//! Diagnostic: scan a directory of MOBI/AZW3 files through the native
//! `parse_mobi` parser (bypassing Calibre) and write per-file quality reports
//! to find files the Phase-2 KF8 skeleton/chunk/FDST work would improve, and to
//! verify parser bug fixes don't regress.
//!
//! Not a hermetic unit test — it reads a directory you point it at via the
//! `AUTOBOOK_MOBI_SCAN_DIR` env var, so it's `#[ignore]`d (skipped in CI).
//! Run (PowerShell): `$env:AUTOBOOK_MOBI_SCAN_DIR='E:\book'; cargo test --lib scan_e_book -- --ignored --nocapture`
//! Reports land in the OS temp dir (mobi_scan.tsv / mobi_deep.tsv / mobi_inspect.txt).

#![cfg(test)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::mobi_parser::{extract_raw_content_bytes_direct, parse_mobi};
use crate::kf8_parser::{parse_palmdb_records, try_parse_kf8};

/// Scan dir from `AUTOBOOK_MOBI_SCAN_DIR`. None when unset/empty so the tests
/// self-skip (CI never runs them against a missing path).
fn scan_dir() -> Option<String> {
    std::env::var("AUTOBOOK_MOBI_SCAN_DIR")
        .ok()
        .filter(|s| !s.is_empty())
}

fn temp_report(name: &str) -> PathBuf {
    std::env::temp_dir().join(name)
}

fn walk(root: &Path, exts: &[&str], out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, exts, out);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if exts.contains(&ext.to_lowercase().as_str()) {
                out.push(path);
            }
        }
    }
}

fn count(hay: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    let mut n = 0;
    let mut start = 0;
    while let Some(i) = hay[start..].find(needle) {
        n += 1;
        start += i + needle.len();
    }
    n
}

/// U+FFFD replacement-char ratio — high = wrong text encoding picked.
fn fffd_ratio(s: &str) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let bad = s.chars().filter(|c| *c == '\u{FFFD}').count() as f32;
    let total = s.chars().count() as f32;
    bad / total
}

#[test]
#[ignore]
fn scan_e_book_quality() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => {
            eprintln!("AUTOBOOK_MOBI_SCAN_DIR unset; skipping scan_e_book_quality");
            return;
        }
    };
    let report = temp_report("mobi_scan.tsv");
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw", "azw3", "prc"], &mut files);
    files.sort();

    let mut tsv = String::new();
    tsv.push_str(
        "file\text\tsize_kb\tjoint\tparse\thtml_chars\tchars_per_kb\timages\trecindex\tpagebreak\tfffd_ratio\terror\n",
    );

    let mut n_ok = 0usize;
    let mut n_err = 0usize;

    for f in &files {
        let name = f
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
            .replace('\t', " ");
        let ext = f
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let size_kb = f.metadata().map(|m| m.len() / 1024).unwrap_or(0);

        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(e) => {
                tsv.push_str(&format!(
                    "{name}\t{ext}\t{size_kb}\t?\tread_err\t0\t0\t0\t0\t0\t0\t{e}\n"
                ));
                n_err += 1;
                continue;
            }
        };

        // joint = MOBI6 + BOUNDARY + KF8. Detect the 8-byte BOUNDARY marker.
        let joint = bytes.windows(8).any(|w| w == b"BOUNDARY");

        match parse_mobi(bytes) {
            Ok(p) => {
                n_ok += 1;
                let html = &p.html;
                let html_chars = html.chars().count();
                let images = p.images.len();
                let recindex = count(html, "recindex:");
                let pagebreak = count(html, "mbp:pagebreak") + count(html, "page-break-after");
                let ffrd = fffd_ratio(html);
                let chars_per_kb = if size_kb > 0 { html_chars / size_kb as usize } else { 0 };
                tsv.push_str(&format!(
                    "{name}\t{ext}\t{size_kb}\t{joint}\tok\t{html_chars}\t{chars_per_kb}\t{images}\t{recindex}\t{pagebreak}\t{ffrd:.4}\t\n"
                ));
            }
            Err(e) => {
                n_err += 1;
                let short: String = e.chars().take(200).collect::<String>().replace('\n', " ");
                tsv.push_str(&format!(
                    "{name}\t{ext}\t{size_kb}\t{joint}\terr\t0\t0\t0\t0\t0\t0\t{short}\n"
                ));
            }
        }
    }

    let summary = format!(
        "\n--- scan summary: {} files, {} ok, {} err ---\nreport: {}\n",
        files.len(),
        n_ok,
        n_err,
        report.display()
    );
    tsv.push_str(&summary);
    if let Ok(mut f) = fs::File::create(&report) {
        let _ = f.write_all(tsv.as_bytes());
    }
    eprint!("{summary}");
}

fn read_be_u32_safe(buf: &[u8], off: usize) -> u32 {
    if off + 4 > buf.len() {
        return 0;
    }
    u32::from_be_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

/// Deep-dive only the files that `parse_mobi` errors on — dump PalmDB record
/// layout, BOUNDARY position, raw text-extraction byte count, and the KF8
/// parser's verdict so we can tell false `is_kf8_only` (text extraction failed
/// → misdispatched to KF8) from genuine missing-KF8 from a try_parse_kf8 bug.
#[test]
#[ignore]
fn deep_dive_errors() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => {
            eprintln!("AUTOBOOK_MOBI_SCAN_DIR unset; skipping deep_dive_errors");
            return;
        }
    };
    let report = temp_report("mobi_deep.tsv");
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw", "azw3", "prc"], &mut files);
    files.sort();

    let mut tsv = String::new();
    tsv.push_str(
        "file\text\tsize_kb\tparse_err\tn_records\trec0_len\tmobi_sig16\tfirst_img\thuff_off\thuff_cnt\tboundary_idx\traw_bytes\tdecl_enc\tkf8_result\n",
    );

    let mut found = 0usize;
    for f in &files {
        let name = f
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
            .replace('\t', " ");
        let ext = f
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let size_kb = f.metadata().map(|m| m.len() / 1024).unwrap_or(0);

        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(_) => continue,
        };

        // Only deep-dive files that error.
        let parse_err: String = match crate::mobi_parser::parse_mobi(bytes.clone()) {
            Ok(_) => continue,
            Err(e) => e.chars().take(120).collect::<String>().replace('\n', " "),
        };
        found += 1;

        let (n_records, rec0_len, mobi_sig16, first_img, huff_off, huff_cnt, boundary_idx) =
            match parse_palmdb_records(&bytes) {
                Ok((records, _title)) => {
                    let rec0 = records.first().copied().unwrap_or(&[]);
                    let mobi_sig = rec0.len() >= 20 && &rec0[16..20] == b"MOBI";
                    let bidx = records
                        .iter()
                        .position(|r| r.starts_with(b"BOUNDARY"))
                        .map(|i| i.to_string())
                        .unwrap_or_else(|| "none".into());
                    (
                        records.len() as u32,
                        rec0.len() as u32,
                        mobi_sig,
                        read_be_u32_safe(rec0, 0x6C),
                        read_be_u32_safe(rec0, 0x70),
                        read_be_u32_safe(rec0, 0x74),
                        bidx,
                    )
                }
                Err(_) => (0, 0, false, 0, 0, 0, "palmdb_err".into()),
            };

        let (raw_bytes, declared_enc) = match extract_raw_content_bytes_direct(&bytes) {
            Some((b, enc)) => (b.len() as u32, enc),
            None => (0, 0),
        };

        let kf8_result = match try_parse_kf8(&bytes) {
            Ok(Some(_)) => "Ok(Some)".into(),
            Ok(None) => "Ok(None)".into(),
            Err(e) => format!(
                "Err: {}",
                e.chars().take(80).collect::<String>().replace('\n', " ")
            ),
        };

        tsv.push_str(&format!(
            "{name}\t{ext}\t{size_kb}\t{parse_err}\t{n_records}\t{rec0_len}\t{mobi_sig16}\t{first_img}\t{huff_off}\t{huff_cnt}\t{boundary_idx}\t{raw_bytes}\t{declared_enc}\t{kf8_result}\n"
        ));
    }

    let summary = format!("\n--- deep-dive: {} error files ---\n", found);
    tsv.push_str(&summary);
    if let Ok(mut f) = fs::File::create(&report) {
        let _ = f.write_all(tsv.as_bytes());
    }
    eprint!("{summary}deep report: {}\n", report.display());
}

fn hex_prefix(buf: &[u8], n: usize) -> String {
    let end = std::cmp::min(n, buf.len());
    buf[..end]
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

/// For each error file: dump bytes around the BOUNDARY record and scan ALL
/// records for a KF8 header (MOBI@16 + format_version==8). This tells us
/// whether a KF8 segment exists (and where) for the "no KF8 found" files,
/// and what's actually at records[boundary+1] for the "expected MOBI sig" file.
#[test]
#[ignore]
fn inspect_error_records() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => {
            eprintln!("AUTOBOOK_MOBI_SCAN_DIR unset; skipping inspect_error_records");
            return;
        }
    };
    let report = temp_report("mobi_inspect.txt");
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw", "azw3", "prc"], &mut files);
    files.sort();

    let mut out = String::new();
    let mut found = 0usize;

    for f in &files {
        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(_) => continue,
        };
        // Only inspect error files.
        if crate::mobi_parser::parse_mobi(bytes.clone()).is_ok() {
            continue;
        }
        found += 1;
        let name = f
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push_str(&format!("\n=== {} ===\n", name));

        let records = match parse_palmdb_records(&bytes) {
            Ok((r, _)) => r,
            Err(e) => {
                out.push_str(&format!("palmdb err: {e}\n"));
                continue;
            }
        };
        out.push_str(&format!("n_records: {}\n", records.len()));

        let boundary = records.iter().position(|r| r.starts_with(b"BOUNDARY"));
        out.push_str(&format!("boundary_idx: {:?}\n", boundary));

        if let Some(b) = boundary {
            for off in [0i64, 1, 2] {
                let idx = b as i64 + off;
                if idx < 0 || idx as usize >= records.len() {
                    continue;
                }
                let r = records[idx as usize];
                let mobi = r.len() >= 20 && &r[16..20] == b"MOBI";
                let fv = if r.len() >= 0x6C {
                    read_be_u32_safe(r, 0x68)
                } else {
                    0
                };
                out.push_str(&format!(
                    "  records[{}]: len={} mobi@16={} fv={} hex[0..24]={}\n",
                    idx,
                    r.len(),
                    mobi,
                    fv,
                    hex_prefix(r, 24)
                ));
            }
        }

        // Scan all records for a KF8 header (MOBI@16 + fv==8), list first 10.
        let kf8_headers: Vec<(usize, u32)> = records
            .iter()
            .enumerate()
            .filter(|(_, r)| r.len() >= 0x6C && &r[16..20] == b"MOBI" && read_be_u32_safe(r, 0x68) == 8)
            .map(|(i, r)| (i, read_be_u32_safe(r, 0x68)))
            .take(10)
            .collect();
        out.push_str(&format!("kf8-header records (MOBI@16 + fv==8): {:?}\n", kf8_headers));

        // Also list MOBI6 headers (fv==6) for context.
        let mobi6_headers: Vec<usize> = records
            .iter()
            .enumerate()
            .filter(|(_, r)| r.len() >= 0x6C && &r[16..20] == b"MOBI" && read_be_u32_safe(r, 0x68) == 6)
            .map(|(i, _)| i)
            .take(5)
            .collect();
        out.push_str(&format!("mobi6-header records (fv==6): {:?}\n", mobi6_headers));
    }

    let summary = format!("\n--- inspect: {} error files ---\n", found);
    out.push_str(&summary);
    if let Ok(mut f) = fs::File::create(&report) {
        let _ = f.write_all(out.as_bytes());
    }
    eprint!("{summary}inspect report: {}\n", report.display());
}

