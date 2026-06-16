//! Parse a MOBI / AZW3 file into HTML + extracted images.
//!
//! The frontend hands us the file bytes; we run the pure-Rust `mobi` crate,
//! pull out the embedded HTML blob, the images, and a few metadata fields,
//! and send the lot back. Image references inside the HTML use the format
//! `recindex:NNNNN` — we leave those alone and let the frontend rewrite
//! them against the returned `images` array (so we don't bake any large
//! data URIs into the HTML on the Rust side).

use base64::{engine::general_purpose, Engine};
use mobi::Mobi;
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

/// Public wrapper around the encoding sniffer for use by sibling modules
/// (kf8_parser). Same algorithm as `decode_best`.
pub fn decode_best_public(raw: &[u8]) -> String {
    decode_best(raw)
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

/// Extract raw decompressed content bytes by parsing PalmDB directly,
/// bypassing the mobi crate's record handling and string conversion.
/// Returns (bytes, declared_encoding) or None for Huffman compression.
/// declared_encoding: 1252 = CP1252, 65001 = UTF-8.
fn extract_raw_content_bytes_direct(file_bytes: &[u8]) -> Option<(Vec<u8>, u32)> {
    use crate::kf8_parser::{parse_palmdb_records, strip_record_trailers};

    let (records, _title) = parse_palmdb_records(file_bytes).ok()?;
    if records.is_empty() {
        return None;
    }

    let rec0 = records[0];
    if rec0.len() < 18 {
        return None;
    }

    // PalmDoc header (first 16 bytes of record 0):
    //   0x00 compression u16 (1=none, 2=PalmDoc, 17480=Huff)
    //   0x08 text_record_count u16
    let compression = u16::from_be_bytes([rec0[0], rec0[1]]);
    let text_record_count = u16::from_be_bytes([rec0[8], rec0[9]]) as usize;

    if compression == 17480 {
        return None; // Huff/CDIC
    }

    // text_encoding at record offset 0x1C (MOBI header offset 0x0C)
    let text_encoding = if rec0.len() >= 0x20 {
        u32::from_be_bytes([rec0[0x1C], rec0[0x1D], rec0[0x1E], rec0[0x1F]])
    } else {
        65001
    };

    // extra_record_data_flags: u16 at record offset 0xF2, only if MOBI
    // header length (at record offset 0x14) >= 0xE4.
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

    // Text records are records 1..=text_record_count
    let text_end = 1 + text_record_count;
    if text_end > records.len() {
        return None;
    }

    let mut bytes = Vec::with_capacity(text_record_count * 4096);
    for record in &records[1..text_end] {
        let trimmed = strip_record_trailers(record, extra_flags);
        match compression {
            1 => bytes.extend_from_slice(trimmed),
            2 => bytes.extend(decompress_palmdoc(trimmed)),
            _ => return None,
        }
    }
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

/// Fallback for Huffman-compressed files: reverse-engineer the original
/// bytes from a WIN1252-decoded string and try CJK encodings.
fn win1252_string_to_bytes(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut enc = encoding_rs::WINDOWS_1252.new_encoder();
    let mut input = s;
    let mut buf = vec![0u8; s.len() * 2 + 16];
    loop {
        let (result, read, written, _) = enc.encode_from_utf8(input, &mut buf, true);
        out.extend_from_slice(&buf[..written]);
        match result {
            encoding_rs::CoderResult::InputEmpty => break,
            encoding_rs::CoderResult::OutputFull => {
                input = &input[read..];
            }
        }
    }
    out
}

fn decode_via_win1252_roundtrip(primary: &str) -> String {
    let bytes = win1252_string_to_bytes(primary);
    let primary_ratio = replacement_char_ratio(primary);
    let (gbk_str, _, gbk_err) = encoding_rs::GBK.decode(&bytes);
    let gbk_ratio = if gbk_err {
        1.0
    } else {
        replacement_char_ratio(&gbk_str)
    };
    let (gb18030_str, _, gb18030_err) = encoding_rs::GB18030.decode(&bytes);
    let gb18030_ratio = if gb18030_err {
        1.0
    } else {
        replacement_char_ratio(&gb18030_str)
    };
    let mut best = (primary_ratio, primary.to_string());
    if gbk_ratio + 0.001 < best.0 {
        best = (gbk_ratio, gbk_str.into_owned());
    }
    if gb18030_ratio + 0.001 < best.0 {
        best = (gb18030_ratio, gb18030_str.into_owned());
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
    let mobi = Mobi::new(&bytes.to_vec()).map_err(|e| format!("解析失败: {e}"))?;

    let title = mobi.title();
    let author = mobi.author().unwrap_or_default();
    let language = Some(format!("{:?}", mobi.language()));

    // Try direct PalmDB parsing first (bypasses mobi crate's record handling).
    // Falls back to mobi crate for Huff/CDIC compressed files.
    let html = if let Some((raw_bytes, declared_enc)) = extract_raw_content_bytes_direct(bytes) {
        if declared_enc == 65001 {
            // Declared UTF-8: use UTF-8 with CP1252 fallback for invalid bytes.
            // Many MOBI files mix UTF-8 text with CP1252 special chars (0x80-0x9F).
            let utf8_result = decode_utf8_cp1252_fallback(&raw_bytes);
            let ratio = replacement_char_ratio(&utf8_result);
            if ratio < 0.20 {
                utf8_result
            } else {
                // Too many replacements → probably not UTF-8 at all, run sniffer
                decode_best(&raw_bytes)
            }
        } else if declared_enc == 1252 {
            // Declared CP1252: might actually be GBK/GB18030, run sniffer
            decode_best(&raw_bytes)
        } else {
            decode_best(&raw_bytes)
        }
    } else {
        // Huffman compression: fall back to crate's string + WIN1252 roundtrip
        let primary = mobi
            .content_as_string()
            .unwrap_or_else(|_| mobi.content_as_string_lossy());
        decode_via_win1252_roundtrip(&primary)
    };

    // Detect KF8:joint / pure KF8 and dispatch to the dedicated KF8 parser.
    let is_joint = crate::kf8_parser::parse_palmdb_records(bytes)
        .map(|(records, _)| records.iter().any(|r| r.starts_with(b"BOUNDARY")))
        .unwrap_or(false);
    let is_kf8_only = strip_tags(&html).trim().chars().count() < 50;
    if is_joint || is_kf8_only {
        match crate::kf8_parser::try_parse_kf8(bytes) {
            Ok(Some(parsed)) => return Ok(parsed),
            Ok(None) => {
                // No KF8 segment found but MOBI6 content is empty — likely a
                // truly broken file.
                return Err(
                    "本文件 MOBI6 段为空且未找到 KF8 段，文件可能损坏。"
                        .into(),
                );
            }
            Err(e) => {
                return Err(format!(
                    "KF8 解析失败: {e}\n临时方案：用 Calibre 把它转成 EPUB 后再导入。"
                ));
            }
        }
    }

    // Extract images from PalmDB records directly.
    let mut images = Vec::new();
    let mut cover_index = 0usize;
    if let Ok((all_records, _)) = crate::kf8_parser::parse_palmdb_records(bytes) {
        let rec0 = all_records.get(0).copied().unwrap_or(&[]);
        // first_image_index at record offset 0x6C (MOBI sig 0x5C)
        let first_img = if rec0.len() >= 0x70 {
            u32::from_be_bytes([rec0[0x6C], rec0[0x6D], rec0[0x6E], rec0[0x6F]]) as usize
        } else {
            0
        };
        let scan_start = if first_img > 0 && first_img < all_records.len() {
            first_img
        } else {
            // fallback: start after text records
            let text_count = if rec0.len() >= 10 {
                u16::from_be_bytes([rec0[8], rec0[9]]) as usize
            } else {
                0
            };
            text_count + 1
        };
        for (i, record) in all_records[scan_start..].iter().enumerate() {
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
        // Cover from EXTH CoverOffset
        cover_index = crate::kf8_parser::parse_exth_cover_offset(rec0)
            .filter(|&idx| idx > 0 && idx <= images.len())
            .unwrap_or_else(|| if images.is_empty() { 0 } else { 1 });
    }

    Ok(ParsedMobi {
        title,
        author,
        language,
        html,
        images,
        cover_index,
    })
}
