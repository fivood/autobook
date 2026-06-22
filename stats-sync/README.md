# autobook-stats-sync

Cloudflare Worker + KV 端点，跨设备同步 AutoBook 阅读时长统计。

## 模型

- 用户每个设备生成一段 device-id（uuid）。
- 用户拥有一段 token（32 hex 字符），桌面端先生成、手机端粘进去。
- KV 一个 key（= token）存一个 JSON：
  ```jsonc
  {
    "v": 1,
    "books": {
      "三体": {
        "2026-06-22": {
          "clients": { "desktop-uuid": 1800, "phone-uuid": 600 },
          "updatedAt": 1719093600000
        }
      }
    }
  }
  ```
- 合并规则：服务端按 device-id 取 max。客户端每次推自己"当天累计"，服务端记下每个设备贡献的最大值。日合计 = `sum(clients.values())`，因此两设备非并发使用会正确累加。
- token 即认证。泄露 → 用户自己换 token，旧数据成孤儿。

## 接口

```
GET  /health                       → { ok: true }
GET  /sync?token=<32hex>           → 完整状态 JSON
POST /sync?token=<32hex>           Body: { books: { [title]: { [date]: { clients } } } }
                                   → 合并后的完整状态
OPTIONS *                          → CORS 预检
```

CORS：`*` 开放（统计数据非隐私敏感，且 token 即认证）。

## 开发

```sh
cd stats-sync
npm install
npx wrangler kv namespace create STATS         # 创建生产 KV
npx wrangler kv namespace create STATS --preview  # 可选，dev 用
# 把输出的 id / preview_id 填进 wrangler.toml
npm run dev                                    # 本地 http://127.0.0.1:8787
```

## 部署

```sh
npm run deploy
```

Cloudflare Dashboard → 部署后的 Worker → **Triggers** → **Custom domains** 加 `sync.fivood.com`，自动配 DNS。

## 容量预估

- 一个 user 假设每天读 5 本书 × 365 天 × 100 字节/entry ≈ **180 KB/年**。
- KV 单值上限 25 MB，本 worker 自己再限 2 MB → 几十年用不爆。
- 免费额度：10 万次读/天、1 千次写/天、1 GB 存储。客户端默认 30 秒一推、每天读几次 → 单用户写 ~2 千次/天（在免费额度内已经够 1–2 个用户；如果上 10+ 用户建议把推送节流到 60s+）。
