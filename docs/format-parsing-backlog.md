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

### MOBI6 的目录标签全是 `section-N`
MOBI6 书的章节标题是 `<p><b>…</b></p>`，`load-mobi.ts` 的 `splitIntoSections` 只认 `<h1>`–`<h6>`，
所以拿不到标题。KF8 不受影响，标题来自 NCX。

思路：MOBI6 书里一般有一页目录，每一行都是 `<a href="#fileposN">第一章</a>`（filepos 现在已经能解析）。
用「链接文字 → 锚点落在哪一节」就能反推出每一节的标题。用 Calibre 把一本 EPUB 转成 .mobi 就能复现。

### 不同章节里 id 重名时，链接会落到第一个
EPUB 导入时 `flattenAnchorHref` 把链接压成全书统一的 `#id`，丢掉了文件名。如果两个章节文件
有同名 id，链接会落到第一个。KF8 现在也输出 `#id`（`resolve_pos_links`），所以同样受影响。
要根治，得在导入时按文件给 id 加前缀；这样只对新导入的书生效。目前还没遇到真实的例子。

### KF8 插入点落在标签中间的坏文件
Calibre `build_parts` 遇到插入点落在标签中间时，会把插入点挪到标签外面
（launchpad #1082669）。`reassemble_with_fragments` 没移植这一步，代码里有 `ponytail:` 注释。
遇到真实的坏文件再补。

### MOBI6 识别注释只靠启发式
MOBI6 没有 class，`footnote.ts` 判断一个链接是不是注释，只看两点：链接在 `<sup>` 里且文字很短，
或者文字像 ☆、[1] 这类标记。如果一本书的注释标记两样都不符合，点了会直接跳转，不弹浮窗。
注释列表里的回链也套在 `<sup>` 里，但它的文字是整段注释，所以「文字 ≤8 字」这个条件就是用来区分回链的。

### MOBI6 锚点可能插进 HTML 实体中间
`add_filepos_anchors` 如果把锚点插进 `&…;` 中间，会把这个实体拆坏。Calibre 会把锚点挪到实体后面，
我们没做。目前没见过真实的例子。
