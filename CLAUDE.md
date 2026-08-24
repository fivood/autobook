# AutoBook 项目规范

AutoBook 是一个桌面电子书阅读器（Tauri，本仓库本分支）。另有一份手机/iPad PWA
部署在 book.fivood.com，**目前是停摆状态，不是在维护的第二端**。

**PWA 的处置（2026-08-24 决定）**：不追平桌面端。它和桌面端已经分叉到「一边有
整套 i18n、一边全是硬编码」的程度，补齐的成本换不来对等的价值。**重新考虑它的
触发条件是「能做成 iOS 应用」**——在那之前它就停在原地，不要为了「双端一致」去
同步功能，也不要因为桌面端改了什么就觉得欠 PWA 一笔。

对外描述、README、发布说明里都按「桌面阅读器」写，别再说「双端」——那个说法现在
是不成立的。

**分支分工（2026-07 起，main 已废弃不用）**：
- `desktop` — 桌面客户端开发。发版打 `vX.Y.Z` tag（tag 触发 CI，不认分支）
- `release/1.6.0` — PWA / web 端。push 即触发 Cloudflare Pages 生产部署（生产分支绑定就是它，别改名）
- **PWA 源码（`mobile-typewriter/`）只在 `release/1.6.0` 上**。这个分支上曾经也有一份，但从 2026-07-02 起就没人动过，2026-08-05 删掉了，留着只会让人（和 dev server）跑错目录。真要改 PWA 就切分支或另开 worktree

## 目录结构

- `src/` — 桌面端 SvelteKit（Svelte 4）源码
- `src-tauri/` — Tauri 2 Rust 壳
- `stats-sync/` — Cloudflare Worker + KV，阅读时长同步（sync.fivood.com）
- `scripts/` — 构建辅助脚本
- `static/vendor/` — postinstall 拷贝的第三方运行时资产（libarchive / ort / pdfjs），**不进 git**

## 提交前必过的检查

必须 **0 error**（PWA 在 `release/1.6.0` 上单独跑同样两条）：

```
npm run check   # svelte-check（类型 + 模板）
npm run lint    # eslint（见下）
```

ESLint 走「少而准」路线，只开确实咬过这个仓库的规则，**不要**擅自启用 recommended 全家桶：

- `no-console`（warn）— 调试日志禁止进版本。需要留的日志用 `import.meta.env.DEV` 门控，或用 `console.warn/error/info`（放行）
- `no-empty`（error）— 裸 `catch {}` 禁止；有意吞错必须在块内写一行注释说明为什么可以吞
- `no-debugger`（error）
- `@typescript-eslint/no-unused-vars`（warn）— 前缀 `_` 表示有意不用

两个包的 eslint.config.js 保持同步；加规则时记得也去 `release/1.6.0` 的 `mobile-typewriter/` 加一遍。

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

## 真机排查（改阅读器行为前先读这一节）

**编辑器内嵌的预览面板不合成画面，`requestAnimationFrame` 一次都不会触发。**
实测 `rafFired: 0 / timerFired: 1`——`setTimeout` 正常，rAF 全死。于是这些
在面板里全是坏的，而它们看起来**和真 bug 一模一样**：

- 分页模式整页空白（`displayedHtml` 赋值在两层嵌套 rAF 里）
- 滚动后阅读进度恒为 `0 / N 0.00%`、书签存进 `exploredCharCount: 0`
  （`onScroll()` 整个包在 rAF 里）
- `scrollIntoView({behavior:'smooth'})` 原地不动（`'auto'` 正常）
- 所有 CSS 动画/过渡卡在第一帧

2026-08 排查朗读时因此差点报出三个假 bug。**碰阅读器渲染、滚动、分页、动画
的改动，一律上真机验。**

```
npm run tauri:dev:cdp                       # 一个 shell 里挂着别关
node scripts/cdp-eval.mjs "location.pathname"
node scripts/cdp-eval.mjs "$(cat probe.js)" # 表达式会被 await，可以返回 Promise
```

### 冒烟套件

```
npm run tauri:dev:cdp      # 一个 shell 挂着
npm run smoke              # 另一个 shell
```

`scripts/smoke-test.mjs`。**每个场景对应一个真出过的 bug**，不是凭空想的检查项：
书籍开头的书签能不能跳回、朗读期间正文是否被藏起来 + 逐句高亮是否推进、批量
导入失败时是否逐个报出文件名。

规矩：
- 加场景的前提是**它对应一个真实发生过的回归**。想不出对应的 bug，就说明那个
  场景大概率不值得写
- 套件自己导一本 `ZZ-冒烟测试用书`，跑完删掉，改过的 localStorage 键全部还原
  （失败路径也走 finally）。跑之前先 snapshot，拿不到就拒绝运行
- 不要靠切存储源/改 fsRoot 来制造失败——那会牵出文件夹授权弹窗，还得让套件自己
  收拾。用坏数据（比如后缀是 .epub 但内容不是 zip）更干净
- `goto()` 必须传一个**页面专属就绪标记**。只等 `readyState === 'complete'` 不够，
  SvelteKit 之后还有客户端导航，这期间起的 evaluate 会以
  `Execution context was destroyed` 挂掉

自检过：把书签那个修复临时退回去，套件立刻红（`4000 → 4000`），改回来又绿。

几条踩过的：

- `tauri dev` 里 vite 走 strictPort，**5281 被占就整个起不来**（CDP 端口也就
  永远不出现）。上一轮的 vite 进程要先杀干净
- `dialogManager.dialogs$.next([...])` 是**整体替换**。自己弹的框会把启动时的
  「文件夹需要重新授权」顶掉——别看到没弹就以为那个机制坏了
- 外存书库要授权才读得到。不想点原生选择框的话，直接写
  `%LOCALAPPDATA%\io.github.fukki.ebookreader\allowed-roots.json`
  （内容是转义好的 JSON 数组，例如 `["E:\\e"]`），`grant_remembered_roots()`
  启动时就读它
- 真机连的是**开发库**，不是安装版的库。动数据前先 `getAll` 存一份快照，
  测完删干净、改过的 localStorage 键还原

## 发版流程

桌面（在 `desktop` 分支上）：
1. 版本号改**四处**：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、
   `src-tauri/Cargo.lock` 里 `name = "app"` 那条。窗口标题**不用管**——1.36.1 起由
   `setup()` 从包版本推导，配置里只留裸的 `"AutoBook"`（之前手写的版本号在 v1.33.0
   卡了两个版本没人发现）
2. `CHANGELOG.md` 顶部加 `## X.Y.Z` 条目：中文、**只写用户视角的摘要**，不展开根因/
   文件/行号（那些写进 commit message）。CI 用它做 release body
3. `npm run check` / `npm run lint` / `npm test` / `cargo check` 全过后提交、推分支
4. **建 release 壳**——`GITHUB_TOKEN` 建不了 release（`Resource not accessible by
   integration`），用个人 token 建，tag 由它顺带创建，**这次 tag push 会自己触发
   工作流，不用再 dispatch**：

   ```
   gh release create vX.Y.Z --target desktop --title vX.Y.Z --notes-file notes.txt
   ```

   `--target` 必须给**分支名**，给 commit SHA 会被 API 拒。tag 已存在时改用
   `--verify-tag` 并手动 `gh workflow run "Release Desktop" --ref vX.Y.Z`
5. 验证：`gh run watch <id>`，完了 `curl https://updates.fivood.com/latest.json`
   确认 version 已经变

`gh run rerun` 对权限问题没用——它沿用原次运行排队时的 token 权限快照。

PWA：推 `release/1.6.0` 即部署，无版本仪式。
