# 独立翻译器 GUI

独立 GUI 不依赖 AutoBook，复用同一套解析器、术语候选、Ollama provider、断点和导出逻辑。

在 `G:\translator-workbench` 执行：

```powershell
pnpm run gui
```

然后打开 <http://127.0.0.1:5274>。

流程：

1. 导入 EPUB、HTML、TXT 或 Markdown。
   文件选择支持多选，也可以直接选择文件夹；每个文件会建立独立 checkpoint 任务。
2. 查看专有词汇候选，填写确认译名并点击“确认术语表”。
3. 点击“开始初译”；每个批次会写入 `gui-data` checkpoint。
4. 可随时“中断并保存”，重新打开任务后继续。
5. 初译完成后，可填写 OpenAI-compatible API 的 Base URL、模型和 API Key，启动精校。
6. 点击“导出当前结果”；若精校完成，导出会优先使用精校文本。

Ollama 默认地址为 `http://127.0.0.1:11434`，端口可用 `TRANSLATOR_GUI_PORT` 修改。
