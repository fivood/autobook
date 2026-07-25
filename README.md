# AutoBook

> A Windows desktop ebook reader that turns reading into a searchable personal knowledge base. Typewriter-style auto-play + TTS, spoiler-safe AI Q&A over the book you're reading, offline dictionaries, and one-click Obsidian sync. Reads EPUB, MOBI/AZW3, PDF (with OCR), Markdown, TXT, HTMLZ, CBZ/CBR. Chinese and Japanese first-class.

**English** · [简体中文](./README.zh-CN.md)

[![Latest release](https://img.shields.io/github/v/release/fivood/autobook?display_name=tag)](https://github.com/fivood/autobook/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/fivood/autobook/total)](https://github.com/fivood/autobook/releases)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)](https://github.com/fivood/autobook/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app/)
[![SvelteKit](https://img.shields.io/badge/frontend-SvelteKit-ff3e00)](https://kit.svelte.dev/)

Originally forked from [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader) and now substantially diverged. Tauri 2 + SvelteKit + Rust, NSIS installer, signed auto-update channel.

---

## What it does

```
 EPUB / MOBI / AZW3 / PDF / MD / TXT / HTMLZ / CBZ / CBR
                          │
                          ▼
                       Reader
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   Highlights +      AI assistant       Look up words
    memos + tags    (spoiler-safe)      in offline dicts
        │                                     │
        ▼                                     │
   Auto-play                                  │
   typewriter                                 │
   or TTS                                     │
        │                                     │
        └──────────────────┬──────────────────┘
                           ▼
                    Knowledge base (Notebook)
                    ├─ Folders + tags
                    ├─ [[wiki-links]] between highlights
                    ├─ Daily review draw
                    └─ Export .md · sync to Obsidian
```

## Highlights

- 📚 **Everything readable**: EPUB, MOBI/AZW/AZW3 (native Rust parser, no third-party crate), PDF (via PDF.js + optional PaddleOCR for scans), Markdown (with KaTeX + syntax highlighting), TXT (auto-encoding, chapter detection), HTMLZ, CBZ/CBR. Batch-import a ZIP of any mix.
- ⌨️ **Typewriter auto-play**: characters fade in at 1–60 chars/sec. Hands-free reading with `A`/`D` speed control.
- 🔊 **TTS**: WinRT system voices, or point at any HTTP TTS endpoint (iFlytek, Baidu, local GPT-SoVITS…) with custom headers/body templates. Language auto-detected from `dc:language` or CJK density.
- 🎨 **4-color highlights + memos + tags**: right-click any selection. Independent of the book file — deleting a book keeps the notes.
- 🧠 **Spoiler-safe AI Q&A**: BM25 index of the book you're reading, hard-capped at your current progress. Ask "who's this character?" or "what's happened so far?" without spoilers. Works with Anthropic Claude, OpenAI, OpenRouter, or a local Ollama endpoint.
- 📖 **Offline dictionaries**: bring your own StarDict packs ([ECDICT](https://github.com/skywind3000/ECDICT), CC-CEDICT, JMdict…). Multi-dict lookup, English lemma fallback, fully offline.
- 🔗 **Personal knowledge base**: cross-book notebook with folders, tags, [[wiki-links]] between highlights, weighted daily-review draw, full-text search. Jump back to the exact page in the original book.
- 📤 **Obsidian sync**: one-click push. Each highlight becomes an atomic `.md` with rich frontmatter (color, tags, links, review dates). Graph, backlinks, and tag panes light up.
- 🖼️ **Scanned book support**: fixed-layout / image-only EPUBs, CBZ/CBR, and scanned PDFs get position tracking, bookmarks, and a 12-step zoom pill.
- 🌓 **13 built-in themes** (light / sepia / dark / seafoam / abyss / rainforest / espresso…), plus a full custom-theme editor with per-menu palette control.

## Screenshots

_See [Releases](https://github.com/fivood/autobook/releases) for the current UI. In-app language: 简体中文 · English · 日本語._

## Install

Grab the latest installer from [Releases](https://github.com/fivood/autobook/releases/latest):

- `AutoBook_<ver>_x64-setup.exe` (NSIS, recommended)
- `AutoBook_<ver>_x64_en-US.msi`

First launch shows a SmartScreen "Unknown publisher" prompt — click **More info → Run anyway**. Subsequent updates apply silently via the built-in updater.

## Data

| What | Where |
|---|---|
| Library + highlights + folders | IndexedDB (schemaless) |
| Original book files | `~/Documents/AutoBook/<title>/` |
| UI settings + AI keys + dictionary paths | localStorage |
| Obsidian sync target | user-chosen vault directory |
| Dictionaries | user-chosen directory |

**"Reset UI"** wipes only localStorage — books, highlights, notes, and folders are kept.

## Develop

```sh
npm install
npm run tauri dev    # Vite dev server + Rust hot-reload
npm run check        # svelte-check (types + templates)
npm run lint         # ESLint
```

## Build

```powershell
# Signing key must be set for the .sig to be generated (updater needs it).
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\autopage.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`:
- `msi/AutoBook_<ver>_x64_en-US.msi`
- `nsis/AutoBook_<ver>_x64-setup.exe`
- Matching `.sig` next to each

Releases: push a `v*` tag → GitHub Actions builds, signs, uploads `latest.json`. In-app auto-update takes over from there.

## Relationship to ttu-ebook-reader

The upstream is a web-based reader focused on Japanese learners (kana, dictionaries, learning aids). AutoBook re-focused around three things:

1. **Chinese long-form reading** on the desktop (formats, encodings, TTS voices, themes)
2. **Typewriter / TTS auto-play** — hands-free reading
3. **Personal knowledge base** — highlights → notebook → Obsidian / AI / dictionaries

Modules removed from upstream: web PWA, cloud storage (GDrive / OneDrive), OAuth, service worker, GitHub Pages deployment, Edge Online TTS (always 403), Japanese-learner specifics, in-app bug report.

## License

BSD-3-Clause, inherited from upstream. See [`LICENSE`](./LICENSE).

---

<sub>Keywords: Windows ebook reader · EPUB reader · MOBI reader · AZW3 reader · PDF reader · scanned PDF OCR · Markdown reader · Chinese ebook reader · Japanese ebook reader · CJK · typewriter reading mode · text-to-speech ebook · TTS reader · WinRT TTS · spoiler-safe AI · book Q&A · BM25 · Anthropic Claude ebook · offline dictionary · StarDict · Obsidian sync · atomic notes · Zettelkasten · Tauri 2 · SvelteKit · Rust · desktop app · knowledge base · ttu-ebook-reader fork</sub>
