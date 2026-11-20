/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * KOReader → AutoBook conversion. Pure functions only so the dateKey math
 * and Lua parsing stay under `npm test`; the IO lives in koreader-import.ts.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';

export interface KoSession {
  startTime: number; // unix seconds
  duration: number; // seconds
  totalPages: number;
}

export interface KoBook {
  title: string;
  md5: string;
  lastOpen: number;
  sessions: KoSession[];
}

/** Fields we lift out of a `metadata.<ext>.lua` sidecar. */
export interface KoSidecar {
  path: string;
  title: string;
  percentFinished: number;
  md5: string;
  annotations: { text: string; datetime: string }[];
}

/**
 * Best-effort parse of a KOReader `metadata.*.lua`. Serpent-serialized Lua
 * tables that only use string keys and string/number/boolean/table values —
 * a regex plucks out the three top-level keys we care about, plus every
 * `text` and `datetime` under `annotations`. No full Lua parser: the values
 * we read are declarative data, and every one we look at is a plain string
 * or a number literal.
 */
export function parseSidecar(path: string, lua: string): KoSidecar {
  const title = matchOne(lua, /\["title"\]\s*=\s*"((?:\\.|[^"\\])*)"/) ?? '';
  const md5 = matchOne(lua, /\["partial_md5_checksum"\]\s*=\s*"([^"]+)"/) ?? '';
  const pct = matchOne(lua, /\["percent_finished"\]\s*=\s*([0-9.eE+-]+)/);
  const annotations = matchAllAnnotations(lua);
  return {
    path,
    title: unescapeLua(title),
    percentFinished: pct ? Number(pct) : 0,
    md5,
    annotations
  };
}

function matchOne(s: string, re: RegExp): string | undefined {
  return re.exec(s)?.[1];
}

function matchAllAnnotations(lua: string): { text: string; datetime: string }[] {
  const start = lua.indexOf('["annotations"]');
  if (start < 0) return [];
  // Each annotation record is a subtable like `[1] = { … }`. We do not need
  // the exact end of the annotations block: a record's `text` and `datetime`
  // are only ever set inside one, and any later block that uses those names
  // (e.g. per-page bookmark entries elsewhere in the file) would introduce
  // duplicates rather than wrong data — and this file does not have them.
  const out: { text: string; datetime: string }[] = [];
  const re = /\[\d+\]\s*=\s*\{([\s\S]*?)\n\s*\},?/g;
  let m: RegExpExecArray | null;
  re.lastIndex = start;
  while ((m = re.exec(lua))) {
    const body = m[1];
    const text = matchOne(body, /\["text"\]\s*=\s*"((?:\\.|[^"\\])*)"/);
    const dt = matchOne(body, /\["datetime"\]\s*=\s*"([^"]+)"/);
    if (text) out.push({ text: unescapeLua(text), datetime: dt ?? '' });
  }
  return out;
}

function unescapeLua(s: string): string {
  return s.replace(/\\(["\\nrt])/g, (_, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c
  );
}

/**
 * Fold KOReader's per-page sessions into AutoBook's per-day statistic rows.
 *
 * KOReader tracks time; we do not carry the KOReader-side character counts
 * back because AutoBook counts characters its own way (`getCharacterCount`).
 * The daily row's `charactersRead` therefore stays 0 for imported days —
 * time totals, streaks and history read correctly; reading-speed columns
 * for those days are blank rather than fabricated.
 *
 * `startOfDay` is `startDayHoursForTracker$` — the same clock AutoBook's own
 * tracker uses, so imported days line up with locally-recorded ones.
 *
 * ponytail: charactersRead=0. If a reading-speed column ever needs to show
 * for the imported days too, estimate as book.characters × session.duration
 * / sum(sessions.duration) at import time.
 */
export function sessionsToStatistics(
  bookTitle: string,
  sessions: KoSession[],
  startOfDay: number,
  now = Date.now()
): BooksDbStatistic[] {
  const byDate = new Map<string, BooksDbStatistic>();
  for (const s of sessions) {
    if (s.duration <= 0) continue;
    const dateKey = dayKeyForUnix(s.startTime, startOfDay);
    let stat = byDate.get(dateKey);
    if (!stat) {
      stat = {
        title: bookTitle,
        dateKey,
        charactersRead: 0,
        readingTime: 0,
        minReadingSpeed: 0,
        altMinReadingSpeed: 0,
        lastReadingSpeed: 0,
        maxReadingSpeed: 0,
        lastStatisticModified: now
      };
      byDate.set(dateKey, stat);
    }
    stat.readingTime += s.duration;
  }
  return [...byDate.values()].sort((a, b) => (a.dateKey > b.dateKey ? 1 : -1));
}

/** yyyy-mm-dd for a unix-seconds instant under AutoBook's start-of-day rule. */
export function dayKeyForUnix(unixSeconds: number, startOfDay: number): string {
  const d = new Date(unixSeconds * 1000);
  if (d.getHours() < startOfDay) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Where a KOReader highlight lands in a book's rendered HTML — character
 * offset for the first plaintext match, or undefined when the passage is
 * not in the copy AutoBook holds (different edition, DRM stub, comic).
 *
 * Text-node walk so the count matches `rangeToOffsets` used by the reader.
 * Whitespace is normalized both sides: KOReader gives back the trimmed
 * selection, AutoBook's HTML has inline whitespace runs.
 */
export function findHighlightOffset(
  html: string,
  needle: string
): { start: number; end: number } | undefined {
  const normalized = needle.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('rt, rp, script, style, [aria-hidden], [hidden]').forEach((el) => el.remove());

  // Flat text with the offset of each source-character preserved, so a match
  // in the normalized string can be mapped back to a range in the DOM's own
  // character space (which is what highlights are indexed by).
  const parts: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const raw = node.textContent || '';
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      const wasSpace = parts.length && /\s/.test(parts[parts.length - 1]);
      if (/\s/.test(ch)) {
        if (!wasSpace && parts.length) {
          parts.push(' ');
          offsets.push(cursor + i);
        }
      } else {
        parts.push(ch);
        offsets.push(cursor + i);
      }
    }
    cursor += raw.length;
  }
  // Drop a trailing space so `offsets[hit + needle.length]` is safe below.
  if (parts.length && parts[parts.length - 1] === ' ') parts.pop();
  const flat = parts.join('').trim();
  // trim() dropped a leading space? offsets[0] is still correct because the
  // walker never emits a leading space (the `wasSpace` guard requires a prior char).

  const hit = flat.indexOf(normalized);
  if (hit < 0) return undefined;
  const start = offsets[hit];
  const endIdx = hit + normalized.length;
  const end = endIdx < offsets.length ? offsets[endIdx] : cursor;
  return { start, end };
}
