# 交接：AI 配置 / 书目元数据 / 音色可用性

分支 `claude/ai-local-gloss-x5urfd`（基于 `desktop` @ 1.22.2），PR #7，草稿状态。
写给接手的人 —— 包括换一台机器、换一个会话之后的自己。代码本身能看，
这里只写代码看不出来的：为什么这么选，以及哪些结论是验过的、哪些没有。

## 七个提交

| commit | 内容 |
|---|---|
| `e85bafb` | 本地模型探测 + 上下文词典 |
| `050ea77` | OCR 文字层纠错（第一个批处理任务） |
| `2f02fd4` | 探测失败时点明 CORS |
| `935e80b` | 统一 AI 配置入口到设置页 |
| `6ed20a5` | DB v12 加 `bookMetadata`，作者维度接上导入的书 |
| `43d0d5c` | 音色列表可用性检查 |
| `eb36b94` | 自动打标（第二个批处理任务） |

## 几个不好倒推的决定

**`bookMetadata` 为什么是独立 store，而不是往 `manualBook` 里塞。**
两边共用一行的话，重新导入一次文件就会静默盖掉用户手填的作者。所以
`bookMetadata` 只放文件解析出来的，`manualBook` 只放人填的，读取时
**字段级**回退（不是整行二选一）—— 只为记页数建的 manualBook 行不该
把文件里的作者抹掉。

**为什么是 v12 不是 v10。** 早先有一版把 `bookMetadata` 挂在 v10，但
`desktop` 上 v10 已经是 `session`、v11 是 `manualBook`，那版直接作废重写。

**音色缺失为什么不自动清空。** 缺失往往是暂时的（Web Speech 首次
`getVoices()` 返回 `[]`）或本机限定的（另一台机器上还在）。自动清空是
拿永久损失换一个显示问题。同理 `checkVoiceSelection` 把空列表判
`unknown` 而不是 `missing`，否则每次打开设置都闪一下红字。

**自动打标为什么不自动写库。** 目标字段是 `manualBook.tags`，也就是用户
手填的那张表。把模型的猜测静默写进去，正是上面拆两张表要避免的那件事——
只不过覆盖者从「重新导入」换成了「模型」。所以任务只产出待审列表，勾选
后才 upsert；写的时候重新读一次库存标签，不信任列表里的快照（审阅列表
可能在屏幕上停留很久，期间手动录入 dialog 可能改过同一本书）。

**打标的模型门槛为什么是 7B，比 OCR 纠错还高。** 查词和纠错都有原文兜底，
模型只是在已有信息上做变换；给一本文件里什么都没写的书打标，靠的全是模型
自己的世界知识。小模型不会照 prompt 说的返回空数组，它会自信地编。低于这个
线，审阅假标签的成本比省下的事还多。

**`resolveLocalModel` 的调用点为什么长得很怪。** 它内部用 `getValue()`
读 store，Svelte 的响应式追踪看不见，`$:` 里的结果会冻结在探测完成之前。
`pickLocal(min, _probe, _chosen)` 的两个没用的参数就是用来在调用点把依赖
显式声明出来的，别"顺手清理掉"。

## 验过 / 没验过

**实机验过**（Playwright + 真浏览器）：v12 全新建库、v11→v12 升级路径且
原数据完整、清掉元数据行重新导入能补上且不产生重复书、作者页显示真实
作者、不进作者页直接导出报告、失效音色的提示与回填、Edge 列表外音色。

**没验过**：SAPI 音色那条走 Tauri IPC，云端环境跑不起 Tauri 应用。它与
web / edge 共用同一个 `checkVoiceSelection` 和同一套标记，但仅此而已。

**自动打标验过**（真浏览器 + 真本地模型 <LOCAL_MODEL> 8B）：造了 6 本覆盖各种
`dc:subject` 形态的书跑通全流程——BISAC 路径拆开、6 位代码映射成词、简介
整段被丢掉、已有标签不重复也不被覆盖、勾掉的书确实没写、写完表格即时刷新。
模型对「未知的书」（编的书名、没有作者）确实返回了空数组，没有硬编。
纯函数部分 38 个断言，脚本没进 git（这个包没有 JS 测试框架，`ocr-correct.ts`
的「已单测」也是同样意思）。

**自动打标没验过**：云端 endpoint 那条路径（本机只有本地模型）；上千本规模
的书库——审阅列表目前一次性全渲染，没有虚拟滚动，几百本以上可能要改。

## 接着做什么（原计划第三块）

~~1. **自动打标**~~ —— `eb36b94` 做完了，见下

1. **高亮聚类**
2. **双语对照渲染** —— 需要和 `fivood/transbook` 一起改，跨仓库开不了
   同一个 PR，两边各推各的分支
3. **模型推荐**（按 EN↔ZH / JA↔ZH / JA↔EN 语向）—— 明确排在最后。
   评测 harness 在 transbook 的 `claude/eval-harness-x5urfd` 上，语料
   含真实书籍片段，**不进 git**（`eval/.gitignore` 只放行 `*.sample.json`）

## 已知但没动

`statistics-content.svelte` 的 `db.getAll('data')` 只为拿 title/characters，
却会把每本书完整的 `elementHtml` 和全部 blob 读进内存。IDB 没有投影查询，
真修得另立轻量索引。

## 换机器时的坑

**DB v12 是单向的。** 跑过这个分支之后，IndexedDB 升到 12，再回去跑
1.22.2 的正式版会 `VersionError` 打不开库。想来回切，先把库备份出来，
或者用另一个浏览器 profile / 另一个 Tauri 数据目录试。

**`static/vendor/` 不在 git 里**（libarchive / ort / pdfjs），`npm install`
的 postinstall 会拷。新克隆之后必须先 `npm install`。

**云端会话装的系统依赖不持久。** 如果在 Linux 上要 `cargo check`：
host 目标会挂在 `winrt_tts.rs`（`mod winrt_tts;` 和 `proxy.rs` 无条件绑
Windows），得交叉编译到 Windows 目标才有意义：

```bash
apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64
rustup target add x86_64-pc-windows-gnu
cargo check --target x86_64-pc-windows-gnu --all-targets
```

`x86_64-pc-windows-msvc` 试过，挂在 `cc-rs: failed to find tool "lib.exe"`。
gnu 目标能覆盖类型 / cfg 分支 / API 用法，但和 CI 出包的 MSVC 目标在
ABI、链接层面不完全一致。

那 25 个 Rust 单测（`edge_tts` 2 / `proxy` 4 / `kf8_indx` 9 /
`mobi_scan_test` 10）在非 Windows 上跑不了 —— 交叉编译产物执行不了，
原生编译又过不去。要本机跑，得把 `winrt_tts` / `proxy` cfg 门控起来、
非 Windows 给返回 `Err` 的桩；其中 19 个是纯解析逻辑，与平台无关。
