# AutoBook 打字机（mobile-typewriter）

`book.fivood.com` 上的 PWA 子项目。把桌面端 AutoBook 的"逐字浮现"播放体验单独拎出来，做成一个手机就能装的 web app。

## 它是什么

- 上传 `.txt` / `.epub` / `.md`，按章节切好（中英章节标题都认）
- 屏幕上一字一字浮现，1–60 字/秒可调，章止开关
- 进度按内容哈希存 `localStorage`，下次重新选同一个文件直接续读
- 装到主屏后离线可用（service worker 缓存）
- 浅 / 深主题跟随系统
- 不需要服务器，纯静态站

## 与桌面端关系

桌面端 AutoBook（仓库 `autopage/`）功能上是个超集：高亮、笔记本、AI、词典、Obsidian 同步、TTS。手机用不上这些重资产，所以独立做了这个最小子集。两边共享思路（编码嗅探、章节切分逻辑），但代码独立，互不影响发版。

桌面端下载：[GitHub Releases](https://github.com/fivood/autobook/releases/latest)

## 开发

```sh
cd mobile-typewriter
npm install
npm run dev      # http://localhost:5174
```

## 构建

```sh
npm run build    # 产物在 build/
```

`@sveltejs/adapter-static` 输出纯静态文件，直接挂任意 CDN 都行。

## 部署到 Cloudflare Pages

1. Cloudflare 控制台 → Pages → Create project → Connect to Git
2. 仓库选这个项目，Build settings：
   - Production branch: `main`
   - Build command: `npm install && npm run build`
   - Build output directory: `build`
   - Root directory: `mobile-typewriter`
3. Custom domain → `book.fivood.com`

每次推 main 自动构建部署。

## 支持的格式

- `.txt` — BOM 嗅探 + UTF-8 严格 + GBK/Shift-JIS/BIG5 评分回退
- `.epub` — unzip → container.xml → OPF spine 按阅读顺序拼接，HTML 转纯文本
- `.md` / `.markdown` — 剥语法保留正文，`#` 标题当章节头

## 暂不支持

- MOBI / AZW3 / PDF：桌面专属（需要 Rust 解析器或 PDF.js，体积太大不上手机）

如果要在手机上读 MOBI/AZW3，桌面端 AutoBook 打开后另存为 `.epub` 或 `.txt` 再传过来。

## License

BSD-3-Clause（继承自 AutoBook）。
