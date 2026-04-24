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
- 浏览器 session 元数据默认保存在和 SQLite 文件相邻的 `browser-sessions/`；如果 `PROMOBOT_DB_PATH` 不是普通文件路径（例如 `:memory:`），则会回退到 `<cwd>/data/browser-sessions/`。
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
pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD
pnpm release:bundle -- --output-dir /tmp/promobot-release
pnpm release:verify -- --input-dir /tmp/promobot-release
pnpm runtime:backup
pnpm runtime:restore -- --input-dir /tmp/promobot-backup
pnpm release:local -- --skip-build --output-dir /tmp/promobot-release
pnpm verify:release -- --input-dir /tmp/promobot-release
pnpm deploy:local -- --skip-smoke
pnpm rollback:local -- --backup-dir /tmp/promobot-backup --skip-smoke
pnpm preflight:local -- --skip-smoke
pnpm browser:artifacts:archive -- --older-than-hours 72
```

- `pnpm dev`：Vite 前端，默认 `0.0.0.0:5173`，并内建 `/api` 代理到 `http://127.0.0.1:3001`；可用 `PROMOBOT_DEV_API_ORIGIN` 覆盖
- `pnpm dev:server`：Express API，默认 `3001`
- `pnpm build`：分别构建到 `dist/client` 和 `dist/server`
- `pnpm start`：启动 `dist/server/index.js`，并在 `dist/client` 存在时直接提供构建后的前端
- `pnpm preflight:prod -- [options]`：做静态上线前检查，输出 JSON summary，不启动服务
- `pnpm release:bundle -- --output-dir <path>`：把构建产物、PM2 配置、必要 ops 脚本和部署文档复制到目录型 release bundle，并生成带文件 checksum 信息的 manifest JSON
- `pnpm release:verify -- --input-dir <path>`：校验目录型 release bundle 的 manifest、关键文件是否完整，并在 manifest 带 checksum 时重算 bundle 内现有文件内容做完整性校验；它不负责 tar.gz 下载文件本身的校验
- `pnpm runtime:backup`：把当前可定位的 SQLite 文件来源、真实运行时 `browser-sessions/` 根目录和仓库根 `.env` 复制到时间戳备份目录，并生成 manifest JSON；若有缺失项，会在 manifest 里标记并以非零退出码返回
- `pnpm runtime:restore -- --input-dir <backupDir>`：按 backup manifest 恢复运行时数据，并在覆盖前为已有目标创建 `.pre-restore-<timestamp>` 备份
- `pnpm release:local -- [options]`：先按需执行 `pnpm build`，再调用 `release:bundle` 生成目录型可交付发布物
- `pnpm release:deploy -- [options]`：调用 `ops/deploy-release.sh`，用于从已打好的 release bundle 根目录直接部署；这和 `deploy:local` 的源码仓库部署不是同一条链路
- `pnpm verify:release -- --input-dir <path>`：调用 shell wrapper 执行 `release:verify`，用于交付前检查 release bundle
- `pnpm deploy:local -- [options]`：执行本机部署链路，封装 `pnpm install`、`pnpm build`、PM2 reload/start 和可选 smoke check
- `pnpm rollback:local -- --backup-dir <path> [options]`：先停 PM2、从已有 runtime backup 恢复数据，再按恢复后的环境重启服务，并按需追加 smoke check
- `pnpm preflight:local -- [options]`：先跑 `preflight:prod`，再按需追加 `smoke:server`
- GitHub Actions CI：`main` 的 push / pull_request 会运行 `pnpm test` 和 `pnpm build`，用于提前拦截测试与构建回归
- GitHub Actions `Release Bundle`：支持手动触发和 `v*` tag push，都会执行 `pnpm test`、`pnpm build`、静态 preflight、release bundle 生成与校验；其中手动 `workflow_dispatch` 主要产出可下载的 Actions artifact，`v*` tag push 会在保留 Actions artifact 的同时追加 GitHub Release asset，并基于压缩包、`.sha256`、`.metadata.json` 自动生成 GitHub Release body，也就是 Release 页面自带的 download / verify 说明。要注意，`Release body` 只是给人读的页面说明，不等于页面下方真正可下载的 GitHub Release asset；workflow 真正附着的是压缩包、`.sha256` 和 `.metadata.json`。如果走 GitHub Release asset 下载链路，`promobot-release-bundle.tar.gz.metadata.json` 的定位就是给下载方 / 自动化方消费的机器可读说明，用来描述这次 `Release Bundle` 产物及校验入口；它不替代 tar.gz 的 sidecar，也不替代解压后的 `manifest.json` 校验
- 生产访问时，浏览器可直接走同一个 Node 进程访问页面和 `/api`

更完整的本地开发、构建、LAN 访问、环境变量和限制说明见 `docs/DEPLOYMENT.md`。

## Release Bundle 直接部署

- `pnpm deploy:local` / `ops/deploy-promobot.sh` 面向“目标机上已有源码 checkout”的部署：脚本会在源码仓库里执行 install / build / PM2 切换。
- `pnpm release:deploy` / `ops/deploy-release.sh` 面向“目标机只拿到目录型 release bundle”的部署：bundle 会随产物带上 deploy 脚本，解压后直接在 bundle 根目录执行即可。
- 新生成的 bundle manifest 会记录 bundle 内文件 checksum；`pnpm release:verify` / `pnpm verify:release` 会在文件存在时重算并比对，不匹配会返回失败。旧 manifest 没有 checksum 时，仍按原来的目录结构校验处理。
- GitHub Release 上和 `promobot-release-bundle.tar.gz` 配套的 sidecar 只用于 tar.gz 下载完整性校验；这一步发生在解压前，和 bundle 内 `manifest.json` 的文件 checksum 校验不是一回事。
- GitHub Release 上和 `promobot-release-bundle.tar.gz` 配套的 `promobot-release-bundle.tar.gz.metadata.json` 是机器可读说明，帮助下载方 / 自动化方识别 bundle、archive 和 sidecar 的关系；它不替代 tar.gz sidecar，也不替代解压后对 `manifest.json` 以及 `pnpm release:verify` / `pnpm verify:release` 的 bundle 校验。
- 正式 `v*` tag push 生成的 GitHub Release 页面会自带一段 download / verify 说明；这段内容由 `Release Bundle` workflow 写进 `Release body`，会列出 `promobot-release-bundle.tar.gz`、`.sha256`、`.metadata.json` 和推荐的校验顺序。真正要下载和核对的仍是页面下方这些 GitHub Release asset，以及解压后 bundle 里的 `manifest.json`。
- 推荐顺序是先在构建机生成并校验 bundle，再把 bundle 目录传到目标机部署。
- 如果不想在本地手动打包，也可以直接用 GitHub Actions `Release Bundle` workflow 取包：手动 `workflow_dispatch` 下载的是 Actions artifact，里面同时带 bundle 目录、压缩包、`.sha256` 和 `.metadata.json`；正式 `v*` tag push 会在保留 Actions artifact 的同时，把压缩包、`.sha256` 和 `.metadata.json` 挂到 GitHub Release asset。两者对应的是同一份已校验的 release bundle 内容，只是挂载位置和消费场景不同；如果拿的是 GitHub Release asset，先用配套 sidecar 校验 `promobot-release-bundle.tar.gz` 的下载完整性，再用 `.metadata.json` 核对资产信息，之后再解压并走后面的 `verify -> deploy -> smoke` 流程。

```bash
pnpm release:local -- --output-dir /tmp/promobot-release
pnpm verify:release -- --input-dir /tmp/promobot-release

# 先把 /tmp/promobot-release 复制到目标机
cd /tmp/promobot-release
pnpm release:deploy
```

## 最终交付 / 验收流程

最终交付建议把记录统一按 `preflight -> build/release bundle -> verify -> deploy -> smoke` 五段收口。要注意：当前 `pnpm preflight:prod` / `pnpm preflight:local` 都会检查 `dist/server/index.js` 和 `dist/client/index.html`，所以实际执行时需要先拿到构建产物；下面的命令清单按“可直接执行”的最少顺序给出。

### 1. 源码仓库部署

适用场景：目标机保留源码 checkout，直接在仓库根目录部署。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD
pnpm test
pnpm deploy:local -- --skip-install --skip-smoke
pnpm smoke:server -- --base-url http://127.0.0.1:3001
```

### 2. Release bundle 直接部署

适用场景：构建机先产出目录型 release bundle，目标机只拿 bundle 目录上线。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD
pnpm release:bundle -- --output-dir /tmp/promobot-release
pnpm verify:release -- --input-dir /tmp/promobot-release

# 先把 /tmp/promobot-release 复制到目标机
cd /tmp/promobot-release
pnpm release:deploy -- --skip-smoke
node dist/server/cli/deploymentSmoke.js --base-url http://127.0.0.1:3001
```

## 生产运维补充

- `pm2.config.js` 现在会把日志落到仓库下的 `logs/`，并带基本重启/退避配置。
- `ops/release-promobot.sh` 现在提供一条本地 release 打包脚本；它会先按需构建，再调用 `release:bundle` 生成可交付目录。
- `ops/deploy-release.sh` 现在提供 bundle 内直接部署入口；进入 release bundle 根目录后可直接运行 `pnpm release:deploy`。
- `ops/verify-release.sh` 现在提供 release 校验脚本；它会先跑 `release:verify`，只在显式开启时才追加 smoke。
- `ops/preflight-promobot.sh` 现在提供上线前预检脚本；它会先跑 `preflight:prod`，再按需追加 smoke check。
- `ops/deploy-promobot.sh` 现在提供一条可重复的本机部署脚本；默认会执行 install/build/PM2 切换，并默认启用 smoke check。脚本会优先读取 `--admin-password`，否则回退到 shell 里的 `PROMOBOT_ADMIN_PASSWORD` / `ADMIN_PASSWORD`，以及仓库根 `.env` 里的 `PROMOBOT_ADMIN_PASSWORD` / `ADMIN_PASSWORD`；如不想跑 smoke，可显式传 `--skip-smoke`。
- `ops/rollback-promobot.sh` 现在提供对应的本机回滚脚本；它会先停 PM2，再调用 `runtime:restore` 恢复运行时数据，最后重启服务并可选追加 smoke check。需要保留当前 `.env` 时，可给 rollback 传 `--skip-env`。
- 仓库提供 `ops/logrotate.promobot.conf` 作为 Linux `logrotate` 样例；使用前把其中的 `REPO_ROOT` 替换成实际仓库绝对路径。
- 仓库提供 `pnpm runtime:backup` / `pnpm runtime:restore`，可以先做本机快照，再按 manifest 恢复运行时状态。
- 详细步骤见 `docs/DEPLOYMENT.md`。

## 设计参考

- `docs/superpowers/specs/2026-04-19-promobot-design.md`
- `docs/superpowers/plans/2026-04-19-promobot-full-platform.md`
