# AutoBook 项目规范

AutoBook 是一个双端电子书阅读器：桌面 Tauri 应用（本目录）+ 手机/iPad PWA（`mobile-typewriter/`，部署在 book.fivood.com）。

**分支分工（2026-07 起，main 已废弃不用）**：
- `desktop` — 桌面客户端开发。发版打 `vX.Y.Z` tag（tag 触发 CI，不认分支）
- `release/1.6.0` — PWA / web 端。push 即触发 Cloudflare Pages 生产部署（生产分支绑定就是它，别改名）
- 改动涉及两端共享内容（少见，PWA 是独立 npm 包）时，记得在两个分支间 cherry-pick 同步

## 目录结构

- `src/` — 桌面端 SvelteKit（Svelte 4）源码
- `src-tauri/` — Tauri 2 Rust 壳
- `mobile-typewriter/` — 独立 npm 包：PWA 打字机阅读器（有自己的 package.json / eslint.config.js）
- `stats-sync/` — Cloudflare Worker + KV，阅读时长同步（sync.fivood.com）
- `scripts/` — 构建辅助脚本
- `static/vendor/` — postinstall 拷贝的第三方运行时资产（libarchive / ort / pdfjs），**不进 git**

## 提交前必过的检查

两端各自跑，都必须 **0 error**：

```
npm run check   # svelte-check（类型 + 模板）
npm run lint    # eslint（见下）
```

ESLint 走「少而准」路线，只开确实咬过这个仓库的规则，**不要**擅自启用 recommended 全家桶：

- `no-console`（warn）— 调试日志禁止进版本。需要留的日志用 `import.meta.env.DEV` 门控，或用 `console.warn/error/info`（放行）
- `no-empty`（error）— 裸 `catch {}` 禁止；有意吞错必须在块内写一行注释说明为什么可以吞
- `no-debugger`（error）
- `@typescript-eslint/no-unused-vars`（warn）— 前缀 `_` 表示有意不用

两个包的 eslint.config.js 保持同步；加规则时两边一起加。

## 代码规范

- **注释只写代码本身表达不了的约束和原因**（为什么这么做、什么坑逼出来的），不写「下一行在干什么」。这个仓库的长注释块都是踩坑记录，延续这个风格
- `as any` / `@ts-ignore` 必须带注释说明原因（参考 `load-pdf.ts` 里对 pdfjs 类型漂移的处理）
- **不要往巨石文件里继续堆代码**。当前最大的三个：`settings-content.svelte`（~3100 行）、`b/+page.svelte`（~2700 行）、PWA `+page.svelte`（~1500 行）。给它们加功能时优先拆出子组件/模块
- UI 文案用中文；按钮 `title` 里带快捷键提示（如「减速 (D)」）
- 错误要么上抛、要么给用户可见反馈（dialog / banner），best-effort 的静默失败必须注释

## 架构约定（违反会出数据 bug）

- **两套 book-id 空间**：书签用 IDB autoincrement id；笔记 / FS 卡片用 `stableIdFromTitle` hash。跨域关联必须经 title 桥接，不能拿一边的 id 查另一边
- **OCR 固定 PaddleOCR.js + ORT WASM 单线程**。WebGPU EP 在 PP-OCRv5 上静默返回 0 结果（不抛错），不要「优化」回去；多线程 WASM 需要 COOP/COEP，是已知的未来项
- Paddle 返回的 poly 点是 `[x, y]` 元组，不是 `{x, y}` 对象
- **blob URL 所有权归缓存**：`formattedBookCache` evict 时统一 revoke，Observable teardown 里不许 revoke（1.14.1 的破图 bug 就是这么来的）
- pdfjs 的 cmaps / standard_fonts / wasm 必须整目录可访问（worker 运行时按目录 URL 找兄弟文件），单文件 `?url` import 会碎。两端都靠 postinstall 拷到 static
- 外存同步回写（`saveExternalLastRead` 等）必须比较 `lastBookModified`，防止旧数据覆盖新进度
- **朗读位置索引统一以 `extractText()` 的原始字符串为准**。分句结果（`Sentence`）自带 `start`/`end` 绝对偏移，别再用「累加 `sentences[i].text.length`」推算——`trim()` 掉的空白会逐句累积漂移（实测 200 段就偏 199 字）
- **不要按 `.tw-c` span 索引定位字符**。打字机现在只包装 frontier 所在的那一段，全书 span 不存在了；而且这条老路径本身就漏掉未包装的 `\n`，包装前后取到的索引不一致。一律走普通 text-node 遍历，包装与否结果相同
- 打字机是**块级增量**的：未读到的段落整段 `.tw-block-hidden`，只有 frontier 那段逐字包装，走过就拆回纯文本。给它加功能时别退回「一次性包装全书」（30 万字实测冻结 1.3 秒 + 常驻 30 万 span）
- blob 类 TTS 引擎（SAPI / 自定义 HTTP / Kokoro）统一继承 `BlobAutoReader`，子类只实现 `synthesize()`。语速由 `synthesisHonorsRate` 决定走合成侧还是 `playbackRate` —— **两边都设会叠乘**（WinRT 曾经 1.5 倍速实际放成 2.25 倍）

## UI 交互规范

- **禁止「隐形但可点」的控件**：hover-reveal 的按钮在未激活时必须保持 `pointer-events-none`，只允许视觉 preview。两个 FAB 栈相邻时斜划误触就是这么修的
- PWA 的 `readingActive` 语义：打字机 = `playing`；手动阅读（PDF / 滑屏）= 3 分钟交互窗口内。唤醒锁和阅读计时都挂在这个标志上，改动前想清楚两边

### 主题调色板契约

写任何浮层 / 菜单 / 对话框时必须走主题变量，禁止用 `bg-white/N` / `bg-black/N` / 具体 rgba 硬编码——主题一换就废。两套语义色，各归各的浮层类型：

- **menu 色** `--menu-background` / `--menu-foreground`（工具类 `bg-menu` / `text-menu`）
  - 常驻在 reader chrome 上的浮标、header 下拉菜单、上下文/右键菜单、短命令 toast、banner。深底浅字，从阅读内容里跳出来
  - hover 用 `hover-menu-inverted`（反相高亮）
- **页面色** `--background-color` / `--font-color`
  - 对话框、抽屉（AI/highlights）、笔记编辑器、模态帮助面板、词典弹窗、侧栏
  - hover 用 `hover-soft`（`color-mix(currentColor 10%)`，深浅主题双向自适应），选中态用 `bg-soft-active`

其它 currentColor-based 惯用写法（都在 `app.scss`）：
- 边框/分隔线：`border-current/20`、`bg-current/30`
- 危险操作文字：`color:var(--danger-color);`（配 `hover-soft-strong`，别用 `text-red-300`）
- 主按钮（对话框「保存/确认」）：`style="background:var(--menu-background);color:var(--menu-foreground);"`，或用 `buttonClasses`（走 `--link-color`）

原生 `<select>` 的 `<option>` 弹出层在 Windows / WebView2 不继承主题字色，`app.scss` 里的全局 `option { color:#111; background:#fff }` 已经兜底，不用每个 `<option>` 内联写 `style="color:#000"`。

## 发版流程

桌面（在 `desktop` 分支上）：
1. 版本号改三处：`package.json`、`src-tauri/tauri.conf.json`（version + 窗口 title）、`src-tauri/Cargo.toml`
2. `CHANGELOG.md` 顶部加 `## X.Y.Z` 条目：中文、写根因和修法，不只写现象（CI 用它做 release body）
3. 提交后 `git tag -a vX.Y.Z` 并推送分支 + tag —— CI 全托管（构建、签名、建 release、latest.json），**不要本地 build 或手动 gh release**
4. 验证：`gh run watch` 或 `curl https://updates.fivood.com/latest.json`

PWA：推 `release/1.6.0` 即部署，无版本仪式。
