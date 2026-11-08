# 格式解析待查（一批）

这里收集格式解析里已知、但还没处理的问题，留着一起排查。只写代码里看不出来的东西：
现象、怎么复现、验过什么、还只是猜测的是什么。处理完一条就删一条，并在 commit 里写清楚。

## 怎么测原生 MOBI / AZW3

本机装了 Calibre，平时 MOBI 走「Calibre 转 EPUB」，原生解析器只在没装 Calibre 时才用。

- 做样本：`"C:\Program Files\Calibre2\ebook-convert.exe" in.epub out.azw3`（或 `out.mobi`，
  即 MOBI6）。用一本带注释的 EPUB 转，转之前先复制出来，别动原文件。
- 不开窗口：`$env:AUTOBOOK_MOBI_FILE='<book>'; cargo test --lib dump_one_mobi -- --ignored --nocapture`
  会打印分节数和字数，并把 HTML 写到临时目录，可以和 EPUB 原文对照。
- 真窗口（`npm run tauri:dev:cdp`）：先 `window.__forceNativeMobi(true)` 绕过 Calibre；
  测试书导进 browser 存储（`localStorage.lastStorageSource = 'browser'`），不碰开发库，
  测完删书并还原这个 localStorage 键。

## 待查

（暂无）
