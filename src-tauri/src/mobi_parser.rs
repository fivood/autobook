//! Parse a MOBI / AZW3 file into HTML + extracted images.
//!
//! The frontend hands us the file bytes; we run the pure-Rust `mobi` crate,
//! pull out the embedded HTML blob, the images, and a few metadata fields,
//! and send the lot back. Image references inside the HTML use the format
//! `recindex:NNNNN` — we leave those alone and let the frontend rewrite
//! them against the returned `images` array (so we don't bake any large
//! data URIs into the HTML on the Rust side).

use base64::{engine::general_purpose, Engine};
use serde::Serialize;

#[derive(Serialize)]
pub struct ParsedMobiImage {
    /// 1-based index used by `recindex:NNNNN` references in the HTML.
    pub index: usize,
    /// File extension we infer from the magic bytes (jpg / png / gif).
    pub ext: String,
    /// base64-encoded raw bytes.
    pub data: String,
}

#[derive(Serialize)]
pub struct ParsedMobi {
    pub title: String,
    pub author: String,
    pub language: Option<String>,
    pub html: String,
    pub images: Vec<ParsedMobiImage>,
    /// 1-based index into `images` for the cover, or 0 if none.
    pub cover_index: usize,
}

fn replacement_char_ratio(s: &str) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let bad = s.chars().filter(|c| *c == '\u{FFFD}').count() as f32;
    let total = s.chars().count() as f32;
    bad / total
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth: i32 = 0;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// PalmDoc LZ77 decompression — copied from the mobi crate because the
/// crate's `decompress_palmdoc()` is `pub(crate)` and we need the raw bytes
/// before any string conversion so we can try CJK encodings directly.
fn decompress_palmdoc(data: &[u8]) -> Vec<u8> {
    let length = data.len();
    let mut pos: usize = 0;
    let mut text_pos: usize = 0;
    let mut text: Vec<u8> = vec![];

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
                    data[pos..(pos + b)].iter().for_each(|ch| {
                        text.push(*ch);
                        text_pos += 1;
                    });
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

// ── Huff/CDIC decompressor (algorithm from Calibre, reimplemented in Rust) ──

struct HuffDict1Entry {
    codelen: u32,
    term: bool,
    maxcode: u32,
}

pub(crate) struct HuffCdic {
    dict1: Vec<HuffDict1Entry>,
    mincode: Vec<u32>,
    maxcode: Vec<u32>,
    dictionary: Vec<(Vec<u8>, bool)>,
}

impl HuffCdic {
    pub(crate) fn load(huff_record: &[u8], cdic_records: &[&[u8]]) -> Result<Self, String> {
        if huff_record.len() < 24 || &huff_record[0..8] != b"HUFF\x00\x00\x00\x18" {
            return Err("Invalid HUFF header".into());
        }
        let off1 = u32::from_be_bytes([huff_record[8], huff_record[9], huff_record[10], huff_record[11]]) as usize;
        let off2 = u32::from_be_bytes([huff_record[12], huff_record[13], huff_record[14], huff_record[15]]) as usize;

        if off1 + 1024 > huff_record.len() || off2 + 256 > huff_record.len() {
            return Err("HUFF record too short for tables".into());
        }

        let mut dict1 = Vec::with_capacity(256);
        for i in 0..256 {
            let base = off1 + i * 4;
            let v = u32::from_be_bytes([
                huff_record[base], huff_record[base+1],
                huff_record[base+2], huff_record[base+3],
            ]);
            let codelen = v & 0x1F;
            let term = (v & 0x80) != 0;
            let maxcode_raw = v >> 8;
            let maxcode = if codelen > 0 {
                ((maxcode_raw.wrapping_add(1)) << (32 - codelen)).wrapping_sub(1)
            } else {
                0
            };
            dict1.push(HuffDict1Entry { codelen, term, maxcode });
        }

        let mut mincode = vec![0u32; 33];
        let mut maxcode_table = vec![0u32; 33];
        for i in 0..32 {
            let base = off2 + i * 8;
            let min_raw = u32::from_be_bytes([
                huff_record[base], huff_record[base+1],
                huff_record[base+2], huff_record[base+3],
            ]);
            let max_raw = u32::from_be_bytes([
                huff_record[base+4], huff_record[base+5],
                huff_record[base+6], huff_record[base+7],
            ]);
            let cl = i + 1;
            mincode[cl] = min_raw << (32 - cl);
            // `max_raw + 1` can overflow u32 at cl=32 (max_raw=0xFFFFFFFF) — wrap,
            // matching the `.wrapping_sub(1)` already used below (standard HUFF
            // maxcode modular arithmetic). Without this large manga AZW3 files
            // panic in debug builds ("attempt to add with overflow").
            maxcode_table[cl] = ((max_raw.wrapping_add(1)) << (32 - cl)).wrapping_sub(1);
        }

        let mut dictionary: Vec<(Vec<u8>, bool)> = Vec::new();
        for cdic in cdic_records {
            if cdic.len() < 16 || &cdic[0..8] != b"CDIC\x00\x00\x00\x10" {
                return Err("Invalid CDIC header".into());
            }
            let phrases = u32::from_be_bytes([cdic[8], cdic[9], cdic[10], cdic[11]]) as usize;
            let bits = u32::from_be_bytes([cdic[12], cdic[13], cdic[14], cdic[15]]) as usize;
            let n = std::cmp::min(1 << bits, phrases.saturating_sub(dictionary.len()));

            for j in 0..n {
                let off_pos = 16 + j * 2;
                if off_pos + 2 > cdic.len() { break; }
                let off = u16::from_be_bytes([cdic[off_pos], cdic[off_pos+1]]) as usize;
                let data_base = 16 + off;
                if data_base + 2 > cdic.len() { break; }
                let blen = u16::from_be_bytes([cdic[data_base], cdic[data_base+1]]);
                let slice_len = (blen & 0x7FFF) as usize;
                let flag = (blen & 0x8000) != 0;
                let end = std::cmp::min(data_base + 2 + slice_len, cdic.len());
                let slice_data = cdic[data_base + 2..end].to_vec();
                dictionary.push((slice_data, flag));
            }
        }

        Ok(HuffCdic { dict1, mincode, maxcode: maxcode_table, dictionary })
    }

    pub(crate) fn unpack(&mut self, data: &[u8]) -> Vec<u8> {
        let mut bitsleft = (data.len() as i64) * 8;
        let mut padded = data.to_vec();
        padded.extend_from_slice(&[0u8; 8]);

        let mut pos: usize = 0;
        let mut x = self.read_u64(&padded, pos);
        let mut n: i32 = 32;
        let mut result = Vec::new();

        loop {
            if n <= 0 {
                pos += 4;
                x = self.read_u64(&padded, pos);
                n += 32;
            }
            let code = ((x >> n as u64) & 0xFFFF_FFFF) as u32;

            let top8 = (code >> 24) as usize;
            let mut codelen = self.dict1[top8].codelen;
            let term = self.dict1[top8].term;
            let mut maxcode_val = self.dict1[top8].maxcode;

            if !term {
                while codelen < 33 && code < self.mincode[codelen as usize] {
                    codelen += 1;
                }
                if codelen >= 33 { break; }
                maxcode_val = self.maxcode[codelen as usize];
            }

            n -= codelen as i32;
            bitsleft -= codelen as i64;
            if bitsleft < 0 { break; }

            let r = (maxcode_val.wrapping_sub(code) >> (32 - codelen)) as usize;
            if r >= self.dictionary.len() { break; }

            let (slice_data, flag) = self.dictionary[r].clone();
            if flag {
                result.extend_from_slice(&slice_data);
            } else {
                let unpacked = self.unpack(&slice_data);
                result.extend_from_slice(&unpacked);
                self.dictionary[r] = (unpacked, true);
            }
        }
        result
    }

    fn read_u64(&self, data: &[u8], pos: usize) -> u64 {
        if pos + 8 > data.len() { return 0; }
        u64::from_be_bytes([
            data[pos], data[pos+1], data[pos+2], data[pos+3],
            data[pos+4], data[pos+5], data[pos+6], data[pos+7],
        ])
    }
}

/// Decompress all text records using Huff/CDIC.
fn decompress_huffcdic(records: &[&[u8]], rec0: &[u8], text_record_count: usize, extra_flags: u32) -> Option<Vec<u8>> {
    use crate::kf8_parser::strip_record_trailers;

    if rec0.len() < 0x78 { return None; }
    let huff_offset = u32::from_be_bytes([rec0[0x70], rec0[0x71], rec0[0x72], rec0[0x73]]) as usize;
    let huff_count = u32::from_be_bytes([rec0[0x74], rec0[0x75], rec0[0x76], rec0[0x77]]) as usize;

    if huff_offset == 0 || huff_count == 0 { return None; }
    if huff_offset + huff_count > records.len() { return None; }

    let huff_record = records[huff_offset];
    let cdic_records: Vec<&[u8]> = (1..huff_count)
        .map(|i| records[huff_offset + i])
        .collect();

    let mut huff = HuffCdic::load(huff_record, &cdic_records).ok()?;

    let text_end = 1 + text_record_count;
    if text_end > records.len() { return None; }

    let mut bytes = Vec::with_capacity(text_record_count * 4096);
    for record in &records[1..text_end] {
        let trimmed = strip_record_trailers(record, extra_flags);
        bytes.extend(huff.unpack(trimmed));
    }
    Some(bytes)
}

/// Strip MOBI control characters (Calibre's approach).
fn strip_mobi_control_chars(raw: &mut Vec<u8>) {
    raw.retain(|&b| b != 0x00 && b != 0x1E && b != 0x02);
}

/// Extract raw decompressed content bytes by parsing PalmDB directly,
/// bypassing the mobi crate's record handling and string conversion.
/// Returns (bytes, declared_encoding).
pub(crate) fn extract_raw_content_bytes_direct(file_bytes: &[u8]) -> Option<(Vec<u8>, u32)> {
    use crate::kf8_parser::{parse_palmdb_records, strip_record_trailers};

    let (records, _title) = parse_palmdb_records(file_bytes).ok()?;
    if records.is_empty() {
        return None;
    }

    let rec0 = records[0];
    if rec0.len() < 18 {
        return None;
    }

    let compression = u16::from_be_bytes([rec0[0], rec0[1]]);
    let text_record_count = u16::from_be_bytes([rec0[8], rec0[9]]) as usize;

    let text_encoding = if rec0.len() >= 0x20 {
        u32::from_be_bytes([rec0[0x1C], rec0[0x1D], rec0[0x1E], rec0[0x1F]])
    } else {
        65001
    };

    let extra_flags = if rec0.len() >= 0xF4 {
        let mobi_len = u32::from_be_bytes([rec0[0x14], rec0[0x15], rec0[0x16], rec0[0x17]]) as usize;
        if mobi_len >= 0xE4 {
            u16::from_be_bytes([rec0[0xF2], rec0[0xF3]]) as u32
        } else {
            0
        }
    } else {
        0
    };

    let text_end = 1 + text_record_count;
    if text_end > records.len() {
        return None;
    }

    let mut bytes = match compression {
        17480 => {
            // Huff/CDIC
            decompress_huffcdic(&records, rec0, text_record_count, extra_flags)?
        }
        _ => {
            let mut buf = Vec::with_capacity(text_record_count * 4096);
            for record in &records[1..text_end] {
                let trimmed = strip_record_trailers(record, extra_flags);
                match compression {
                    1 => buf.extend_from_slice(trimmed),
                    2 => buf.extend(decompress_palmdoc(trimmed)),
                    _ => return None,
                }
            }
            buf
        }
    };

    strip_mobi_control_chars(&mut bytes);
    Some((bytes, text_encoding))
}

/// Decode UTF-8 bytes with CP1252 fallback for invalid sequences.
/// Many MOBI files declare UTF-8 but embed CP1252 special characters
/// (em-dashes 0x97, curly quotes 0x93/0x94, etc.) whose byte values
/// are invalid in UTF-8.
fn decode_utf8_cp1252_fallback(raw: &[u8]) -> String {
    let mut result = String::with_capacity(raw.len());
    let mut pos = 0;
    while pos < raw.len() {
        match std::str::from_utf8(&raw[pos..]) {
            Ok(s) => {
                result.push_str(s);
                break;
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                // Safe: from_utf8 guarantees [pos..pos+valid_up_to] is valid UTF-8
                result.push_str(unsafe {
                    std::str::from_utf8_unchecked(&raw[pos..pos + valid_up_to])
                });
                pos += valid_up_to;
                // Decode the invalid byte(s) as CP1252
                let error_len = e.error_len().unwrap_or(1);
                for j in 0..error_len {
                    if pos + j < raw.len() {
                        let (ch, _, _) = encoding_rs::WINDOWS_1252.decode(&raw[pos + j..pos + j + 1]);
                        result.push_str(&ch);
                    }
                }
                pos += error_len;
            }
        }
    }
    result
}

/// Pick the best encoding for raw content bytes. Order matters because
/// GBK / Big5 are both permissive single/double-byte encodings — decoding
/// GBK bytes as Big5 yields valid-but-nonsense Hanzi with 0 replacement
/// chars, so a pure replacement-ratio comparison picks Big5 wrongly.
///
/// Strategy: accept the first encoding whose replacement ratio is "low
/// enough" (< 1%), in priority order suited to our user base
/// (Simplified Chinese): UTF-8 → GB18030 → GBK → Big5. GB18030 is a
/// strict superset of GBK and the Chinese national standard, so it
/// covers everything GBK does plus rare CJK ext chars.
fn decode_best(raw: &[u8]) -> String {
    // Strict UTF-8 — clean genuinely-UTF-8 file.
    if let Ok(s) = std::str::from_utf8(raw) {
        return s.to_string();
    }

    // Critical disambiguator: GBK / GB18030 / Big5 are permissive double-byte
    // encodings — decoding UTF-8 Chinese bytes as GBK yields ~0% replacement
    // chars (the bytes happen to map to valid but nonsense Hanzi). So we can't
    // rank purely by replacement ratio.
    //
    // Discriminator: UTF-8 lossy ratio.
    //   - Genuine UTF-8 file with a few trailing/noise bytes:  ratio ~0–5%
    //   - Genuine GBK file decoded as UTF-8:                   ratio ~40–65%
    //                                                          (almost every
    //                                                          high byte starts
    //                                                          an invalid seq)
    // 20% is a wide safe gap between these two regimes.
    let utf8_lossy = String::from_utf8_lossy(raw).into_owned();
    let utf8_ratio = replacement_char_ratio(&utf8_lossy);
    if utf8_ratio < 0.20 {
        return utf8_lossy;
    }

    let (gb18030_str, _, _) = encoding_rs::GB18030.decode(raw);
    let gb18030_ratio = replacement_char_ratio(&gb18030_str);
    if gb18030_ratio < 0.05 {
        return gb18030_str.into_owned();
    }

    let (gbk_str, _, _) = encoding_rs::GBK.decode(raw);
    let gbk_ratio = replacement_char_ratio(&gbk_str);
    if gbk_ratio < 0.05 {
        return gbk_str.into_owned();
    }

    let (big5_str, _, _) = encoding_rs::BIG5.decode(raw);
    let big5_ratio = replacement_char_ratio(&big5_str);

    // Last-resort: lowest ratio wins, with Big5 needing a meaningful margin
    // over Chinese encodings.
    let mut best = (utf8_ratio, utf8_lossy);
    if gb18030_ratio < best.0 {
        best = (gb18030_ratio, gb18030_str.into_owned());
    }
    if gbk_ratio < best.0 {
        best = (gbk_ratio, gbk_str.into_owned());
    }
    if big5_ratio + 0.05 < best.0 {
        best = (big5_ratio, big5_str.into_owned());
    }
    best.1
}

fn detect_image_ext(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "jpg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else {
        "jpg"
    }
}

#[tauri::command]
pub fn parse_mobi(bytes: Vec<u8>) -> Result<ParsedMobi, String> {
    // Wrap the WHOLE pipeline. The mobi crate panics on certain malformed
    // files (esp. AZW3) at various stages — raw_records, palmdoc decode,
    // image extraction — not just Mobi::new. Without an outer catch_unwind,
    // a panic crashes the Tauri command worker and JS sees `null` (which
    // renders as "undefined" through error.message).
    let result: std::thread::Result<Result<ParsedMobi, String>> =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_mobi_inner(&bytes)));
    match result {
        Ok(inner) => inner,
        Err(panic) => {
            let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                format!("mobi parser panicked: {s}")
            } else if let Some(s) = panic.downcast_ref::<String>() {
                format!("mobi parser panicked: {s}")
            } else {
                "mobi parser panicked on this file (unknown). 这通常发生在 AZW3 / KF8 文件上，建议用 Calibre 转成 EPUB 后再导入。".to_string()
            };
            Err(msg)
        }
    }
}

fn parse_mobi_inner(bytes: &[u8]) -> Result<ParsedMobi, String> {
    let all_records = crate::kf8_parser::parse_palmdb_records(bytes)
        .map_err(|e| format!("PalmDB 解析失败: {e}"))?;
    let (records, _palm_title) = &all_records;

    if records.is_empty() {
        return Err("文件不包含有效记录".into());
    }
    let rec0 = records[0];

    // Extract metadata from EXTH / MOBI header (no mobi crate dependency)
    let title = crate::kf8_parser::parse_mobi_full_name(rec0)
        .unwrap_or_else(|| _palm_title.clone());
    let author = crate::kf8_parser::parse_exth_author(rec0)
        .unwrap_or_default();
    let language: Option<String> = None;

    // Decompress text (PalmDoc + Huff/CDIC both handled natively now)
    let (raw_bytes, declared_enc) = extract_raw_content_bytes_direct(bytes)
        .ok_or_else(|| "无法解压文本内容".to_string())?;

    // Encoding: trust declared codec first (Calibre's approach), then sniff
    let html = if declared_enc == 65001 {
        let utf8_result = decode_utf8_cp1252_fallback(&raw_bytes);
        let ratio = replacement_char_ratio(&utf8_result);
        if ratio < 0.20 {
            utf8_result
        } else {
            decode_best(&raw_bytes)
        }
    } else if declared_enc == 1252 {
        // Calibre trusts CP1252 declaration, but Chinese books often lie.
        // Try CP1252 first; if it looks like garbage (CJK content decoded
        // as Latin), fall back to sniffer.
        let (cp1252_str, _, _) = encoding_rs::WINDOWS_1252.decode(&raw_bytes);
        let plain = strip_tags(&cp1252_str);
        let cjk_count = plain.chars().filter(|c| *c as u32 > 0x2E80).count();
        let total = plain.chars().count().max(1);
        if cjk_count * 100 / total > 30 {
            // Looks like CJK text — CP1252 was correct (the raw bytes
            // actually encoded CJK via some double-byte scheme that
            // CP1252 decoded into high Unicode). But more likely the
            // file is actually GBK/GB18030 mislabeled as 1252.
            decode_best(&raw_bytes)
        } else {
            cp1252_str.into_owned()
        }
    } else {
        decode_best(&raw_bytes)
    };

    // Detect KF8:joint / pure KF8 and dispatch to dedicated parser.
    // Pure KF8 (record 0 MOBI header format_version == 8) always goes
    // to try_parse_kf8, even if the MOBI6 codepath above produced text —
    // MOBI6 misreading a KF8 header often "works" (returns some bytes)
    // but yields garbled content, especially for Huff/CDIC-compressed
    // AZW3s where the flow / skeleton structure would otherwise get lost.
    let is_joint = records.iter().any(|r| r.starts_with(b"BOUNDARY"));
    let is_pure_kf8 = rec0.len() >= 16 + 0x60
        && &rec0[16..20] == b"MOBI"
        && u32::from_be_bytes([rec0[16 + 0x58], rec0[16 + 0x59], rec0[16 + 0x5A], rec0[16 + 0x5B]]) == 8;
    let is_kf8_only = strip_tags(&html).trim().chars().count() < 50;
    if is_joint || is_pure_kf8 || is_kf8_only {
        match crate::kf8_parser::try_parse_kf8(bytes) {
            Ok(Some(parsed)) => return Ok(parsed),
            Ok(None) => {
                // No BOUNDARY and not pure KF8 → genuine MOBI6-only (often
                // image-heavy / scanned books with little text). Don't error;
                // fall through to the MOBI6 extraction below so the user gets
                // the book (text + images) instead of a "文件可能损坏" dead-end.
            }
            Err(e) => {
                // KF8 parse failed. Only surface the error to the user if
                // we have no MOBI6 fallback content — the pre-KF8-dispatch
                // MOBI6 codepath sometimes produces readable output even
                // for pure KF8 files (garbled but not empty). Preferring
                // partial content over a dead-end error was the pattern
                // established in 1.16.3 for image-heavy scanned MOBI6.
                let mobi6_len = strip_tags(&html).trim().chars().count();
                if is_joint || mobi6_len < 50 {
                    return Err(format!("KF8 解析失败: {e}"));
                }
                // else: fall through with MOBI6-derived html
            }
        }
    }

    // Extract images
    let mut images = Vec::new();
    let first_img = if rec0.len() >= 0x70 {
        u32::from_be_bytes([rec0[0x6C], rec0[0x6D], rec0[0x6E], rec0[0x6F]]) as usize
    } else {
        0
    };
    let scan_start = if first_img > 0 && first_img < records.len() {
        first_img
    } else {
        let text_count = if rec0.len() >= 10 {
            u16::from_be_bytes([rec0[8], rec0[9]]) as usize
        } else {
            0
        };
        text_count + 1
    };
    for (i, record) in records[scan_start..].iter().enumerate() {
        if record.starts_with(&[0xFF, 0xD8, 0xFF])
            || record.starts_with(&[0x89, b'P', b'N', b'G'])
            || record.starts_with(b"GIF8")
        {
            let ext = detect_image_ext(record);
            images.push(ParsedMobiImage {
                index: i + 1,
                ext: ext.to_string(),
                data: general_purpose::STANDARD.encode(record),
            });
        }
    }
    let cover_index = crate::kf8_parser::parse_exth_cover_offset(rec0)
        .filter(|&idx| idx > 0 && idx <= images.len())
        .unwrap_or_else(|| if images.is_empty() { 0 } else { 1 });

    Ok(ParsedMobi {
        title,
        author,
        language,
        html,
        images,
        cover_index,
    })
}
