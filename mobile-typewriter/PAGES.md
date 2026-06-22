# Cloudflare Pages 部署设置

把 GitHub 仓库 `fivood/autobook` 接到 Cloudflare Pages，用以下配置：

| 字段 | 值 |
|---|---|
| **Production branch** | `main` |
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

CI 触发：每次 push 到 `main` 自动构建部署。
