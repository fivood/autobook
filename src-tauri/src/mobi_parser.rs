//! Parse a MOBI / AZW3 file into HTML + extracted images.
//!
//! The frontend hands us the file bytes; we run the pure-Rust `mobi` crate,
//! pull out the embedded HTML blob, the images, and a few metadata fields,
//! and send the lot back. Image references inside the HTML use the format
//! `recindex:NNNNN` — we leave those alone and let the frontend rewrite
//! them against the returned `images` array (so we don't bake any large
//! data URIs into the HTML on the Rust side).

use base64::{engine::general_purpose, Engine};
use mobi::headers::Compression;
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

/// Extract raw decompressed content bytes, bypassing the mobi crate's
/// string conversion which destroys CJK byte sequences via
/// `String::from_utf8_lossy`. Returns None for Huffman compression
/// (where we'd need the complex Huffman tables — rare for Chinese books).
fn extract_raw_content_bytes(mobi: &Mobi) -> Option<Vec<u8>> {
    let compression = mobi.compression();
    let range = mobi.readable_records_range();
    let records = mobi.raw_records();
    let readable = records.range(range);

    match compression {
        Compression::No => {
            let mut bytes = Vec::new();
            for record in readable {
                bytes.extend_from_slice(record.content);
            }
            Some(bytes)
        }
        Compression::PalmDoc => {
            let mut bytes = Vec::new();
            for record in readable {
                bytes.extend(decompress_palmdoc(record.content));
            }
            Some(bytes)
        }
        Compression::Huff => None,
    }
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

    // Try to get raw bytes and decode with proper CJK encoding detection.
    // This bypasses the mobi crate's lossy UTF-8/WIN1252 conversion that
    // destroys GBK byte sequences.
    let html = if let Some(raw_bytes) = extract_raw_content_bytes(&mobi) {
        decode_best(&raw_bytes)
    } else {
        // Huffman compression: fall back to crate's string + WIN1252 roundtrip
        let primary = mobi
            .content_as_string()
            .unwrap_or_else(|_| mobi.content_as_string_lossy());
        decode_via_win1252_roundtrip(&primary)
    };

    // Detect KF8:joint files. They contain a record whose content is the
    // 8-byte marker `BOUNDARY`, after which all subsequent records belong to
    // the KF8 segment (the modern format Amazon uses). The MOBI6 portion of
    // a joint file is intentionally degraded — usually just a "use a newer
    // Kindle" stub or a tiny excerpt — so passing it through silently makes
    // the user think the book is broken. Reject up-front with a clear hint.
    //
    // Also catches pure AZW3 / KF8 where the MOBI6 segment is empty.
    let is_joint = mobi
        .raw_records()
        .records()
        .iter()
        .any(|r| r.content == b"BOUNDARY");
    let is_kf8_only = strip_tags(&html).trim().chars().count() < 50;
    if is_joint || is_kf8_only {
        return Err(
            "本文件是 AZW3 / KF8 格式（Amazon 新版 Kindle 格式），AutoBook 目前还在做原生 KF8 解析。临时方案：用 Calibre 把它转成 EPUB 后再导入。下个大版本会原生支持 KF8。"
                .into(),
        );
    }

    let mut images = Vec::new();
    for (i, raw) in mobi.image_records().iter().enumerate() {
        let content = raw.content;
        if content.is_empty() {
            continue;
        }
        let ext = detect_image_ext(content).to_string();
        images.push(ParsedMobiImage {
            index: i + 1,
            ext,
            data: general_purpose::STANDARD.encode(content),
        });
    }

    let cover_index = mobi
        .metadata
        .exth
        .get_record(mobi::headers::ExthRecord::CoverOffset)
        .and_then(|vals| vals.first())
        .and_then(|bytes| {
            if bytes.len() >= 4 {
                Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize + 1)
            } else {
                None
            }
        })
        .unwrap_or(0);

    Ok(ParsedMobi {
        title,
        author,
        language,
        html,
        images,
        cover_index,
    })
}
