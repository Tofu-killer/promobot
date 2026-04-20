# PromoBot

PromoBot 现在不是“只有 spec 的空仓库”了。

当前代码库已经包含一个可本地运行的运营控制台原型，前端是 React 19 + Vite，后端是 Express 5，状态落在 SQLite。它覆盖了项目管理、内容生成、草稿流转、发布排程、系统队列、渠道账号健康检查，以及监控 / 收件箱 / 口碑三个运营面板。

## 当前已实现的能力

- 项目管理：`/api/projects` 支持创建、读取、更新项目站点上下文。
- 内容生成：`/api/content/generate` 仍支持多平台草稿生成，但当前前端首发默认只把 `x` / `reddit` 作为可直接操作平台，其它平台走人工接管或暂缓首发语义。
- 草稿工作流：`/api/drafts` 支持读取、编辑、送审、排程、发布，状态覆盖 `draft`、`review`、`approved`、`scheduled`、`queued`、`published`、`failed`。
- 发布队列：后端内置 scheduler runtime 和 SQLite job queue，支持 enqueue、tick、reload、retry、cancel。
- 运营数据页：Dashboard、Discovery Pool、Social Inbox、Competitor Monitor、Reputation、Channel Accounts、Settings、System Queue 都有对应页面和 API。
- 渠道账号：可保存账号元数据、检查平台 readiness、手动附加浏览器 session 元数据。

## 当前真实发布行为

- `x`：配置 `X_ACCESS_TOKEN` 或 `X_BEARER_TOKEN` 时会调用 X API；未配置时会返回明确失败，不会再伪造 `published` 结果。
- `reddit`：配置完整 OAuth 环境变量时会调用 Reddit API；未配置时也会返回明确失败，不会再伪造 `published` 结果。
- `facebook-group`：不会自动发帖，只会根据已保存的 session 元数据返回 manual handoff / manual review 合同。
- `weibo`、`xiaohongshu`：目前只有 `manual_required` 的 stub 发布器。
- `blog`：目前只有 manual stub，没有真实博客平台集成。

这意味着当前“成功发布”语义已经比之前更可靠：未配凭证的 `x` / `reddit` 会直接失败；但 `facebook-group`、`weibo`、`xiaohongshu`、`blog` 仍主要停留在 manual / handoff 路径。当前首发运营范围应理解为：`X + Reddit + Facebook Group（人工接管）`。

## 数据与运行时

- 默认数据库路径是当前工作目录下的 `data/promobot.sqlite`；从仓库根目录启动或使用 `pm2.config.js` 时，等同于 `<repo>/data/promobot.sqlite`。可用 `PROMOBOT_DB_PATH` 覆盖。
- 浏览器 session 元数据默认保存在数据库目录旁边的 `browser-sessions/`。
- 当 `dist/client/index.html` 存在时，Express 会直接服务构建后的前端文件，并对非 API 路由做 SPA fallback。
- 所有 API 都挂在 IP allowlist 中间件后面。
- 当前 allowlist 只做“精确 IP 字符串匹配”或 `*` 全放开，不支持 CIDR 子网计算。
- `/api/system/health` 现在会返回 `service`、`timestamp`、`uptimeSeconds` 和 scheduler 摘要，便于 PM2 / 运维探活。

## 重要限制

- 开发模式下，Vite dev server 仍然没有内建 `/api` proxy；要在 `pnpm dev` 场景里跑通完整浏览器链路，仍需要额外同源代理或你自己的反向代理。
- `ADMIN_PASSWORD` 现在通过 `x-admin-password` 请求头接入后端 API；前端首次进入时会要求输入管理员密码，并保存在浏览器本地存储中用于后续请求。
- Settings 页里保存的 `allowlist` 会写进 SQLite，但不会更新已经启动的 Express IP 中间件；真正生效的还是进程启动时读取的 `ALLOWED_IPS`。
- `monitor/fetch` 已支持 RSS、V2EX、Reddit search；`inbox/fetch` 与 `reputation/fetch` 会优先消费已落库的 monitor 信号，再退回 monitor 查询配置生成骨架项，尚未形成各自独立的实时抓取器。
- `monitor / inbox / reputation` 在生产环境下已禁用 demo / seed 数据回退；没有真实配置或真实信号时会返回空态。
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

## 生产运维补充

- `pm2.config.js` 现在会把日志落到仓库下的 `logs/`，并带基本重启/退避配置。
- 仓库提供 `ops/logrotate.promobot.conf` 作为 Linux `logrotate` 样例；使用前把其中的 `REPO_ROOT` 替换成实际仓库绝对路径。
- SQLite 备份/迁移时，不只复制 `promobot.sqlite`，还要连同数据库目录旁边的 `browser-sessions/` 一起迁走。
- 详细步骤见 `docs/DEPLOYMENT.md`。

## 设计参考

- `docs/superpowers/specs/2026-04-19-promobot-design.md`
- `docs/superpowers/plans/2026-04-19-promobot-full-platform.md`
