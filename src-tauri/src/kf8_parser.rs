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
    /// NCX / TOC index (MOBI-sig+0xE4), Phase 4.
    ncx_record: u32,
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

    // Field offsets — all MOBI-sig-relative unless noted. Cross-referenced
    // against KindleUnpack (mobi_header.py) and Calibre (mobi/reader/headers.py).
    //   0x0C text_encoding      (1252 = CP1252, 65001 = UTF-8)
    //   0x40 first_non_book_index
    //   0x58 format_version     (8 = KF8)
    //   0x5C first_image_index
    //   0x60 huff_record / 0x64 huff_count
    //   0xB0 fdst_index / 0xB4 fdst_count           (KF8 only)
    //   0xE4 ncx_index                               (navigation, ignored)
    //   0xE8 chunks_index (aka fragment)             (KF8 Phase 3)
    //   0xEC skeleton_index                          (KF8 Phase 2)
    // Header layout was probed empirically — several online references
    // disagree about which of 0xE8 / 0xEC is skeleton vs. chunks. In our
    // sample corpus the TAGX shape at 0xEC is `(1, 1, 3, 0), (6, 2, 12, 0)`
    // which matches the documented skeleton layout (num_frags + [offset,
    // length] pair encoded as tag 6 with num_values=2).
    //   0xF2 extra_record_data_flags (u16) — record-relative, not sig-relative
    // Cross-checked KindleUnpack mobi_header.py and Calibre latest;
    // Phase 1 misread these (skeleton at 0xEC and fragment/skeleton
    // swapped) which yielded NCX rows shaped like `off=1 len=0` when we
    // tried to use them in Phase 2.
    h.text_encoding = read_u32_be(record, mobi_start + 0x0C);
    h.first_non_book_index = read_u32_be(record, mobi_start + 0x40);
    h.format_version = read_u32_be(record, mobi_start + 0x58);
    h.first_image_index = read_u32_be(record, mobi_start + 0x5C);
    h.huff_record = read_u32_be(record, mobi_start + 0x60);
    h.huff_count = read_u32_be(record, mobi_start + 0x64);
    h.fdst_record = read_u32_be(record, mobi_start + 0xB0);
    h.fdst_count = read_u32_be(record, mobi_start + 0xB4);
    h.ncx_record = read_u32_be(record, mobi_start + 0xE4);
    h.fragment_record = read_u32_be(record, mobi_start + 0xE8);
    h.skeleton_record = read_u32_be(record, mobi_start + 0xEC);
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
/// Strip trailing metadata from a text record. Matches Calibre's
/// sizeof_trailing_entries: bits 1+ processed in ascending order (bit 1's
/// trailer is outermost), then bit 0 (multibyte overlap).
pub fn strip_record_trailers(record: &[u8], flags: u32) -> &[u8] {
    let size = record.len();
    let mut num: usize = 0;

    let mut f = flags >> 1;
    while f != 0 {
        if f & 1 == 1 {
            let ts = sizeof_trailing_entry(record, size - num);
            if ts == 0 || ts > size - num {
                return record;
            }
            num += ts;
        }
        f >>= 1;
    }

    if flags & 1 == 1 && size > num {
        let off = size - num - 1;
        num += (record[off] & 0x03) as usize + 1;
    }

    if num >= size { return &record[..0]; }
    &record[..size - num]
}

/// Calibre-compatible backward varint. Reads from position psize-1 backward;
/// first byte read (at end) occupies lowest bits. MSB=1 is the stop signal.
fn sizeof_trailing_entry(data: &[u8], psize: usize) -> usize {
    let mut bitpos: u32 = 0;
    let mut result: usize = 0;
    let mut p = psize;
    loop {
        if p == 0 { return result; }
        p -= 1;
        let v = data[p] as usize;
        result |= (v & 0x7F) << bitpos;
        bitpos += 7;
        if (v & 0x80) != 0 || bitpos >= 28 {
            return result;
        }
    }
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
pub fn parse_exth_author(record0: &[u8]) -> Option<String> {
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
pub fn parse_mobi_full_name(record0: &[u8]) -> Option<String> {
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

/// Phase 2 fallback: no fragment table available, so we can only slice
/// each skeleton's full raw byte range (template + fragments back-to-back).
/// HTML output isn't strictly valid — fragments trail past `</html>` —
/// but tolerant parsers still render it.
fn reassemble_phase2_concat(
    skels: &[crate::kf8_indx::SkeletonRow],
    raw_html_bytes: &[u8],
    flow0_end: usize,
) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::with_capacity(flow0_end.saturating_sub(skels[0].offset as usize));
    let ends: Vec<usize> = (0..skels.len())
        .map(|i| {
            if i + 1 < skels.len() {
                skels[i + 1].offset as usize
            } else {
                flow0_end
            }
        })
        .collect();
    let mut kept = 0usize;
    for (i, row) in skels.iter().enumerate() {
        let start = row.offset as usize;
        let end = ends[i].min(raw_html_bytes.len());
        if start >= end || start >= raw_html_bytes.len() {
            continue;
        }
        buf.extend_from_slice(b"<mbp:pagebreak/>");
        buf.extend_from_slice(&raw_html_bytes[start..end]);
        kept += 1;
    }
    if kept < 2 {
        buf.clear();
    }
    buf
}

/// Phase 3: fragment-into-skeleton reassembly. For each skeleton,
/// interleave its fragment bytes into the template at each fragment's
/// insert_pos. Produces byte-accurate per-section XHTML.
///
/// Matches Calibre `mobi8.py::Mobi8Reader::write_opf` — per-file layout
/// is `base_xml[0:ip_1] + frag_1_data + base_xml[ip_1:ip_2] + frag_2_data
/// + ... + base_xml[ip_N:]`. Fragment start_pos and length come directly
/// from the fragment row (tag 6 tuple), not derived from position gaps.
/// Grouping by parent skeleton is via `parent_ord` (Calibre's
/// `file_number`, tag 3), which is populated for every well-formed KF8.
fn reassemble_with_fragments(
    skels: &[crate::kf8_indx::SkeletonRow],
    frags: &[crate::kf8_indx::FragmentRow],
    raw_html_bytes: &[u8],
    _flow0_end: usize,
    cncx_pool: &[u8],
    ncx_labels: &[Option<String>],
) -> Vec<u8> {
    // Group fragments by parent skeleton ordinal (Calibre `file_number`,
    // tag 3). Fall back to sequential grouping by num_fragments if
    // parent_ord looks bogus for the whole file.
    let use_parent_ord = frags.iter().any(|f| f.parent_ord > 0)
        && frags.iter().all(|f| (f.parent_ord as usize) < skels.len());
    let mut groups: Vec<Vec<&crate::kf8_indx::FragmentRow>> = vec![Vec::new(); skels.len()];
    if use_parent_ord {
        for f in frags {
            groups[f.parent_ord as usize].push(f);
        }
    } else {
        let mut cursor = 0usize;
        for (i, s) in skels.iter().enumerate() {
            let take = (s.num_fragments as usize).min(frags.len().saturating_sub(cursor));
            for f in &frags[cursor..cursor + take] {
                groups[i].push(f);
            }
            cursor += take;
        }
    }

    let total_estimate: usize = skels.iter().map(|s| s.length as usize).sum::<usize>()
        + frags.iter().map(|f| f.length as usize).sum::<usize>()
        + skels.len() * 16;
    let mut buf: Vec<u8> = Vec::with_capacity(total_estimate);
    let mut kept = 0usize;

    for (i, skel) in skels.iter().enumerate() {
        let tpl_start = skel.offset as usize;
        let tpl_end = (tpl_start + skel.length as usize).min(raw_html_bytes.len());
        if tpl_start >= tpl_end {
            continue;
        }
        let base_xml = &raw_html_bytes[tpl_start..tpl_end];

        // Fragment bytes for this skeleton live in raw text starting
        // right after the template (i.e. at skel.offset + skel.length).
        // Fragment.start_pos is an offset within that region, not an
        // absolute offset — Calibre's `mobi8.py` computes fragment data
        // as `text[fragment_start + start_pos : + length]`.
        let frag_base = tpl_end;

        let mut group = groups[i].clone();
        // Reassemble in insert_pos order — walk the template linearly.
        group.sort_by_key(|f| f.insert_pos);

        buf.extend_from_slice(b"<mbp:pagebreak/>");
        // Prefer the NCX-derived chapter label (real epub TOC name).
        // Fall back to the fragment table's CNCX only if it isn't an
        // xpath position anchor (e.g. `P-//*[@aid='UGI0']`, which is
        // what fragment CNCX actually holds in practice) — this branch
        // is defensive and rarely fires. If neither has a usable name,
        // omit the marker and let the frontend scan `<h*>` in the body.
        let label: Option<String> = ncx_labels
            .get(i)
            .cloned()
            .flatten()
            .or_else(|| {
                let first = group.first()?;
                if first.toc_cncx == 0 || cncx_pool.is_empty() {
                    return None;
                }
                let name = crate::kf8_indx::read_cncx_name(cncx_pool, first.toc_cncx)?;
                let looks_like_xpath =
                    name.starts_with("P-//") || name.starts_with("//*[") || name.contains("[@aid");
                if looks_like_xpath || name.trim().is_empty() {
                    None
                } else {
                    Some(name)
                }
            });
        if let Some(l) = label {
            let sanitized = l.replace("-->", "-- >");
            buf.extend_from_slice(b"<!--autobook-section-label:");
            buf.extend_from_slice(sanitized.as_bytes());
            buf.extend_from_slice(b"-->");
        }
        let mut cur = 0usize;
        for f in &group {
            let ip = (f.insert_pos as usize).min(base_xml.len());
            if ip > cur {
                buf.extend_from_slice(&base_xml[cur..ip]);
                cur = ip;
            }
            let fs = frag_base + f.start_pos as usize;
            let fe = (fs + f.length as usize).min(raw_html_bytes.len());
            if fs < fe && fs < raw_html_bytes.len() {
                buf.extend_from_slice(&raw_html_bytes[fs..fe]);
            }
        }
        if cur < base_xml.len() {
            buf.extend_from_slice(&base_xml[cur..]);
        }
        kept += 1;
    }

    if kept < 2 {
        buf.clear();
    }
    buf
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

    // Pure KF8 (record 0 is a KF8 header, fv==8) takes precedence over the
    // BOUNDARY scan: some AZW3 files have a valid KF8 header at record 0 AND
    // a BOUNDARY marker later (a secondary/legacy segment). Previously the
    // BOUNDARY scan won and pointed kf8_start past it, where records[boundary+1]
    // isn't a PalmDoc+MOBI header → "expected MOBI signature" error.
    let kf8_start = if is_pure_kf8(records[0]) {
        0
    } else {
        match find_boundary_index(&records) {
            Some(boundary) => boundary + 1,
            None => return Ok(None),
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

    // Huff/CDIC decoder is loaded once and reused across all text
    // records if this KF8 uses compression==17480. huff_record and
    // huff_count in the KF8 header are relative to the KF8 segment.
    let mut huff: Option<crate::mobi_parser::HuffCdic> = None;
    if header.compression == 17480 {
        if header.huff_record == 0 || header.huff_count == 0 {
            return Err("KF8 Huff/CDIC-compressed but header.huff_record==0".into());
        }
        let huff_abs = kf8_start + header.huff_record as usize;
        if huff_abs + header.huff_count as usize > records.len() {
            return Err("KF8 Huff/CDIC record range extends past file".into());
        }
        let cdic_records: Vec<&[u8]> = (1..header.huff_count as usize)
            .map(|i| records[huff_abs + i])
            .collect();
        match crate::mobi_parser::HuffCdic::load(records[huff_abs], &cdic_records) {
            Ok(h) => huff = Some(h),
            Err(e) => return Err(format!("KF8 Huff/CDIC init failed: {e}")),
        }
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
            17480 => match huff.as_mut() {
                Some(h) => h.unpack(trimmed),
                None => return Err("KF8 Huff/CDIC decoder not initialized".into()),
            },
            other => {
                return Err(format!(
                    "unknown KF8 compression type: {other} (expected 1, 2, or 17480)"
                ));
            }
        };
        raw_html_bytes.extend_from_slice(&chunk);
    }

    if raw_html_bytes.is_empty() {
        return Err("KF8 text records decompressed to nothing".into());
    }

    // Phase 2: use FDST to slice out flow 0 (the HTML container).
    // Everything past flow 0 is CSS files, SVG image masks, and other
    // resources concatenated into the same decompressed byte stream.
    // Phase 1 returned all of it, dumping raw CSS + SVG markup into the
    // visible content. Phase 2 keeps only flow 0.
    let mut flow0_range: Option<(usize, usize)> = None;
    let fdst_abs = kf8_start.saturating_add(header.fdst_record as usize);
    if header.fdst_record != 0
        && header.fdst_record != u32::MAX
        && header.fdst_count > 0
        && fdst_abs < records.len()
    {
        // FDST usually lives in a single record but the header allows
        // multiple — concatenate them before parsing.
        let end_rec = (fdst_abs + header.fdst_count as usize).min(records.len());
        let mut concat: Vec<u8> = Vec::new();
        for i in fdst_abs..end_rec {
            concat.extend_from_slice(records[i]);
        }
        if let Ok(flows) = crate::kf8_indx::parse_fdst(&concat) {
            if let Some(first) = flows.first() {
                let s = first.start as usize;
                let e = (first.end as usize).min(raw_html_bytes.len());
                if s < e {
                    flow0_range = Some((s, e));
                }
            }
        }
    }
    let (flow0_start, flow0_end) = flow0_range.unwrap_or((0, raw_html_bytes.len()));
    let flow0_bytes = &raw_html_bytes[flow0_start..flow0_end];

    // Phase 2/3: skeleton INDX + fragment INDX — reassemble flow 0 into
    // per-section HTML with fragments inserted into their parent
    // skeleton's template at the correct filepos.
    //
    // Phase 2 (fallback if fragment parse fails): concatenate
    //   raw[skel.offset .. next_skel.offset)
    // for each row. Template + fragments end up back-to-back (fragments
    // fall after `</html>`), but tolerant HTML parsers still read the
    // whole thing.
    //
    // Phase 3 (when fragment table parses): for each skeleton, interleave
    // fragment content into the template at each fragment's insert_pos.
    // The result is byte-accurate to the epub source's per-file HTML,
    // one document per skeleton row, joined by <mbp:pagebreak/> so the
    // frontend's splitIntoSections regex picks up the section
    // boundaries.
    let mut skeleton_split: Option<Vec<u8>> = None;
    if header.skeleton_record != 0 && header.skeleton_record != u32::MAX {
        let skel_prim_abs = kf8_start + header.skeleton_record as usize;
        let frag_prim_abs = kf8_start + header.fragment_record as usize;
        if skel_prim_abs < records.len() {
            let primary = records[skel_prim_abs];
            let data_count = crate::kf8_indx::primary_indx_data_count(primary);
            let data_records: Vec<&[u8]> = (1..=data_count)
                .filter_map(|i| records.get(skel_prim_abs + i).copied())
                .collect();

            let skel_rows = crate::kf8_indx::parse_skeleton_indx(primary, &data_records)
                .ok()
                .filter(|r| !r.is_empty());

            // Try fragment table too. If it parses, do Phase 3
            // reassembly; if not, fall back to Phase 2 concat. Also load
            // the fragment INDX's CNCX pool so we can attach real chapter
            // titles to each section (Calibre's `toc_text` semantic).
            let (frag_rows, cncx_pool) = if header.fragment_record != 0
                && header.fragment_record != u32::MAX
                && frag_prim_abs < records.len()
            {
                let f_prim = records[frag_prim_abs];
                let f_data_count = crate::kf8_indx::primary_indx_data_count(f_prim);
                let f_cncx_count = crate::kf8_indx::primary_indx_cncx_count(f_prim);
                let f_data_records: Vec<&[u8]> = (1..=f_data_count)
                    .filter_map(|i| records.get(frag_prim_abs + i).copied())
                    .collect();
                let cncx_start = frag_prim_abs + 1 + f_data_count;
                let mut cncx_pool: Vec<u8> = Vec::new();
                for i in 0..f_cncx_count {
                    if let Some(rec) = records.get(cncx_start + i) {
                        cncx_pool.extend_from_slice(rec);
                    }
                }
                let rows = crate::kf8_indx::parse_fragment_indx(f_prim, &f_data_records)
                    .ok()
                    .filter(|r| !r.is_empty());
                (rows, cncx_pool)
            } else {
                (None, Vec::new())
            };

            // Also try to load NCX (real TOC with human-readable chapter
            // names). Its CNCX pool holds the chapter titles; each row's
            // position is a byte offset in flow 0 we can match to a
            // skeleton by nearest-preceding.
            let (ncx_rows, ncx_cncx_pool) = if header.ncx_record != 0
                && header.ncx_record != u32::MAX
                && (kf8_start + header.ncx_record as usize) < records.len()
            {
                let ncx_prim_abs = kf8_start + header.ncx_record as usize;
                let n_prim = records[ncx_prim_abs];
                let n_data_count = crate::kf8_indx::primary_indx_data_count(n_prim);
                let n_cncx_count = crate::kf8_indx::primary_indx_cncx_count(n_prim);
                let n_data_records: Vec<&[u8]> = (1..=n_data_count)
                    .filter_map(|i| records.get(ncx_prim_abs + i).copied())
                    .collect();
                let n_cncx_start = ncx_prim_abs + 1 + n_data_count;
                let mut pool: Vec<u8> = Vec::new();
                for i in 0..n_cncx_count {
                    if let Some(rec) = records.get(n_cncx_start + i) {
                        pool.extend_from_slice(rec);
                    }
                }
                let rows = crate::kf8_indx::parse_ncx_indx(n_prim, &n_data_records)
                    .ok()
                    .filter(|r| !r.is_empty());
                (rows, pool)
            } else {
                (None, Vec::new())
            };

            if let Some(skels) = skel_rows {
                // Build per-skeleton label lookup from NCX by finding the
                // top-level (depth 0 or 1) NCX entry whose position falls
                // in [skel.offset, next_skel.offset). Chapter names come
                // from the NCX's own CNCX pool.
                let skel_labels: Vec<Option<String>> = if let Some(nrows) = &ncx_rows {
                    let mut top_level: Vec<&crate::kf8_indx::NcxRow> = nrows
                        .iter()
                        .filter(|n| n.depth == 0 || n.depth == 1)
                        .collect();
                    if top_level.is_empty() {
                        top_level = nrows.iter().collect();
                    }
                    top_level.sort_by_key(|n| n.position);
                    (0..skels.len())
                        .map(|i| {
                            let start = skels[i].offset;
                            let end = if i + 1 < skels.len() {
                                skels[i + 1].offset
                            } else {
                                flow0_end as u32
                            };
                            top_level
                                .iter()
                                .find(|n| n.position >= start && n.position < end)
                                .and_then(|n| crate::kf8_indx::read_cncx_name(&ncx_cncx_pool, n.name_cncx))
                                .filter(|s| !s.trim().is_empty())
                        })
                        .collect()
                } else {
                    vec![None; skels.len()]
                };

                let buf = match frag_rows {
                    Some(frags) => reassemble_with_fragments(
                        &skels,
                        &frags,
                        raw_html_bytes.as_slice(),
                        flow0_end,
                        &cncx_pool,
                        &skel_labels,
                    ),
                    None => reassemble_phase2_concat(
                        &skels,
                        raw_html_bytes.as_slice(),
                        flow0_end,
                    ),
                };
                if !buf.is_empty() {
                    skeleton_split = Some(buf);
                }
            }
        }
    }

    let final_bytes: &[u8] = skeleton_split.as_deref().unwrap_or(flow0_bytes);

    let html = if header.text_encoding == 1252 {
        encoding_rs::WINDOWS_1252.decode(final_bytes).0.into_owned()
    } else {
        String::from_utf8_lossy(final_bytes).into_owned()
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
