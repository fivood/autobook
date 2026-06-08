# autopage

个人定制的电子书阅读器，基于 [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader) 改造。同一份源码同时输出两个目标：

- **网页 PWA**：[book.fivood.com](https://book.fivood.com)（Cloudflare Pages 部署，可在 iPhone Safari 加到主屏幕）
- **Windows 桌面版**：通过 [Tauri](https://tauri.app/) 打包成 `.msi` / `.exe`，书库直接落到本地文件系统

## 与上游的差异

- **桌面端原生存储**：新增 `TauriFsStorageHandler`，书库存到 `~/Documents/EbookReader/`，每本书一个子目录，文件可直接管理
- **横排默认 + 中文 UI**：默认横排阅读，菜单/工具提示/对话框按钮中文化
- **配色重做**：sage-green 主题（`#f0efe6` / `#5f7e7b` / `#405a5c`）作为默认
- **TXT 编码自动识别**：BOM 嗅探 → 严格 UTF-8 → Shift-JIS / GB18030 / BIG5 按 CJK 密度打分自动选择
- **字体瘦身**：删掉 Klee / Shippori / Genei 等装饰字体，保留 Noto Sans JP / Noto Serif JP / KZ UDGothic / KZ UDMincho，新增**思源黑体（Noto Sans SC）**
- **去掉了** Bug Report、PWA 安装的部分提示等不需要的入口

## 主要功能

| 功能 | 说明 |
|---|---|
| **打字机自动播放**（连续滚动模式） | 右下角兔子图标，逐字浮现，A/D 调速（1–60 字/秒），已读内容首次启动时自动显示 |
| **语音朗读**（分页模式） | 右下角喇叭图标，按 `V` 键切换，基于 Web Speech API，支持语速调节（0.5×–2.0×）与语音选择 |
| **自动语言检测** | 打开书籍时根据 EPUB `dc:language` 或 TXT 文本内容自动识别语言（中/日/英），并匹配对应语音 |
| **检查更新** | 顶部菜单内置更新按钮（仅桌面端），自动对比 GitHub Releases 版本 |
| **主题系统** | 自定义主题支持菜单背景、文字、按钮、超链接等完整配色，支持编辑内置主题 |
| **TXT 章节识别** | 自动识别「第 X 章」、汉数字、阿拉伯数字标题、序章/楔子/番外、Chapter/Section/Part 等格式 |

## 开发

```sh
npm install
npm run dev          # 浏览器开发，http://localhost:5173
npm run tauri:dev    # 桌面壳开发，自动启动 Vite + 编译 Rust
```

## 构建

### Windows 安装包

```sh
npm run tauri:build
```

产物在 `src-tauri/target/release/bundle/`：
- `msi/<name>_<ver>_x64_en-US.msi`
- `nsis/<name>_<ver>_x64-setup.exe`

首次安装时 SmartScreen 会提示"未知发布者"，点"更多信息 → 仍要运行"即可。

### 网页版

```sh
npm run build        # 产物在 build/
```

Cloudflare Pages 配置：
- Framework preset: None（或 SvelteKit）
- Build command: `npm run build`
- Build output directory: `build`
- 自动通过 `process.env.BASE_PATH || ''` 部署到域名根路径

## 数据互通

| | 桌面版（Tauri） | 网页版（PWA / 手机） |
|---|---|---|
| 默认存储 | 本地文件系统 | 浏览器 IndexedDB |
| 存储位置 | `~/Documents/EbookReader/<书名>/` | 浏览器内部 |
| 跨端同步 | 通过 Google Drive / OneDrive 在两端各连一次 | 同左 |

两端的本地存储是隔离的，要共享书库走云盘同步。

## License

继承上游 BSD-3-Clause，见 `LICENSE`。
