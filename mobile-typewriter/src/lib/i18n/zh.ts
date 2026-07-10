// PWA-only dictionary. Different feature set than desktop — no
// keyboard-shortcuts panel, no notebook, no AI, no dictionary popup.
// Structure by feature area; alphabetical within each namespace.
export default {
  // Language picker (inside sync-settings sheet since PWA has no top nav)
  'locale.label': '界面语言',
  'locale.zh': '中文',
  'locale.en': 'English',
  'locale.ja': '日本語',

  // Duration formatter (formatDuration in +page.svelte)
  'duration.seconds': '{n} 秒',
  'duration.minutes': '{n} 分',
  'duration.hours': '{h} 时 {m} 分',

  // Landing page (before opening a book)
  'landing.dropHint': '松开导入',
  'landing.lead': '逐字浮现 + 扫描 PDF 滑屏。支持 .txt / .epub / .md / .pdf。',
  'landing.leadSub': '桌面端可以直接把文件拖进这里。',
  'landing.dropAria': '文件拖放区',
  'landing.pickFile': '选择文件',
  'landing.loading': '读取中…',
  'landing.recentTitle': '最近读过',
  'landing.recentPagesPdf': '第 {page} / {total} 页 · PDF',
  'landing.recentPct': '{pct}% · {preview}…',
  'landing.recentDelete': '删除记录',
  'landing.recentHint': '点条目重新选同一个文件即可继续上次进度。',
  'landing.syncOpen': '跨设备同步阅读时长',
  'landing.desktopFullLink':
    '桌面完整版（高亮 / 笔记本 / AI / 离线词典 / Obsidian 同步）：{link}',
  'landing.syncFab': '同步设置',

  // Ingest / load progress
  'ingest.pdfProgress': '渲染第 {loaded} / {total} 页…',
  'ingest.readFail': '读取失败：{err}',
  'ingest.noReadableContent': '这个文件好像没有可读内容',
  'ingest.hashMismatch': '这不是同一本书：哈希不对。换个文件再试。',
  'ingest.pdfPreview': '共 {n} 页',

  // Reader top bar
  'reader.close': '‹ 关闭',
  'reader.immersiveOn': '沉浸模式',
  'reader.immersiveOff': '退出沉浸',
  'reader.progressAria': '今日累计 (含其它设备)',
  'reader.pdfProgress': '{cur}/{total} 页 · {duration}',
  'reader.textProgress': '{pct}% · {duration}',

  // PDF viewer bottom bar
  'pdf.prevPage': '上一页',
  'pdf.nextPage': '下一页',
  'pdf.pageOf': '第 {cur} / {total} 页',
  'pdf.resumeTooltip': '切回 App 时回到原位置',
  'pdf.resume': '续读',
  'pdf.alt': '第 {n} 页',

  // Scroll-mode bottom bar
  'scroll.toTypewriter': '切换到打字机模式',
  'scroll.label': '滑屏阅读',

  // Typewriter bottom bar + controls
  'typewriter.toScroll': '切换到手动滑屏阅读',
  'typewriter.speedUnit': '{n} 字/秒',
  'typewriter.play': '播放',
  'typewriter.pause': '暂停',
  'typewriter.resumeTooltip': '切回 App 时若之前在播则继续',
  'typewriter.resume': '续读',
  'typewriter.chapterStop': '章止',
  'typewriter.tocSummary': '目录 · {n} 章',
  'typewriter.untitledChapter': '（无标题段 {n}）',
  'typewriter.restart': '从头开始',

  // Sync settings sheet (opens from the ⇅ fab)
  'sync.title': '跨设备同步',
  'sync.close': '关闭',
  'sync.description':
    '32 字符 token 是认证。先在桌面端「设置 → 数据 → 同步」生成，把同一串粘进下方；或直接在这里生成、复制到桌面端。',
  'sync.enable': '启用同步',
  'sync.tokenPlaceholder': '32 字符 hex token',
  'sync.save': '保存',
  'sync.generate': '生成',
  'sync.copy': '复制',
  'sync.deviceIdLabel': '本机 device-id：',
  'sync.deviceIdUnset': '（未生成）',
  'sync.pushNow': '立刻推送',
  'sync.pullNow': '立刻拉取',
  'sync.lastSync': '上次：{time}',
  'sync.never': '从未',
  'sync.tokenInvalid': 'token 必须是 32 字符 hex',
  'sync.saved': '已保存',
  'sync.tokenCleared': 'token 已清除',
  'sync.generated': '已生成。把它粘到桌面端「设置 → 数据 → 同步」即可对接',
  'sync.copyFail': '复制失败：{err}',
  'sync.enabled': '同步已启用',
  'sync.disabled': '同步已关闭',
  'sync.pushing': '推送中…',
  'sync.pushed': '已推送 {n} 条',
  'sync.notEnabled': '未启用同步',
  'sync.pushFail': '推送失败：{err}',
  'sync.pulling': '拉取中…',
  'sync.pulled': '已拉取，云端共 {n} 本书',
  'sync.pullFail': '拉取失败：{err}'
};
