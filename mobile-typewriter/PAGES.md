# Cloudflare Pages 部署设置

把 GitHub 仓库 `fivood/autobook` 接到 Cloudflare Pages，用以下配置：

| 字段 | 值 |
|---|---|
| **Production branch** | `release/1.6.0` |
| **Root directory** | `mobile-typewriter` |
| **Build command** | `npm install && npm run build` |
| **Build output directory** | `build` |
| **Node version** | `20` |
| **环境变量** | 无 |

Custom domain 加 `book.fivood.com`。Cloudflare DNS 已托管 `fivood.com`，会自动给你提示加一条 CNAME。

部署后：
- 主站：`https://book.fivood.com/`
- PWA 可在 iOS Safari「分享 → 添加到主屏幕」装为 standalone app
- service worker 缓存全部静态资源，离线可用

CI 触发：每次 push 到 `release/1.6.0` 自动构建部署。

> 历史背景：原配置盯 `main`，但桌面端 AutoBook 走 `release/1.6.0` 直接开发，main 上的 merge commit 历史跟 release 已经 DAG 分叉无法 fast-forward。统一改盯 `release/1.6.0` 后桌面 + 移动一条流水线，每次桌面 tag 发版顺带 push 移动 PWA 部署。
