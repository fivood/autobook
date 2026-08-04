# Translator Workbench

本项目是独立的本地翻译工作台。核心包会保持与界面解耦，后续可被
`G:/ebook reader/autopage`（AutoBook）直接引用。

当前第一里程碑：

- EPUB 原始 ZIP 解包与文本节点定位
- TXT / Markdown 段落提取与原文件导出
- AutoBook 已存储 HTML 的文本节点提取与导出
- HTML 翻译结果可按字符上限导出为多个 Markdown 分块，并打包为 ZIP 供复核或再次处理
- 稳定的段落 ID
- 只替换 XHTML 文本节点并重新打包
- 保留原始 CSS、图片、字体、目录和其他资源
- Ollama provider 的统一接口
- OpenAI-compatible 精校 provider，可接本地代理或其他模型 API
- 可序列化的 `TranslationJob` 快照和批次恢复辅助函数
- AutoBook 可将已确认的术语保存为默认世界观词汇表，并在后续书籍中复用

`src/core` 不依赖 Svelte、Tauri 或 AutoBook 的 `$lib` 路径；`src/adapters`
只负责文件格式；`src/providers` 只负责模型调用。这样可以在工作台和
AutoBook 中共享同一套翻译任务和术语逻辑。

## 本地开发

需要 Node.js 20+ 和正在运行的 Ollama。模型地址默认为
`http://127.0.0.1:11434`。

```powershell
pnpm install
pnpm run check
pnpm run test:roundtrip
```

测试默认使用 `G:/trans/Amello-Novellas/Thane.epub`；如果该文件不存在，
可以通过 `TRANSLATOR_TEST_EPUB` 指定其他 EPUB。

代码将来接入 AutoBook 时保留 BSD-3-Clause 许可声明。
