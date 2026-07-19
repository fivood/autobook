# Changelog

## 1.17.5

补齐 KF8 相对 Calibre 的三大用户可感知差距：图片链接、SVG 封面、章节内跳转。之前 KF8 书里的图片有一部分显示破图（`kindle:embed:XXXX` 没重写）、封面破图（SVG 在 flow 1+ 里没抽出）、TOC 点击不跳（`kindle:pos:` 没重写）。

- **`kindle:embed:XXXX` URL 重写**：KF8 里的 `<img src="kindle:embed:0003?mime=image/jpg">` 用 4-char Kindle-base32（字母表 `0-9A-V`）编码 1-based 资源索引，与 `recindex:00003` 语义等价，但 pre-1.17.5 的 rewriteImageRefs 只认 recindex → KF8 图片破图。加 `fromBase32(s)` decoder 和第二条 regex 走同一份 blob 表
- **SVG flow 抽取**（Phase 4）：Kindle 封面和扫描图常用 `<image xlink:href="kindle:flow:0001?mime=image/svg+xml">` 引用 FDST flow 1+ 里的 SVG 文本。Phase 2 只留 flow 0 直接把 SVG 丢了。新增 `ParsedFlowResource { flow_index, ext, data }`，Rust 侧遍历 flow 1+，前 300 字节包含 `<svg` 就当 SVG 抽出（跳过 CSS 和 unknown 类型，我们不接原书 CSS）。扫本地 181 KF8 文件，15 个有 SVG 共 92 个资源。前端 `rewriteFlowRefs` 走跟 embed 相同的 blob 管道，mime 加 `svg → image/svg+xml`
- **`kindle:pos:fid:XXXX:off:YYYY` 章节内跳转**：Kindle TOC 点击 / 内文交叉引用用这种 URL，fid 是目标 `<body aid="…">` 值的 Kindle-base32 表达。前端在 splitIntoSections 里扫每 section 的 `<body aid="…">` 建 aid→section-N 映射，然后跑 `rewriteKindlePosRefs` 把 URL 换成 `#section-N`（忽略 off 直接跳节顶，TOC 场景够用；精确到字符位置要另外做锚点，价值低）。URL fid 是零填充的（`0001`）body aid 是紧凑的（`1`），比较时两边都 strip leading zeros + uppercase 规整
- 回归：242 文件 0 err，avg pagebreak 保持 145.6，avg chars 稳定；`kindle:embed`/`kindle:flow`/`kindle:pos` 只影响前端渲染路径，Rust 侧输出仅新增 flow_resources 字段

## 1.17.4

前端 KF8 导入路径省一次 DOMParser round-trip。大书 O(100-500ms) 的常数省下来。

- **ParsedMobi 新增 `well_formed` bool**：KF8 Phase 3 skeleton+fragment 反嵌入或 Phase 2 concat 走通时 Rust 侧返 true（`skeleton_split.is_some()`），标记 HTML 已是 byte-accurate XHTML 没 attribute leak；MOBI6 路径固定 false 因为 PalmDoc 记录切分处会产生 `1em" width="2em">` 半截 tag 泄漏
- **前端 `cleanHtml` 分岔**：`well_formed=true` 直接跑一遍字符串级 `stripEmbeddedFontsRegex(html)` 就返，跳过 `<!doctype html><html><body><div>…</div></body></html>` wrap + DOMParser + stripAttributeLeaks + re-serialize；`false` 走原来的 DOMParser 路径。字体正则化用共享的 `FONT_FAMILY_RE` 常量避免重复编译
- 附带：kf8_indx.rs 新增 9 个单元测试（varint / FDST / TAGX decode 的 value_bytes 分支 / CNCX 池查名），几毫秒跑完，覆盖之前只靠 mobi_scan 整库 6 分钟集成扫描验证的关键 pure fn

## 1.17.3

KF8 NCX 表解析，KF8 section TOC 现在用真章节名（原 epub `nav.xhtml` 里的），不用前端从 `<h*>` 抓。之前 fallback 到 `<h*>` 的问题是：很多 KF8 section 开头没标题元素（只有 `<p>` 或 `<div>`），或标题文本残缺（如「第一章」缺失章节名），生成的 TOC 项就是 fallback 的 `section-N`。

- **kf8_indx.rs 新增 NCX INDX 表解析**：MOBI-sig+0xE4 是 NCX 主 INDX 记录，Calibre 叫 `ncxidx`。TAGX shape `(1,1,1,0), (2,1,2,0), (3,1,4,0), (4,1,8,0), (21,1,16,0), (22,1,32,0), (23,1,64,0), (6,2,128,0)`：tag 1=pos（flow 0 字节位置）、tag 2=length、tag 3=CNCX name offset、tag 4=depth、tag 21=parent、tag 6=[pos_fid, offset] 元组。新增 `parse_ncx_indx` + `read_cncx_name`（varint length + utf8 bytes 的 CNCX 池按 offset 查名字）
- **kf8_parser.rs 反嵌入时按 NCX pos 匹配 skeleton**：加载 NCX 表 + 独立的 NCX CNCX 池（跟 fragment 表的 CNCX 是分开的两份），按 `depth == 0/1` 过滤到顶层章节，按 position 排序，对每个 skeleton 找 `position ∈ [skel.offset, next_skel.offset)` 的 NCX 项拿名字。fragment 表的 `toc_cncx` 存的其实是 XPath 位置锚点（`P-//*[@aid='UGI0']`）而不是章节名，所以彻底不用它——保留一层 defensive 只在不像 xpath 且 NCX 没匹上时才用
- **前端 load-mobi.ts 新增 rustLabelRe**：优先识别 Rust 侧插的 `<!--autobook-section-label:TITLE-->` marker（在 `<mbp:pagebreak/>` 后紧跟），拿到就用；没有再 fallback 到 `<h*>` 扫描。marker 里如果 title 含 `-->` 会在 Rust 侧转义成 `-- >` 防止提前闭合
- 验证：3 个抽样文件的 187/39/11 sections 分别命中 175/37/10 个 NCX 标签（未命中的少数几个是 cover / 版权页这类无 NCX 条目的辅助 section）。典型标签：「一位女士的画像」「序曲 梦与苏醒」「1 泥泞湾」「第一章」——都是原 epub 的 nav.xhtml 里的字面文本
- 回归：242 文件 0 err、avg pagebreak 保持 145.6、avg chars 896k → 897k（多的 1k 是 label markers 的常数开销）

## 1.17.2

KF8 Huff/CDIC 压缩解锁 + pure-KF8 dispatch 修复。1.17.1 只覆盖了 PalmDoc/uncompressed 压缩的 KF8；本地扫描发现 34+ 个 AZW3 用 Huff/CDIC（Kindle 商店主流压缩方式），之前都被 MOBI6 fallback 路径当成不完全 KF8 处理（返回半通不通的文本、0 pagebreak）。

- **KF8 Huff/CDIC 解压**：MOBI6 侧的 `HuffCdic` struct 早就实现好了，只是 `try_parse_kf8` 遇到 compression==17480 直接报错让用户装 Calibre。把 HuffCdic + load/unpack 改成 `pub(crate)`，KF8 侧初始化一次然后每个 text record 走 `unpack`。huff_record 在 KF8 头 MOBI-sig+0x60 位置，读到相对 KF8 段的记录索引，加 `kf8_start` 得到绝对位置
- **pure-KF8 强制 dispatch**：原 `parse_mobi_inner` 只在 `is_joint || is_kf8_only`（strip_tags 后文本 <50 字）时才 dispatch 到 `try_parse_kf8`。纯 KF8 AZW3 用 Huff/CDIC 时，MOBI6 路径能 decompress 出「看起来像文本」的字节（HuffCdic 是共用的），文本 > 50 字，dispatch 就不触发——结果 KF8 结构信息（flow / skeleton / fragment）全丢，用户拿到没 pagebreak 的一大坨。现在检测 record 0 的 `format_version == 8` 就当 pure KF8 强制 dispatch，扫描里 `夏目友人帐1-6` 178MB 漫画从 pagebreak=0 → 1143，`伟大的《沙丘》六部曲` 从 0 → 269 段
- **KF8 dispatch 失败时对 pure KF8 兜底不再报错**：pure-KF8 强制 dispatch 后若 try_parse_kf8 出 Err，之前会把错误抛给用户。改成——只要 MOBI6 那边已经产生 ≥50 字符，就 fall through 到 MOBI6 图片抽取路径用它已经算好的 html（沿用 1.16.3 建立的「有部分内容比死路好」策略）。joint / true is_kf8_only 场景仍然报错（那些没有 MOBI6 输出可退）
- 回归：242 文件仍 0 err，avg pagebreak 48.7 → 145.6（约 3x），avg chars 902k → 897k（-0.7%，是 KF8 路径正确剔除了 MOBI6 误读出的资源流字节）

## 1.17.1

KF8/AZW3 原生解析器 Phase 2 + Phase 3：FDST 流分离 + skeleton 表章节切分 + fragment 反嵌入。KF8 合订本终于有 TOC，且每节 HTML 是 byte-accurate 的 XHTML（跟 epub 源同分布）。跑本地 242 文件回归，MOBI6-only 完全不变，49 个 joint/KF8 文件平均 pagebreak marker 从 0.7 → 226；内容仅掉 2%（是 Phase 1 混进去的 CSS/SVG 资源流被剔除）。

- **FDST 表解析**：KF8 把主 HTML、CSS 文件、SVG 图片遮罩等多个 flow 拼在一段解压字节里，Phase 1 全部返回，导致 CSS/SVG 混进正文（有的 55MB joint 文件只出 1 char/kb 正文，其他都是资源）。新增 `kf8_indx.rs::parse_fdst`（按 MOBI-sig+0xB0 fdst_index / 0xB4 fdst_count 读，多 record 支持先 concat 再 parse），拿到 flow 0 的 [start, end)，只保留这段
- **skeleton INDX 表解析 + 章节切分**：KF8 用 skeleton 表把 flow 0 划分成 N 个 HTML 文件（原 epub 每一个 xhtml 一行）。新增 `parse_skeleton_indx`（含 minimal INDX header + TAGX + IDXT decoder，Calibre `mobi/reader/index.py` 的 `parse_index_record` 语义：`value == mask && popcount > 1` 时读 varint 得 value_bytes，然后按字节长度消费；否则按 `masked >> shift` 数 count），拿到每个 skeleton 的 offset。每段前插 `<mbp:pagebreak/>`，前端 `load-mobi.ts::splitIntoSections` 已识别这个 marker → 零改动即拿到多 section + TOC 标签
- **fragment INDX 表解析 + 反嵌入（Phase 3）**：skeleton 只是 `<html>...<body></body></html>` 200-500 字节的模板，body 内容以 fragment 形式放在 flow 0 里的模板之后。fragment 表在 MOBI-sig+0xE8（KindleUnpack 叫 `FragIdx`，Calibre 叫 `dividx`，TAGX `(2,1,1,0), (3,1,2,0), (4,1,4,0), (6,2,8,0)`）。对着 Calibre `mobi8.py` 的 `Elem(int(text), toc_text, tag_map[3][0], tag_map[4][0], tag_map[6][0], tag_map[6][1])` 逐字段对回来：**entry name 是 insert_pos**（在父 skeleton 模板里插的位置，我最初误当成 raw text 位置）、tag 2 是 CNCX offset（TOC 章节名）、tag 3 是 **file_number（父 skeleton index）**、tag 4 是 seqnum、tag 6 是 `[start_pos, length]` 元组（跟 skeleton 表一样的 num_values=2 编码）。**start_pos 是相对父 skeleton 的 fragment 区起点**（`skel.offset + skel.length`）的偏移，不是 raw text 绝对偏移——发现这个是因为 frag[3,4,5,6,7] 全都 parent_ord=3 且 start_pos=0/7887/15849/22395/30585 累积对应，明显是分片累加而不是散点。新增 `parse_fragment_indx` + `reassemble_with_fragments`：按 file_number 分组，模板按 insert_pos 升序切段、每 fragment 从 `raw[skel.frag_base + start_pos, +length)` 取字节、交错回填。fragment 表解析失败时 fallback 到 Phase 2 的 concat 逻辑（模板+fragments 顺序拼，容错解析器能读但不是严格 XHTML）
- **对着 Calibre 验证**：3 个抽样 joint 文件（亨利·詹姆斯 187 节 / 刺客正传2 39 节 / 卡拉马佐夫 11 节）跑 `ebook-convert` 得到 epub，再拿 Phase 3 输出对比每节 xhtml 的**去 tag 后 text 字符数**——三个文件都是 100%/101%/101.5%，字节级 rounding-error 匹配。HTML 总字节数差 -5% 到 +12% 是因为 Calibre serializer 会加/删自己的 `calibre_pb` 锚点、`id`、`aid` 等属性，与内容正确性无关
- **skeleton_index 偏移探测**：Phase 1 沿用 KindleUnpack `mobi_header.py` 的注释把 skeleton 记在 MOBI-sig+0xE4（其实是 NCX 表）、fragment 记在 0xE8（其实是 chunks 表），且互换。真正的 skeleton table 在 **0xEC**（tags `(1,1,3,0), (6,2,12,0)`，tag 6 num_values=2 一次读出 [offset, length] 元组），是本地扫遍所有 header 4 字节对齐位置对 INDX record 的 TAGX shape 匹配出来的。Calibre 源码里叫 `dividx`，KindleUnpack 里叫 `skelidx`，同一个表两个名，取 tag 1+6 的 shape 认起来更稳
- **`skel.length` ≠ section 长度**：Phase 2 一开始写成 `[skel.offset, skel.offset + skel.length)` 切片，结果 joint 文件平均 chars 从 1.89M 掉到 89k——因为 `length` 只是模板长度（250-450 字节），body 是紧跟其后的 fragment 字节。Phase 2 fallback 改成用 `[skel.offset, next_skel.offset)` 覆盖整段；Phase 3 里每个 fragment 的字节长度按 `next_frag.position - this.position`（末段用 `next_skel.offset - last_frag.position`）算
- **诊断脚手架扩充**：`mobi_scan_test.rs` 加 `phase2_kf8_diag`（每 KF8 文件 dump FDST flow 数 / flow0_end / skeleton row 数）、`phase2_kf8_end_to_end`（每 KF8 文件跑完整 `try_parse_kf8` 数 mbp:pagebreak marker 数）、`probe_kf8_header_indx_pointers`（扫指定文件的 KF8 header 每 4 字节对齐位置，对指向 INDX record 的值 dump TAGX shape，用来经验定位表偏移）。跟本轮回归用的 baseline / phase2_v4 / phase3 三份对比 TSV 配套

## 1.17.0

存储/备份 UI 统一 + 统计模块整轮重设计。存储路径可自定义并支持迁移，多源存储那套空壳彻底移除；统计新增「年度」tab（叙事式回顾），tracker 开始持久化 session 记录以支撑将来的时段分析。

- **书库文件夹可自定义 + 迁移**：`TauriFsStorageHandler` 里 `Documents/AutoBook` 原是写死常量（`ROOT_DIR` + `BaseDirectory.Document`），无法搬到外挂盘或云盘同步目录。改成读 `fsRoot$`（新 localStorage 键）：非空 → 绝对路径模式（`baseDir` 传 undefined，plugin-fs 直接把路径当绝对）；空 → 保留老 default。Rust 新增 `move_directory`（同盘 `fs::rename` 秒完，跨盘 fallback 到递归 copy+remove）+ `default_fs_root`；`get_data_paths` 收 `fsRoot` 参数返回有效根。Settings → 存储与备份 → 本地数据路径 大格显示当前路径 + 「更改文件夹…」（拉起 Tauri 原生目录选择器）+ 「恢复默认」。**修选完新目录后没切换的 bug**：文件选择器返回的目标路径必然已存在，旧 `move_directory` `if (to.exists()) return Err()` 直接失败、JS 侧 catch 后 `return` 就不再更新 `fsRoot$`。改成允许目标是空目录（先 `remove_dir` 再 rename，Windows rename 到已存在目录会失败即使空的），JS 侧解耦「换根」与「搬数据」——选新路径必切根，搬移失败只弹错误不回滚
- **多源存储 UI 与代码全清**：`SettingsStorageSourceList` / `SettingsStorageSource` / `SettingsSyncDialog` / `StorageUnlock` 4 个组件删除；`syncTarget$` store、`SyncSelection` 类型、`storageSourcesChanged$` / `getStorageSources` / `saveStorageSource` / `deleteStorageSource` DB API 全部移除；`storage-source-manager.ts` 精简成只留 `FsHandle` / `RemoteContext` 两个历史 IDB 迁移文件用的类型定义。这些原是为 PWA 阅读时长跨端同步设计的，但 `sync-manager.ts` + `sync.fivood.com` token 早就把该功能接过去了，多源那套一直是没用的空壳（能新建、点击不产生任何实际差异）。`+page.svelte` 的 `getStorageHandlerByName` 简化——只 `INTERNAL_TAURI_FS` 走 TAURI_FS handler，DB `storageSource` 表查询移除；auto-replication 目标固定为 TAURI_FS 内建源
- **新增「年度」统计 tab**：叙事式回顾，替代「热图 + 表格」的分析工作台风格。Hero 4 格（累计小时 / 阅读天数 / 完成书数 / 总字数）+ 月度 12 柱 + 4 张小卡（最长连续 / 最强单日 / 开卷第一天 / 最近一次）+ Top 5 书 + 24 小时时段分布柱图。年份可切换（上一年 / 下一年）。计算逻辑 pure fn 抽到 `statistics-year/year-summary.ts`（输入日聚合 + session、输出显示就绪结构），Svelte 侧纯渲染
- **IDB v10：新增 `session` object store**（`{ id, title, startTs, endTs, durationSec, charsRead, dateKey, sectionsRead? }`，索引 `dateKey` / `title` / `startTs`）。老的 `statistic` 每日聚合表**不动**——`sync-manager` 靠它推云端、PWA 也读它，兼容性零风险。年度 tab 的时段分布、session 时长中位/p95/最长这些从新表来；老年份没 session 数据的部分显示提示条
- **Tracker 增加 session 持久化**：unpause → `startActiveSession(now)` 开缓冲；每 tick 在 `processStatistics` 里把 timeDiff/charDiff 正向累加到 buffer（守 `if (>0)` 防 history-revert 走负值路径 commit 出负值）；pause / unmount → `commitActiveSession()` ≥ 30s 才写 IDB，短抖动直接丢。老 `sessionStatistics` in-memory 累计不动（那是「书打开到关闭」的口径，跟「一次 unpause-to-pause」不是同一概念），新 buffer 独立
- **统计 header 瘦身**：删掉「以 TMW 日志格式复制数据」popover（上游 ttu-reader 遗留的 Discord 沉浸日志格式，中文阅读用户完全用不到）和独立的筛选按钮位；「筛选书籍」并入设置抽屉顶栏，点击先关设置抽屉再开筛选抽屉。相关 `copyStatisticsData$` subject / handler、`stats.header.readingTime` `charactersRead` `copyTmw` `titleFilter` 4 组 i18n key 一并清理
- **修统计设置抽屉配色写死**：右侧滑入的设置面板原用 `bg-gray-700 text-white`，深色主题下与主内容对不上。改为 `var(--font-color)` / `var(--background-color)`
- **修统计侧栏「每日起始小时」滑块用系统蓝色**：加全局 `input[type='range'] { accent-color: var(--accent-color) }`，站内所有 range 都跟主题走
- **修 `report-error.ts` 引起 Vite dev 404**：`import { version } from '../../../package.json'` 在生产 build 被静态打进 bundle 没问题，但 dev 模式下 Vite 把它当 URL 去取，`package.json` 在 `server.fs.allow` 允许根之外 → 404。改成 `vite.config.js` 读一次 `package.json` 通过 `define` 注入编译期常量 `__APP_VERSION__`
- **修 `settings-reading-goals` 里失效的「同步」按钮**：原「同步阅读目标」按钮拉起 `SettingsSyncDialog` 让用户在多个存储源之间对拷；多源被移除后已经没有目标可选，按钮 + 相关代码一起删



原生 MOBI/KF8 解析器修掉 9 个硬失败（之前必须靠 Calibre 才能 import 的文件）。用 Rust 侧诊断测试扫了本地 241 个 MOBI/AZW3 定位根因，修完 241 文件 0 error。

- **修大体量漫画 AZW3 的 HUFF 表溢出 panic**（4 文件，均 165–271MB）：`mobi_parser.rs:182` 建 HUFF maxcode 表时 `max_raw + 1` 用普通 `+`，debug 下 `max_raw == u32::MAX` 时溢出 panic（被 `catch_unwind` 转成 Err）。标准 HUFF maxcode 公式 `((max+1)<<shift)-1` 的末位已用 `wrapping_sub`，唯独 `+1` 漏了 wrapping。改 `wrapping_add(1)`
- **修 joint AZW3「expected MOBI signature」**（1 文件）：record 0 本就是 KF8 头（format_version==8），但 `find_boundary` 优先级高于 `is_pure_kf8`，找到一个次要 BOUNDARY（@595）后 `kf8_start=596`，而 records[596] 是 "CONT..." 段不是 PalmDoc+MOBI 头 → 报错。改成先查 `is_pure_kf8(records[0])`，是纯 KF8 就 `kf8_start=0`（BOUNDARY 是次要段/假阳性时不再误导）
- **修真 MOBI6-only「文件可能损坏」误报**（4 文件）：这些是 MOBI6-only（无 BOUNDARY、全记录无 KF8 头、record 0 format_version==6），文字本就少（图像/扫描书）。`is_kf8_only`（文本<50字）误触发 → dispatch KF8 → `Ok(None)` → 报「损坏」。改成 `Ok(None)` 时不报错、fall through 到 MOBI6 提取（返回 文本+图片，用户至少能打开）
- **诊断测试**：新增 `src-tauri/src/mobi_scan_test.rs`，`#[ignore]`（CI 不跑），用 `AUTOBOOK_MOBI_SCAN_DIR` env 指定目录扫 MOBI/AZW3 出质量报告（TSV：html 字数 / 图片数 / pagebreak / FFFD 比例 / 错误），输出到 OS temp。用于定位 Phase-2（KF8 skeleton/chunk/FDST 结构重组）目标 + 验证 parser 修复不回归
- 顺带修正 Cargo.lock 的 `app` 版本（之前 stale 在 1.15.1，与 Cargo.toml 不同步；CI 本地 build 时自动修，但提交的 lock 一直 stale）

> 注：这 9 个文件现在能 native import 不再强制 Calibre，但其中图像/扫描类文字本就少、部分 MOBI6 的文本提取仍偏少（约 4-5 万字量级）——这是 KF8/MOBI6 文本提取的下一阶段（Phase 2：skeleton/chunk/FDST 结构重组）要解决的，不在本次范围。

## 1.16.2

弹窗基建修复 + 第一个巨石文件拆分。无新功能。

- **dialogManager 支持链式弹窗**：`+layout.svelte` 的 `on:close` 原是 `closeAllDialogs`（清空整个 `dialogs$`），而 ConfirmDialog 的 `resolver` 先跑、`dispatch('close')` 后跑——resolver 里 push 的下一个 dialog 会被紧跟的清空砸掉，链式弹窗不可用（这正是此前 `settings-data-paths` 双确认一直留原生 `confirm()` 的原因）。改成 `removeDialog(dialog)`（按引用移除该个）：旧 dialog 此时已不在数组 → no-op → 新 dialog 存活。单个 dialog 行为不变，backdrop 仍 dismiss-all
- **原生 `confirm()` 全应用清零**：最后一个残留 `settings-data-paths.clearAll` 的双确认（清除全部本地数据）改用链式 `ConfirmDialog`（第一段带 `pre-line` 保 bullet 换行，header 复用 `dataPaths.clearAll`）。至此原生 confirm 全部迁到应用内弹窗
- **`database.service` 高亮簇拆出 `HighlightRepository`**（巨石机会式拆分第一刀，CLAUDE.md「不要往巨石文件里继续堆代码」）：新建 `highlight-repository.ts`，14 个高亮方法（getHighlights / addHighlight / deleteHighlight / linkHighlights / markHighlightReviewed / 文件夹 CRUD …）移入，仅依赖注入的 `db` + `highlightsChanged$`，自洽。`database.service` 留 14 个一行 facade，**所有 `database.addHighlight` 等调用点零改动**；`storeHighlightsForTitle` 留在 service（跨 data 域，用 `getDataByTitle`）。service 净减 ~140 行实现，高亮逻辑内聚到独立模块
- **lint 首次全绿**：`app.d.ts` 的 `App` 命名空间（SvelteKit 模板类型扩展点，ambient 声明被误报 unused）加 `eslint-disable`，清掉最后 1 个 warning。eslint 现为 0 errors / 0 warnings

## 1.16.1

代码卫生批次：无新功能、无可见行为变化（除 confirm 弹窗改用应用内自定义弹窗），主要是去重、合规与 lint 清理。

- **colorDot 三处重复定义归一**：`highlight-sidebar` / `note-editor-dialog` / `notebook+page` 各写一份 4 色 rgba map，新建 `src/lib/data/highlight-color.ts` 导出 `HIGHLIGHT_COLORS` + `HIGHLIGHT_COLOR_DOT`，三处改 import
- **reset-UI 流程去重**：`changelog.performReset` 与 `settings-content.resetUiSettings` 是近乎一模一样的重复（confirm + Tauri `schedule_ui_reset` / localStorage 清空 + reload），新建 `src/lib/functions/reset-ui-settings.ts` 统一 `confirmResetUiSettings()`，两处变 1-3 行调用
- **notebook 条目删除改用应用内弹窗**：`removeOne` 原用浏览器原生 `confirm()`，与同页文件夹删除已用的 `ConfirmDialog` 不一致；换 `ConfirmDialog`（`white-space: pre-line` 保换行）
- **原生 `confirm()` 跨应用统一（4/6 处）**：settings-sync 重置设备 ID、settings-theme-editor 删主题、changelog / settings-content 重置 UI 设置 改用 `ConfirmDialog`。`settings-data-paths` 的双确认保留原生——`+layout` 的 `closeAllDialogs` 在 `on:close` 清空 `dialogs$`，而 ConfirmDialog resolver 先跑、`dispatch('close')` 后跑，链式弹窗的第二个会被紧跟的清空砸掉；要彻底修得改共享 close 逻辑（高风险），留待后续
- **`as any` 审计（25 处全合规）**：CLAUDE.md 要求每个 `as any` 带注释。修 3 处真味道——`utils.ts` 的 `('x' in navigator) as any`（`in` 返回 boolean，cast 无意义；`msMaxTouchPoints` 是 IE-only 不在 TS DOM lib，改正确的 `Navigator & { msMaxTouchPoints?: number }` cast）；kokoro 的 `(mod as any).KokoroTTS` 两处重复抽成 `loadKokoroTtsClass()` helper；`pdf-ocr-banner` 的 `$ocrLang$ as any` 改 `as OcrLanguage`（顺手让 `ocr-job-manager` re-export `OcrLanguage` 供调用方取）。其余合理项（CSS Custom Highlight API、Tauri/调试全局、pdfjs 类型漂移、`{}` reduce seed 等）补注释
- **console 清理**：`logger.ts` 的 `console.debug` 加 eslint-disable（logger 抽象层正当用）；`replicator.ts` 的 `console.log` → `console.info`（放行方法）。其余 console 早已带 disable 注释，合规
- **lint 清理（25→1 warning）**：13 文件清 unused imports/vars；参数型（`storageSourceName` / `storageSourceManager`·`window` / `isPaginated`）按 CLAUDE.md 前缀 `_`；`load-pdf.ts` 删死变量 `bestArea`（当初想比尺寸、后改取首个的残留）。剩 1 warning 是 `app.d.ts` 的 `App` 命名空间（SvelteKit 模板扩展点，ambient 声明误报，删了丢扩展位故留）
- 巨石文件评估（`settings-content` 3227 / `b/+page` 2747 / `database.service` 1275 / `statistics-heatmap` 1408）：各文件的可提取 cohesive 簇已识别，按 CLAUDE.md「机会式」——下次因功能改动碰到对应文件时顺手提取，不现在盲拆（无法跑 app 验证，盲拆千行易留暗坑）

## 1.16.0

笔记本（跨书高亮 / 独立笔记）整轮优化，覆盖搜索、编辑、交互、性能四方面。无数据结构改动，排序选「默认（阅读顺序）」时与改造前完全一致。

- **搜索：字段语法 + 命中高亮 + 排序 + 颜色筛选 + 标签 AND/OR**：原搜索是单字段整串子串匹配，且过滤/分组/标签统计全堆在 `+page.svelte` 里。抽出 `src/lib/functions/notebook/notebook-search.ts` 模块，支持 `memo:` `tag:` `book:` `color:` `kind:` 字段过滤（空格分隔，裸词跨字段搜），命中处 `<mark>` 黄底（escape 安全：分段转义后插标签，不靠整体 escape 后再 regex）；新增排序切换（默认阅读顺序 / 最近修改 / 创建时间 / 相关度，相关度按命中权重计分）；4 色高亮首次暴露为筛选维度（之前完全没入口）；标签 chip 旁加且/或切换。多词搜索从「字面短语」改为「词的 AND」，与新字段语义一致
- **独立笔记专属编辑器**：原独立笔记复用高亮备注弹窗（单行、强制黄色、无预览、误关即丢）。新建 `note-editor-dialog.svelte`：多行 textarea、编辑/预览切换（marked 渲染，带 `.nb-preview` 排版）、实时字数、4 色选择（不再强制黄）、Markdown 草稿自动存 localStorage——下次打开恢复 + 「丢弃」入口，保存清空、取消保留（防误关丢失）。书内高亮编辑仍走原弹窗，行为不变
- **修笔记本侧栏 active 高亮失效**：`class:bg-black-5` 是无效 Svelte class 指令（Tailwind 透明度用 `bg-black/5`，斜杠在 class 指令里解析不了），导致「全部」视图选中时无背景高亮。改为条件 class 字符串，并给三个视图按钮 + 文件夹行补一致的 active 背景
- **文件夹新建/重命名/删除换自定义弹窗**：原先用浏览器原生 `prompt()`/`confirm()`，与书库侧栏（`library-folders/folder-sidebar` 已用 `TextInputDialog`/`ConfirmDialog`）不一致。notebook 侧栏对齐该模式：新建走 `TextInputDialog`、删除走 `ConfirmDialog`、重命名改内联输入（Enter 提交 / Esc 取消 / blur 提交）
- **回顾模态键盘快捷键**：`Enter`=已看、`→`/`Space`=跳过、`Esc`=关闭，按钮 `title` 带提示 + 底部一行可发现提示。window handler 里 `preventDefault()` 阻断按钮默认 Enter 激活，避免双触发跳两条
- **修链接选择器聚焦 + 补 Esc/Enter**：`<input autofocus>` 在 Svelte 里不可靠（组件挂载时机），改 `tick().then(focus)`（与 `HighlightMemoDialog`/`TextInputDialog` 同模式）；补 Esc 关闭、Enter 选第一条结果
- **搜索防抖 + 关联派生**：搜索输入 90ms 防抖（`debouncedQuery` 驱动解析/过滤），快打字时合并重算；`getLinked(h)` 原在模板里每条每帧调 3 次（`if` / `count` / `each` 各一次，每次 `.map().filter()`），改为 `buildLinkedById(groups, highlightById)` 每渲染周期算一次 `Map<id, linked[]>`，模板用 `{@const linked = ...}`
- i18n 三语各补约 50 条 `notebook.*` key（搜索 / 排序 / 标签 / 编辑器 / 文件夹弹窗）

## 1.15.1

- **修 Calibre 转换 MOBI/AZW3 时弹出黑窗口并卡住**：`ebook-convert` 在 Windows GUI 父进程下会闪现控制台窗口，且某些文件会让它无限挂起。改为隐藏窗口 + 5 分钟超时，超时时强制杀掉子进程并提示用户手动转 EPUB
- **修更新失败没有遥测**：自动更新报错只在对话框显示，运维侧看不到。失败时自动把错误信息提交到 `sync.fivood.com/report`
- **新增错误报告提交入口**：诊断日志弹窗（设置 → 数据 → 导出诊断日志触发）新增「提交报告」按钮，把日志匿名提交到 Cloudflare Worker
- **MOBI/AZW 导入失败自动上报**：导入出错且包含 MOBI/AZW 文件时，自动提交类型为 `import` 的错误报告，便于跟踪 Calibre 兼容性问题
- **修 MOBI/AZW 文件拖入无反应**：Tauri WebView 里 `webkitGetAsEntry()` 可能返回空，导致拖入文件不触发导入。`get-drop-event-files.ts` 在 FileSystemEntry 不可用时回退到 `dataTransfer.files`，拖入和选择器行为一致
- 后端 `stats-sync` Worker 新增 `POST /report` 端点，接收 64 KB 以内的匿名错误/安装/更新/导入报告，存在 KV 中

## 1.15.0

- **中 / 英 / 日 三语界面切换**：顶栏语言选择器（🌐 图标），首次访问按浏览器语言自动选择，其后每次会话记住选择
- 覆盖全部核心用户路径：顶栏 / 库管理 / 侧栏 / 阅读器 header 与 FAB / 目录 / 快捷键面板 / 高亮 · PDF · 词典右键菜单 / 完成本书 · 退出确认 · 跳转对话框 / 统计头 · 热力图 · 笔记本 / 设置 5 个 tab 骨架和常用条目 / 阅读时统计菜单 / 数据路径面板（含清除全部本地数据的多行确认）/ 同步设置
- 长文档提示（TTS 引擎选择说明、自定义 HTTP TTS 配置、CHANGELOG 页正文等）保留中文，翻译成本远大于收益
- 词库：约 470 条 key × 3 语言 = 1400+ 条翻译，经用户两轮审校
- 内部机制：零依赖轻量 i18n（自造 store + t() + JSON 词典），缺失 key 三级回退（当前 locale → zh → key 本身），单个组件加译不需重构调用点

- **修 TTS 悬浮按钮误触**：TTS 未启用时设置齿轮靠 group-hover 变可点，鼠标斜划过 TTS 悬浮区去按打字机减速键时点击落在隐形齿轮上。改为隐藏控件一律只做视觉预览、不接收点击
- **TTS FAB 重做**：齿轮 + 弹出面板换成与打字机同款的 −/+ 语速药丸（0.1× 步进、0.5–2×）。喇叭和播放键同行同高，两个调速药丸叠加共用播放键下方同一槽位——TTS 播放时显示语速、打字机播放时显示字/秒
- **Web Speech 语音选择迁到设置 → 阅读**：原先只在齿轮面板里有
- **修部分扫描版 PDF 整本读不出**：JBIG2 压缩的扫描图在打包版 404，改为整目录拷贝到 static；渲染兜底空白检测原本 7 个定点覆盖不足，改为整页缩到探针画布全扫

## 1.14.3

- **修部分黑白扫描版 PDF 整本读不出**（正式版正文全白板 / 部分页面丢失），两个叠加根因：
  - JBIG2 压缩的扫描图需要 pdf.js 的 wasm 解码器，原来用单文件 `?url` import 定位目录——dev 正常、打包后文件名被 hash 且兄弟文件不输出，运行时按原名请求 `jbig2.wasm` 直接 404，正文页全部渲染成白板。改为 postinstall 把 cmaps / standard_fonts / wasm 整目录拷进 static/vendor/pdfjs（与 PWA 端同方案）
  - 渲染兜底的「空白页检测」只采 7 个 20×20 定点（覆盖 0.19%），排版疏朗的页面 7 点全落白 → 渲染成功的页被当空白扔掉。改为整页缩进 24×32 探针画布后全量扫描，任意位置的墨迹都能命中
- 顺带修正：CJK cmap / 标准字体的生产加载与上述同坑，一并走 static 目录

## 1.14.2

- **修点「−」减速误触 TTS 齿轮**：TTS 未启用时设置齿轮靠 group-hover 变成可点，鼠标斜划过 TTS 悬浮区去按打字机减速键时，点击落在刚被 hover 激活的隐形齿轮上。现在隐藏控件一律只做视觉预览、不接收点击
- **TTS 悬浮按钮重做**：齿轮 + 弹出面板换成与打字机同款的 −/+ 语速药丸（0.1× 步进、0.5–2×）。喇叭和播放键同行同高，两个调速药丸叠加共用播放键下方同一槽位——TTS 播放时显示语速、打字机播放时显示字/秒，互不干扰
- **Web Speech 语音选择迁到设置 → 阅读**：原先只在齿轮面板里有；中文 / 日语音色排前。设置改完回阅读器即时生效
- **删掉播放键头顶的「字/秒」黑徽章**：速度药丸常显后信息重复，还和连播按钮相撞
- 清理 25 条遗留调试日志；工程侧落地 ESLint 与项目规范文档（CLAUDE.md）

## 1.14.1

- **修 CBR / CBZ / PDF 图片在二次进入时全部破图**：根因在 `format-book-data-html.ts` 的 Observable teardown 立即 `URL.revokeObjectURL` 所有 blob URLs——这在 BookReader 卸载（/b → /settings 之类导航）时跑，但 `formattedBookCache` 还留着 htmlContent（里面嵌着那些被废弃的 URL）。下次回 /b 缓存命中、把废弃 URL 喂给 `<img>` → `complete: true` 但 `naturalWidth: 0`，浏览器画破图标
- 修法：把 URL 所有权从 Observable 交给缓存。`getHtmlWithImageSource` 不再 teardown 时 revoke；改在缓存 evict（开新书时）一次性 revoke 旧 entry 的 URLs。新书的 URLs 立即生效不会被废，缓存命中时 URLs 还活着

## 1.14.0

- **OCR 引擎从 Tesseract.js 换 [PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js)（PP-OCRv5）**：1.13.0 内部 bench 对比一张典型中文扫描页，Tesseract 把人物照片识别成乱码、正文里塞 `RERTEEAR HEH RARBRA X` / `CEES PET FULT TT` / `E-ABFTRESN` 这种死亡乱码；Paddle 跳过照片只圈文字行、文本几乎可以直接粘到笔记里。耗时基本同档（25 秒/页 vs Tesseract ~25 秒）。本版把整条 OCR 链路换成 Paddle，删 tesseract.js 依赖
- **横幅 / 右键菜单语言选项简化**：从 8 个 Tesseract code（`chi_sim+eng / chi_tra+eng / chi_sim / chi_sim_vert / ...`）收紧到 5 个 Paddle code：`ch / chinese_cht / japan / korean / en`。PP-OCRv5 的 `ch` 默认就吃简中 + 英文混排，覆盖 95% 国产扫描
- **透明文本层从 per-char span 改 per-line span**：Tesseract HOCR 给的是 per-word（CJK = per-char）bbox，每字一个 span；Paddle 给的是 per-line polygon，每行一个 span。浏览器在 span 内仍按字符切分选区，部分行选取依然行，复制出来是干净中文段落
- **OCR 结果同步外存的 follow-up 已落实**：1.13.0 留了 `pushOcrResultToExternalStorage`，Tauri FS 跑 OCR 完直接 fire-and-forget 写回磁盘，别的设备打开就有
- **修分页模式点击翻页热区跟随用户边距**：1.13.0 的浮按钮已经做了，1.14.0 顺手把"点击翻页"的开关默认状态留给用户自己开（首次打开 reader 看不到不是 bug，是设置 → 阅读器里那个 toggle 没勾上）
- **WebGPU 不开启**：试过 ORT WebGPU EP 跑 PP-OCRv5，模型初始化 OK、推理 4 秒/页（vs WASM 25 秒），但 silently 返回 0 detection items——典型的 onnxruntime-web WebGPU EP 对某些算子不支持却不抛错的 bug。固定 backend WASM 单线程。多线程 WASM 需要 COOP/COEP，留作下版本（理论上 4-8 倍速）
- **修 `itemsToTextLayer` 把 Paddle 输出全过滤掉的 bug**：Paddle 的 polygon 是 `[x, y]` 元组数组不是 `{ x, y }` 对象，我之前错读 `p.x` / `p.y` → 全 undefined → bbox 算出 -Infinity → 每个 item 都被 `w<=0` 守卫 continue 掉 → 空文本层。改成 `p[0]` / `p[1]` + 加正确的 `OcrPoint` 类型

## 1.13.0

- **扫描 PDF 文字层（透明 OCR）**：OCR 输出从「图上面一段段段落」改造成 Chrome PDF 阅读器那种**透明文本层**。Tesseract 切到 HOCR 输出 + `preserve_interword_spaces: '0'`，每个识别词（中文里就是单字）拿到 `bbox` 像素坐标，生成 `<span style="left:Xpx;top:Ypx;font-size:Hpx">字</span>` 钉在 `<div class="pdf-text-layer">` 里。这个层 `color: transparent` + `user-select: text`，跟图叠在一个 `pdf-page-shell` 里靠 `--pdf-scale-factor` 跟随图片缩放。**结果**：视觉是干净的扫描原图，鼠标拖选时蓝色选区穿透图片选中底下的字，Ctrl+C 复制出来是无多余空格的干净中文（之前老版「编 者 的 话」变成「编者的话」）
- **OCR 输出形态升级路径**：旧版 `<p class="pdf-ocr-text">…</p>` 在 `isScannedPdf` 仍然认为是「已 OCR」，旧书不会再被 OCR 提示打扰；新跑的 OCR（或对旧书重跑 OCR）会自动用透明层取代旧段落；单页右键重 OCR 也走同一新路径
- **OCR 结果同步到 Tauri FS 磁盘**：之前只写 IDB，别的设备打开还是看扫描原图。现在 OCR 完成时 fire-and-forget 写一份回 `bookdata_*` 文件，下次别处打开就有
- **OCR 后 sections 字段重算**：之前每页 `characters: 1`（图占位），OCR 完每页突然有几百字但 sections 不更新，TTS 高亮 / 翻页跳转 / 阅读进度全错位。新增 `recomputeSectionChars` 扫一遍 newHtml，重写每个 section 的 `characters` 和累积 `startCharacter`
- **PDF 页图被 100vh 截短**：连续 / 分页两个 reader 的 `:global(img)` max-height cap 之前对 `.pdf-page-img` 也生效，shell 用 `aspect-ratio` 算出 1425px 高但图被截到 viewport 高度 1031px，透明文本层 spans 用源坐标渲染就跟可见图错位。改成 `:not(.pdf-page-img)` 豁免，分页模式同样豁免 `.pdf-page-shell` / `.pdf-section` 的 ttu-illustration-container 卡位
- **pdf-text-layer / pdf-page-shell CSS 提到全局**：之前规则只塞在 `book.styleSheet` 里，v1.11 之前导入的书没这些规则，OCR 完透明层就显成黑色裸字。现搬到 `book-reader/styles.scss`，所有书统一吃，老书不用重新导入
- **分页模式点击翻页热区跟随用户边距**：之前两侧固定 20px 细条，初次用根本看不出有这功能。改成：横向阅读取 `(viewport - 阅读区最大宽度) / 2`，竖排取 `阅读区左右边距`，最小兜底 5rem（≈80px，一根手指宽）。设了大边距热区自动变宽
- **边缘悬停浮出翻页按钮**：分页模式鼠标移到两侧热区内，淡灰半透明 chevron 圆按钮 fade in；1.2s 不动自动隐藏。`pointer-events: none` 不抢点击，下面的透明大按钮接管。横向 ← / → ，竖排互换（RTL）

## 1.12.18

- **CBR / CB7 / CBT 漫画归档支持**：之前只支持 CBZ（ZIP）。新增 [libarchive.js](https://github.com/nika-begiashvili/libarchive.js)（WASM ~1MB，按需 dynamic import）作 RAR / 7z / tar 三种漫画归档的解码器，复用 CBZ 的 `cbz-page-N.*` blob key 形态，OCR / 图片缩放 / 右键菜单全免改。fileAssociations、import 正则、accept 属性、Tauri 端 BOOK_EXTS 同步加上（顺手补了之前漏的 `azw` 单扩展名）
- **OCR 进度页码不再 "330 / 286 页"**：之前传 `page.pageNum`（PDF 物理页号，可能比 OCR-able 页数高），改为传迭代序号 `i + 1`，286 页扫描就是 1/286 → 286/286
- **OCR 完成后不再误报"检测到扫描版"**：旧逻辑判 isScannedPdf 时只看有没有 `<p class="pdf-ocr-text">` 文本块，但低质量扫描 OCR 跑完每页都返回空，没人插这个标记 → reload 后又弹。修法两层：1) OCR 完成时强制在 elementHtml 头部塞一个 `<p class="pdf-ocr-text" hidden></p>` 哨兵 2) ocr-job-manager 完成时把 bookId 写进 `pdfOcrSkippedBookIds$` 永久消音。CBR / CBZ 也加进白名单（漫画归档本来就是图片，不是误扫描 PDF）
- **【最大的坑】OCR 结果不再 reload 后丢失**：根因在 `saveExternalLastRead`（b/+page.svelte:1457）——`storageSource` 不为空时（Tauri FS / Dropbox），它无条件用磁盘上的 bookData 覆盖 IDB 读出来的，导致 OCR 写到 IDB 的新 elementHtml 一 reload 就被磁盘上的旧版盖掉，DOM 里完全看不到识别的文字。修法：用 `lastBookModified` 比较，本地新就保留 IDB 版本，别拿磁盘旧版无脑覆盖

## 1.12.17

- 撤掉 1.12.14 ~ 1.12.16 引入的 `[autobook:dbg]` console.log（hover 进度问题已确认修好，调试探针完成任务）
- 保留 putBookmark 的一行 dev log 和 `window.__autobook`（dev-only，prod 自动剥离，留作以后调试入口）

## 1.12.16

- **真·真·修 Tauri FS hover 进度 0%**：1.12.2 / 1.12.12 / 1.12.13 / 1.12.14 / 1.12.15 五次都没修中根因。dev 控制台日志暴露了真相——`card d.id=604654529 "D: 死亡余韵" bm= NO_MATCH`：tauri-fs-handler 的 `getBookList` 把 card.id 设为 `stableIdFromTitle(title)`（一个哈希，例如 604654529），而 IDB bookmark.dataId 用的是 reader 第一次打开书时分配的 IDB 自增 id（例如 5）。两套 id 空间永远不重合，任何 keyBy('dataId') / `bookmarkMap.get(d.id)` 的合并都必定 NO_MATCH
- 修法：用 title 做桥。新增 `idbTitleByDataId$` 观察 IDB `data` 表，把 bookmark.dataId 解析到 title，构 `titleToBookmark` Map，FS card 按 title 匹配。BROWSER 路径也走同一逻辑（browser-handler card.title 就是 IDB data.title，一样匹配）
- 1.12.14 BROWSER-only 分支的合并、1.12.15 unconditional 合并都在治标——其实是一开始 join key 选错了

## 1.12.15

- **修 1.12.14 的回归**：上一版给 Tauri FS / Dropbox 分支无脑 spread `bookmarkToProgress(undefined, ...)`，当 IDB 里没匹配的 bookmark（从别的机器同步来的书、刚导入还没读的书）就会把 tauri-fs-handler 从磁盘 `progress_*.json` 文件名解析出来的 progress / lastBookmarkModified 清零
- 现在改成：bookmark 不存在就保留 dataList 原值；存在才合并
- 顺手把 BROWSER 和非 BROWSER 两条分支合一，placeholder 过滤还是只对 BROWSER 用（FS handler 不会产 placeholder）

## 1.12.14

- **真·修阅读进度 hover 显示 0%（Tauri FS / Dropbox 用户）**：原 `bookCards$` 里只有 `$storageSource$ === BROWSER` 那一支会调 `bookmarkToProgress` 合并书签进度，其他存储源（`ttu-internal-tauri-fs` 桌面用户、Dropbox 等）直接返回 dataList 不带 progress 字段。所以 1.12.2 / 1.12.12 / 1.12.13 三次修都没辙——书签数据完全正确（dev 控制台看到 dataId=5 progress=0.143），就是 manage 页 BROWSER 分支才合并它
- 修法：BROWSER 之外的分支也走同样的 `bookmarkMap` 合并。FS 桌面用户终于能看到 hover 进度了
- 加了 dev-only 调试探针（gated by `import.meta.env.DEV`）：putBookmark 调用打 log；bookCards$ rebuild 打 log；window.__autobook 暴露 database + 关键 store。生产构建自动剥离，零运行时成本

## 1.12.13

- **修打字机加速后停止播放且显示全文的 bug**：根因连锁——所有 4 个 TTS 引擎的 `setContentEl(el)` **不做幂等检查**，每次调用都 `reset()` → `off()`；book-reader-continuous 的 `$:{}` 反应块对 `multiplier` 变化也敏感，加速点击会重跑该块、调 `setContentEl(contentEl)` 同一节点；reset() 内部 `off()` 让 autoReader 的 `wasReaderEnabled$` 假阳性 fire false → +page.svelte 订阅器调 `autoScroller.revealAll()` → 全文显示 + revealedIndex 到末端 → 下次 `revealNext` 撞底 `off()` 自杀。所以"加速 = 停 + 显示全文 + 再点也无效（revealedIndex 已经在末端，立刻自杀）"
- 修法：4 个 AutoReader 引擎（Web Speech / SAPI / Custom / Kokoro）的 `setContentEl` 都加 `if (this.contentEl === el) return` 幂等短路，照 AutoScroller 的写法
- **修速度徽标「12 字/秒」和 AutoReaderFab 音量按钮重叠**：徽标原来 `absolute -top-2 -right-2` 朝右上角伸出，跟 AutoReaderFab 在 right-20 的图标在视觉上撞了。改成 `-top-5 left-1/2 -translate-x-1/2` 浮在播放按钮**正上方**居中显示，永不重叠

## 1.12.12

- **真修阅读进度 hover 不更新**：1.12.2 改了 `bookmarkToProgress` 兼容老数据，但症状没消失——根因是更底层的：`database.bookmarks$` 观察 `bookmarksChanged$` 这个 Subject，**只在 replicator 导入/导出时 fire**，正常 `putBookmark` 调用路径根本没触发。所以阅读器里读完保存进度后，`bookmarks$` 还停留在 app 启动时的快照。书库 hover 弹窗 / 卡片进度条永远显示打开 AutoBook 那一刻的进度
- 在 `putBookmark` 和 transaction-级 `delete bookmark` 路径都补上 `this.bookmarksChanged$.next()`，正常保存进度后回到书库即时反映
- 之前 1.12.2 的 fallback 改动（用 `exploredCharCount / book.characters` 兜底）依然保留，对老书签依然有效

## 1.12.11

- **修 v1.12.4 – 1.12.10 CI 全线构建失败**：根因是 `ttsCustomProxyUrl$` 的 store 导出 + 对应 Rust `custom_tts_synthesize` 的 `proxy_url` 参数 + auto-reader-custom.ts 的 import 一直只在我本地工作树里没 git add，自 1.12.4 起所有 tag 推上去 CI 一拉就报 `"ttsCustomProxyUrl$" is not exported by "src/lib/data/store.ts"`。本地构建一直成功（文件存在）让我没察觉。
- 这次把三处补齐：store.ts 加 `ttsCustomProxyUrl$` export 和 `TtsCustomPresetState.proxyUrl` 字段；auto-reader-custom.ts 调用 invoke 时把 proxyUrl 透传给 Rust；lib.rs 的 `custom_tts_synthesize` 接受 `proxy_url: Option<String>` 并转给 `custom_tts::synthesize`（Rust 侧已经支持 proxy）
- 自此自定义 HTTP TTS 现已支持代理（OpenAI / ElevenLabs 在国内可通过 HTTP/SOCKS5 代理走通）

## 1.12.10

- **修 Web Speech TTS 滚动模式下「中断再开（光标位置）只读一段就停」**：根因两处。一是 `AutoReaderContinuous.speakNext` 没做空文本判断 —— 光标位置策略可能让 `slice(charOffset)` 出空字符串（光标落在段末），Web Speech 收到空 utterance 抛 `invalid-argument` 错误。二是 `utt.onerror` 处理把所有非 canceled/interrupted 错误都视为致命直接 `off()`，整个朗读会话被终止
- 修法：
  - speakNext 加空文本短路（跟 SAPI / Custom / Kokoro 一致）：空 / 只含空白时 `paraIndex++` 通过 `queueMicrotask` 递归到下一段
  - onerror 对 `invalid-argument` / `text-too-long` / `audio-busy` 这类**可恢复错误**改为跳过当前段继续，只有真致命错误（合成失败 / 网络 / 没语音）才停整段
- 行为变化：现在不管光标策略落在哪儿，TTS 都能稳定向下播

## 1.12.9

- **修「优先阅读器样式」开启后图片不显示**：原 `&.ttu-apply-important { :global(*) { font-family: inherit !important; } }` 的通配符 `*` 把规则套到了 `<img>` / `<svg>` / `<picture>` / `<source>` 上。Chromium 渲染器在 EPUB 内联样式跟 `!important` 字体规则冲突时偶发图像不渲染。改成排除式选择器 `:not(img):not(svg):not(picture):not(source):not(video):not(canvas)`，只对真正承载文字的元素生效
- 顺手修「图片只占一段的 `<p>` 被全局 text-indent 推移」：很多 EPUB 用 `<p><img/></p>` 包裹插图，开启「优先阅读器样式」后 `:global(p) { text-indent: ... !important }` 会让插图整体右移。新加 `:global(p:has(> img):not(:has(> :not(img))))` 规则把"只含图片的段落"text-indent 强制归零

## 1.12.8

- TTS 预设顺序再调整：**MiMo 提到第一位**，因为 v1.12.7 验证 SiliconFlow 已经取消新人赠送、MiMo 仍在限时免费阶段。★ 推荐标记从 SiliconFlow 挪到 MiMo —— 「免费 + 国内直连」是新人最该先试的
- MiMo helpHint 更新：「小米 MiMo TTS 限时免费阶段（中文听书白嫖首选）；不绑卡，注册即用」

## 1.12.7

- 修 SiliconFlow 预设标签和 helpHint 误导：2025 年中起新用户没有 14 元赠送额度了，文案改成「按字符计费」并加上 CosyVoice2 实际单价 `¥105/100 万字符`，注明「部分模型有限免」并明确赠送已取消。诚实标签 > 营销话术，新人不该因为旧文案上当

## 1.12.6

- 修 Aliyun Qwen3-TTS 预设的「获取 API key ↗」按钮指向：原 dashscope.console.aliyun.com 已迁到百炼 bailian.console.aliyun.com，按钮 URL 改成 `https://bailian.console.aliyun.com/?tab=model#/api-key`。helpHint 文案也提一句"dashscope 已迁到 bailian"避免老用户迷惑。API 端点 `dashscope.aliyuncs.com/api/v1/...` 阿里继续兼容，不变

## 1.12.5

- **TTS 预设列表重排 + 标签更新**：按"实用度"重排顺序：国内（SiliconFlow ★ / Aliyun Qwen3 / MiMo / 火山）→ 海外（Google Cloud ★ / Gemini / OpenAI / Azure / ElevenLabs）→ 手动配置兜底。两个"性价比之王"用 ★ 前缀标出
- Azure Speech 标签改成「中文质量好但配置繁琐」—— 中文音色顶级但 5 步配置（注册 Azure → 创建 Speech 资源 → 拿 key + region → 替换 endpoint）门槛劝退
- ElevenLabs 标签改成「仅英语推荐」—— 按字符贵 + 中文质量一般，主要听英语才用
- **每个预设加 helpUrl + helpHint**：选中预设后，旁边出现「获取 API key ↗」按钮，点了用 Tauri shell 在系统默认浏览器打开 console；下方一行小字简述：注册流程、是否绑卡、有无免费额度、是否需梯子等关键信息
- 示例：选 SiliconFlow → 看到「注册送 14 元额度，OpenAI 兼容接口，国内直连不用梯子」；选 Azure → 看到完整 5 步配置指引；选 OpenAI → 看到「需绑卡按字符计费；中文质量一般，英语优秀」

## 1.12.4

- **新增 SiliconFlow 硅基流动 TTS 预设**：国内直连无需梯子，**OpenAI 兼容接口**，端点 `https://api.siliconflow.cn/v1/audio/speech`。聚合了 FunAudioLLM/CosyVoice2-0.5B（8 个中文音色 alex/anna/bella/benjamin/charles/claire/david/diana）、GPT-SoVITS、Fish-Speech 1.5 等开源模型，有**免费额度**，是当前国内最稳的 AI TTS 接入方式
- **新增 Aliyun DashScope Qwen3-TTS-Flash 预设**：端点 `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`。Qwen3-TTS-Flash 4 个音色（Cherry / Serena / Ethan / Chelsie）。⚠ DashScope 响应是包了音频 URL 的 JSON 不是裸字节，需配合下面的 URL 抽取能力
- **新「url:」音频路径抽取**：自定义 HTTP TTS 引擎新增 audioPath 前缀 `url:` 语法 ——`url:output.audio.url` 表示「先在 JSON 响应里按 dot-path 取到一个 URL，再后端二次 fetch 这个 URL 当音频字节用」。覆盖 DashScope Qwen / 火山引擎流式 / 任何「响应里给 URL 不给字节」的服务。改动只在 Rust 端 `custom_tts::synthesize`，前端零侵入
- 占位符 placeholder 文字更新说明新语法：「留空 = 响应是裸音频字节；JSON 里 base64 字段填 dot-path；JSON 里是音频 URL 填 url:dot-path」

## 1.12.3

- **设置加新 tab「TTS」**：跟阅读 / 外观 / 数据 / 统计并列，音量图标。原来 TTS 设置藏在「阅读」tab 里且被 `isTauri() && viewMode === Paginated` gate 住，自 1.11.1 起滚动模式也支持 TTS 后这个限制失效，所以把整段 TTS 设置（朗读引擎 / 朗读起点 / 章末自动续读 / 全局快捷键 / Kokoro / SAPI 语音 / 自定义 HTTP TTS）摘出来独立成 tab
- 旧位置（阅读 tab 里的 TTS 块）用 `{#if false}` 封存，下一版清除
- 文案更新：移除「桌面端分页模式专属」字样，改成「自 1.11 起在滚动 + 分页两种模式下都可用」
- 内联控件统一换成 `.settings-input` pill 样式（之前是老 `border-b-2` 下划线式）

## 1.12.2

- **修书库 hover 详情 / 卡片底部进度条始终 0%**：根因是非常老版本的 bookmark 文档可能根本没有 `progress` 字段，只有 `exploredCharCount`。v1.10.12 我把 `bookmarkToProgress` 改成只看 `progress` 后这类老书签直接返回 0。补 fallback：缺 `progress` 时用 `exploredCharCount / book.characters` 兜底算
- **新预设：Google Cloud TTS**（`texttospeech.googleapis.com/v1/text:synthesize`）每月 100 万字符免费配额，MP3 输出直接走现有引擎。`audioPath: 'audioContent'` 即可。默认音色 cmn-CN-Wavenet-A
- **新预设：Gemini 2.5 Flash TTS**（`generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`）——Gemini 返回的是**裸 L16 PCM 24kHz**，浏览器没法直接播。新增 `pcm-to-wav.ts` 工具把响应字节加 WAV header 再喂给 `<audio>`。auto-reader-custom 检测到 endpoint 是 generativelanguage + audioPath 以 `inlineData.data` 结尾时自动套 WAV，其他 TTS 走 MP3 原样
- 自定义 HTTP TTS 引擎现已覆盖：OpenAI / ElevenLabs / Azure / Volcengine / MiMo / **Google Cloud / Gemini**。"manual" 预设依然是用户接其他任何 HTTP TTS 的入口
- 关于 Coqui-AI/TTS 仓库的查询：经查 [Coqui AI 公司 2024 年初已倒闭](https://github.com/coqui-ai/TTS/discussions/3221)，仓库未归档但 2024-08 后停滞。XTTS-v2 旗舰还是 **CPML 非商用许可**。建议改用持续维护的 community fork [idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS) 或换用 Qwen3-TTS / CosyVoice 2

## 1.12.1

- **修 v1.12.0 Kokoro 默认音色不存在**：v1.12.0 我猜测的 `zf_xiaobei` / `zm_yunjian` 这类中文音色 ID 不在 kokoro-js v1.0 ONNX 包里——v1.0 实际只打包了**英语**音色（美式 + 英式，共 28 个）。试听会报错 `Voice "zf_xiaobei" not found. Should be one of: af_heart, af_alloy...`。
  - 设置面板的音色下拉换成模型实际支持的 28 个：美式女声 11 个、美式男声 9 个、英式女声 4 个、英式男声 4 个
  - 默认从 `zf_xiaobei` 改成 `af_heart`（社区推荐音色）
  - 加保护性兜底：调 `tts.generate` 前先校验 voiceId 是否在 `tts.voices` 列表里，不在则自动回落到第一个可用音色并把校正后的值写回 store。从 1.12.0 升级上来、本地存了无效 voiceId 的也能自动救回
  - 音色下方加说明：中文 / 日语需要等上游更新或换用「自定义 HTTP TTS」接 Qwen3-TTS / CosyVoice 2 等中文模型
- **修阅读器 TTS FAB 引擎切换后语音下拉仍是 Web Speech**：之前 FAB 里的语音选择只有 `sapi` / `custom` / Web Speech 三个分支，选了 `kokoro` 会落到默认 Web Speech 分支显示系统语音。加 `kokoro` 分支显示「音色在『设置 → 阅读 → Kokoro-82M』里选」，引擎名标签也加上「Kokoro 离线」

## 1.12.0

**内置离线 TTS：Kokoro-82M**

- 朗读引擎下拉新增「Kokoro-82M（内置离线）」选项，跟 Web Speech / SAPI / 自定义 HTTP 并列
- **opt-in 下载**：选中 Kokoro 后什么都不会发生；面板里点「下载并启用」才触发 ~80MB 模型从 Hugging Face (`onnx-community/Kokoro-82M-v1.0-ONNX`) 拉到本机，存进 WebView2 的 IndexedDB。下载进度实时显示百分比 + MB。下载完成后**完全离线**，飞行模式也能朗读
- 多音色：中文 8 个（zf 系列 4 女声 / zm 系列 4 男声）、英语美式 5 个、英语英式 2 个、日语 2 个，下拉分组
- 复用 v1.11.1 的 `ontimeupdate` 段内插值 boundary 机制 —— Kokoro 也是「一段返回一个 audio buffer」，分页翻页和当前句高亮跟着自动同步
- 试听按钮支持 Kokoro：选好音色直接听一句「这是语音测试。床前明月光，疑是地上霜。」
- 用 onnxruntime-web 走 wasm 推理，CPU 跑得动；不上传任何阅读内容，模型权重也是首次下完之后全在本地
- 试听 / 切换音色 / 重新启用都不会再触发下载（除非清空所有本地数据）

**实现细节**：
- 新文件 [auto-reader-kokoro.ts](src/lib/components/book-reader/auto-reader-kokoro.ts) 实现 `AutoReader` 接口；与 SAPI / 自定义 HTTP 同构（同样的 paragraphs / paraIndex 节奏，同样的 boundary 插值）
- `kokoro-js` 走 `await import()` 动态加载，冷启动不付出 50MB JS 解析成本，仅在第一次使用时按需加载
- 新增 store：`kokoroAccepted$`（用户授权下载与否）/ `kokoroVoiceId$`（当前音色）/ `kokoroLoadStatus$`（实时下载进度）
- 工厂函数返回 `AutoReaderKokoro` 时优先于 Tauri / 浏览器判断，因为 Kokoro 在两种环境都能跑

## 1.11.1

- **TTS 当前句高亮**：朗读时把正在念的整句话用半透明黄色背景标出来，两种视图模式都生效。底层用 CSS Custom Highlight API（`window.Highlight` + `CSS.highlights.set('tts-sentence', ...)`），无 DOM 改动；不支持的浏览器静默退化。新文件 `tts-highlight.ts`，三个 TTS 引擎（Web Speech / SAPI / 自定义 HTTP）都加了 `getCurrentSentence(): { globalStart, globalEnd, text }`
- **滚动模式接入 TTS + 用 TTS 控制打字机节奏**：之前 TTS 只在分页模式可用，现在滚动模式也显示 TTS FAB；按 `V` 在两种模式都能切。滚动模式下 TTS 启动时：调 `autoScroller.prepare()` 给字符 wrap 上 `.tw-c` 隐藏 span，关掉打字机自带计时器，让每次 `onBoundary` 的 charIndex 直接喂给 `seekToCharIndex` —— 屏幕字符与语音同步出现。同时智能滚屏：当前句不在视口中 20%–70% 时平滑滚到中间。TTS 停止时 `revealAll()` 把后面字全显出来
- **修分页 TTS 长段落不翻页**：根因是 SAPI / 自定义 HTTP 引擎只在段首报一次 `onBoundary`（Web Speech 是逐词报）。长段落超过一页时翻页逻辑等不到下次 boundary 触发，朗读位置比显示位置超出 200+ 字。修法：给 SAPI / 自定义的 `<audio>` 挂 `ontimeupdate`，按 `audio.currentTime / audio.duration` 线性插值算出段内 char 偏移，每 2% 进度触发一次 boundary（约 50 次/段）。`ensureCharVisible` 随之跟上
- 新增公共 `AutoScroller.prepare()` + `seekToCharIndex()` 接口（types.ts），用于 TTS 启动时预先 wrap 字符。`AutoReader.getCurrentSentence()` 加入接口

## 1.11.0

**PDF 文字层 Phase 1**：有文字层的 PDF 导入后体验对齐 Chrome 内置 PDF 阅读器——视觉是原版页面图，鼠标可以直接选中文字。

- `load-pdf.ts` 重构：原"text 模式只输出 `<p>` 段落、image 模式只输出 `<img>`"变为「文字 PDF 同时输出图像 + 透明定位 span 文字层」。每页生成 `<div class="pdf-page-shell" data-page-w data-page-h>` 含 `<img>` + `<div class="pdf-text-layer">` 中 N 个绝对定位 `<span>`，每个 span 带 `left / top / font-size` 来自 PDF.js 文字项 transform 矩阵
- 新 `buildTextLayer()` 把 PDF user-space 坐标（左下原点）转 CSS 坐标（左上原点），减 fontSize 让 span 顶边对齐文字顶部；旋转文字按矩阵 atan2 算角度套 `rotate()`
- 新 Svelte action `pdfPageShell`：在阅读器内容容器挂 ResizeObserver + MutationObserver，给每个 shell 设 `--pdf-scale-factor = actualWidth / intrinsicWidth`，CSS 让 text-layer `transform: scale(var(--pdf-scale-factor))`——图像缩放时文字层永远跟着对齐
- 文字层 CSS：span 透明字 + `pointer-events: auto` + `cursor: text` + `user-select: text`；`::selection` 蓝色半透明高亮，体感和 Chrome 一致
- 真实字数统计：之前 image 模式所有页 `characters: 1`（进度条几乎无意义），现在用 PDF.js 文字项实际字数。进度 / TTS / 朗读速度 / AI 抽屉提示词长度全部受益
- 扫描 PDF 流程未变：image-only 路径（无 shell、无文字层）保持原样，OCR 工作流（v1.10.6+ 的字符串级 `<p class="pdf-ocr-text">` 注入）继续起作用。Phase 2（v1.12）会把 OCR 输出也改成定位 span 文字层，扫描书也能选文字
- 旧库里的书 `elementHtml` 不动；要享受新体验需重新导入原 PDF。一本 300 页文字 PDF 的 IDB 占用从 ~200 KB 升到 ~10 MB（图 9 MB + spans HTML 1.5 MB）——交换的是真还原版式 + 真可选文字

**修 AZW3 导入错误显示**：
- 之前原生 KF8 解析在合订本 / 漫画包 / 多卷本上 panic 时，JS 端拿到的 Tauri 错误对象在某些边界条件下序列化为 `{}`，错误提示完全没用。新加 `extractTauriError(e)` 按 `string → .message → .error → .name → JSON.stringify → 兜底中文`优先级提取，再也不会显示 `{}`
- Calibre 提示文案改清楚：明说原生解析器对合订本 / 多卷本兼容性有限，装 Calibre 是最稳的（AutoBook 检测到 Calibre 会自动调用它先转 EPUB 再导入）

## 1.10.12

- 打字机模式提前向上滚 + 控件淡出：之前 typewriter 触发滚动的阈值是 viewport bottom 80px 内，结果活动行进入右下角 FAB 控件占用区时还没滚，文字被遮挡。改成 `max(120px, 32% × viewport height)` —— 1080p 屏 ~346px 安全区，活动行永远在视口高度 68% 以上。auto-scroll FAB 在播放时鼠标 1.2 秒不动自动淡到 20% 透明度，键盘帮助图标默认透明度从 0.4 降到 0.22
- 书库封面卡状态指示：左上角加 chip —— **「✓ 已读」**（绿）当进度 ≥ 99.5%，**「未读」**（白）当从未打开过；中间在读不放 chip（底下进度条已说明）。顺手把进度条配色从红 gradient 改成中性蓝灰，加 0.25s 过渡
- 修进度数值归一化 bug：之前 0–1（新书签）和 0–100（老字符串"45%"）两套并存，导致老数据进度条显示 4500% 宽（被 CSS 截到 100%，视觉永远满）；1.10.11 的「已读」筛选 `p >= 100` 对新数据永远不命中。`bookmarkToProgress` 统一归一到 0–1，筛选改用 `>= 0.995`
- 书库文字搜索：书卡上方加搜索条，按书名实时过滤（case-insensitive substring）。右上角显示 `X / Y` 计数，✕ 一键清空。**不持久化**，下次进书库默认看全本书
- 书卡 hover 详情卡：鼠标在封面停留 **600ms** 后弹出小卡片，显示完整书名、字数（万字单位）、进度 + 剩余字数、上次阅读 / 书签 / 更新的相对时间（"3 天前"，悬停看绝对时间）。鼠标离开 / 点击 / 多选模式 / 触屏设备都不弹。智能定位避让窗口边
- 阅读器 FAB 协调：图片缩放胶囊和键盘帮助图标挪到**左下角**，右下角留给最常用的 typewriter / TTS 播放 FAB，不再互相挡
- 阅读器冷启动懒加载：AiReaderDrawer（302 行）、BookReaderImageGallery（255 行）、BookReadingTracker（874 行）从静态 import 改为 `await import()` 动态加载。AI 抽屉、图片库到用户首次打开按钮时才解析；统计 tracker 在阅读器 hydrate 一帧后异步加载，不阻塞初始渲染。三者合计 ~1.4k 行模板从冷启动关键路径上拆掉

## 1.10.11

- 按页重 OCR：扫描 PDF / CBZ 的页图上右键 → 「重新识别这页」（用当前 OCR 语言）或「用其它语言识别…」展开 9 语言选择（含 1.10.8 的竖排中日）。新函数 `runOcrOnPage` 走字符串级重写，只替换目标 `<img data-pdf-page>` 之前的 OCR `<p>` 块，整本结构原样保留。识别完直接 `db.put` + reload，底部 toast 显示识别字数
- 阅读器键盘快捷键面板：按 `?` 弹出（输入框内不触发），或点右下角浮动键盘图标打开。从 `bookReaderKeybindMap$` 实时读取所有绑定，按动作分组合并大小写变体；多个键画 `<kbd>` 标签。`Esc` 关闭
- 书库新增「筛选」按钮（漏斗图标，排序前面）：popover 多选 chips
  - **格式**：PDF / EPUB / MOBI / CBZ / TXT / Markdown / HTMLZ / 其他（按 title 后缀名判定）
  - **完成状态**：全部 / 未读 / 在读 / 已读（按 progress 0 / 0-100 / ≥100 判定）
  - 当前过滤 active 时漏斗图标右上角橙色小圆点；面板底部「清除全部筛选」按钮；状态 localStorage 持久化
- 统计筛选面板视觉对齐：之前 `<select>` / `<input type="date">` 一律 `class="text-black"` 硬写黑字在新主题里出戏，批量换成 `.settings-input`，套用「软填充胶囊」（8% 前景填充 + 18% 边框 + 圆角）。`.settings-input option` 加专用规则白底黑字防主题穿透
- 补全图标 tooltip：
  - 书库头部「多选模式」SVG 之前完全没 tooltip，加 `<title>` + `aria-label`
  - 统计页头部「回到当前书」SVG 同上
  - 目录侧栏「上一章 / 下一章」之前在不可点状态下 title 变空字符串，改成永远显示

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

- 书库分类：左侧新增分类侧栏，支持新建 / 重命名 / 删除文件夹。一本书可以同时归入多个分类（tag 风格），比如同一本推理小说可同时属于「推理」和「女性作者」，互不冲突
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
