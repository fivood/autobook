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

/// Reverse-engineer the original bytes from a WIN1252-decoded string. The
/// mobi crate only ever decodes as UTF-8 or WIN1252 — and WIN1252 is a
/// near-bijective single-byte encoding so each `char` in the lossy output
/// corresponds to exactly one source byte (with a handful of multi-byte
/// quirks for 0x80..0x9F). This lets us get back to raw bytes without
/// needing the crate's private palmdoc decoder.
fn win1252_string_to_bytes(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let encoder = encoding_rs::WINDOWS_1252.new_encoder();
    let mut input = s;
    let mut buf = vec![0u8; s.len() * 2 + 16];
    let mut enc = encoder;
    loop {
        let (result, read, written, _had_unmappable) =
            enc.encode_from_utf8(input, &mut buf, true);
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
    // Run the parser on a worker thread so a panic inside the mobi crate
    // (malformed AZW3 has been known to trip it) doesn't kill the Tauri
    // runtime.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        Mobi::new(&bytes).map_err(|e| format!("parse failed: {e}"))
    }));
    let mobi = match result {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("mobi parser panicked on this file".into()),
    };

    let title = mobi.title();
    let author = mobi.author().unwrap_or_default();
    let language = Some(format!("{:?}", mobi.language()));

    // mobi crate only knows about UTF-8 / WIN1252, so Chinese .mobi files
    // typically encoded in GBK come out as `\u{FFFD}`-laced soup. If the
    // crate's preferred decode looks bad, try GBK on the raw decompressed
    // bytes (we collect them from the per-record decompression that the
    // crate already does internally).
    let primary = mobi
        .content_as_string()
        .unwrap_or_else(|_| mobi.content_as_string_lossy());
    // The mobi crate only knows UTF-8 / WIN1252. Chinese .mobi files are
    // usually GBK — round-trip the primary string through WIN1252 bytes and
    // try decoding as GBK; if that yields fewer replacement chars, use it.
    let html = {
        let bytes = win1252_string_to_bytes(&primary);
        let (gbk_str, _, gbk_had_errors) = encoding_rs::GBK.decode(&bytes);
        let primary_ratio = replacement_char_ratio(&primary);
        let gbk_ratio = replacement_char_ratio(&gbk_str);
        if !gbk_had_errors && gbk_ratio + 0.001 < primary_ratio {
            gbk_str.into_owned()
        } else {
            primary
        }
    };

    // If the readable MOBI6 portion of an AZW3 / KF8 file is empty we end up
    // here with a few bytes of header noise but no real content. Surface a
    // clean error instead of importing an empty book.
    if strip_tags(&html).trim().chars().count() < 50 {
        return Err(
            "本文件看起来是 AZW3 / KF8 格式，当前 MOBI parser 只能读 legacy MOBI6 部分，KF8 章节为空。请尝试用 Calibre 转成 EPUB 后再导入。"
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

    // EXTH record 201 holds the cover image index (0-based into image_records).
    // get_record returns Option<&Vec<Vec<u8>>> — outer vec is the multi-value
    // list, we take the first 4 bytes of the first record as a big-endian u32.
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
