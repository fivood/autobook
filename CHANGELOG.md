# Changelog

## 1.10.10

- 修笔记本 / 更新历史页面返回按钮在浅色主题下"看不见"：MergedHeaderIcon 之前硬写 `color: var(--menu-foreground)`——设置 / 统计页因为父容器有 `bg-menu` 深色背景所以白色图标显眼，笔记本 / 更新历史用页面背景就完全消失。改为 `color: inherit`，所有调用方都跟着自己父容器的前景色走
- OCR 三处判定连环修：
  - **混合模式 PDF 不再误报**：之前 `isScannedPdf` 只看图片页和真实字符比例，导致 270 节文字 + 19 节图片插页的混合书也弹 OCR 提示，且点开始会被 90% 安全门拦下。现在要求图片页占总节数 ≥ 60% 才视为扫描版
  - **已 OCR 不再重复提示**：之前用"每张图平均字符数 < 50"判定，对识别质量差的扫描书（如以地图、版画为主的书）OCR 跑完识别率不高，下次进入还是会弹。改为优先看 HTML 里有没有 `<p class="pdf-ocr-text">` 标记——跑过就视为已 OCR，绝不再问
  - **防截断门槛放宽**：runOcr 启动前的 90% 安全门改成更松的「目录节数 > 100 且找到图片页 < 5」才中止，混合书不再误伤；末尾的「序列化丢页」检查依然兜底防真截断
- 书库自适应宽屏：网格从硬编码 `grid-cols-3 md:4 lg:5`（永远封顶 5 列）改为 CSS `repeat(auto-fill, minmax(--book-card-min, 1fr))`，1920 屏能塞 9–10 列；移除 `pxScreen` 在 lg/2xl 处的怪异最大宽度限制，书库占满窗口
- 书库新增「封面尺寸」按钮（排序按钮旁边的网格图标）：滑块 120-300px + 3 档预设（密 130 / 标准 170 / 大 220），全局 localStorage 持久化。CSS 变量 `--book-card-min` 实时联动网格

## 1.10.9

- 设置页大改版（4 个 tab 内分组重排）：数据 / 阅读 / 外观 / 统计每个 tab 加 3–8 个分组标题，把原本一长串平铺的项目按职责归位。比如「数据」分成「存储与备份 / 导入与导出 / 阅读器行为 / 存储源与诊断」；「阅读」分「视图模式 / TTS 朗读 / 视图行为 / 阅读区尺寸 / 书签 / 页脚显示 / 图片与阅读点 / 其他」等
- 视觉层级重写：分组标题 1.6rem 粗体压顶 + 上方 1px 浅色分隔线，单项标题降到 text-base，整页一眼能看清"段落"——之前分组标题反而比单项小
- 顶部 4 个 tab（阅读 / 外观 / 数据 / 统计）从纵向图标 + 文字改成横向并排，未选透明度从 0.7 压到 0.5，选中加底部 2px 实线 + 14% 前景叠层。明暗主题下都不会"未选反而像选中"
- Off / On 切换按钮重做：未选从"白底黑字"改成"透明 + 50% 暗淡轮廓"，选中保留实色块 + 加粗。暗色主题下不会再被未选的白色块吸睛
- 输入框从"下划线式"改成"软填充胶囊"：圆角 + 8% 前景填充 + 18% 前景边框，不再和分组分隔线打架
- 数据 tab 新增 OCR 全局开关：「扫描版 PDF 自动提示 OCR」On/Off + 「清空仅看原图记忆」按钮（显示已记忆的本数）。配合 1.10.8 的「仅看原图」按钮，所有 OCR 提示行为可在一处管理
- 「本地数据位置」面板优化：lg 屏 IndexedDB / localStorage / Documents 三张卡片改为横排 3 列；长路径用 `text-overflow: ellipsis` 配合 `direction: rtl` 从右端省略，保留盘符可见；刷新 + 清除按钮挪到面板底部 actions 行
- 笔记本 / 更新历史的返回逻辑跟设置 / 统计统一：删除左上自写的 `<` 箭头按钮，改用右上 `MergedHeaderIcon` + `prevPage`（从哪进的回哪），不再用 `window.history.back()`

## 1.10.8

- 扫描版 PDF 顶部 OCR 提示条新增「仅看原图」按钮：点一次后这本书永久不再弹 OCR 提示（按书 ID 记忆，存 localStorage 的 `pdfOcrSkippedBookIds`）。原来的 ✕ 仍然只在本次会话隐藏
- OCR 语言选项加上**竖排中文 / 日文** (`chi_sim_vert` / `chi_tra_vert` / `jpn_vert`)：扫描的竖版繁中 / 日文老书选对应模型后能按右→左、上→下正确识别成横排段落
- 滚动模式下大型扫描 PDF / 漫画图片不显示：根因是所有页 `<img>` 同时解码触发 WebView2 内存上限，给所有 PDF / CBZ 页图加 `loading="lazy"` + `decoding="async"`，并对历史导入的书在打开时通过 DOM 改写自动补上这两个属性，无需重导
- 新增右下角浮动「图片缩放」按钮：仅在滚动模式 + 图片型 PDF / CBZ 下出现，12 档预设（50% – 300%），全局 localStorage 持久化跨书复用。点击展开后可缩放、点中间数字回到 100%

## 1.10.7

- 设置 → 数据 新增「本地数据位置」面板：实时显示三处实际物理路径（IndexedDB 主存储 / localStorage / Documents/AutoBook 同步副本），各自大小，以及「复制」「在资源管理器打开」按钮。一眼能看见数据真的在哪
- 「清除全部本地数据并重启」按钮：双重确认后通过 Rust 写 flag 文件，下次启动前 Rust 同时删 Local Storage + IndexedDB，把书库 / 高亮 / 笔记本 / 统计 / UI 设置全部清空。比手动卸载重装快
- 「重置 UI」依然存在（单独只清 localStorage），与新增的「全清」并存

## 1.10.6

> ⚠ 严重数据完整性修复。如果你在 1.10.3–1.10.5 期间对 PDF 跑过 OCR 且现在书内容大幅缩水，删除该书条目并重新导入原 PDF 文件即可恢复。
- 修 PDF OCR 写回时静默截断书内容的根因：之前用 DOMParser 把整本 elementHtml 解析成 DOM 树再 serialize 回来，浏览器 HTML 解析器在 800+ 页 PDF 上会沉默地丢节点，导致写回的版本比原书少几百页。这次完全绕开 DOMParser，改用正则定位每个 `<img data-pdf-page>` 后做字符串级插入，章节结构原样保留
- 加双重防御：runner 启动时若识别到的页数 < 书 sections 数的 90% 直接抛错中止，绝不允许写回；末尾再 verify 写回的 HTML 里 `data-pdf-page` 标记数没少于开始

## 1.10.5

- PDF OCR 改为后台作业：开了 OCR 之后可以切到别的书 / 书库 / 笔记本 / 设置随便逛，job 在 module 单例里继续跑，不会被路由切换打断
- 全局右下角浮一个胶囊提示「OCR · 书名 · 12 / 894」，点击直接跳回对应书；OCR 完成时变成「应用」按钮
- 只能同时跑一个 OCR：在已有 job 期间打开另一本扫描书，「开始」按钮会被禁用并提示「正在 OCR《X》，中止后才能开始这本」
- 错误状态显示「重试」按钮而不是简单 disappear

## 1.10.4

- 修 PDF OCR 跑几页后 banner 跳回初始状态：runner 之前按 `.pdf-section` 选择器迭代，大体积 HTML 下 DOMParser 偶尔丢失 section 父节点但保留 img，导致循环提前结束。改为按 `img[data-pdf-page]` 直接迭代，每个 img 用 `closest()` 找回插入容器；完整 894 页都能跑完
- OCR 完成后不再自动 reload。新增「完成」状态显示「OCR 完成（共 N 页）」+「应用并刷新」按钮，用户点击才刷新
- 阅读 banner 加防御日志：blob name 找不到时控制台 warn，便于排错

## 1.10.3

- 修 OCR 横幅永远不出现的 bug：`isScannedPdf` 之前算全文 < 200 字才算扫描，但 image 模式 `<h3>` 里塞着每页页码（"1", "2"...），100 页书光页码就 290 字。改为统计排除 `<h3>` 之后每页平均 < 50 字符才算扫描
- 修 PDF 误判为 text 模式的 bug：之前 useTextMode 只要半数样本不算 garbage 就走 text 模式，但每页只有页眉/页码/章节标记的扫描书能凑足 20 字过 isGarbageText 阈值。新增 average sample chars ≥ 150 的判定，"几乎啥也抽不出来"的扫描书自动回落到 image 模式 + OCR 横幅

## 1.10.2

- CBZ 漫画支持：把 ZIP 包里的图片按文件名 natural sort 排好，一页一 section 当书读。ComicInfo.xml 的 Title 会被识别成书名，第一张图自动作封面，1.10.0 的 PDF 页面 dwell 追踪器对 CBZ 同样有效
- 桌面 magic-byte 嗅探：扩展名不匹配任何格式时，按文件头识别 PDF / MOBI / ZIP 家族，ZIP 再二次细分（mimetype → EPUB；index.html → HTMLZ；纯图片 → CBZ）。iOS 分享/改过名的文件不再被错误解析
- 手机端 EPUB 封面：从 OPF 拉 cover image（EPUB3 properties="cover-image" 或 EPUB2 meta cover），「最近读过」卡片左侧显示缩略图，没封面的用 📖 占位
- 扫描版 PDF 的 OCR（桌面端）：自动识别"几乎没有文字层的 PDF"，阅读页顶部浮蓝色横幅，选语言（简中+英 / 繁中+英 / 纯英 / 日 等）→ 开始 → 实时进度。完成后阅读器、打字机、AI 助手、词典查词、字数统计立刻全部能用在扫描书上
- 移动端不引入 OCR：Tesseract.js wasm + 中文模型一共 ~30MB，PWA 装包不带这些
- 桌面端 BOOK_EXTS 把 pdf 和 cbz 也加上，命令行/文件关联直接打开

## 1.10.1

- PDF 原生目录：读取 PDF 自带的 outline（书签），章节名按层级缩进展示并叠在「第 N 页」标签前。原来翻几百页只有页码，现在能直接跳「序言/第三章 X」
- PDF 双栏识别：扫描页面正文宽度 35%–65% 内的候选边界，按"两侧均有 ≥30% 内容 + 跨越者 ≤10%"打分挑分栏线。学术论文/杂志/双栏报告读取顺序终于对了，单栏书不受影响
- EPUB 真目录（手机端）：读 EPUB3 的 nav.xhtml 或 EPUB2 的 toc.ncx，给每个 spine item 注章节名，渲染器按章节标题居中加粗显示，不再靠正文 h1 启发式
- Markdown YAML frontmatter 剥除：开头的 `---\n...\n---` 元数据块（Obsidian / Jekyll / Hugo 笔记常见）不再被当成正文读出来
- 手机端 PWA：visibility 检测 + wall-clock ticker，屏幕锁定/切换 App 时立即停止计阅读时长；rAF dt 上限 1000ms，避免后台返回时一口气浮现一大段
- 手机端 PWA 品牌统一：图标改用桌面端同款 PNG，名称从「AutoBook 打字机」改为「AutoBook」（manifest / svelte:head / apple-touch-icon-title 全部统一）
- 手机端「最近读过」卡片样式适配：长中文标题不再溢出，按 line-clamp 两行 + CJK anywhere 断行，删除按钮固定不被挤压
- EPUB 文件识别用三层信号：扩展名 + MIME + ZIP magic byte，iOS 分享时丢扩展名也能正确走 EPUB 解析器
- 「关闭书」「返回」按钮的视觉与可访问性微调

> ⚠ 设置 → 数据 顶部新增「跨设备同步阅读统计」面板。如果之前的 UI 自定义导致面板错位，请「重置 UI」后重启。

- 跨设备阅读时长同步：自带 32 字符 token 跨设备配对（无需注册账号），通过 sync.fivood.com（Cloudflare Worker + KV）合并桌面 + 手机端的每日阅读时长
- 合并策略：服务端按设备分桶取 max，客户端聚合时排除自身贡献后加进本地，多设备非并发使用时长会正确累加
- 桌面端：设置 → 数据 顶部新增同步面板，支持生成/保存/复制 token、立刻推送/拉取、重置 device-id；启用后默认 30 秒 debounce push + 5 分钟 pull
- 手机端 book.fivood.com PWA：阅读时右上 ⇅ 按钮、落地页脚链接均可打开同步面板；阅读时顶栏进度旁显示「今日 X 分」实时合并多设备贡献；typewriter 播放期间每秒累计阅读时长
- 顺手修了手机端 EPUB / Markdown 上传被识别成 txt 的 bug（handleFile 和 resumeFromRecent 之前都直接调 extractTxt，loader dispatcher 没生效）
- PDF 页数统计：阅读追踪器自动识别 PDF 书（基于 sections 引用前缀），每页停留满 3 秒才计入"已访问"集合，避免快速滚动虚加；阅读时点统计图标自动把"已读字数"换成"已读页数: X / Y"，纯图 PDF 也能拿到有意义的日报
- BooksDbStatistic 新增 sectionsRead / sectionsTotal 可选字段（IDB schemaless，无需 schema 升级）

## 1.9.1

> ⚠ 1.9.1 之前的版本如果自动更新升级后菜单图标没变（窗口标题显示新版本但 UI 是旧的），需要去 GitHub Releases 下载 NSIS installer 手动重装一次。1.9.1 起的版本自动更新会自动 kill webview 子进程，避免再踩这个坑。

- 修自动更新后前端 bundle 未替换的问题：NSIS 安装器加 PREINSTALL hook，先 taskkill app.exe / AutoBook.exe / msedgewebview2.exe 再 SetOverwrite on，确保 webview 不会持有 resources 文件导致 silent skip

## 1.9.0

> ⚠ 高亮右键菜单新增「查词」入口、笔记本图标从书签改为灯泡。如果之前的 UI 自定义导致菜单/图标错位，请「重置 UI」后重启。

- 离线词典（BYO 自带）：选中文字右键 → 高亮菜单新增「查词」→ 浮卡列出所有匹配词典的释义
- StarDict 格式（.ifo + .idx + .dict / .dict.dz）和 *.dict.json 自定义格式都支持，浮卡里 📂 选词典文件夹后递归扫描
- 完全离线（.dict.dz 走浏览器原生 DecompressionStream），路径记忆，下次自动重载
- 修 StarDict sametypesequence 解析：按 NUL 分隔切字段，音标用 [...] 包裹，避免 t/m 类型连排时出现替换字符方框
- 简单英文词形还原回退：复数 / -ing / -ed / -er / -est 查不到时自动尝试
- 图片剧透模式新增「不模糊」选项；「封面外」语义重写为「只露第一个子节点（封面），封底+扉页+正文图片都模糊」，解决某些书在开头并列展示封底（带剧透简介）的问题
- 右下角自动播放/朗读按钮：未启用时缩小+半透明几乎隐形，hover 整组才展开全部控件，启用时维持全可见
- 高亮右键菜单底色改用 --menu-background / --menu-foreground 主题变量，加三层 box-shadow 防止与背景色融在一起
- 笔记本图标 faBookmark → faLightbulb：与「书签」功能视觉区分，呼应"找写作灵感"的使用场景
- 笔记本/更新历史的返回按钮改用 history.back() 优先，没历史才回书库——从书内跳到笔记本再返回直接回原书
- 书库分类视图：拖书入分类后弹绿勾 toast 确认；单本拖动手型 cursor 提示；分类视图下的删除只解除分类关联不删书
- 主题导入/导出/新建三按钮包成一组，不再因主题数量多被拆分到两行
- 新增 /changelog 路由（书库顶部菜单时钟图标），支持 > ⚠ ... callout 提示和「立即重置 UI」按钮
- README 重写：从"中文 + TTS 增强阅读器"调整为"以读书为入口的个人知识库"定位

## 1.8.0

> ⚠ 阅读界面新增了机器人图标按钮。如果之前的 UI 自定义导致图标错位或不显示，请「重置 UI」后重启。

- 阅读时 AI 助手（剧透安全）：阅读界面顶部新增机器人图标，打开右侧抽屉问答
- RAG 仅基于"当前阅读进度之前"的文本：按 exploredCharCount/bookCharCount 比例切分纯文本索引，超出阅读位置的 chunk 一概不送进上下文
- 检索策略：BM25 取 top-6 相关片段 + 最近 2000 字尾部上下文，喂给 LLM
- 系统提示强制剧透安全：未读到的内容回答"还没读到，不能剧透"
- 支持 Anthropic 直连（带 dangerous-direct-browser-access 头）和 OpenAI 兼容协议（OpenAI 官方 / OpenRouter / 本地 Ollama）
- 抽屉内可即时配置 provider / api key / base url / model，本地保存
- 流式响应、可中途停止、可清空对话

## 1.7.1

- Obsidian vault 联动：笔记本顶部「选择 vault」按钮选定一个本地目录，「同步到 vault」一键单向推送
- 每条高亮/笔记导出为独立 .md（atomic note），按 vault/AutoBook/{书名 or StandaloneNotes}/{id}-{slug}.md 组织
- 文件 frontmatter 带 id / kind / book / color / tags / created / modified / reviewed / links，Obsidian 的 graph / backlinks / tag 全部直接可用
- 高亮间的「链接」生成为正文 wiki-link `[[...]]`，可在 Obsidian 中点击穿透
- vault 路径持久化（localStorage），后续打开自动记得；按钮 hover 显示当前 vault 路径

## 1.7.0

- 笔记本视图：书库顶部菜单新增「笔记本」入口，跨书浏览所有高亮
- 按书名分组、搜索原文/备注/书名/标签，已删原书的高亮保留并标「书已删除」
- 点击「跳转」回到原书原位置，分页模式自动切换到对应章节
- 高亮标签：备注对话框新增标签输入，支持空格/逗号分隔，笔记本顶部按标签筛选（多选 AND）
- 独立笔记：笔记本内「新建笔记」记录与书无关的碎片心得，可加标签，独立分组显示
- 导出 Markdown：当前过滤结果一键导出为 .md，按书分组，高亮转引用块、备注转斜体，独立笔记直接成段
- 文件夹：左侧栏支持新建/重命名/删除文件夹，每条高亮可在「未归档」与各文件夹间移动，删除文件夹时其中高亮回退到未归档
- 高亮链接：每条可链接到另一条形成主题串，关联面板内联展示，可解除链接
- 今日回顾：按 `(now - lastReviewedAt)/7d` 加权随机抽 10 条卡片轮询，点「已看」更新回顾时间，跳过不更新
- 暗色模式下书本原始 stylesheet 的 color 声明 + inline `style="color:..."` + `<font color>` 全部剥掉，避免书自带配色覆盖主题
- IDB v9：新增 highlightFolder store；highlight 增加可选字段 folderId / linkedIds / lastReviewedAt

## 1.6.1

- 高亮笔记接入备份/恢复/云同步：导出 zip、Tauri FS 同步、自动同步链路新增 highlights_ 文件
- 导出对话框新增「高亮笔记」勾选项
- 数据库新增 storeHighlightsForTitle：按书名匹配并合并高亮，遵守 NewOnly 行为，跨设备恢复时按 startOffset+endOffset+text 去重

## 1.6.0

- 高亮笔记：选中文字右键弹出菜单，支持 4 色高亮（黄/蓝/绿/粉）+ 备注
- 高亮侧栏：顶部菜单新增笔记按钮，打开侧栏浏览当前书所有高亮，按章节分组，点击跳转到对应位置
- 高亮编辑：点击已有高亮可修改颜色、编辑/添加备注、删除
- 高亮独立存储：高亮数据不随书籍删除而丢失，保留书名供后续跨书搜索
- 修复 HtmlRenderer insertBefore 崩溃：重写渲染器绕过 Svelte 4 HtmlTagHydration 的 DOM 锚点失效问题

## 1.5.2

- 移除 Edge 在线 TTS 引擎：微软反爬持续 HTTP 403，可用率长期为零，不再维护；本地高音质改用 SAPI + Windows 11 自然语音（设置 → 辅助功能 → 讲述人 → 添加自然语音）或自定义 HTTP TTS
- 砍掉网页版残留代码：云存储（GDrive / OneDrive）、OAuth、PWA service worker、GitHub Pages 部署脚本、网页域名提示全部移除；桌面端不再受这些遗留模块影响构建体积和启动时间

## 1.5.1

- 新增 PDF 支持（MVP）：基于 PDF.js 抽文本 + 整页 JPEG 渲染，按页切 section 并自动生成目录。文字层走打字机/朗读完全正常；图片占位走现有图库流程。复杂排版（多栏 / 表格 / 公式）的还原度有限，纯文字 PDF 最稳
- 更新对话框支持 markdown 渲染：跨版本升级时的合并 release notes 现在按版本折叠展示，列表 / 代码 / 链接都能正常排版

## 1.5.0

- KF8 / AZW3 自研 Rust 解析器：完整实现 Huff/CDIC 解压算法（对齐 Calibre 实现），不再依赖第三方 mobi crate，能原生读没有 Calibre 也能开的 AZW3 文件
- 修 MOBI6 乱码根因：record trailer 剥离逻辑里反向 varint 字节序和 bit 迭代方向错了，导致 PalmDoc 解压输出被截断混入垃圾。对齐 Calibre 的 sizeof_trailing_entries 后中文 MOBI 不再出现成段乱字符
- Calibre 智能转换：导入 MOBI / AZW3 时自动检测本机 Calibre，有则调 `ebook-convert` 转 EPUB 获得最佳排版（封面 / 编码 / 字体），无则走内置 parser 并提示安装
- 彻底移除 mobi crate 依赖：PalmDB 解析、元数据抽取、文本解压全部 in-house，避免上游 crate 不更新带来的 panic 风险
- MOBI HTML 里嵌入的 font-family 全部剥掉，保证阅读器主字体（思源黑体）一贯到底，避免出版社字体声明覆盖主题
- 解压后过滤 MOBI 控制字符 0x00 / 0x1E / 0x02，避免阅读器内出现不可见空段
- 调试用：浏览器控制台输入 `__forceNativeMobi(true)` 可强制走内置 parser 绕过 Calibre（用于对比解析效果）

## 1.4.22

> 1.4.13 → 1.4.22 之间的若干小版本未单独打 tag，统一在 1.4.22 累计发布。

- Calibre `ebook-convert` 集成：导入 MOBI / AZW3 时自动检测本机 Calibre，有则用它转 EPUB（最佳兼容性），无则走内置 parser 并显示安装提示
- 修文件夹分类显示为空：之前书 ID 用 `getDummyId()` 随机生成，每次重新打开都变，文件夹关联表查不到老书。改成对书名做 FNV-1a 哈希生成稳定 ID
- 修文件夹删除按钮无效：`ConfirmDialog` 的 resolver 把 wasCanceled 当成 ok 用了，确认即取消、取消即确认
- 重写 MOBI6 文本提取：绕开 mobi crate 的输出，自己解 PalmDB record 区、剥 trailer、按 UTF-8 + CP1252 fallback 解码，国产中文 MOBI 不再乱码
- 重写 KF8 解析器：修 `extra_record_data_flags` 偏移（应该是 0xF2 u16，原 crate 算错了）、修 fragment / skeleton record 偏移，AZW3 章节内容能正确抽出
- 重写 MOBI 图片提取：扫 PalmDB record 区按 magic byte 识别图片类型，不再依赖 crate 的 image_records 索引
- KF8 EXTH cover offset + author 解析
- 修 gaiji（外字图）误识别：尺寸阈值放宽，避免把正常小图当成外字过滤掉

## 1.4.12

- MOBI 中文乱码彻底解决：放弃 mobi crate 的 String::from_utf8_lossy 输出（会把 GBK 字节永久转成 U+FFFD），改成自己从 records 拉原始字节、直接做 PalmDoc 解压，再按 UTF-8 → GB18030 → GBK → Big5 优先级嗅探
- 关键判别量：用 UTF-8 lossy 的 replacement char 比例做编码分类轴。真 UTF-8 文件带尾部噪声 ratio ≈ 0–5%，真 GBK 强解 UTF-8 ratio ≈ 40–65%，20% 阈值能干净分开；纯靠"最少替换字符"判别时 GBK / Big5 都是宽容编码，会把任意字节解成"看起来像汉字的垃圾"，无法分辨
- KF8 / AZW3 joint 文件不再混过：扫记录里的 BOUNDARY 标记，发现就直接报错引导用户用 Calibre 转 EPUB，不再显示 1/8 残片误导用户。原生 KF8 解析器排进 1.5.0
- MOBI 解析全流程外套 catch_unwind：原先只 Mobi::new 受保护，后续 raw_records / image_records / palmdoc decode 任一环节 panic 都会让 Tauri command 崩溃，前端收到 null 弹"error: undefined"。现在 panic 也会变成可读字符串
- 前端 loadMobi 把 Tauri reject 的裸字符串包成真 Error 对象，让上层错误提示能正确显示中文报错
- HTML 属性碎片清理正则增强，能匹配以 CSS 值开头的残片如 1em" width="2em">，以及孤立的 "> 闭合碎片

## 1.4.6

- MOBI 编码 fallback 加 GB18030：GBK fallback 在 1.4.3 已加，但少量 GBK 不收录的字符仍剩 `��`。GB18030 是 GBK 的 4 字节超集覆盖全 Unicode，作为第三选项；三个候选（原始 / GBK / GB18030）按 replacement char 比例最低者取胜
- MOBI HTML 残片清理 v2：上一版 DOMParser 处理后仍有「孤儿属性串」漏到 text node 里（`1em" width="2em" align="justify">他两只...`），原因是 MOBI6 record 边界把 `<p ...` 的开头切走，剩下半截属性串进了文字流。现在 DOMParser 之后遍历所有 text node，用正则 `(\w+="..."){1,5}>?` 把这种残片删掉，要求至少一对完整 `name="value"` 才匹配，避免误伤正常文字里的引号
- 图片库剧透标签 `ネタバレ` → 「剧透」：1.2.x 中文化时漏了 book-reader-image-gallery 这两处

## 1.4.5

- 修 Win10 Web Speech 引擎下 TTS 朗读时不自动翻页：原逻辑只靠 `SpeechSynthesisUtterance.onboundary` 事件触发翻页同步，但 Win10 老 OneCore 语音（Yaoyao / Huihui 等）在 Chromium/WebView2 里不发 word/sentence 级 boundary 事件，整段读完都没回调，页面永远不动。现在每段开头额外用 `onstart` 触发一次 boundary，至少能做到段级翻页，与 SAPI 引擎的行为对齐。Win11 用户也无副作用：onstart 比第一个 word boundary 早一点点触发，已在当前页就 no-op
- 清理 stop / restartIfSpeaking 路径里漏掉的 `onstart = null`，避免引用泄漏

## 1.4.4

- 修分页模式下鼠标框选文字会被识别成翻页：svelte-gestures v5 的 swipe action 不区分 pointerType，鼠标拖动也会触发 swipe；现在 onSwipe 里检测 `ev.detail.pointerType === 'mouse'` 直接 return，触控 / 触笔不受影响

## 1.4.3

- 修中文 MOBI 乱码 `���`：mobi crate 只支持 UTF-8 / WIN1252 两种解码，国产中文 .mobi 基本都是 GBK，全部被识别成乱码。新逻辑：把 crate 输出的 WIN1252 字符串按 char→byte 反推回原始字节流，再用 encoding_rs 的 GBK 解一遍，replacement char 比例更低就用 GBK 结果
- 修 MOBI HTML 标签残片泄漏（`9ight="1em" width="2"` `idth="2em">` 等）：MOBI6 时代 HTML 经常带半截 `<p height="" width="" />` 伪标签，crate 直接拼记录串出来后字符串里残留这些片段。前端走一遍 DOMParser 让浏览器宽容 parser 修复，再 re-serialize 拿干净的 HTML
- AZW3 / 纯 KF8 文件友好报错：当前 mobi crate 只读 MOBI6 record 区，KF8 章节读不到，会变成空书。导入前检测 strip_tags 后内容 < 50 字时直接返回错误 "本文件看起来是 AZW3 / KF8 格式，KF8 章节为空。请尝试用 Calibre 转成 EPUB 后再导入"。后续要原生 KF8 得换 parser 或者 libmobi FFI，复杂度高，先这样兜底
- 加 encoding_rs 0.8 依赖（仅用于 GBK 解码 fallback）

## 1.4.2

- 修拖入 / 选择器报「文件必须是 HTMLZ、TXT、EPUB 或包含这些格式的 ZIP」的过时提示。错误文案改成「EPUB / HTMLZ / TXT / MD / Markdown / MOBI / AZW / AZW3」完整列表。如果还是看到这个错，多半是 NSIS 检测到「已是 1.4.1」跳过了覆盖，1.4.2 版本号会强制走完整安装

## 1.4.1

- 新增 MOBI / AZW3 支持：
  - Rust 端用 `mobi = "0.8"` crate 在 Tauri command `parse_mobi` 里解析，纯 Rust 无 C 依赖；KF8 (AZW3) 和 legacy MOBI 都能吃
  - 解析跑在 `catch_unwind` 里，遇到畸形文件 panic 不会拖垮整个 webview，返回字符串错误给前端
  - 内部图片走 EXTH cover offset 找封面，其余图片按 `recindex:NNNNN` 在 HTML 里被前端 rewrite 成虚拟文件名挂进 blobs map，复用现有 reader 的图片解析管线
  - HTML 用 `<mbp:pagebreak>` / `<p style="page-break-after:always">` / `<div class="mbp_pagebreak">` 切 section，每段抓首个 h1-h6 作为 TOC label，匹配现有翻页 / 进度算法
  - DRM 文件能解析出 metadata 但内容是乱码，crate 会在解压时报错降级成 `content_as_string_lossy`，目前不专门提示，后续看反馈再加
- tauri.conf.json fileAssociations 注册 `.mobi` `.azw` `.azw3`；BOOK_EXTS 同步加，从命令行 / 双击关联打开也走得通
- 文件选择器 accept / 拖入 regex / book-card 封面识别都已就位（书脊 palette MOBI/AZW/AZW3 已有，棕橘色）

## 1.4.0

- 新增 Markdown 格式支持（.md / .markdown）：
  - marked 解析 GFM；fenced code block 走 highlight.js（atom-one-dark 配色）；`$...$` / `$$...$$` 数学公式由 KaTeX 渲染（throwOnError=false，错的语法降级显示为红字 code 块，不让一条公式炸掉整章）
  - 按一级、二级标题（`#` `##`）切 section，与 TOC 联动；三级以下标题留在 section 内
  - 表格、引用块、列表、分隔线、行内代码都有相应样式；blockquote 边框 / table border / hr 用 currentColor 跟主题字色走
  - 读取时先 UTF-8，若 replacement char 超过 5 个再 fallback GBK，国产 Windows .md 文件不乱码
  - 跑通的链路：drop/选择器 accept → replicator dispatch (`load-md.ts`) → MD palette 绿色书脊封面（MD 标识）→ reader stylesheet 注入 KaTeX + hljs
- tauri.conf fileAssociations 注册 `.md` `.markdown` → 系统可关联本应用打开
- MOBI / AZW3 单独开下一个 1.4.x 处理：纯前端 parser 没有现成靠谱的，要么找 wasm（kindleunpack-wasm 之类）要么调用 Calibre cli 或自己写 PalmDOC + Huffman/HUFF 解码，工作量与 MD 不在一个量级

## 1.3.7

- 新建分类弹窗换成主题化对话框：之前用浏览器原生 `prompt()` 跳出 "tauri.localhost 显示" 的灰白默认框，无法贴主题色。新增 TextInputDialog 组件走 DialogTemplate 体系，背景、字色随当前主题变；Enter 提交、Esc / 点取消都正确返回 undefined
- 所有 dialog 位置上移：原 `top-1/2 -translate-y-1/2` 屏幕正中，垂直方向有点遮挡书库内容。改成 `top-[38%]`，对话框中心点位于屏幕约 38% 处（视觉"中间偏上"），不挡下方继续阅读时的内容

## 1.3.6

- 下拉 / 弹出菜单跟着主题色变：之前 popover 基底硬编码 `bg-[#333] text-white`，书库右上角的「排序」「来源切换」、统计页的「复制数据」下拉和「标题筛选」侧栏一律深灰白字，与 sage-green 等浅主题不搭。改走 `bg-menu` / `text-menu`（已绑 --menu-background / --menu-foreground 变量），切主题这些下拉立刻跟着变
- 新增 `bg-menu-inverted` / `text-menu-inverted` / `hover-menu-inverted` 三个工具类，用于"菜单底色反转"的选中态和 hover —— 排序菜单当前选中项的高亮就是这个反转色，hover 同理
- 书籍卡片底部标题条由 `bg-gray-800 text-white` 改成 `bg-menu/85 text-menu`，封面上的标题在浅主题下不再是突兀的灰黑横条

## 1.3.5

- 修 1.3.4 fresh install 看不到分类侧栏：v0 → v7 升级路径里没建 folder / bookFolder 两个 store，导致 refreshFolders 静默失败、侧栏组件挂在但没数据；侧栏 CSS 用 transparent 背景在浅主题下完全看不出来。case 0 补建两表 + 索引；侧栏改成淡灰底 + 加粗右边框 + min-height: calc(100vh - 4rem) 强制撑满
- bump 到 1.3.5 是因为 NSIS 检测「已是 1.3.4」会跳过覆盖、WebView2 又缓存了旧 frontend，导致重装后还是看不到改动；新版本号能强制走完整安装

## 1.3.4

- 书库分类：左侧新增分类侧栏，支持新建 / 重命名 / 删除文件夹。一本书可以同时归入多个分类（tag 风格），比如《无人生还》同时属于「推理」和「女性作者」，互不冲突
- 拖动入分类：从书库选中（点头部「选择」进多选模式）一本或多本，直接拖到侧栏目标文件夹上，松手即批量加入。被拖的书若在当前选区里则整批进，不在则只进它一本
- 顶部胶囊按钮：进入选择模式后顶部出现「将选中 N 本加入 [分类名]」一排胶囊，点一下即加入；当前正在浏览某个分类时多出「从当前分类移出」红色按钮
- 视图过滤：侧栏可切换「全部书籍」/「未分类」/ 每个分类，对应过滤右侧卡片网格。当前选择 persist 到 localStorage，下次打开维持
- DB schema v6 → v7：新增 `folder`（id / name / sortOrder / createdAt）和 `bookFolder` 多对多映射（[bookId, folderId] 复合主键），从 v5 / v6 升级时不动现有书数据，只 createObjectStore + 索引。删书时联动清理 bookFolder 中该 bookId 的所有条目，避免脏挂载

## 1.3.3

- 新增 Markdown 文档支持：.md / .markdown 文件可直接拖入或选取导入。解析走 marked（GFM），代码块用 highlight.js 语法高亮，行内 / 块级数学公式（$...$ / $$...$$）用 KaTeX 渲染，含表格、引用、列表、链接、图片。按 H1 / H2 自动切章并生成目录；其余样式（标题字号、引用块、代码块背景）走 .md-section 全局样式
- 文件关联 / 文件选择对话框 / 拖拽过滤 / 书库 ZIP 内扫描的允许后缀全部加上 .md, .markdown
- 修 TXT 在书库封面不显示后缀和 TXT 配色的问题：之前 loadTxt 把 .txt 从 title 抠掉了，book-card 检测格式时拿不到后缀，回落到通用 BOOK 占位图。改成不抠后缀，book-card 自己负责显示时再剥（cleanTitle 已有这逻辑）
- 书库占位封面新增 MD 配色（深蓝 + 亮蓝 accent），与现有 EPUB / TXT / HTMLZ 视觉区分

## 1.3.2

- 拖拽导入书籍：从资源管理器把 epub / htmlz / txt / zip 拖到 AutoBook 窗口任意空白处即可导入；拖入时整页会出现虚线蓝框 + 「松开以导入书籍」提示。原「点击图标」选择文件夹的入口保留但仍只限于中间那个上传图标区域，避免误触
- 修 Tauri 2 webview 默认开启 `dragDropEnabled` 拦截 HTML5 drop 事件、导致原有 Svelte `on:drop` 完全不触发的问题。tauri.conf.json 的 windows 配置加 `"dragDropEnabled": false`

## 1.3.1

- 滚动模式下隐藏 TTS 相关全部设置：滚动模式有自己的「打字机自动播放」，分页模式才用 TTS 朗读 + 自动翻页，设置项明确二选一，不再两套都展开
- 朗读引擎下拉框限宽并缩短选项文字（"自定义 HTTP TTS（OpenAI / ElevenLabs / Azure ...）" → "自定义 HTTP TTS"），不再撑爆相邻栏
- 朗读设置布局稳定：把 朗读起点 / 章末自动续读 / 朗读全局快捷键 三项移到引擎下拉之后、引擎专属子选项之前，切换引擎时这三项位置不再跳动；引擎专属的 SAPI 语音 / Edge 语音 / 自定义 HTTP TTS 配置块改占整行（lg:col-span-3），不再挤进窄列
- 朗读全局快捷键改成「录制」按钮：点击后按下任意组合键自动写入（含 modifier 状态），不用再手敲按键名；保留「重置」「禁用」
- 自定义 HTTP TTS 增加「显示/隐藏内容」开关：请求头和请求体默认用 CSS `-webkit-text-security: disc` 遮成圆点，避免身后路过看见 API key；按需点击显示
- 自定义 HTTP TTS 增加 per-preset 持久化：之前切预设时下一份的模板会覆盖你刚填的 key，现在每个预设（手动 / OpenAI / ElevenLabs / Azure / 火山 / MiMo）独立保存一份 endpoint + method + headers + body + audioPath，切回不丢；新增「恢复模板」按钮按需还原当前预设到默认空模板。原本「fire-and-forget 填充」式的预设下拉换成持续绑定 `ttsCustomActivePreset$`，预设切换 + 字段编辑均自动落盘（250ms debounce）。升级时如检测到老的散字段有自填值，会自动 seed 到「手动配置」槽位
- 删掉 settings-content 里 200 多行 `{#if false}` 包着的 legacy 死代码

## 1.3.0

- 朗读 / 打字机起点改为光标位置：阅读页内选中一段文字或单击设置光标后再按播放，会从那个位置开始读，而不是从上次保存位置或当前可见处。继承原有优先级回退：有选区用选区；没选区用上次保存的恢复点；都没有用当前可见位置
- 分页模式 TTS 读到本章结尾自动翻到下一章并继续：之前读完最后一段就停了，现在会推进 sectionIndex、等新章节渲染完后再 prepare + 续读，直到整本书结束
- 后台朗读不中断：最小化到托盘时音频继续播放，下一段也能正常获取，章末换章也会触发
- AutoReader 接口暴露 on()，PageManager 暴露 advanceToNextSection() + ensureCharVisible()
- 分页模式 TTS 边读边翻页：每次朗读新句子时算它对应的 scrollPos，若不在当前页，自动翻过去（前后两个方向都行）。横向翻页留下的 translateX 也会清掉再 scrollTo，否则视觉上看着没动。配合「章末自动续读」，整本书能从头读到尾且文字始终在屏幕里
- 修分页模式 TTS 跟页错位：TTS 报的 charIndex 是 extractText 原始字符串里的偏移（含空格、标点），而 SectionCharacterStatsCalculator 用 getCharacterCount 数（剥掉空白和非 CJK 符号），两套口径不通，导致整个 section 后半段全部返回 -1。新增 ttsIndexToCalculatorIndex 转换函数，onBoundary 时按章节缓存 extractText，把 TTS 索引换算成 calculator 口径再传入 ensureCharVisible
- 修自动翻章 this 丢失：之前 const fn = pageManager.advanceToNextSection 这种提取式调用让 this 变 undefined，advanceToNextSection 改成 pageManager.advanceToNextSection() 直接当方法调
- 修 TTS 音频 blob URL 在切换句子时报 net::ERR_FILE_NOT_FOUND 和 偶发系统滴滴声：每个 Audio 自带 URL，onended/onerror 时 src 清空 + revoke，旧元素不会再异步去查已失效 URL
- DevTools 启用（按 F12 打开）

## 1.2.9

- 移除 Piper 引擎。rhasspy/piper 已停更，中文音色普遍存在 "x is not a single codepoint" 崩溃且唯一不崩的 huayan 朗读体验差，不适合实用。本地高音质需求请用 Windows 11 自然语音（设置 → 辅助功能 → 讲述人 → 添加自然语音，可装晓晓 Natural 等），装好后自动出现在 SAPI 语音列表
- Edge 在线引擎加上时钟漂移补偿：连接被 403/401 拒绝时解析响应里的 Date 头反推 client/server 时差，自动重试一次。如果是 client 时钟不准导致的 GEC token 失效，这次会自动救回（但实测微软主动反爬下绕过率仍低，建议改用 SAPI + Windows 11 自然语音）
- 朗读引擎说明文案明确把 SAPI + Windows 11 自然语音作为主推方案，Edge 标实验性、不保证可用
- 修诊断日志对话框「打开仓库」「下载报告」两按钮在桌面端无效的问题：前者改走 Tauri shell 调用系统浏览器；后者改走 fs 写到 文档/AutoBook/Logs/ 目录（之前用 data: URI + target=_blank，Tauri WebView2 都不支持）
- 系统 TTS（SAPI）引擎底层切换到 WinRT SpeechSynthesizer，能正确枚举 Windows 11「自然语音」（晓晓 Natural / 云希 Natural 等神经网络音色，离线、音质接近 Edge 云端）。之前用的 tts crate 只能看到老 SAPI 5 音色，看不到 Natural
- 书库目录从 文档/EbookReader/ 改名为 文档/AutoBook/。安装新版后自动原子重命名（同盘秒级，不复制不丢数据），失败时旧目录原样保留
- 诊断日志放进 文档/AutoBook/Logs/ 子目录，不再混在书库根目录
- 新增「自定义 HTTP TTS」引擎：把任意付费/自建 TTS 接口接进来。提供 OpenAI / ElevenLabs / Azure Speech / 火山引擎 / MiMo（小米，限时免费）一键预设，填好 API key 即可；自由编辑端点、请求头（JSON）、请求体模板（{text} 自动替换为句子并 JSON 转义）；新增「音频路径」字段，支持响应是 JSON 包 base64 音频的接口（如 MiMo 的 choices.0.message.audio.data）。这是目前在 Windows 上获得 Edge 云端级别高质量本地 TTS 的唯一可行路径
- 自定义 TTS 配置面板改成横向 标签+输入 两列网格，独占整行宽度（之前挤在 1/3 列），输入框舒展不再换行折叠
- 修正 SAPI tooltip 关于 Windows 11 自然语音的错误引导（之前说能用，实测应用层调不到）

## 1.2.8

- **Edge 在线音色更新到最新协议**：常量同步至 Chromium 143（对齐 rany2/edge-tts master），新增 Sec-CH-UA 等头部，TLS 从 native-tls（SChannel）换成 rustls，绕过部分 TLS 指纹拦截；功能继续标「实验性」，失败时朗读自动停止
- **新增 Piper 本地神经网络 TTS 引擎**：完全离线，质量优于 SAPI
  - 首次使用：从 github.com/rhasspy/piper/releases 下载 `piper_windows_amd64.zip` 解压全部文件，从 huggingface.co/rhasspy/piper-voices 下载 `.onnx + .onnx.json` 音色文件对，全部丢进设置里「Piper 音色」下方显示的文件夹，刷新即用
  - 音色质量：rhasspy/piper-voices 的 zh_CN 含 huayan / liangsheng 等本地音色，约 50MB / 个
- **Windows 11 自然语音引导**：SAPI 引擎介绍提示用户可在「设置 → 辅助功能 → 讲述人 → 添加自然语音」装 Xiaoxiao 等离线神经网络音色，重启后自动出现在 SAPI 语音列表里
- 安装包新增 @tauri-apps/plugin-shell（支持「打开音色文件夹」按钮）

## 1.2.7

- **设置 Tab 重新分工**：
  - **外观**：主题 + 字体（组1/组2）+ 字号 + 行高 + 字重 + 段落首行缩进 + 段落间距 + 两端对齐 + 美化换行 + 排版方向 + 竖排字距/VPAL/文字方向 + 振假名
  - **阅读**（按使用频率分组）：阅读视图 → 朗读引擎/语音/试听/快捷键 → 视图模式专属（滚动: 自定义阅读点/窗口变化定位；分页: 避免分页打断/选中即书签/点击翻页/分栏数/滑动阈值/禁用滚轮）→ 阅读区尺寸 → 书签 → 页脚显示 → 图片模糊/统计阅读点 → 杂项（屏幕常亮/关闭确认/优先样式）
  - **数据**：仅剩存储 / 同步 / 诊断日志 / 重置 UI
- **Edge TTS 403 修复**：补齐 Microsoft 校验的请求头（Pragma / Cache-Control / Accept-Encoding / Accept-Language），UA 与 Sec-MS-GEC-Version 升级到 Edge 131。若仍 403，说明你的网络出口 IP 被微软地理拦截，需考虑 Worker 反代方案

## 1.2.6

- **设置页 Tab 重排**：原「阅读器」拆出独立的「外观」标签，主题选择与编辑、导入/导出全部归到外观；阅读相关其余项保留在「阅读」
- **主题内联编辑器**：在外观页点击主题旁边的笔形图标，下方直接出现编辑面板，无需弹窗；支持还原默认 / 删除（仅自定义）/ 保存
- **书库封面圆角**：所有书卡加上圆角，视觉更柔和
- **无封面书的格式占位封面**：根据书名后缀（epub/txt/htmlz/mobi/azw3/pdf）渲染不同配色的 SVG 占位封面，左侧色带 + 底部格式标签；未识别格式回退为「BOOK」深蓝
- 书卡标题展示时自动剥离扩展名（`.epub` 等）

## 1.2.5

- **托盘菜单新增「重置 UI（保留书库）」**：从旧版本升级后界面卡死/异常导致设置页里的重置按钮看不到时，右键托盘 → 重置 即可；写入标志文件后重启，启动前由 Rust 删除 WebView2 的 Local Storage 目录，IndexedDB（书库 + 统计）原样保留
- 设置页里的「重置 UI 设置」按钮同步改走这条更可靠的路径
- **跨版本升级时显示完整中间版本的更新说明**：升级弹窗调用 Worker 的 `/changelog` 端点，聚合显示 (当前版本, 目标版本] 区间内所有 release notes，按版本号倒序折叠展示

## 1.2.4

- **阅读器语音设置面板跟随当前引擎**：在设置里切到 SAPI / Edge 后，阅读器右下「语音设置」按钮里的下拉框现在显示对应引擎的语音列表，不再固定为 Web Speech
- **试听按钮**：设置 → 数据 → 朗读引擎 旁新增「试听」按钮，无需打开书即可预览当前选中引擎 + 语音的效果
- **重置 UI 设置按钮**：从更早版本升级后界面表现异常时用，清除本地全部 UI 设置（主题/字体/快捷键/TTS 选项等），书库和统计保留

## 1.2.3

- 修复中文 Windows 系统上安装包仍出现 `{{product_name}} 正在运行!` 占位符（1.2.1 移除语言锁后 Tauri 仍按系统语言自动加载有 bug 的简体中文模板）。安装包 UI 强制锁定英文，提示文字 100% 正确（"AutoBook is running!"）
- 若安装时出现 `无法加载 nsis_taur*.dll`，多为安装包带"来自网络"锁标记 / 杀软隔离 NSIS 插件：右键 .exe → 属性 → 勾选"解除锁定" 后重试

## 1.2.2

- **新增 Edge 在线 TTS 引擎**：「设置 → 数据 → 朗读引擎」新增「Edge 在线音色（需联网）」
  - 使用微软 Azure 神经网络音色：晓晓 / 云希 / 云扬 / 晓伊 / 粤语 / 台湾腔 / 日语 / 英语 共约 20 个精选音
  - 音质显著优于 SAPI / Web Speech
  - 需要联网，访问 `speech.platform.bing.com`；失败时朗读自动停止，请回切到 SAPI 或 Web Speech
  - 位置记忆精度到句子级（同 SAPI）
  - 切换引擎需要重新打开书生效

## 1.2.1

- 修复 1.1.2 / 1.2.0 安装包遇到"已运行实例"时弹窗显示 `{{product_name}} is running!` 而非应用名（NSIS 简体中文语言文件占位符未被替换，回退到默认英文模板）

## 1.2.0

- **新增 Windows 系统 TTS 引擎（SAPI）**：在「设置 → 数据 → 朗读引擎」可切到「系统 TTS」，调用 Windows 内置语音
  - 应用最小化到托盘后朗读不中断
  - 在「系统 TTS 语音」下拉中选择本机已安装的语音；想要更多中文/日文音色可在 Windows 控制面板 → 时间和语言 → 语音 自行安装
  - 切换引擎需要重新打开书生效
  - 注：现阶段位置记忆精度到句子级（暂停后续读会从当前句开头开始）
- 抽取朗读公共逻辑（分句 / 文本提取 / 位置换算），为后续 Edge 在线语音引擎（1.3.0）铺垫

## 1.1.2

- **关闭窗口改为最小化到托盘**：右上角 X 不再退出应用；托盘菜单「退出」才真正退出
- **全局快捷键修复**：1.1.1 中连续滚动模式下按 Ctrl+Alt+P 无反应已修复；现在两种视图模式都生效，并提升到全局监听层（非 /b 页面按下也会回到阅读器执行）
- **快捷键可自定义**：设置 → 数据 新增「朗读全局快捷键」输入框，留空则禁用；冲突时静默降级
- **设置项 tooltip 不再被下一行遮挡**（popover z-index 修复）
- **导入/导出主题图标交换**：导出↑ / 导入↓，更符合直觉
- **安装更快**：NSIS 改为当前用户模式（免 UAC）+ zlib 压缩 + 跳过语言选择对话框

## 1.1.1

- **ZIP 批量导入**：导入入口支持选择 .zip 压缩包，自动解出其中的 EPUB / TXT / HTMLZ 并批量导入
- **文件关联**：安装后可在资源管理器中双击 .epub / .txt / .htmlz 直接用 AutoBook 打开导入；应用已运行时自动聚焦窗口并导入
- **系统托盘**：托盘图标提供 显示窗口 / 播放暂停朗读 / 退出；双击托盘图标唤起窗口
- **全局快捷键**：Ctrl+Alt+P 在任意界面播放/暂停朗读（窗口最小化也有效）
- **诊断日志导出**：设置 → 数据 新增「导出诊断日志」按钮，便于反馈问题
- 问题反馈仓库链接指向 fivood/autobook

## 1.1.0

- **TTS 记忆朗读位置**：每本书自动保存朗读进度（章节 + 段落 + 句内偏移），重开书后从上次位置续读；主动翻页后从新位置开始；整本读完自动清除
- 修复多章节书在分页模式下 TTS 起点错位的问题

## 1.0.11

- 修复 epub 含中文/日文资源文件名时导入失败（`item ... not found`）；非关键资源缺失只跳过不再整本失败
- 新增自定义主题导入/导出（设置 → 主题 区域 ↓/↑ 按钮，JSON 格式）
- 修复暗色主题下对话框按钮文字不可见；跳转输入框与更新进度条接入主题配色

## 1.0.10

- 性能：从设置/书库返回阅读器不再重新格式化书籍内容（缓存命中则秒回）
- WebView2 关闭磁盘缓存，杜绝升级后旧前端资源残留

## 1.0.9

- 修复设置页头部标签按钮部分区域无法点击
- 返回书库图标颜色与菜单文字统一
- 编辑主题对话框按钮改为 On/Off 切换样式
- 跳转改为百分比输入（0-100），显示当前进度
- Rainforest 主题菜单背景调整为 #1d2a29

## 1.0.8

- 标题栏显示版本号
- 顶部菜单悬停触发区域扩大一倍

## 1.0.7

- TTS：朗读中调整语速/切换语音立即生效；修复 voiceschanged 监听泄漏；忽略 interrupted 错误
- 语音设置面板点击外部自动关闭
- 顶部下拉菜单跟随当前主题配色
- 主题预览字符 ぁあ → 中字；剧透标签 ネタバレ → 剧透

## 1.0.6

- **修复字体不生效**：禁用 CSS 压缩，避免 Lightning CSS 去掉 `@font-face` 中 `font-family` 的引号，导致所有字体名被解析为同一个标识符
- **修复主题不可编辑**：启动时验证 `theme` 存储值，空字符串或无效值自动重置为 sage-green-theme
- **修复默认阅读模式**：启动时验证 `viewMode` 存储值，无效值自动重置为滚动模式

## 1.0.5

- 修复中文字体回退到系统宋体的问题
  - 全局 UI 字体统一使用 `Noto Sans SC`（思源黑体）
  - 正文 `font-family` fallback 加入 `Noto Sans SC`
  - CSS 变量 `--font-family-serif` / `--font-family-sans-serif` 现在带引号传入，避免被解析为多个字体名
  - EPUB 书籍内部 CSS 的 fallback 也加入 `Noto Sans SC`
- 修复分页模式下语音按钮偶尔不出现的问题（将 `AutoReader` 初始化移到 `onMount`）
- 打字机自动播放新增可视化调速：右下角 `[-]` / `[+]` 按钮，点击即可减速/加速
- 设置页面「阅读视图」说明保持：滚动模式支持打字机自动播放，分页模式支持语音朗读

## 1.0.4

- **语音朗读（TTS）**：基于 Web Speech API，支持桌面端与移动端
  - 右下角新增语音播放按钮，按 `V` 快捷键切换朗读（仅在分页模式可用）
  - 语速调节（0.5× ~ 2.0×）
  - 语音列表自动检测，优先展示中文/日文语音
  - **自动语言匹配**：打开书籍时根据 EPUB 元数据或 TXT 文本内容自动检测语言（中/日/英），并自动切换对应语音
  - 语音下拉框按当前书籍语言排序，优先显示匹配的语音
  - 朗读进度与当前阅读位置同步，从已读位置开始而非从头
- 自动功能按视图模式分离：
  - **连续滚动模式**：打字机自动播放（逐字浮现）
  - **分页模式**：语音朗读
- 减小书库页顶部触发高度（48px → 24px），添加 200ms 延迟，避免误触菜单
- 书库空状态时上传热区限制在图标本身，hover 显示提示文字
- 修复顶部菜单图标在 sage-green 主题下的对比度问题

## 1.0.3

- 默认阅读模式改为连续滚动，打字机式自动播放开箱即用
- 自定义主题弹窗：新建主题时以当前主题颜色为种子预填充，输入框和预览按钮同步主题色
- 支持编辑内置主题（保存后会生成同名覆盖配置）
- 主题系统扩展：新增菜单背景色、菜单文字色、按钮选中/悬停色、选中文字背景/颜色、超链接颜色
- 主题弹窗跟随当前深浅主题自动变色
- 更新弹窗统一使用无衬线字体，去除等宽字体
- 修复：鼠标悬停菜单改用纯 CSS 实现，避免覆盖内联样式导致主题色丢失
- 修复：旧版本主题数据缺失字段时自动补全，防止白屏
- 修复：打字机模式在内容加载后正确重新准备字符节点

## 1.0.2

- 自动阅读改为打字机模式：逐字浮现，速度单位字/秒（默认 6，A/D 调速 1–60）
- 已读到的视口内容首次启动时一次性显示，不丢上下文
- 字体迁移：老版本残留的 Noto Serif JP / Sans JP 默认值自动升级为思源黑体，避免回退到系统宋体
- 图片模糊设置仅在最近打开的书含插图时显示，纯文字小说界面更干净

## 1.0.1

- 顶部菜单新增"检查更新"按钮（仅桌面端）
- 阅读器右下角浮动按钮：开始/暂停自动阅读、速度倍率、章止/连播切换
- 顶部菜单触发改为鼠标悬停（更快、不易误点）
- TXT 章节自动识别：支持"第 X 章"、汉数字、纯阿拉伯数字粗体标题、序章/楔子/番外、英文 Chapter/Section/Part 等
- 主题切换即时全局生效
- 菜单字体使用思源黑体
- 全新图标
- 更多设置项中文化（含字重、段落缩进、滑动阈值、各类 tooltip 等）

## 1.0.0

- 首个正式版
- 桌面端原生本地文件存储（`~/Documents/EbookReader/`）
- 横排默认 + 中文 UI
- Sage-green 主题
- TXT 编码自动识别（UTF-8 / Shift-JIS / GB18030 / BIG5）
- 字体瘦身 + 新增思源黑体
- 桌面端内置自动更新
