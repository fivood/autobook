# AutoBook

> Windows 桌面电子书阅读器，把读书变成可检索、可回顾的个人知识库。打字机 / TTS 自动播放、剧透安全的 AI 问答、离线词典、一键同步到 Obsidian。支持 EPUB、MOBI/AZW3、PDF（带 OCR）、Markdown、TXT、HTMLZ、CBZ/CBR。中日文一等公民。

[English](./README.md) · **简体中文**

[![Latest release](https://img.shields.io/github/v/release/fivood/autobook?display_name=tag)](https://github.com/fivood/autobook/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/fivood/autobook/total)](https://github.com/fivood/autobook/releases)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)](https://github.com/fivood/autobook/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app/)
[![SvelteKit](https://img.shields.io/badge/frontend-SvelteKit-ff3e00)](https://kit.svelte.dev/)

原型 fork 自 [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader)，与上游已实质性分叉。Tauri 2 + SvelteKit + Rust，NSIS 安装包，带签名的自动更新通道。

---

## 它做什么

读得了一堆格式，记下高亮和心得，问 AI 但不剧透，查自带的离线词典，最后能一键导进 Obsidian 接续写作。

```
EPUB/MOBI/AZW3/PDF/MD/TXT  ──读──→  阅读器
                                     │
                                     ├─ 高亮 + 备注 + 标签 ──┐
                                     ├─ AI 助手（剧透安全）│
                                     ├─ 划词查离线词典   │
                                     │                    │
                                     ▼                    ▼
                                  自动播放          知识库（笔记本）
                                  打字机/朗读       ├─ 文件夹 / 标签
                                                   ├─ 高亮间链接
                                                   ├─ 每日回顾抽卡
                                                   └─ 导出 .md / 同步 Obsidian
```

## 阅读功能

### 格式支持

- **EPUB / HTMLZ**：上游基础，最完整
- **TXT**：编码自动识别（BOM → UTF-8 严格 → Shift-JIS / GB18030 / BIG5 CJK 密度打分）+ 章节自动切分（第 X 章、序章、楔子、Chapter…）
- **Markdown（.md / .markdown）**：marked + GFM、highlight.js 代码高亮、KaTeX 数学公式，按 h1/h2 切 section
- **MOBI / AZW / AZW3**：完全自研 Rust 解析器（不依赖第三方 crate），支持 PalmDoc + Huff/CDIC 两种压缩、KF8:joint 切换、中文编码嗅探链、内嵌图片
- **PDF**：通过 PDF.js 提取文本 + 整页图，按页切 section；扫描版 PDF 可用内置 PaddleOCR
- **扫描版 EPUB**（老 PDF 硬转的图册）：位置追踪 + 书签 + 12 档图片缩放
- **CBZ / CBR** 漫画包
- **Calibre 智能转换**：导入时自动检测本机 [Calibre](https://calibre-ebook.com/)，有则调 `ebook-convert` 转 EPUB 获得最佳排版
- **ZIP 批量**：任意格式打包成 ZIP 拖入，自动展开逐个导入

### 自动播放

- **打字机模式**（连续滚动）：右下角播放按钮逐字浮现，A/D 调速（1–60 字/秒）
- **语音朗读**（分页）：
  - **WinRT TTS**：Windows 系统本地语音（需先在 Windows 设置中安装中文语音）
  - **自定义 HTTP TTS**：对接任意第三方 TTS API（讯飞、百度、本地 GPT-SoVITS 等），自定义 endpoint / headers / body 模板
- **自动语言识别**（EPUB `dc:language` 或 CJK 密度打分），匹配对应语音
- **全局快捷键**（默认 `Ctrl+Alt+P`，可自定义）

### 高亮 + 备注

- 选中文字右键：4 色高亮、即时备注、标签、查词典
- 高亮独立存储，删书也不会丢
- 阅读器侧栏按章节分组浏览当前书的高亮

## 知识库（笔记本）

顶部菜单灯泡图标进入 `/notebook`，跨书浏览所有高亮和笔记。

- **标签**：高亮可加自由标签，按标签筛选（多选 AND）
- **文件夹**：手动建文件夹归类（与标签并存）
- **独立笔记**：不绑书的纯心得，记录碎片灵感
- **链接**：把相关高亮互链成主题串，Obsidian 风的 `[[wiki-link]]`
- **每日回顾**：按上次回看时间加权随机抽 10 条卡片轮询，发现忘记的想法
- **搜索**：原文 / 备注 / 书名 / 标签全文检索
- **跳转**：点击「跳转」回到原书原位置（分页模式自动切换到对应章节）

## 数据流出

### Obsidian vault 单向同步

- 选定本地 vault 目录，一键推送
- 每条高亮 → 独立 `.md` 文件（atomic note），YAML frontmatter 带 `id / kind / book / color / tags / created / modified / reviewed / links`
- 文件按 `{vault}/AutoBook/{书名}/{id}-{slug}.md` 组织，独立笔记进 `StandaloneNotes/`
- 链接生成为 `[[...]]` wiki-link，Obsidian 的 graph / backlinks / tag 直接激活

### Markdown 导出

- 当前过滤结果一键导出 `.md`：高亮转 `>` 引用块，备注转斜体，独立笔记成段，标签 + 时间在 `<sub>` 里

## AI 助手（剧透安全）

阅读界面机器人图标 → 右侧抽屉问答。

- **剧透三重防护**：开书时把全文按 ~800 字切 chunk，BM25 检索时按 `exploredCharCount/bookCharCount` 比例硬截断，未读 chunk 一概不进上下文；system prompt 强制「未读到的内容回答还没读到」
- **检索策略**：BM25 top-6 相关片段 + 最近 2000 字尾部，喂给 LLM
- **Provider**：
  - Anthropic（直连，用 dangerous-direct-browser-access 头）
  - OpenAI 兼容（OpenAI 官方 / OpenRouter / 本地 Ollama，填 base URL 即可）
- 流式响应、可中途停止、对话内即可配置

适合：「这个角色是谁」、「之前提过 X 吗」、「现在剧情走到哪了」

## 离线词典（BYO，自带）

选中文字右键「查词」→ 浮卡显示所有匹配词典的释义。

- **格式**：StarDict（`.ifo + .idx + .dict[.dz]`）和 `*.dict.json` 自定义
- **完全离线**：`.dict.dz` 用浏览器原生 `DecompressionStream` 解压
- **多词典并查**：点 📂 选词典文件夹，AutoBook 递归扫描所有 `.ifo` 子目录和 `.dict.json` 文件，结果按词典分段显示
- **英文词形还原回退**：复数 / -ing / -ed / -er / -est 查不到时自动尝试
- 路径记忆，下次打开自动重载

去 [ECDICT](https://github.com/skywind3000/ECDICT)、[CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)、[JMdict](https://www.edrdg.org/jmdict/edict_doc.html) 抓现成 StarDict 包，丢进一个文件夹选定即可用。

## 书库管理

- **文件夹分类**（tag 风格，一本书可同时归入多个）：左侧栏建文件夹，拖书过去；分类视图下删除只解关联不删书
- **拖拽归类**：单本直接拖动；多选后整批拖
- **批量胶囊**：多选后顶部出现「+ 分类名」一排，点一下入分类，有 toast 确认
- **本地文件系统存储**：`~/Documents/AutoBook/<书名>/`，可直接拷贝 / 备份 / Everything 搜索

## 桌面集成

- **Tauri 2 NSIS 安装包**，签名的自动更新通道（GitHub Releases + `latest.json` + Cloudflare Worker 代理）
- **系统托盘**：最小化到托盘，托盘菜单切换 TTS、退出
- **文件关联**：双击 `.epub` / `.mobi` / `.azw3` / `.pdf` / `.md` 等直接打开
- **全局快捷键**：TTS 启停可绑系统级快捷键

## 主题

- 13 个内置主题：上游 7 个 + Seafoam / Columbia Blue / Dove Grey（浅）+ Abyss / Espresso / Rainforest（深）
- 默认 `sage-green`（`#f0efe6` / `#5f7e7b` / `#405a5c`）
- 完整调色板（背景 / 字 / 菜单 / 按钮 / 选区 / 链接独立设置），可基于内置主题派生覆盖
- 暗色模式下书自带 `color:` CSS 全剥，避免出版社配色覆盖主题
- 自定义主题可导出 / 导入 JSON

## 安装

从 [Releases](https://github.com/fivood/autobook/releases/latest) 抓安装包：

- `AutoBook_<ver>_x64-setup.exe`（NSIS，推荐）
- `AutoBook_<ver>_x64_en-US.msi`

首次安装 SmartScreen 会提示「未知发布者」，点「更多信息 → 仍要运行」。之后的更新走应用内 updater 静默应用。

## 开发

```sh
npm install
npm run tauri dev    # 启 Vite + 编 Rust
npm run check        # svelte-check 类型检查
npm run lint         # ESLint
```

## 构建

```powershell
# 必须先设签名 key 才会生成 .sig（updater 需要）
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\autopage.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/`：
- `msi/AutoBook_<ver>_x64_en-US.msi`
- `nsis/AutoBook_<ver>_x64-setup.exe`
- 同名 `.sig` 签名文件

发版：推 `v*` tag 后 GitHub Actions 自动构建 + 上传 `latest.json`，应用内自动检测更新。

## 数据存储

| 内容 | 位置 |
|---|---|
| 书库 + 高亮 + 文件夹 | IndexedDB（schemaless） |
| 书籍原文件 | `~/Documents/AutoBook/<书名>/` |
| UI 设置 + AI key + 词典路径 | localStorage |
| Obsidian 同步 | 用户选定的 vault 目录 |
| 词典文件 | 用户选定的任意目录 |

「重置 UI」只清 localStorage，书 / 高亮 / 笔记 / 文件夹都保留。

## 与上游 ttu-ebook-reader 的关系

上游是面向日语学习者的网页阅读器，注重日文 / 假名 / 词典支持。AutoBook 重新对焦在三件事：

1. **中文长篇阅读** 的桌面体验（格式、编码、TTS、主题）
2. **打字机 / TTS 自动播放** 解放双手
3. **个人知识库**（高亮 → 笔记本 → Obsidian / AI / 词典）

删掉的上游模块：网页版 PWA、云存储（GDrive / OneDrive）、OAuth、Service Worker、GitHub Pages 部署、Edge 在线 TTS（始终 403）、日语学习专属细节、Bug Report 入口。

## License

继承上游 BSD-3-Clause，见 [`LICENSE`](./LICENSE)。
