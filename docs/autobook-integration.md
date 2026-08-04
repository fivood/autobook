# AutoBook integration boundary

AutoBook consumes the built `translator-workbench` package through the local
file dependency in `G:/ebook reader/autopage/package.json`.

The shared package is intentionally browser-safe at its public entry point:

- `EpubAdapter.extract({ sourcePath, bytes })` returns a format-neutral
  `TranslationDocument` with stable segment IDs.
- `EpubAdapter.export(document, replacements)` returns EPUB bytes and leaves
  unmodified ZIP entries byte-for-byte equivalent after decompression.
- If an EPUB manifest or NCX references a missing non-spine XHTML resource,
  export adds an empty placeholder entry (and, for NCX-only targets, a matching
  OPF manifest item) so strict readers and EPUB validators can open the result.
- `TextAdapter('txt' | 'markdown')` preserves plain-text/Markdown paragraph
  offsets and exports the translated file as UTF-8.
- `HtmlAdapter` can inspect the HTML already stored in an AutoBook book record,
  so the reader header can open `/translate?bookId=…` without re-importing the
  source file.
- `exportHtmlAsMarkdownChunks(document, replacements, { maxChars })` renders the
  HTML result as review-friendly Markdown parts, keeping each part below the
  configured character budget instead of sending a whole long book to a model.
- `OllamaProvider` and `OpenAICompatibleProvider` implement the same
  `TranslationProvider` interface.
- `translateInBatches` provides checkpoint-friendly batch boundaries and rejects
  unknown, duplicate, or missing segment results before a batch is checkpointed.
- `validateTranslationCheckpoint` repairs stale or partially written checkpoints
  before a job is resumed; the AutoBook UI exposes “中断并保存” and “继续初译”.
- The live runner writes checkpoints atomically, supports `--validate`, resumes
  by stable document ID, and treats SIGINT/SIGTERM as a safe pause.

For a long local run, the same command is both the start and continue command:

```powershell
$env:TRANSLATOR_BATCH_SIZE = '1'
$env:TRANSLATOR_MAX_RETRIES = '5'
node --experimental-strip-types scripts/live-translate.ts G:\trans\Amello-Novellas\Amber.epub G:\trans\Amello-Novellas\translation-output qwen2.5:14b
```

Use `--validate` instead of running the model to inspect and repair the existing
checkpoint first.
- glossary candidates and validation stay outside the UI framework.

Node/Tauri file-system wrappers live under `src/runtime/files.ts` and are not
exported from the browser entry point. AutoBook should use its own Tauri file
dialog/FS commands and pass bytes to the shared adapter.

## Local development order

```powershell
Set-Location G:\translator-workbench
pnpm install
pnpm run check
pnpm run build

Set-Location 'G:\ebook reader\autopage'
pnpm install --lockfile=false
node_modules\.bin\svelte-check.cmd --tsconfig .\tsconfig.json
node_modules\.bin\vite.cmd build
```

The current AutoBook `/translate` route is a working first-stage UI for EPUB,
TXT and Markdown import, glossary confirmation, Ollama model discovery (the
largest installed model is suggested unless the user chooses one), draft
translation, configurable OpenAI-compatible refinement and format-preserving
export. HTML files and stored AutoBook books can also export a Markdown ZIP;
the model batches use an approximate 12,000-source-character ceiling and the
UI defaults to 24,000 characters per Markdown part. It checkpoints the
`TranslationJob` after every batch in the
`autobook-translation-jobs` IndexedDB database and exposes a recovery action
when the route is reopened. The route is also available from the merged header
navigation. It deliberately does not alter the reader's existing book loader
yet; the current page now accepts multiple files or a directory and lets the
user switch the active file. The reader header also opens the current book
directly; its translated HTML is exported separately for review, while writing
back into the reader's stored book remains an explicit future action.

Approved terms can be saved to the `default-world` glossary profile in the same
IndexedDB database. New books prefill matching candidates from that profile and
offer separate checkboxes for reusing it and for saving the current book's
confirmed terms back to it.

For a real folder run outside the UI, `pnpm run translate:live -- <input.epub>
<output-dir> <model> [glossary.json]` writes a per-book checkpoint, glossary
candidate JSON, and a translated EPUB. Re-running the command resumes from the
checkpoint; the runner retries malformed or incomplete model batches without
checkpointing them.
