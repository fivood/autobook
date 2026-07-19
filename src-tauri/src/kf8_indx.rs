//! KF8 Phase 2: FDST + skeleton INDX table parsing.
//!
//! KF8 stores the decompressed text as one long byte stream, but it's not
//! a single HTML file — it's several concatenated "flows":
//!   flow 0 = the actual HTML container (all chapters + inline body content)
//!   flow 1..N = auxiliary resources (CSS files, SVG image masks, etc.)
//!
//! Phase 1 concatenated everything, dumping CSS/SVG garbage into the visible
//! text. Phase 2 uses the FDST record to identify flow 0's byte range and
//! return only that.
//!
//! The skeleton INDX table divides flow 0 into "skeleton" HTML documents
//! (one per chapter file in the original epub source). Each skeleton row has
//! an offset+length pointing at a slice of flow 0 that reconstructs to one
//! HTML file — for our purposes we use these slice boundaries as section
//! splits so the reader gets proper chapter navigation instead of a single
//! monolithic blob.
//!
//! Full fragment-into-skeleton reassembly (which produces byte-for-byte
//! valid XHTML per section) is Phase 3. The raw skeleton-and-fragments
//! byte range already reads correctly in a tolerant HTML parser, so it's
//! not blocking usability.

use serde::Serialize;

// ── FDST ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FdstSection {
    /// Byte offset in the decompressed text stream (inclusive).
    pub start: u32,
    /// Byte offset in the decompressed text stream (exclusive).
    pub end: u32,
}

fn read_u32_be(bytes: &[u8], off: usize) -> u32 {
    if off + 4 > bytes.len() {
        return 0;
    }
    u32::from_be_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]])
}

fn read_u16_be(bytes: &[u8], off: usize) -> u16 {
    if off + 2 > bytes.len() {
        return 0;
    }
    u16::from_be_bytes([bytes[off], bytes[off + 1]])
}

/// Parse an FDST record. Layout:
///   0x00: "FDST" (4)
///   0x04: header_length (u32) — points to the flow table, usually 0x0C
///   0x08: num_sections (u32)
///   0x0C: [start(u32), end(u32)] × num_sections
pub fn parse_fdst(record: &[u8]) -> Result<Vec<FdstSection>, String> {
    if record.len() < 12 {
        return Err("FDST record too short".into());
    }
    if &record[0..4] != b"FDST" {
        return Err(format!(
            "expected FDST signature, got {:?}",
            std::str::from_utf8(&record[0..4]).unwrap_or("?")
        ));
    }
    let num_sections = read_u32_be(record, 8) as usize;
    // Cap to defend against corrupt headers claiming millions of flows.
    let num_sections = num_sections.min(65536);
    let mut out = Vec::with_capacity(num_sections);
    let table_start = read_u32_be(record, 4) as usize;
    let base = if table_start >= 12 && table_start + num_sections * 8 <= record.len() {
        table_start
    } else {
        12
    };
    for i in 0..num_sections {
        let off = base + i * 8;
        if off + 8 > record.len() {
            break;
        }
        let start = read_u32_be(record, off);
        let end = read_u32_be(record, off + 4);
        out.push(FdstSection { start, end });
    }
    if out.is_empty() {
        return Err("FDST parsed 0 sections".into());
    }
    Ok(out)
}

// ── INDX (skeleton table) ───────────────────────────────────────────────

/// One row in the skeleton table. Names come from the CNCX; offset/length
/// point into flow 0 of the decompressed text stream.
#[derive(Debug, Clone, Serialize)]
pub struct SkeletonRow {
    pub name: String,
    pub num_fragments: u32,
    pub offset: u32,
    pub length: u32,
}

/// TAGX entry — describes one field of an INDX row.
#[derive(Debug, Clone, Copy)]
struct TagxEntry {
    tag: u8,
    num_values: u8,
    bitmask: u8,
    end_flag: u8,
}

/// Locate and parse the TAGX table embedded in the primary INDX record.
fn parse_tagx(primary: &[u8]) -> Result<(Vec<TagxEntry>, u32), String> {
    let pos = primary
        .windows(4)
        .position(|w| w == b"TAGX")
        .ok_or_else(|| "TAGX signature not found in INDX header".to_string())?;
    if pos + 12 > primary.len() {
        return Err("TAGX header truncated".into());
    }
    let header_len = read_u32_be(primary, pos + 4) as usize;
    let control_byte_count = read_u32_be(primary, pos + 8);
    let end = (pos + header_len).min(primary.len());
    let mut entries = Vec::new();
    let mut i = pos + 12;
    while i + 4 <= end {
        entries.push(TagxEntry {
            tag: primary[i],
            num_values: primary[i + 1],
            bitmask: primary[i + 2],
            end_flag: primary[i + 3],
        });
        i += 4;
    }
    Ok((entries, control_byte_count))
}

/// Read a MOBI-style forward varint. MSB=1 signals stop.
/// Returns (value, bytes_consumed).
fn read_varint_forward(data: &[u8], start: usize) -> (u64, usize) {
    let mut val: u64 = 0;
    let mut i = start;
    while i < data.len() {
        let b = data[i];
        val = (val << 7) | ((b & 0x7F) as u64);
        i += 1;
        if b & 0x80 != 0 {
            break;
        }
        if i - start >= 10 {
            break;
        }
    }
    (val, i - start)
}

/// Decode one INDX entry's tag→values map given TAGX + entry data.
///
/// Matches Calibre's `parse_index_record` (mobi/reader/index.py). Entry
/// data is `control_byte_count` control bytes followed by a varint
/// stream. TAGX entries with `end_flag != 0` advance the control-byte
/// cursor. For each real tag with bitmask `m`:
///   - masked == 0                       → tag absent
///   - masked == m, single-bit m         → one occurrence, read num_values
///                                          varints
///   - masked == m, multi-bit m          → read a leading varint = number
///                                          of bytes; then read varints
///                                          until that many bytes consumed
///   - masked partial (< m)              → occurrences = masked >> shift,
///                                          read occurrences × num_values
///                                          varints
fn decode_indx_entry(
    entry_data: &[u8],
    tagx: &[TagxEntry],
    control_byte_count: u32,
) -> std::collections::HashMap<u8, Vec<u64>> {
    let mut out: std::collections::HashMap<u8, Vec<u64>> = std::collections::HashMap::new();

    let n_control = control_byte_count as usize;
    if entry_data.len() < n_control {
        return out;
    }
    let control_bytes: Vec<u8> = entry_data[..n_control].to_vec();
    let mut pos = n_control;
    let mut cbyte_idx: usize = 0;

    // Two-pass Calibre-style: first classify each tag as either
    // fixed-count mode or byte-length mode; then read the varints in the
    // classified order.
    enum Mode {
        Count(usize),
        Bytes(usize),
    }
    let mut plan: Vec<(u8, u8, Mode)> = Vec::new();
    for t in tagx {
        if t.end_flag != 0 {
            cbyte_idx += 1;
            continue;
        }
        if cbyte_idx >= control_bytes.len() {
            break;
        }
        let cbyte = control_bytes[cbyte_idx];
        let mask = t.bitmask;
        if mask == 0 {
            continue;
        }
        let shift = mask.trailing_zeros();
        let masked = cbyte & mask;
        if masked == 0 {
            continue;
        }
        if masked == mask {
            if mask.count_ones() > 1 {
                let (nbytes, n) = read_varint_forward(entry_data, pos);
                if n == 0 {
                    return out;
                }
                pos += n;
                plan.push((t.tag, t.num_values, Mode::Bytes(nbytes as usize)));
            } else {
                plan.push((t.tag, t.num_values, Mode::Count(1)));
            }
        } else {
            let count = (masked >> shift) as usize;
            plan.push((t.tag, t.num_values, Mode::Count(count)));
        }
    }

    for (tag, num_values, mode) in plan {
        match mode {
            Mode::Count(vc) => {
                let total = (vc as usize).saturating_mul(num_values as usize).min(4096);
                for _ in 0..total {
                    let (v, n) = read_varint_forward(entry_data, pos);
                    if n == 0 {
                        return out;
                    }
                    out.entry(tag).or_default().push(v);
                    pos += n;
                }
            }
            Mode::Bytes(vb) => {
                let start = pos;
                while pos - start < vb && pos < entry_data.len() {
                    let (v, n) = read_varint_forward(entry_data, pos);
                    if n == 0 {
                        break;
                    }
                    out.entry(tag).or_default().push(v);
                    pos += n;
                    // Defensive: never let a single tag consume more than
                    // its declared byte length + 16 bytes of slack.
                    if pos - start > vb + 16 {
                        break;
                    }
                }
            }
        }
    }

    out
}

/// Parse the skeleton INDX table.
/// - `primary` is the first INDX record (contains header + TAGX).
/// - `data_records` are the subsequent INDX records, each holding N rows.
/// - `cncx_records` are the CNCX records, holding the name pool.
///
/// Skeleton table TAGX (probed empirically against the sample corpus):
///   tag 1 = num_fragments   (num_values=1, mask=0x03)
///   tag 6 = [offset, length] pair (num_values=2, mask=0x0C)
/// Names are stored inline in the entry (name_len byte + name bytes) —
/// typically a zero-padded ordinal like "SKEL0000000000" or "0000000123".
pub fn parse_skeleton_indx(
    primary: &[u8],
    data_records: &[&[u8]],
) -> Result<Vec<SkeletonRow>, String> {
    if primary.len() < 4 || &primary[0..4] != b"INDX" {
        return Err("skeleton primary INDX signature missing".into());
    }
    let (tagx, control_byte_count) = parse_tagx(primary)?;
    if tagx.is_empty() {
        return Err("TAGX has no entries".into());
    }

    let mut rows: Vec<SkeletonRow> = Vec::new();
    for rec in data_records {
        parse_indx_data_record(rec, &tagx, control_byte_count, &mut rows)?;
    }
    Ok(rows)
}

/// Parse one INDX data record. Layout:
///   0x00: "INDX"
///   0x04: header_length (u32)
///   ...
///   0x14: idxt_offset (u32) — offset to the IDXT block within this record
///   0x18: idxt_count (u32) — number of entries in this record
///
/// At `idxt_offset`:
///   "IDXT" (4)
///   entry_offset (u16) × idxt_count
///
/// Each entry at its offset:
///   name_len (u8)
///   name bytes (name_len bytes)
///   control bytes + tag varints
fn parse_indx_data_record(
    rec: &[u8],
    tagx: &[TagxEntry],
    control_byte_count: u32,
    out: &mut Vec<SkeletonRow>,
) -> Result<(), String> {
    if rec.len() < 0x20 || &rec[0..4] != b"INDX" {
        return Err("INDX data record signature missing".into());
    }
    let idxt_off = read_u32_be(rec, 0x14) as usize;
    let count = read_u32_be(rec, 0x18) as usize;
    if idxt_off + 4 + count * 2 > rec.len() {
        return Err("IDXT block extends past record".into());
    }
    if &rec[idxt_off..idxt_off + 4] != b"IDXT" {
        return Err("IDXT signature missing at declared offset".into());
    }

    let mut entry_offs: Vec<usize> = Vec::with_capacity(count);
    for i in 0..count {
        let off = read_u16_be(rec, idxt_off + 4 + i * 2) as usize;
        entry_offs.push(off);
    }

    for i in 0..count {
        let start = entry_offs[i];
        let end = if i + 1 < count {
            entry_offs[i + 1]
        } else {
            idxt_off
        };
        if start >= rec.len() || end > rec.len() || start >= end {
            continue;
        }
        let entry = &rec[start..end];
        if entry.is_empty() {
            continue;
        }
        let name_len = entry[0] as usize;
        if 1 + name_len > entry.len() {
            continue;
        }
        let name = String::from_utf8_lossy(&entry[1..1 + name_len]).to_string();
        let tail = &entry[1 + name_len..];
        let vals = decode_indx_entry(tail, tagx, control_byte_count);

        let num_fragments = vals.get(&1).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        // Tag 6 carries [offset, length] as a single 2-value tuple.
        let (offset, length) = match vals.get(&6) {
            Some(v) if v.len() >= 2 => (v[0] as u32, v[1] as u32),
            _ => (0u32, 0u32),
        };

        // Skeleton rows always carry offset+length. If both are zero, the
        // entry probably came from a table we don't understand — skip it
        // rather than emit a bogus empty section.
        if offset == 0 && length == 0 {
            continue;
        }

        out.push(SkeletonRow {
            name,
            num_fragments,
            offset,
            length,
        });
    }
    Ok(())
}

/// Look up how many INDX data records follow the primary. Stored at 0x18
/// in the INDX header.
pub fn primary_indx_data_count(primary: &[u8]) -> usize {
    read_u32_be(primary, 0x18) as usize
}

/// CNCX record count from the primary INDX header (offset 0x34). CNCX
/// records follow the data records and hold a pool of names referenced by
/// varint offsets from index entries.
pub fn primary_indx_cncx_count(primary: &[u8]) -> usize {
    read_u32_be(primary, 0x34) as usize
}

// ── NCX INDX table ─────────────────────────────────────────────────────
//
// NCX = the epub source's `nav.xhtml` / TOC, encoded as an INDX table.
// Header ptr lives at MOBI-sig+0xE4 (Calibre `ncxidx`). Each row is a
// TOC entry with a position in flow 0, a chapter name (via CNCX), and
// hierarchy fields (depth, parent, first/last child) that let us
// reconstruct a nested nav tree.
//
// TAGX shape (probed against sample corpus):
//   tag 1  (mask=1)   — pos (byte position in flow 0)
//   tag 2  (mask=2)   — length
//   tag 3  (mask=4)   — CNCX offset for chapter name
//   tag 4  (mask=8)   — depth / heading level
//   tag 21 (mask=16)  — parent index
//   tag 22 (mask=32)  — first child index
//   tag 23 (mask=64)  — last child index
//   tag 6  (mask=128, num_values=2) — [pos_fid, offset]

#[derive(Debug, Clone, Serialize)]
pub struct NcxRow {
    /// Byte position in flow 0 (roughly `skel.offset` for the section
    /// this entry labels).
    pub position: u32,
    pub length: u32,
    pub name_cncx: u32,
    pub depth: u32,
    pub parent: u32,
}

pub fn parse_ncx_indx(
    primary: &[u8],
    data_records: &[&[u8]],
) -> Result<Vec<NcxRow>, String> {
    if primary.len() < 4 || &primary[0..4] != b"INDX" {
        return Err("NCX primary INDX signature missing".into());
    }
    let (tagx, control_byte_count) = parse_tagx(primary)?;
    if tagx.is_empty() {
        return Err("NCX TAGX has no entries".into());
    }
    let mut rows: Vec<NcxRow> = Vec::new();
    for rec in data_records {
        parse_ncx_data_record(rec, &tagx, control_byte_count, &mut rows)?;
    }
    Ok(rows)
}

fn parse_ncx_data_record(
    rec: &[u8],
    tagx: &[TagxEntry],
    control_byte_count: u32,
    out: &mut Vec<NcxRow>,
) -> Result<(), String> {
    if rec.len() < 0x20 || &rec[0..4] != b"INDX" {
        return Err("NCX INDX data record signature missing".into());
    }
    let idxt_off = read_u32_be(rec, 0x14) as usize;
    let count = read_u32_be(rec, 0x18) as usize;
    if idxt_off + 4 + count * 2 > rec.len() {
        return Err("NCX IDXT block extends past record".into());
    }
    if &rec[idxt_off..idxt_off + 4] != b"IDXT" {
        return Err("NCX IDXT signature missing at declared offset".into());
    }
    let mut entry_offs: Vec<usize> = Vec::with_capacity(count);
    for i in 0..count {
        let off = read_u16_be(rec, idxt_off + 4 + i * 2) as usize;
        entry_offs.push(off);
    }
    for i in 0..count {
        let start = entry_offs[i];
        let end = if i + 1 < count { entry_offs[i + 1] } else { idxt_off };
        if start >= rec.len() || end > rec.len() || start >= end {
            continue;
        }
        let entry = &rec[start..end];
        if entry.is_empty() {
            continue;
        }
        let name_len = entry[0] as usize;
        if 1 + name_len > entry.len() {
            continue;
        }
        // NCX entry names are typically hex ordinal like "0000000000".
        // We ignore them — the meaningful name is at tag 3 via CNCX.
        let tail = &entry[1 + name_len..];
        let vals = decode_indx_entry(tail, tagx, control_byte_count);
        let position = vals.get(&1).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        let length = vals.get(&2).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        let name_cncx = vals.get(&3).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        let depth = vals.get(&4).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        let parent = vals.get(&21).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        out.push(NcxRow {
            position,
            length,
            name_cncx,
            depth,
            parent,
        });
    }
    Ok(())
}

/// Look up a name in a concatenated CNCX byte pool at the given offset.
/// Layout at each offset: `[varint_length][utf8 bytes]`. Returns None if
/// the offset is out of bounds or the length varint is malformed.
pub fn read_cncx_name(cncx_pool: &[u8], offset: u32) -> Option<String> {
    let off = offset as usize;
    if off >= cncx_pool.len() {
        return None;
    }
    let (len, consumed) = read_varint_forward(cncx_pool, off);
    let start = off + consumed;
    let end = start + len as usize;
    if end > cncx_pool.len() {
        return None;
    }
    Some(String::from_utf8_lossy(&cncx_pool[start..end]).to_string())
}

// ── Fragment / chunks INDX table (Phase 3) ──────────────────────────────
//
// Each fragment row describes one chunk of body text and where it should
// be inserted into its parent skeleton's HTML template.
//
// TAGX shape (probed empirically, matches Calibre's `dividx`
// / KindleUnpack's `FragIdx`):
//   tag 2 (mask=1, num_values=1)  — CNCX offset (chapter title lookup)
//   tag 3 (mask=2, num_values=1)  — file_number: parent skeleton index
//   tag 4 (mask=4, num_values=1)  — sequence_number
//   tag 6 (mask=8, num_values=2)  — [start_pos, length] in raw markup
//
// **Entry name** — a decimal ASCII string. Parses as int → **insert_pos**
// in the parent skeleton's template (Calibre `mobi8.py`: `Elem(int(text),
// ...)`). Not a raw text position like KindleUnpack's naming implies.
#[derive(Debug, Clone, Serialize)]
pub struct FragmentRow {
    /// Insert position within the parent skeleton's HTML template.
    pub insert_pos: u32,
    /// 0-based index of the parent skeleton (Calibre's `file_number`).
    pub parent_ord: u32,
    /// Start byte position in the decompressed text stream.
    pub start_pos: u32,
    /// Byte length of fragment content.
    pub length: u32,
    /// CNCX offset for chapter title (0 = none).
    pub toc_cncx: u32,
}

pub fn parse_fragment_indx(
    primary: &[u8],
    data_records: &[&[u8]],
) -> Result<Vec<FragmentRow>, String> {
    if primary.len() < 4 || &primary[0..4] != b"INDX" {
        return Err("fragment primary INDX signature missing".into());
    }
    let (tagx, control_byte_count) = parse_tagx(primary)?;
    if tagx.is_empty() {
        return Err("TAGX has no entries".into());
    }

    let mut rows: Vec<FragmentRow> = Vec::new();
    for rec in data_records {
        parse_fragment_data_record(rec, &tagx, control_byte_count, &mut rows)?;
    }
    Ok(rows)
}

fn parse_fragment_data_record(
    rec: &[u8],
    tagx: &[TagxEntry],
    control_byte_count: u32,
    out: &mut Vec<FragmentRow>,
) -> Result<(), String> {
    if rec.len() < 0x20 || &rec[0..4] != b"INDX" {
        return Err("fragment INDX data record signature missing".into());
    }
    let idxt_off = read_u32_be(rec, 0x14) as usize;
    let count = read_u32_be(rec, 0x18) as usize;
    if idxt_off + 4 + count * 2 > rec.len() {
        return Err("fragment IDXT block extends past record".into());
    }
    if &rec[idxt_off..idxt_off + 4] != b"IDXT" {
        return Err("fragment IDXT signature missing at declared offset".into());
    }

    let mut entry_offs: Vec<usize> = Vec::with_capacity(count);
    for i in 0..count {
        let off = read_u16_be(rec, idxt_off + 4 + i * 2) as usize;
        entry_offs.push(off);
    }

    for i in 0..count {
        let start = entry_offs[i];
        let end = if i + 1 < count {
            entry_offs[i + 1]
        } else {
            idxt_off
        };
        if start >= rec.len() || end > rec.len() || start >= end {
            continue;
        }
        let entry = &rec[start..end];
        if entry.is_empty() {
            continue;
        }
        let name_len = entry[0] as usize;
        if 1 + name_len > entry.len() {
            continue;
        }
        // Entry name (ASCII decimal) → insert position in template.
        let name = &entry[1..1 + name_len];
        let insert_pos = std::str::from_utf8(name)
            .ok()
            .and_then(|s| {
                let trimmed = s.trim_start_matches('0');
                if trimmed.is_empty() {
                    Some(0)
                } else {
                    trimmed.parse::<u32>().ok()
                }
            })
            .unwrap_or(0);
        let tail = &entry[1 + name_len..];
        let vals = decode_indx_entry(tail, tagx, control_byte_count);
        let toc_cncx = vals.get(&2).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        let parent_ord = vals.get(&3).and_then(|v| v.first().copied()).unwrap_or(0) as u32;
        let (start_pos, length) = match vals.get(&6) {
            Some(v) if v.len() >= 2 => (v[0] as u32, v[1] as u32),
            _ => (0u32, 0u32),
        };
        out.push(FragmentRow {
            insert_pos,
            parent_ord,
            start_pos,
            length,
            toc_cncx,
        });
    }
    Ok(())
}

