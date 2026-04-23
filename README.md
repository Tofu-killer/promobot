# PromoBot

PromoBot 现在不是“只有 spec 的空仓库”了。

当前代码库已经包含一个可本地运行的运营控制台原型，前端是 React 19 + Vite，后端是 Express 5，状态落在 SQLite。它覆盖了项目管理、内容生成、草稿流转、发布排程、系统队列、渠道账号健康检查，以及监控 / 收件箱 / 口碑三个运营面板。

## 当前已实现的能力

- 项目管理：`/api/projects` 支持创建、读取、更新项目站点上下文。
- 内容生成：`/api/content/generate` 现在支持为首发可用与人工接管平台一起生成草稿；自动发布仍主要集中在 `x` / `reddit` / `blog`，其余平台走后续人工接管。
- 草稿工作流：`/api/drafts` 支持读取、编辑、送审、排程、发布，状态覆盖 `draft`、`review`、`approved`、`scheduled`、`queued`、`published`、`failed`。
- 发布队列：后端内置 scheduler runtime 和 SQLite job queue，支持 enqueue、tick、reload、retry、cancel。
- 运营数据页：Dashboard、Discovery Pool、Social Inbox、Competitor Monitor、Reputation、Channel Accounts、Settings、System Queue 都有对应页面和 API。
- 渠道账号：可保存账号元数据、检查平台 readiness、手动附加浏览器 session 元数据。

## 当前真实发布行为

- `x`：配置 `X_ACCESS_TOKEN` 或 `X_BEARER_TOKEN` 时会调用 X API；未配置时会返回明确失败，不会再伪造 `published` 结果。
- `reddit`：配置完整 OAuth 环境变量时会调用 Reddit API；未配置时也会返回明确失败，不会再伪造 `published` 结果。
- `facebook-group`：不会自动发帖，只会根据已保存的 session 元数据返回 manual handoff / manual review 合同。
- `weibo`、`xiaohongshu`：现在会像 `facebook-group` 一样基于浏览器 session 返回有状态的 manual handoff 合同；缺 session 时会明确提示 `request_session`，过期时会提示 `relogin`。
- `blog`：现在会把发布内容写入本地 Markdown 文件；默认输出到 `data/blog-posts/`，也可用 `BLOG_PUBLISH_OUTPUT_DIR` 覆盖。

对于 `facebook-group / 小红书 / 微博`，当 session 已就绪时，发布请求现在会额外生成本地 handoff artifact 文件，包含草稿内容、目标、accountKey 和 session 摘要，便于人工接管或外部 browser lane 消费。artifact 会显式维护 `pending / resolved / obsolete` 状态：后续 publish 成功会结单成 `resolved`，session 缺失或过期则会把旧 handoff 标成 `obsolete`。

这意味着当前“成功发布”语义已经比之前更可靠：未配凭证的 `x` / `reddit` 会直接失败；`blog` 会真正落地成可交付的本地文件；`facebook-group`、`weibo`、`xiaohongshu` 也不再是无状态 stub，而是带 session 诊断的 browser handoff 路径。当前可落地发布范围应理解为：`X + Reddit + Blog（本地文件） + Facebook Group / 小红书 / 微博（人工接管）`。

## 数据与运行时

- 默认数据库路径是当前工作目录下的 `data/promobot.sqlite`；从仓库根目录启动或使用 `pm2.config.js` 时，等同于 `<repo>/data/promobot.sqlite`。可用 `PROMOBOT_DB_PATH` 覆盖。
- 浏览器 session 元数据默认保存在数据库目录旁边的 `browser-sessions/`。
- 当 `dist/client/index.html` 存在时，Express 会直接服务构建后的前端文件，并对非 API 路由做 SPA fallback。
- 所有 API 都挂在 IP allowlist 中间件后面。
- allowlist 现在支持“精确 IP 字符串”“CIDR 子网”以及 `*` 全放开；Settings 页保存后会立即影响当前进程的访问控制。
- 服务启动时会自动读取仓库根目录下的 `.env`（如果存在）；已存在的 shell 环境变量优先，不会被 `.env` 覆盖。
- `/api/system/health` 现在会返回 `service`、`timestamp`、`uptimeSeconds`、scheduler 摘要，以及 browser artifact 摘要：`browserArtifacts.laneRequests(total/pending/resolved)` 和 `browserArtifacts.handoffs(total/pending/resolved/obsolete/unmatched)`，便于 PM2 / 运维探活。

## 重要限制

- `ADMIN_PASSWORD` 现在优先通过服务端 session cookie 保护后端 API；前端首次进入时会要求输入管理员密码。默认登录发会话级 `HttpOnly` cookie；如果勾选“记住这台浏览器”，则会改为持久 cookie。管理员 session 现已落到 SQLite，可跨 app 实例与重启继续生效。为了兼容自动化与 CLI，后端当前仍接受 `x-admin-password` 作为 fallback。
- allowlist 现在会从共享 settings 状态读取；共享同一 SQLite 的多个进程在下一次请求时都能看到最新 allowlist。
- `monitor/fetch` 已支持 RSS、V2EX、Reddit search；`inbox/fetch` 与 `reputation/fetch` 现在也会直接基于 settings/source configs 调用 X、Reddit、V2EX 搜索，不再主要依赖 monitor 落库或骨架项。
- `monitor / inbox / reputation` 在生产环境下已禁用 demo / seed 数据回退；没有真实配置或真实信号时会返回空态。
- 浏览器 session 的采集 / relogin 还没接自动化；但 Session 元数据现在既支持继续填写现有 `storageStatePath`，也支持直接导入 storage state JSON 到受管 `browser-sessions/managed/` 目录。
- 手填 `storageStatePath` 时，路径现在必须落在允许的 session 根目录内，并且指向真实存在、结构合法的 Playwright storage state 文件；否则保存会直接失败，不再先写 metadata 再在读取阶段降级。
- 直接导入 `storageState` JSON 时，顶层至少要包含合法的 `cookies` / `origins` 数组；同时传 `storageStatePath` 和 `storageState` 会被拒绝。
- 如果 session metadata 仍在，但底层 storage state 文件已经消失，系统现在会自动把它降级成 `missing / needs_session`，不会继续误报可用。
- 请求登录 / 重新登录现在会额外生成 `artifacts/browser-lane-requests/` 下的接管工单文件，便于外部 browser lane 消费；保存 session 成功后，对应工单也会回写为 `resolved`，并附上 session 摘要。但真正的自动登录流程仍未接入。
- 外部 browser lane 现在也可以把结果写成 `browser_lane_result` artifact，然后调用 `POST /api/system/browser-lane-requests/import` 让服务端自动导入 `storageState`、更新渠道账号 session 元数据，并结掉对应 request artifact。这样第一刀无需内置 Playwright，也不用再手工回填 session 表单。
- 仓库同时提供了 `pnpm browser:lane:submit -- --request-artifact <path> --storage-state-file <path>`，用于从本地 Playwright storage state JSON 生成 `browser_lane_result` artifact；如果再附带 `--base-url` 和 `--admin-password`，会直接把 `requestArtifactPath + storageState` 提交给 importer API，因此 browser lane 不必和服务端共享同一份 result artifact 目录。
- `facebook-group`、`weibo`、`xiaohongshu` 的 browser handoff 现在也有正式完成入口：外部 lane 或人工接管完成后，可调用 `POST /api/system/browser-handoffs/import` 回写 `published/failed` 结果，系统会同步更新草稿状态、publish log 和 handoff artifact。
- 仓库同时提供了 `pnpm browser:handoff:complete -- --artifact-path <path> --status <published|failed>`，用于在本机直接结单 handoff；如果再附带 `--base-url` 和 `--admin-password`，则会走远程 API 导入。
- 仓库同时提供了 `pnpm browser:artifacts:archive -- [--older-than-hours <n>] [--include-results]`，用于把足够旧的已结单 browser artifacts 归档到 `artifacts/archive/`；默认是 dry-run，只有加 `--apply` 才会真正移动文件。
- `System Queue`、`Dashboard`、`Settings`、`Channel Accounts` 现在都能直接看到 browser lane / browser handoff 的最新状态；系统 API 也提供了 `/api/system/browser-handoffs` 只读汇总入口。
- `Drafts` 和 `Review Queue` 在 `manual_required` 时会直接显示 handoff 回执里的 `browserHandoff` 细节，不再只剩一条泛化成功消息。

## 开发与验证

使用 `pnpm`。

```bash
pnpm install
pnpm dev
pnpm dev:server
pnpm test
pnpm browser:artifacts:archive -- --older-than-hours 72
```

- `pnpm dev`：Vite 前端，默认 `0.0.0.0:5173`，并内建 `/api` 代理到 `http://127.0.0.1:3001`；可用 `PROMOBOT_DEV_API_ORIGIN` 覆盖
- `pnpm dev:server`：Express API，默认 `3001`
- `pnpm build`：分别构建到 `dist/client` 和 `dist/server`
- `pnpm start`：启动 `dist/server/index.js`，并在 `dist/client` 存在时直接提供构建后的前端
- GitHub Actions CI：`main` 的 push / pull_request 会运行 `pnpm test` 和 `pnpm build`，用于提前拦截测试与构建回归
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
