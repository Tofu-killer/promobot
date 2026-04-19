# PromoBot

PromoBot 现在不是“只有 spec 的空仓库”了。

当前代码库已经包含一个可本地运行的运营控制台原型，前端是 React 19 + Vite，后端是 Express 5，状态落在 SQLite。它覆盖了项目管理、内容生成、草稿流转、发布排程、系统队列、渠道账号健康检查，以及监控 / 收件箱 / 口碑三个运营面板。

## 当前已实现的能力

- 项目管理：`/api/projects` 支持创建、读取、更新项目站点上下文。
- 内容生成：`/api/content/generate` 可为 `blog`、`facebook-group`、`reddit`、`weibo`、`x`、`xiaohongshu` 生成草稿，可选择直接写入草稿库。
- 草稿工作流：`/api/drafts` 支持读取、编辑、送审、排程、发布，状态覆盖 `draft`、`review`、`approved`、`scheduled`、`queued`、`published`、`failed`。
- 发布队列：后端内置 scheduler runtime 和 SQLite job queue，支持 enqueue、tick、reload、retry、cancel。
- 运营数据页：Dashboard、Discovery Pool、Social Inbox、Competitor Monitor、Reputation、Channel Accounts、Settings、System Queue 都有对应页面和 API。
- 渠道账号：可保存账号元数据、检查平台 readiness、手动附加浏览器 session 元数据。

## 当前真实发布行为

- `x`：配置 `X_ACCESS_TOKEN` 或 `X_BEARER_TOKEN` 时会调用 X API；未配置时会退回 stub publisher，返回“成功发布”的占位结果。
- `reddit`：配置完整 OAuth 环境变量时会调用 Reddit API；未配置时也会退回 stub publisher，返回占位结果。
- `facebook-group`：不会自动发帖，只会根据已保存的 session 元数据返回 manual handoff / manual review 合同。
- `weibo`、`xiaohongshu`：目前只有 `manual_required` 的 stub 发布器。
- `blog`：目前只有 manual stub，没有真实博客平台集成。

这意味着“发布成功”并不总是代表已经打到真实平台，尤其是未配凭证的 `x` / `reddit` 和所有 stub / manual 平台。

## 数据与运行时

- 默认数据库路径是当前工作目录下的 `data/promobot.sqlite`；从仓库根目录启动或使用 `pm2.config.js` 时，等同于 `<repo>/data/promobot.sqlite`。可用 `PROMOBOT_DB_PATH` 覆盖。
- 浏览器 session 元数据默认保存在数据库目录旁边的 `browser-sessions/`。
- 当 `dist/client/index.html` 存在时，Express 会直接服务构建后的前端文件，并对非 API 路由做 SPA fallback。
- 所有 API 都挂在 IP allowlist 中间件后面。
- 当前 allowlist 只做“精确 IP 字符串匹配”或 `*` 全放开，不支持 CIDR 子网计算。

## 重要限制

- 开发模式下，Vite dev server 仍然没有内建 `/api` proxy；要在 `pnpm dev` 场景里跑通完整浏览器链路，仍需要额外同源代理或你自己的反向代理。
- `ADMIN_PASSWORD` 目前只是配置项，实际请求链路没有启用登录认证。
- Settings 页里保存的 `allowlist` 会写进 SQLite，但不会更新已经启动的 Express IP 中间件；真正生效的还是进程启动时读取的 `ALLOWED_IPS`。
- Inbox / Monitor / Reputation 的 `fetch` 目前写入的是本地 seed 数据，不是实时抓取外部平台。
- 浏览器 session 的采集 / relogin 还没接自动化，只能手动登记 storage state 路径和状态元数据。
- `.env.example` 只是参考文件，当前脚本不会自动加载 `.env`，`pm2.config.js` 也只会继承启动它的 shell 环境。

## 开发与验证

使用 `pnpm`。

```bash
pnpm install
pnpm dev
pnpm dev:server
pnpm test
```

- `pnpm dev`：Vite 前端，默认 `0.0.0.0:5173`
- `pnpm dev:server`：Express API，默认 `3001`
- `pnpm build`：分别构建到 `dist/client` 和 `dist/server`
- `pnpm start`：启动 `dist/server/index.js`，并在 `dist/client` 存在时直接提供构建后的前端
- 生产访问时，浏览器可直接走同一个 Node 进程访问页面和 `/api`

更完整的本地开发、构建、LAN 访问、环境变量和限制说明见 `docs/DEPLOYMENT.md`。

## 设计参考

- `docs/superpowers/specs/2026-04-19-promobot-design.md`
- `docs/superpowers/plans/2026-04-19-promobot-full-platform.md`
