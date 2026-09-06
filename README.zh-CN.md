# AutoBook

> Windows 桌面电子书阅读器，把读书变成可检索、可回顾的个人知识库。打字机 / TTS 自动播放、剧透安全的 AI 问答、离线词典、漫画翻译，一键同步 Obsidian。

[English](./README.md) · **简体中文**

[![Latest release](https://img.shields.io/github/v/release/fivood/autobook?display_name=tag)](https://github.com/fivood/autobook/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/fivood/autobook/total)](https://github.com/fivood/autobook/releases)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)](https://github.com/fivood/autobook/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app/)

原型 fork 自 [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader)，与上游已实质性分叉。Tauri 2 + SvelteKit + Rust，带签名的自动更新通道。

---

## 功能亮点

- **格式**：EPUB、MOBI/AZW/AZW3（自研 Rust 解析器）、PDF（文本 + 扫描版 OCR）、Markdown、TXT、HTMLZ、CBZ/CBR；任意格式可打包成 ZIP 批量导入
- **打字机 / 朗读**：逐字浮现自动播放（A/D 调速），支持 WinRT 系统音色与自定义 HTTP TTS 端点
- **漫画翻译**：CBZ/CBR → OCR → 气泡归组 → 本地 / 云端 LLM → 阅读器内译文覆盖层
- **漫画抹字**：自动擦除气泡原文（纯色填充，渐变 / 纹理交给 LaMa），漏检的 SFX 可手工框选补抹
- **剧透安全 AI**：对全书建 BM25 索引，按阅读进度硬截断，问「这个角色是谁」不会剧透；支持 Anthropic、OpenAI 兼容、本地 Ollama
- **离线词典**：自带 StarDict 词典包，完全离线、多词典并查
- **知识库**：跨书笔记本（文件夹 / 标签 / 双链 / 每日回顾 / 全文搜索），一键同步 Obsidian
- **翻译工作台**：逐书术语表、带检查点的分批翻译、中断 / 重启可续——文本书与漫画同一工作流
- **13 套主题** + 完整自定义主题编辑器

## 阅读

- **打字机模式**：逐字浮现，1–60 字/秒，`A`/`D` 调速
- **朗读**：WinRT 系统音色，或自定义 HTTP 端点（讯飞、百度、本地 GPT-SoVITS 等），可配 header / body 模板
- **高亮**：4 色 + 备注 + 标签，独立于书籍文件存储——删书不丢笔记
- **词典**：右键查词、英文词形还原回退、多词典合并

## AI 与翻译

- **剧透安全助手**：按进度限制检索范围，问「之前提过 X 吗」不会剧透后续
- **翻译工作台**（`/translate`）：导入书籍或文件，校准逐书术语表，分批翻译，断点自动保存、中断或重启可续
- **漫画翻译**：CBZ/CBR 端到端——OCR（19 种语言）、气泡归组、AI 纠错、分批翻译、阅读器内译文覆盖层
- **抹字**：气泡原文自动擦除（纯色填充；渐变 / 纹理背景交给 LaMa sidecar），overlay 落在干净页面上；手工框选补抹漏检区域
- **模型管理**：一个页面统一查看 PaddleOCR、Kokoro、Ollama、LaMa 的就绪状态、下载进度、存储位置与卸载

## 知识库

- 跨书笔记本：文件夹、标签、`[[双链]]`、加权每日回顾抽卡、全文搜索、跳回原书原页
- **Obsidian 同步**：一键推送，每条高亮生成一个带完整 frontmatter 的原子 `.md`

## 安装

从 [Releases](https://github.com/fivood/autobook/releases/latest) 下载安装包：

- `AutoBook_<ver>_x64-setup.exe`（NSIS，推荐）
- `AutoBook_<ver>_x64_en-US.msi`

首次安装 SmartScreen 提示「未知发布者」，点「更多信息 → 仍要运行」。之后的更新由应用内 updater 静默应用。

## 数据

| 内容 | 位置 |
|---|---|
| 书库 + 高亮 + 文件夹 | IndexedDB |
| 书籍原文件 | `~/Documents/AutoBook/<书名>/` |
| UI 设置、AI key、词典路径 | localStorage |
| Obsidian 同步 / 词典 | 用户选定的目录 |

「重置 UI」只清 localStorage，书 / 高亮 / 笔记 / 文件夹都保留。

## 开发

```sh
npm install
npm run tauri dev
npm run check   # svelte-check
npm run lint    # ESLint
```

## 构建

```sh
# 先设签名 key 才会生成 .sig（updater 需要）
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/`（`nsis/`、`msi/`，含 `.sig`）。发版：推 `v*` tag 后 GitHub Actions 自动构建、签名并上传 `latest.json`。

## License

继承上游 BSD-3-Clause，见 [`LICENSE`](./LICENSE)。
