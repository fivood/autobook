# autobook

桌面优先的中文电子书阅读器，原型 fork 自 [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader)，目前与上游已有较大分歧。同一份源码输出两个目标：

- **网页 PWA**：[book.fivood.com](https://book.fivood.com)（Cloudflare Pages，可在 iPhone Safari 加到主屏幕）
- **Windows 桌面版**：[Tauri 2](https://tauri.app/) 打包成 `.exe`（NSIS），书库直接落到本地文件系统，带签名的自动更新通道

## 与上游 ttu-ebook-reader 的差异

上游是面向日语学习者的网页阅读器，注重日文 / 假名 / 词典支持。autobook 重新对焦在「中文长篇阅读 + 桌面应用 + 自动播放」三件事上，主要改动按层次列：

### 桌面端 / 分发
- **完整的 Tauri 2 桌面壳**，上游只有网页版
- **签名的自动更新通道**：基于 GitHub Releases + `latest.json` manifest，应用内一键检查更新
- **本地文件系统存储**：`TauriFsStorageHandler`，书库直接放 `~/Documents/AutoBook/<书名>/`，每本书一个子目录，可直接拷贝 / 备份 / 用 Everything 搜索
- **窗口标题栏带版本号**（"AutoBook vX.Y.Z"）

### 阅读体验（这是主要改动）
- **打字机自动播放**（连续滚动模式）：右下角播放/暂停按钮，逐字浮现，A/D 调速（1–60 字/秒），从已读位置接着开始
- **多引擎语音朗读**（分页模式）：
  - **WinRT TTS**：Windows 本地语音，支持自然人声（需在 Windows 设置中安装）
  - **Edge 在线 TTS**：微软 Edge 云端神经网络语音，无需安装，音质优秀
  - **自定义 HTTP TTS**：对接任意第三方 TTS API（如讯飞、百度等），支持自定义 endpoint / headers / body 模板
  - 右下角喇叭按钮 / 全局快捷键（默认 `Ctrl+Alt+P`，可自定义），0.5×–2.0× 语速
- **自动语言检测**：打开书籍时根据 EPUB `dc:language` 或文本 CJK 密度自动识别（中 / 日 / 英），匹配对应 TTS 语音
- **滚动模式与分页模式自动播放各司其职**：连续模式跟随打字机，分页模式跟随 TTS，互不串扰
- **顶部菜单触发热区扩大到 48px**（上游过小容易划过）

### 格式支持
- **EPUB / HTMLZ**：继承上游，是最完整的格式
- **TXT**：编码自动识别（BOM 嗅探 → 严格 UTF-8 → Shift-JIS / GB18030 / BIG5 按 CJK 密度打分）；自动识别章节（「第 X 章」汉/阿数字、序章 / 楔子 / 番外 / Chapter / Section / Part 等）
- **Markdown（.md / .markdown）**：marked + GFM 渲染；fenced code block 走 highlight.js（atom-one-dark 配色）；`$...$` / `$$...$$` 数学公式由 KaTeX 渲染（语法错误降级为红字 code 块）；按 h1/h2 切 section 联动 TOC
- **MOBI / AZW / AZW3**：完全自研 Rust 解析器（不依赖第三方 crate），支持 PalmDoc 和 Huff/CDIC 两种压缩；中文编码嗅探链（UTF-8 + CP1252 回退 → GB18030 → GBK → Big5）；自动提取封面和内嵌图片；按 `<mbp:pagebreak>` 切 section 生成 TOC
- **AZW3 / KF8**：原生 KF8 解析器，支持 KF8:joint 和纯 KF8 两种文件结构，自动检测 BOUNDARY 标记切换解析模式
- **Calibre 智能转换**：导入 MOBI/AZW3 时自动检测本机 [Calibre](https://calibre-ebook.com/)，有则调用 `ebook-convert` 转 EPUB 获得最佳效果，无则走内置解析器并提示安装 Calibre
- **ZIP 批量**：上述任意格式打包成 ZIP 拖入或选择，自动展开后逐个导入

### 书库管理
- **自定义文件夹分类**（1.3.4+）：左侧侧栏建文件夹；拖书籍卡片到文件夹完成归类；同一本书可同时归到多个文件夹（标签式而非互斥）；多选 + 胶囊批量分类

### 主题
- **13 个内置主题**：上游 7 个，autobook 新增 Seafoam / Columbia Blue / Dove Grey（浅色）与 Abyss / Espresso / Rainforest（深色）
- **sage-green** 设为默认（`#f0efe6` / `#5f7e7b` / `#405a5c`）
- **可编辑内置主题**（产生同名覆盖）+ 完整调色板（菜单背景 / 字 / 按钮 / 超链接独立设置）
- **下拉菜单跟随主题**（上游硬编码灰色）

### UI / 本地化
- 默认横排
- 菜单 / 工具提示 / 对话框按钮 / 剧透标签全中文化（原本散落日文 `ぁあ` / `ネタバレ` 等已替换）
- 字体瘦身：删掉 Klee / Shippori / Genei 等装饰字体；保留 Noto Sans JP / Noto Serif JP / KZ UDGothic / KZ UDMincho；新增**思源黑体（Noto Sans SC）**

### 工程改造
- 全部 svelte-check 类型错误清零（`moduleResolution: bundler`，ambient 类型补全）
- TTS / 自动滚动 / 主题 store 等模块的边界 bug 修复

### 删掉的东西
- Bug Report 入口
- 部分 PWA 安装提示
- 各种日语学习者向的细节（如假名 furigana 的部分提示）

## 主要功能速查

| 功能 | 操作 |
|---|---|
| 导入书籍 | 拖入文件 / 点击上传图标，支持 EPUB、TXT、MD、MOBI、AZW3、ZIP |
| 打字机自动播放 | 连续滚动模式 → 右下角播放按钮 / A/D 调速 |
| 语音朗读 | 分页模式 → 右下角喇叭按钮 / 全局快捷键 `Ctrl+Alt+P` |
| 文件夹分类 | 左侧栏新建文件夹，拖拽书籍卡片归类 |
| 检查更新 | 顶部菜单 → 设置内（仅桌面端） |
| 自定义主题 | 设置 → 主题 → `+` 新建 / 选中已有主题点笔图标编辑 |
| 切换全屏 | 顶部菜单全屏图标 |

## 开发

```sh
npm install
npm run dev          # 浏览器开发，http://localhost:5173
npm run tauri:dev    # 桌面壳开发（自动启 Vite + 编译 Rust）
```

## 构建

### Windows 安装包

```powershell
# 必须先设签名 key 才会生成 .sig（updater 需要）
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\autopage.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri:build
```

产物在 `src-tauri/target/release/bundle/`：
- `msi/AutoBook_<ver>_x64_en-US.msi`
- `nsis/AutoBook_<ver>_x64-setup.exe`
- 同名 `.sig` 签名文件

首次安装时 SmartScreen 会提示"未知发布者"，点"更多信息 → 仍要运行"即可。

#### 发版时还要做一步：上传 `latest.json`

updater 端点是 `releases/latest/download/latest.json`，没这个文件「检查更新」会报 *Could not fetch a valid release JSON from the remote*。每次 `gh release create` 后还要：

```json
{
  "version": "1.0.x",
  "notes": "...",
  "pub_date": "2026-06-09T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<.sig 文件全部内容>",
      "url": "https://github.com/fivood/autobook/releases/download/v1.0.x/AutoBook_1.0.x_x64-setup.exe"
    }
  }
}
```

```sh
gh release upload v1.0.x latest.json --clobber
```

### 网页版

```sh
npm run build        # 产物在 build/
```

Cloudflare Pages：
- Build command: `npm run build`
- Build output directory: `build`

## 数据互通

| | 桌面版（Tauri） | 网页版（PWA / 手机） |
|---|---|---|
| 默认存储 | 本地文件系统 | 浏览器 IndexedDB |
| 存储位置 | `~/Documents/AutoBook/<书名>/` | 浏览器内部 |
| 跨端同步 | 通过 Google Drive / OneDrive 在两端各连一次 | 同左 |

两端的本地存储隔离，要共享书库走云盘同步。

## License

继承上游 BSD-3-Clause，见 `LICENSE`。
