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
use crate::kf8_indx::{parse_fdst, parse_skeleton_indx, primary_indx_data_count};

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
/// Scan directory for any KF8 file whose PalmDoc header reports
/// compression == 17480 (Huff/CDIC). Prints names so we can verify Huff
/// KF8 decoding lands correctly.
#[test]
#[ignore]
fn find_huff_kf8_files() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => return,
    };
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw", "azw3", "prc"], &mut files);
    files.sort();
    let mut found = 0;
    for f in &files {
        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let (records, _) = match parse_palmdb_records(&bytes) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let boundary = records.iter().position(|r| r.starts_with(b"BOUNDARY"));
        let is_pure_kf8 = records
            .first()
            .map(|r| r.len() >= 0x78 && &r[16..20] == b"MOBI" && read_be_u32_safe(r, 16 + 0x58) == 8)
            .unwrap_or(false);
        let kf8_start = if is_pure_kf8 {
            0
        } else if let Some(b) = boundary {
            b + 1
        } else {
            continue;
        };
        if kf8_start >= records.len() {
            continue;
        }
        let hdr = records[kf8_start];
        if hdr.len() < 2 {
            continue;
        }
        let comp = u16::from_be_bytes([hdr[0], hdr[1]]);
        if comp == 17480 {
            let name = f.file_name().and_then(|s| s.to_str()).unwrap_or("?");
            let sz = f.metadata().map(|m| m.len() / 1024).unwrap_or(0);
            println!("HUFF-KF8: {name} ({sz} KB)");
            found += 1;
        }
    }
    println!("total Huff/CDIC KF8 files: {found}");
}

/// Dump first 6 fragments (raw fields) for 刺客正传2 so we can hand-check
/// against Calibre's expected values.
#[test]
#[ignore]
fn phase3_dump_fragment_rows() {
    use crate::kf8_indx::{parse_fragment_indx, primary_indx_data_count};
    let path = r"E:\book\刺客正传2·皇家刺客 - 罗宾·霍布.mobi";
    let bytes = fs::read(path).expect("read file");
    let (records, _) = parse_palmdb_records(&bytes).expect("palmdb");
    // Locate KF8 segment
    let boundary = records.iter().position(|r| r.starts_with(b"BOUNDARY"));
    let kf8_start = boundary.map(|b| b + 1).unwrap_or(0);
    let hdr = records[kf8_start];
    let frag_idx = read_be_u32_safe(hdr, 16 + 0xE8);
    let frag_abs = kf8_start + frag_idx as usize;
    let primary = records[frag_abs];
    let dc = primary_indx_data_count(primary);
    let data_records: Vec<&[u8]> = (1..=dc)
        .filter_map(|i| records.get(frag_abs + i).copied())
        .collect();
    let frags = parse_fragment_indx(primary, &data_records).expect("frags");
    for (i, f) in frags.iter().take(10).enumerate() {
        eprintln!("frag[{i}]: insert_pos={} parent_ord={} start_pos={} length={} toc_cncx={}",
            f.insert_pos, f.parent_ord, f.start_pos, f.length, f.toc_cncx);
    }
}

/// For 3 hand-picked joint KF8 files, run try_parse_kf8, split the
/// returned HTML at `<mbp:pagebreak/>` markers, and dump per-section
/// char counts + a strip_tags-ed word count. Paired against Calibre
/// `ebook-convert` output on the same files to verify Phase 3
/// reassembly is semantically equivalent.
#[test]
#[ignore]
fn phase3_calibre_compare_dump() {
    let targets = [
        r"E:\book\亨利·詹姆斯小说系列（套装共5册).mobi",
        r"E:\book\刺客正传2·皇家刺客 - 罗宾·霍布.mobi",
        r"E:\book\卡拉马佐夫兄弟 (陀思妥耶夫斯基) (Z-Library).mobi",
    ];
    let out_dir = std::env::temp_dir().join("phase3_verify");
    let _ = fs::create_dir_all(&out_dir);
    for path in &targets {
        let base = std::path::Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let bytes = match fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("skip {base}: {e}");
                continue;
            }
        };
        let parsed = match try_parse_kf8(&bytes) {
            Ok(Some(p)) => p,
            _ => {
                eprintln!("skip {base}: not KF8 or parse failed");
                continue;
            }
        };
        // Split at pagebreak marker (same regex load-mobi uses, minus the
        // more esoteric variants).
        let sections: Vec<&str> = parsed.html.split("<mbp:pagebreak/>").collect();
        let report = out_dir.join(format!("{base}.tsv"));
        let mut tsv = String::from("idx\tchars\ttext_chars\thead\n");
        for (i, s) in sections.iter().enumerate() {
            let chars = s.chars().count();
            // strip tags to get rough text char count
            let mut depth = 0i32;
            let mut text_chars = 0usize;
            for c in s.chars() {
                match c {
                    '<' => depth += 1,
                    '>' if depth > 0 => depth -= 1,
                    _ if depth == 0 => text_chars += 1,
                    _ => {}
                }
            }
            let head: String = s.chars().skip_while(|c| c.is_whitespace()).take(40).collect();
            let head = head.replace('\t', " ").replace('\n', " ");
            tsv.push_str(&format!("{i}\t{chars}\t{text_chars}\t{head}\n"));
        }
        let _ = fs::write(&report, tsv);
        eprintln!("[{base}] sections={} report={}", sections.len(), report.display());
        // Also dump raw HTML for byte-diff.
        let _ = fs::write(out_dir.join(format!("{base}.html")), &parsed.html);
    }
    eprintln!("phase3_verify dir: {}", out_dir.display());
}

/// For a known joint KF8 file, scan every 4-byte-aligned MOBI-header
/// field in [0xB0, 0x140) and, if the value points at an INDX record,
/// dump the TAGX shape. Lets us identify which offset holds the skeleton
/// table by matching against skeleton's expected TAGX (tags 1, 6, 7).
#[test]
#[ignore]
fn probe_kf8_header_indx_pointers() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => return,
    };
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw3"], &mut files);
    files.sort();
    // Just take a few well-formed joint files to keep output small.
    let targets = ["亨利·詹姆斯", "刺客正传2", "卡拉马佐夫", "创造自然"];
    for f in &files {
        let name = f
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !targets.iter().any(|t| name.contains(t)) {
            continue;
        }
        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let (records, _) = match parse_palmdb_records(&bytes) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let boundary = records.iter().position(|r| r.starts_with(b"BOUNDARY"));
        let is_pure_kf8 = records
            .first()
            .map(|r| r.len() >= 0x78 && &r[16..20] == b"MOBI" && read_be_u32_safe(r, 16 + 0x58) == 8)
            .unwrap_or(false);
        let kf8_start = if is_pure_kf8 {
            0
        } else if let Some(b) = boundary {
            b + 1
        } else {
            continue;
        };
        let hdr = records[kf8_start];
        let mobi_start = 16usize;
        println!("\n=== {} (kf8_start={}) ===", name, kf8_start);
        for off_mobi in (0xB0usize..0x140).step_by(4) {
            let val = read_be_u32_safe(hdr, mobi_start + off_mobi);
            if val == 0 || val == 0xFFFFFFFF {
                continue;
            }
            let abs = kf8_start + val as usize;
            if abs >= records.len() {
                continue;
            }
            let target = records[abs];
            if target.len() < 4 || &target[0..4] != b"INDX" {
                continue;
            }
            // Try to find TAGX signature in target.
            let tagx_pos = target.windows(4).position(|w| w == b"TAGX");
            if let Some(tp) = tagx_pos {
                let hlen = read_be_u32_safe(target, (tp + 4) as usize) as usize;
                let cbc = read_be_u32_safe(target, (tp + 8) as usize);
                let mut tags = Vec::new();
                let mut i = tp + 12;
                while i + 4 <= tp + hlen && i + 4 <= target.len() {
                    tags.push((target[i], target[i + 1], target[i + 2], target[i + 3]));
                    i += 4;
                }
                println!(
                    "  offset MOBI+0x{:02X} → val={} record[{}] cbc={} tags={:?}",
                    off_mobi, val, abs, cbc, tags
                );
            }
        }
    }
}

/// Sanity: call try_parse_kf8 on every joint/pure-KF8 file and count how
/// many `<mbp:pagebreak/>` markers land in the returned html. If skeleton
/// splitting is working end-to-end, joint files with skel_rows > 2 should
/// carry that many markers.
#[test]
#[ignore]
fn phase2_kf8_end_to_end() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => return,
    };
    let report = temp_report("mobi_phase2_e2e.tsv");
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw", "azw3", "prc"], &mut files);
    files.sort();
    let mut tsv = String::new();
    tsv.push_str("file\text\tsize_kb\thtml_chars\tpgbrk_mbp\tpgbrk_css\n");
    for f in &files {
        let name = f
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
            .replace('\t', " ");
        let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let size_kb = f.metadata().map(|m| m.len() / 1024).unwrap_or(0);
        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(_) => continue,
        };
        match try_parse_kf8(&bytes) {
            Ok(Some(parsed)) => {
                let mbp = count(&parsed.html, "mbp:pagebreak");
                let css = count(&parsed.html, "page-break-after");
                tsv.push_str(&format!(
                    "{name}\t{ext}\t{size_kb}\t{}\t{mbp}\t{css}\n",
                    parsed.html.chars().count()
                ));
            }
            _ => continue,
        }
    }
    if let Ok(mut f) = fs::File::create(&report) {
        let _ = f.write_all(tsv.as_bytes());
    }
    eprintln!("e2e report: {}", report.display());
}

/// Dump KF8 Phase 2 diagnostic per joint/pure-KF8 file: FDST flow count,
/// flow 0 byte range, skeleton row count. Lets us see why skeleton
/// splitting isn't producing pagebreaks for a given file.
#[test]
#[ignore]
fn phase2_kf8_diag() {
    let dir = match scan_dir() {
        Some(d) => d,
        None => {
            eprintln!("AUTOBOOK_MOBI_SCAN_DIR unset; skipping phase2_kf8_diag");
            return;
        }
    };
    let report = temp_report("mobi_phase2.tsv");
    let mut files = Vec::new();
    walk(Path::new(&dir), &["mobi", "azw", "azw3", "prc"], &mut files);
    files.sort();

    let mut tsv = String::new();
    tsv.push_str(
        "file\text\tsize_kb\tjoint\tkf8_start\tfdst_idx\tfdst_cnt\tflows\tflow0_end\tskel_idx\tskel_data_cnt\tskel_rows\tskel_err\n",
    );

    for f in &files {
        let name = f
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
            .replace('\t', " ");
        let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let size_kb = f.metadata().map(|m| m.len() / 1024).unwrap_or(0);
        let bytes = match fs::read(f) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let (records, _) = match parse_palmdb_records(&bytes) {
            Ok(r) => r,
            Err(_) => continue,
        };
        // Locate KF8 segment start.
        let boundary = records.iter().position(|r| r.starts_with(b"BOUNDARY"));
        let joint = boundary.is_some();
        let is_pure_kf8 = records
            .first()
            .map(|r| r.len() >= 0x78 && &r[16..20] == b"MOBI" && read_be_u32_safe(r, 16 + 0x58) == 8)
            .unwrap_or(false);
        let kf8_start = if is_pure_kf8 {
            0
        } else if let Some(b) = boundary {
            b + 1
        } else {
            continue; // MOBI6-only, skip
        };
        if kf8_start >= records.len() {
            continue;
        }
        let hdr = records[kf8_start];
        let mobi_start = 16;
        let fdst_idx = read_be_u32_safe(hdr, mobi_start + 0xB0);
        let fdst_cnt = read_be_u32_safe(hdr, mobi_start + 0xB4);
        let skel_idx = read_be_u32_safe(hdr, mobi_start + 0xEC);

        // Compute flow count and flow 0 end.
        let mut flows = 0u32;
        let mut flow0_end = 0u32;
        let fdst_abs = kf8_start + fdst_idx as usize;
        if fdst_idx != 0 && fdst_cnt > 0 && fdst_abs < records.len() {
            let end_rec = (fdst_abs + fdst_cnt as usize).min(records.len());
            let mut concat: Vec<u8> = Vec::new();
            for i in fdst_abs..end_rec {
                concat.extend_from_slice(records[i]);
            }
            if let Ok(fs) = parse_fdst(&concat) {
                flows = fs.len() as u32;
                if let Some(f0) = fs.first() {
                    flow0_end = f0.end;
                }
            }
        }

        // Skeleton parse.
        let mut skel_rows = 0i32;
        let mut skel_data_cnt = 0u32;
        let mut skel_err = String::new();
        if skel_idx != 0 && skel_idx != u32::MAX {
            let skel_prim_abs = kf8_start + skel_idx as usize;
            if skel_prim_abs < records.len() {
                let primary = records[skel_prim_abs];
                skel_data_cnt = primary_indx_data_count(primary) as u32;
                let data_records: Vec<&[u8]> = (1..=skel_data_cnt as usize)
                    .filter_map(|i| records.get(skel_prim_abs + i).copied())
                    .collect();
                match parse_skeleton_indx(primary, &data_records) {
                    Ok(rows) => skel_rows = rows.len() as i32,
                    Err(e) => {
                        skel_rows = -1;
                        skel_err = e.chars().take(80).collect::<String>().replace('\n', " ");
                    }
                }
            } else {
                skel_err = "skel_prim_abs OOB".into();
            }
        }

        tsv.push_str(&format!(
            "{name}\t{ext}\t{size_kb}\t{joint}\t{kf8_start}\t{fdst_idx}\t{fdst_cnt}\t{flows}\t{flow0_end}\t{skel_idx}\t{skel_data_cnt}\t{skel_rows}\t{skel_err}\n"
        ));
    }

    if let Ok(mut f) = fs::File::create(&report) {
        let _ = f.write_all(tsv.as_bytes());
    }
    eprintln!("phase2 diag report: {}", report.display());
}

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

