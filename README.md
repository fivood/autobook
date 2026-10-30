# AutoBook

> A Windows desktop ebook reader that turns reading into a searchable personal knowledge base. Typewriter auto-play, spoiler-safe AI Q&A, offline dictionaries, comic translation, and one-click Obsidian sync.

**English** · [简体中文](./README.zh-CN.md)

[![Latest release](https://img.shields.io/github/v/release/fivood/autobook?display_name=tag)](https://github.com/fivood/autobook/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/fivood/autobook/total)](https://github.com/fivood/autobook/releases)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)](https://github.com/fivood/autobook/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app/)

Forked from [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader), substantially diverged. Tauri 2 + SvelteKit + Rust, signed auto-update channel.

---

## Highlights

- **Formats**: EPUB, MOBI/AZW/AZW3 (native Rust parser), PDF (text + OCR for scans), Markdown, TXT, HTMLZ, CBZ/CBR. Batch-import any mix as a ZIP.
- **Typewriter / TTS**: hands-free reading with speed control; WinRT voices or any HTTP TTS endpoint.
- **Comic translation**: CBZ/CBR → OCR → bubble grouping → local/cloud LLM → translated overlay right in the reader.
- **Comic inpainting**: auto-erase source text (flat-fill + optional LaMa), manual frame-selection for missed SFX.
- **Spoiler-safe AI Q&A**: BM25 over the book, hard-capped at your progress. Anthropic, OpenAI-compatible, or local Ollama.
- **Offline dictionaries**: bring your own StarDict packs; fully offline, multi-dict.
- **Knowledge base**: cross-book notebook with folders, tags, wiki-links, daily review, full-text search, and Obsidian sync.
- **Translation workbench**: per-book glossary, checkpointed batch translation, interrupt/resume — for text and comics alike.
- **13 themes** with a full custom-theme editor.

## Reading

- **Typewriter mode**: characters fade in at 1–60 chars/sec, `A`/`D` speed control.
- **TTS**: WinRT system voices or custom HTTP endpoints (iFlytek, Baidu, local GPT-SoVITS…) with header/body templates.
- **Highlights**: 4-color + memos + tags, stored independently of the book file — deleting a book keeps your notes.
- **Dictionaries**: right-click lookup, English lemma fallback, multi-pack merge.

## AI & Translation

- **Spoiler-safe assistant**: ask "who's this character?" without future spoilers. Progress-capped retrieval.
- **Translation workbench** (`/translate`): import a book or file, review per-book glossary candidates, then batch-translate with checkpoints that survive interruption or restart.
- **Comic translation**: works end-to-end on CBZ/CBR — OCR (19 languages), bubble grouping, AI OCR correction, batch translation, and a rendered overlay in the reader.
- **Inpainting**: source text is erased from bubbles (flat-fill; gradient/textured backgrounds hand off to a LaMa sidecar), so the overlay sits on a clean page. Manual frame-selection catches what OCR missed.
- **Model management**: one page shows status, download progress, storage location, and uninstall for PaddleOCR, Kokoro, Ollama, and LaMa.

## Knowledge Base

- Cross-book notebook: folders, tags, `[[wiki-links]]`, weighted daily-review draw, full-text search, jump back to the exact page.
- **Obsidian sync**: one-click push, each highlight becomes an atomic `.md` with rich frontmatter.

## Install

Grab the installer from [Releases](https://github.com/fivood/autobook/releases/latest):

- `AutoBook_<ver>_x64-setup.exe` (NSIS, recommended)
- `AutoBook_<ver>_x64_en-US.msi`

First launch shows a SmartScreen "Unknown publisher" prompt — click **More info → Run anyway**. Updates apply silently via the built-in updater.

## Data

| What | Where |
|---|---|
| Library + highlights + folders | IndexedDB |
| Original book files | `~/Documents/AutoBook/<title>/` |
| UI settings, AI keys, dict paths | localStorage |
| Obsidian sync / dictionaries | user-chosen directories |

**"Reset UI"** wipes only localStorage.

## Develop

```sh
npm install
npm run tauri dev
npm run check   # svelte-check
npm run lint    # ESLint
```

## Build

```sh
# Set the signing key first so the .sig is generated (updater needs it).
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` (`nsis/`, `msi/`, with `.sig`). Release: push a `v*` tag — GitHub Actions builds, signs, uploads `latest.json`.

## License

BSD-3-Clause, inherited from upstream. See [`LICENSE`](./LICENSE).

---

<sub>Keywords: Windows ebook reader · EPUB · MOBI · AZW3 · PDF OCR · CBZ · CBR · comic translation · comic inpainting · LaMa · Markdown · Chinese · Japanese · typewriter · TTS · spoiler-safe AI · BM25 · offline dictionary · StarDict · Obsidian · notebook · Tauri 2 · SvelteKit · Rust</sub>
