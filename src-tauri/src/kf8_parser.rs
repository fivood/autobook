//! KF8 (a.k.a. AZW3) parser. Handles two file shapes:
//!
//! 1. **MOBI:joint**: a single PalmDB file containing a full MOBI6 segment, a
//!    record whose content is exactly the 8-byte `BOUNDARY` marker, and then
//!    a complete KF8 segment after it.
//! 2. **Pure KF8** (.azw3): the file is just one KF8 segment starting at
//!    record 0. No BOUNDARY marker, no MOBI6.
//!
//! A KF8 segment looks structurally like a MOBI6 segment — it starts with a
//! record whose payload is `[16-byte PalmDoc header][MOBI header v8]`, then
//! has compressed text records, then resource records (images, fonts, CSS),
//! and uses skeleton / fragment tables to reassemble the HTML on the fly.
//!
//! Phase 1 (this file): parse the MOBIv8 header, decompress the text records
//! into one concatenated HTML blob, decode as the appropriate encoding,
//! extract image records, and return — same shape as mobi_parser. We skip
//! skeleton/chunk reassembly: KF8 text records ARE HTML chunks, so simple
//! concatenation gives a readable (if structurally messy) document, which
//! is already a huge improvement over the current "use Calibre" error.
//!
//! Phase 2 (next): parse FDST + skeleton + chunk index tables so the HTML
//! comes out with proper structure, then split into sections on flow
//! boundaries.

use base64::{engine::general_purpose, Engine};
use serde::Serialize;

use crate::mobi_parser::{ParsedMobi, ParsedMobiImage};

/// MOBIv8 header subset we need. All offsets are from the start of the MOBI
/// signature (`b"MOBI"`), which lives at byte 16 of the first KF8 record
/// (after the 16-byte PalmDoc header).
#[derive(Debug, Serialize, Default)]
struct Mobi8Header {
    /// Should be `b"MOBI"`.
    identifier: [u8; 4],
    /// Total header length including the 8 bytes of identifier+length.
    header_length: u32,
    /// 1252 = WIN1252, 65001 = UTF-8, anything else = unknown.
    text_encoding: u32,
    /// Records before this one are content; this and after are non-book
    /// (NCX, FDST, skeleton, chunks, etc.). Relative to KF8 segment start.
    first_non_book_index: u32,
    /// Should be `8` for KF8.
    format_version: u32,
    /// Record index of the first image. Relative to KF8 segment start.
    first_image_index: u32,
    /// Huff/CDIC record index (Phase 3 will handle huff/cdic decompression).
    huff_record: u32,
    huff_count: u32,
    /// Compression type from the PalmDoc header preceding this MOBI header.
    /// 1=none, 2=PalmDoc, 17480=Huff/CDIC. Filled in by caller.
    compression: u16,
    /// Number of compressed text records, from PalmDoc header. This is the
    /// most reliable text-record-count source — first_non_book_index can be
    /// 0 or unreliable in some KF8 files.
    text_record_count: u16,
    /// Extra record data flags — bitfield telling us what trailing data each
    /// content record has. Lowest bit = multibyte trailer, higher bits = a
    /// varint-length trailer each.
    extra_record_data_flags: u32,
    /// FDST table record index (relative to KF8 start), for Phase 2.
    fdst_record: u32,
    fdst_count: u32,
    /// Skeleton + chunk indices (Phase 2). Offsets per KindleUnpack:
    ///   fragment_table at record offset 0xF8 → MOBI sig + 0xE8
    ///   skeleton_table at record offset 0xFC → MOBI sig + 0xEC
    fragment_record: u32,
    skeleton_record: u32,
}

/// Read a big-endian u32 from `bytes` at `offset`, returning 0 if out of
/// bounds (instead of panicking). Lots of MOBI files have truncated headers.
fn read_u32_be(bytes: &[u8], offset: usize) -> u32 {
    if offset + 4 > bytes.len() {
        return 0;
    }
    u32::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn read_u16_be(bytes: &[u8], offset: usize) -> u16 {
    if offset + 2 > bytes.len() {
        return 0;
    }
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

/// Parse the MOBIv8 header from the first record of a KF8 segment.
/// `record` is the FULL record content (PalmDoc 16 bytes + MOBI header).
fn parse_mobi8_header(record: &[u8]) -> Result<Mobi8Header, String> {
    if record.len() < 16 + 8 {
        return Err("KF8 record too short for MOBI header".into());
    }
    // PalmDoc header: u16 compression, u16 unused, u32 text_length,
    // u16 record_count, u16 record_size, u16 encryption_type, u16 unused.
    let compression = read_u16_be(record, 0);

    // MOBI header sits at offset 16.
    let mobi_start = 16;
    let identifier_slice = &record[mobi_start..mobi_start + 4];
    if identifier_slice != b"MOBI" {
        return Err(format!(
            "expected MOBI signature at offset 16, got {:?}",
            std::str::from_utf8(identifier_slice).unwrap_or("?")
        ));
    }
    let mut h = Mobi8Header::default();
    h.identifier.copy_from_slice(identifier_slice);
    h.compression = compression;
    h.header_length = read_u32_be(record, mobi_start + 4);

    // Field offsets within the MOBI header (relative to MOBI signature):
    //   0x0C text_encoding
    //   0x40 first_non_book_index
    //   0x58 format_version (8 = KF8)
    //   0x5C first_image_index
    //   0x60 huff_record
    //   0x64 huff_count
    //   0xC8 fdst_record (KF8 stores it here, MOBI6 leaves zero)
    //   0xCC fdst_count
    //   0xC0 skeleton_record (KF8 only)
    //   0xC4 chunks_record (KF8 only)
    h.text_encoding = read_u32_be(record, mobi_start + 0x0C);
    h.first_non_book_index = read_u32_be(record, mobi_start + 0x40);
    h.format_version = read_u32_be(record, mobi_start + 0x58);
    h.first_image_index = read_u32_be(record, mobi_start + 0x5C);
    h.huff_record = read_u32_be(record, mobi_start + 0x60);
    h.huff_count = read_u32_be(record, mobi_start + 0x64);
    // KindleUnpack-verified offsets (record-relative, so subtract 16 for MOBI-sig-relative):
    //   0xB0: fdst_table, 0xB4: fdst_count, 0xE8: fragment_table, 0xEC: skeleton_table
    h.fdst_record = read_u32_be(record, mobi_start + 0xB0);
    h.fdst_count = read_u32_be(record, mobi_start + 0xB4);
    // KindleUnpack: fragment at record offset 0xF4, skeleton at record offset 0xFC
    h.fragment_record = read_u32_be(record, 0xF4);
    h.skeleton_record = read_u32_be(record, 0xFC);
    // extra_record_data_flags: u16 at record offset 0xF2 (KindleUnpack-verified).
    h.extra_record_data_flags = read_u16_be(record, 0xF2) as u32;

    // PalmDoc header (bytes 0..16 of the same record):
    //   0x00 compression u16  | 0x02 unused u16
    //   0x04 text_length u32
    //   0x08 record_count u16  ← number of text records, the gold-standard count
    //   0x0A record_size u16  | 0x0C encryption u16  | 0x0E unused u16
    h.text_record_count = read_u16_be(record, 0x08);

    Ok(h)
}

/// Strip trailing data appended to a content record per `extra_record_data_flags`.
/// Each high bit (1..31) of the flags adds a varint-length-prefixed trailer at
/// the end. Bit 0 adds a 1-byte multibyte char overlap count, also at the end.
/// We process from the highest bit down, peeling bytes off the end.
pub fn strip_record_trailers(record: &[u8], flags: u32) -> &[u8] {
    let mut len = record.len();
    // Process bits 31..1 in descending order.
    let mut bit = 31usize;
    while bit > 0 {
        if (flags >> bit) & 1 == 1 {
            // Trailer is a backward-encoded varint: read bytes from end while
            // the high bit (continuation marker, here actually the MSB acts as
            // a stop signal in MOBI's reversed scheme). We read up to 4 bytes.
            let trailer_size = read_backward_varint(&record[..len]);
            if trailer_size == 0 || trailer_size > len {
                return record; // bad data, bail
            }
            len -= trailer_size;
        }
        bit -= 1;
    }
    // Bit 0: a single byte at the end indicating how many bytes of the next
    // record's first multibyte char spill into this one. We discard them since
    // they're metadata, not text.
    if flags & 1 == 1 && len > 0 {
        let n = (record[len - 1] & 0x03) as usize + 1;
        if n <= len {
            len -= n;
        }
    }
    &record[..len]
}

/// MOBI's backward-encoded varint: read from end, each byte contributes 7 bits,
/// MSB=1 marks the FIRST byte (i.e. the last byte read going backward), so we
/// stop after reading a byte with MSB set. Returns the total decoded value AND
/// includes its own byte count in the value (so subtracting yields the data
/// before the trailer).
fn read_backward_varint(bytes: &[u8]) -> usize {
    let mut val: usize = 0;
    for i in 1..=4 {
        if bytes.len() < i {
            return 0;
        }
        let b = bytes[bytes.len() - i];
        val = (val << 7) | (b & 0x7F) as usize;
        if b & 0x80 != 0 {
            return val;
        }
    }
    0
}

/// Locate the BOUNDARY record in `raw_records` content. Returns the index of
/// the BOUNDARY record itself; the KF8 segment starts at `index + 1`.
fn find_boundary_index(raw_records: &[&[u8]]) -> Option<usize> {
    raw_records
        .iter()
        .position(|r| r.starts_with(b"BOUNDARY"))
}

/// Decide whether a file is pure KF8 by looking at the MOBI signature in
/// record 0. Pure KF8 has format_version == 8 at the very first MOBI header.
fn is_pure_kf8(record_0: &[u8]) -> bool {
    if record_0.len() < 16 + 0x60 {
        return false;
    }
    if &record_0[16..20] != b"MOBI" {
        return false;
    }
    read_u32_be(record_0, 16 + 0x58) == 8
}

/// PalmDoc decompression — same algorithm used by MOBI6, shared here so we
/// don't depend on mobi crate's private impl.
fn decompress_palmdoc(data: &[u8]) -> Vec<u8> {
    let length = data.len();
    let mut pos: usize = 0;
    let mut text_pos: usize = 0;
    let mut text: Vec<u8> = Vec::with_capacity(length * 2);

    let mut prev = None;
    while pos < length {
        let byte = data[pos];
        pos += 1;
        match byte {
            new if prev.is_some() => {
                let old = prev.take().unwrap();
                let mut dist_len_bytes = u16::from_be_bytes([old, new]);
                dist_len_bytes &= 0x3fff;
                let offset = (dist_len_bytes >> 3) as usize;
                let len = ((dist_len_bytes & 0x0007) + 3) as usize;
                let start = if offset > text_pos {
                    if text_pos == 0 {
                        return text;
                    }
                    offset % text_pos
                } else {
                    text_pos - offset
                };
                let end = if start + len >= text.len() {
                    text.len()
                } else {
                    start + len
                };
                for i in start..end {
                    text.push(text[i]);
                    text_pos += 1;
                }
            }
            0x0 | 0x09..=0x7f => {
                text.push(byte);
                text_pos += 1;
            }
            0x1..=0x8 => {
                let b = byte as usize;
                if pos + b <= length {
                    for ch in &data[pos..(pos + b)] {
                        text.push(*ch);
                        text_pos += 1;
                    }
                    pos += b;
                }
            }
            0x80..=0xbf => {
                if pos >= text.len() {
                    return text;
                }
                prev = Some(byte);
            }
            _ => {
                text.push(b' ');
                text.push(byte ^ 0x80);
                text_pos += 2;
            }
        }
    }
    text
}

fn detect_image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else {
        None
    }
}

/// Parse PalmDB header and extract record byte slices from raw file bytes,
/// bypassing the mobi crate entirely. Returns (records, title, num_records).
pub fn parse_palmdb_records(bytes: &[u8]) -> Result<(Vec<&[u8]>, String), String> {
    if bytes.len() < 78 + 8 {
        return Err("file too short for PalmDB header".into());
    }
    // PalmDB title: first 32 bytes, null-terminated
    let title_end = bytes[..32].iter().position(|&b| b == 0).unwrap_or(32);
    let title = String::from_utf8_lossy(&bytes[..title_end]).to_string();

    let num_records = read_u16_be(bytes, 76) as usize;
    if num_records == 0 {
        return Err("PalmDB has 0 records".into());
    }
    // Record info list starts at offset 78, each entry is 8 bytes
    let info_end = 78 + num_records * 8;
    if info_end > bytes.len() {
        return Err("PalmDB record info list extends past file".into());
    }

    let mut offsets = Vec::with_capacity(num_records);
    for i in 0..num_records {
        let off = read_u32_be(bytes, 78 + i * 8) as usize;
        offsets.push(off);
    }

    let mut records = Vec::with_capacity(num_records);
    for i in 0..num_records {
        let start = offsets[i];
        let end = if i + 1 < num_records {
            offsets[i + 1]
        } else {
            bytes.len()
        };
        if start > bytes.len() || end > bytes.len() || start > end {
            records.push(&bytes[0..0]);
        } else {
            records.push(&bytes[start..end]);
        }
    }
    Ok((records, title))
}

/// Try to extract EXTH CoverOffset from raw record 0 bytes.
pub fn parse_exth_cover_offset(record0: &[u8]) -> Option<usize> {
    // EXTH header sits right after the MOBI header. MOBI header starts at
    // offset 16, its length is at mobi+4.
    if record0.len() < 24 {
        return None;
    }
    let mobi_len = read_u32_be(record0, 20) as usize; // offset 16+4
    let exth_start = 16 + mobi_len;
    if exth_start + 12 > record0.len() {
        return None;
    }
    if &record0[exth_start..exth_start + 4] != b"EXTH" {
        return None;
    }
    let exth_count = read_u32_be(record0, exth_start + 8) as usize;
    let mut pos = exth_start + 12;
    for _ in 0..exth_count {
        if pos + 8 > record0.len() {
            break;
        }
        let rec_type = read_u32_be(record0, pos);
        let rec_len = read_u32_be(record0, pos + 4) as usize;
        if rec_len < 8 || pos + rec_len > record0.len() {
            break;
        }
        // CoverOffset = EXTH type 201
        if rec_type == 201 && rec_len >= 12 {
            let offset = read_u32_be(record0, pos + 8) as usize;
            return Some(offset + 1); // 1-based for our image array
        }
        pos += rec_len;
    }
    None
}

/// Try to extract author from EXTH records.
fn parse_exth_author(record0: &[u8]) -> Option<String> {
    if record0.len() < 24 {
        return None;
    }
    let mobi_len = read_u32_be(record0, 20) as usize;
    let exth_start = 16 + mobi_len;
    if exth_start + 12 > record0.len() {
        return None;
    }
    if &record0[exth_start..exth_start + 4] != b"EXTH" {
        return None;
    }
    let exth_count = read_u32_be(record0, exth_start + 8) as usize;
    let mut pos = exth_start + 12;
    for _ in 0..exth_count {
        if pos + 8 > record0.len() {
            break;
        }
        let rec_type = read_u32_be(record0, pos);
        let rec_len = read_u32_be(record0, pos + 4) as usize;
        if rec_len < 8 || pos + rec_len > record0.len() {
            break;
        }
        // Author = EXTH type 100
        if rec_type == 100 {
            let data = &record0[pos + 8..pos + rec_len];
            return Some(String::from_utf8_lossy(data).to_string());
        }
        pos += rec_len;
    }
    None
}

/// Extract the "full name" from MOBI record 0. The MOBI header stores
/// full_name_offset at record offset 0x54 and full_name_length at 0x58.
/// These are offsets from the START of record 0.
fn parse_mobi_full_name(record0: &[u8]) -> Option<String> {
    if record0.len() < 0x5C {
        return None;
    }
    let name_offset = read_u32_be(record0, 0x54) as usize;
    let name_length = read_u32_be(record0, 0x58) as usize;
    if name_offset > 0 && name_length > 0 && name_offset + name_length <= record0.len() {
        Some(String::from_utf8_lossy(&record0[name_offset..name_offset + name_length]).to_string())
    } else {
        None
    }
}

/// Top-level entry. Returns `Ok(Some(parsed))` if the file is KF8 (joint or
/// pure) and we managed to parse it, `Ok(None)` if the file is pure MOBI6
/// (caller should use the legacy MOBI6 path), or `Err` if parse failed.
pub fn try_parse_kf8(bytes: &[u8]) -> Result<Option<ParsedMobi>, String> {
    let (records, palm_title) =
        parse_palmdb_records(bytes).map_err(|e| format!("PalmDB parse: {e}"))?;
    if records.is_empty() {
        return Ok(None);
    }

    let kf8_start = match find_boundary_index(&records) {
        Some(boundary) => boundary + 1,
        None => {
            if is_pure_kf8(records[0]) {
                0
            } else {
                return Ok(None);
            }
        }
    };

    if kf8_start >= records.len() {
        return Err("KF8 boundary marker is last record, no KF8 segment after it".into());
    }

    let kf8_records = &records[kf8_start..];
    let header = parse_mobi8_header(kf8_records[0])?;

    if header.format_version != 8 {
        return Err(format!(
            "expected KF8 format_version 8, got {}",
            header.format_version
        ));
    }

    if header.compression == 17480 {
        return Err(
            "本文件使用 Huff/CDIC 压缩，KF8 解析器还在做（计划 1.6.0）。临时方案：用 Calibre 转 EPUB。"
                .into(),
        );
    }

    // Title: prefer MOBI full-name from KF8 header record, then from MOBI6
    // header (record 0), then PalmDB title.
    let title = parse_mobi_full_name(kf8_records[0])
        .or_else(|| {
            if kf8_start > 0 {
                parse_mobi_full_name(records[0])
            } else {
                None
            }
        })
        .unwrap_or(palm_title);
    let author = parse_exth_author(kf8_records[0])
        .or_else(|| {
            if kf8_start > 0 {
                parse_exth_author(records[0])
            } else {
                None
            }
        })
        .unwrap_or_default();

    let text_start = kf8_start + 1;
    let text_count = header.text_record_count as usize;
    let mut text_end = text_start + text_count;
    if text_end > records.len() {
        text_end = records.len();
    }
    if text_end <= text_start {
        return Err(format!(
            "KF8 PalmDoc header reports {text_count} text records — nothing to decompress."
        ));
    }

    let mut raw_html_bytes: Vec<u8> = Vec::with_capacity(text_count * 4096);
    for record in &records[text_start..text_end] {
        let trimmed = strip_record_trailers(record, header.extra_record_data_flags);
        let chunk = match header.compression {
            1 => trimmed.to_vec(),
            2 => decompress_palmdoc(trimmed),
            other => {
                return Err(format!(
                    "unknown KF8 compression type: {other} (expected 1 or 2)"
                ));
            }
        };
        raw_html_bytes.extend_from_slice(&chunk);
    }

    if raw_html_bytes.is_empty() {
        return Err("KF8 text records decompressed to nothing".into());
    }

    let html = if header.text_encoding == 1252 {
        encoding_rs::WINDOWS_1252.decode(&raw_html_bytes).0.into_owned()
    } else {
        String::from_utf8_lossy(&raw_html_bytes).into_owned()
    };

    let first_image_abs = kf8_start + header.first_image_index as usize;
    let resource_scan_start = if first_image_abs > text_end && first_image_abs < records.len() {
        first_image_abs
    } else {
        text_end
    };
    let mut images = Vec::new();
    for (i, record) in records[resource_scan_start..].iter().enumerate() {
        if let Some(ext) = detect_image_ext(record) {
            images.push(ParsedMobiImage {
                index: i + 1,
                ext: ext.to_string(),
                data: general_purpose::STANDARD.encode(record),
            });
        }
    }

    let exth_cover = parse_exth_cover_offset(kf8_records[0])
        .or_else(|| {
            if kf8_start > 0 {
                parse_exth_cover_offset(records[0])
            } else {
                None
            }
        })
        .filter(|&idx| idx > 0 && idx <= images.len())
        .unwrap_or(0);
    let cover_index = if exth_cover > 0 {
        exth_cover
    } else if !images.is_empty() {
        1
    } else {
        0
    };

    Ok(Some(ParsedMobi {
        title,
        author,
        language: None,
        html,
        images,
        cover_index,
    }))
}
