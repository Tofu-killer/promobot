# PromoBot

PromoBot 现在不是“只有 spec 的空仓库”了。

当前代码库已经包含一个可本地运行的运营控制台原型，前端是 React 19 + Vite，后端是 Express 5，状态落在 SQLite。它覆盖了项目管理、内容生成、草稿流转、发布排程、系统队列、渠道账号健康检查，以及监控 / 收件箱 / 口碑三个运营面板。

## 当前已实现的能力

- 项目管理：`/api/projects` 支持创建、读取、更新项目站点上下文。
- 内容生成：`/api/content/generate` 现在支持为首发可用与人工接管平台一起生成草稿；自动发布仍主要集中在 `x` / `reddit` / `blog`，`instagram` / `tiktok` / `facebook-group` / `xiaohongshu` / `weibo` 走后续人工接管。
- 草稿工作流：`/api/drafts` 支持读取、编辑、送审、排程、发布，状态覆盖 `draft`、`review`、`approved`、`scheduled`、`queued`、`published`、`failed`。
- 发布队列：后端内置 scheduler runtime 和 SQLite job queue，支持 enqueue、tick、reload、retry、cancel。
- 运营数据页：Dashboard、Discovery Pool、Social Inbox、Competitor Monitor、Reputation、Channel Accounts、Settings、System Queue 都有对应页面和 API。
- 渠道账号：可保存账号元数据、检查平台 readiness、手动附加浏览器 session 元数据。

## 当前真实发布行为

- `x`：配置 `X_ACCESS_TOKEN` 或 `X_BEARER_TOKEN` 时会调用 X API；未配置时会返回明确失败，不会再伪造 `published` 结果。
- `reddit`：配置完整 OAuth 环境变量时会调用 Reddit API；未配置时也会返回明确失败，不会再伪造 `published` 结果。
- `facebook-group`：不会自动发帖，只会根据已保存的 session 元数据返回 manual handoff / manual review 合同。
- `instagram`、`tiktok`、`weibo`、`xiaohongshu`：现在会像 `facebook-group` 一样基于浏览器 session 返回有状态的 manual handoff 合同；缺 session 时会明确提示 `request_session`，过期时会提示 `relogin`。
- `blog`：现在支持 `BLOG_PUBLISH_DRIVER=file|wordpress|ghost`。默认 `file` 会把发布内容写入本地 Markdown 文件，默认输出到 `data/blog-posts/`，也可用 `BLOG_PUBLISH_OUTPUT_DIR` 覆盖；切到 `wordpress` 时会调用站点 `/wp-json/wp/v2/posts`，需要同时配置 `BLOG_WORDPRESS_SITE_URL`、`BLOG_WORDPRESS_USERNAME`、`BLOG_WORDPRESS_APP_PASSWORD`；切到 `ghost` 时会调用 Ghost Admin API，需要配置 `BLOG_GHOST_ADMIN_URL`、`BLOG_GHOST_ADMIN_API_KEY`，其中 Admin URL 会自动规范到 `/ghost`。

对于 `facebook-group / instagram / tiktok / 小红书 / 微博`，当 session 已就绪时，发布请求现在会额外生成本地 handoff artifact 文件，包含草稿内容、目标、accountKey 和 session 摘要，便于人工接管或外部 browser lane 消费。artifact 会显式维护 `pending / resolved / obsolete` 状态：后续 publish 成功会结单成 `resolved`，session 缺失或过期则会把旧 handoff 标成 `obsolete`。

`Social Inbox` 的 reply handoff 也沿用同一套 browser/manual 合同：`POST /api/inbox/:id/send-reply` 现在会明确区分 `sent / manual_required / failed`。其中 `manual_required` 不会把会话误记为 `handled`；如果后端返回 `details.browserReplyHandoff`，前端会直接展示 `readiness`、`sessionAction` 和 handoff artifact 路径，便于人工接管或外部 browser lane 继续消费。缺 session 时会看到 `request_session`，session 过期时会看到 `relogin`，而且只有真正 `sent` 的 reply 才会回写 `handled`。

这意味着当前“成功发布”语义已经比之前更可靠：未配凭证的 `x` / `reddit` 会直接失败；`blog` 现在会按 `file / wordpress / ghost` 三种 driver 真正落地到本地文件或 CMS，driver 不受支持、或 WordPress / Ghost 凭证不完整时也会直接失败，不再伪造成功；`facebook-group`、`instagram`、`tiktok`、`weibo`、`xiaohongshu` 也不再是无状态 stub，而是带 session 诊断的 browser handoff 路径。当前可落地发布范围应理解为：`X + Reddit + Blog（本地文件 / WordPress / Ghost） + Facebook Group / Instagram / TikTok / 小红书 / 微博（人工接管）`。

## 数据与运行时

- 默认数据库路径是当前工作目录下的 `data/promobot.sqlite`；从仓库根目录启动或使用 `pm2.config.js` 时，等同于 `<repo>/data/promobot.sqlite`。可用 `PROMOBOT_DB_PATH` 覆盖。
- 浏览器 session 元数据默认保存在和 SQLite 文件相邻的 `browser-sessions/`；如果 `PROMOBOT_DB_PATH` 不是普通文件路径（例如 `:memory:`），则会回退到 `<cwd>/data/browser-sessions/`。
- 当 `dist/client/index.html` 存在时，Express 会直接服务构建后的前端文件，并对非 API 路由做 SPA fallback。
- 所有 API 都挂在 IP allowlist 中间件后面。
- allowlist 现在支持“精确 IP 字符串”“CIDR 子网”以及 `*` 全放开；Settings 页保存后会立即影响当前进程的访问控制。
- 服务启动时会自动读取仓库根目录下的 `.env`（如果存在）；已存在的 shell 环境变量优先，不会被 `.env` 覆盖。
- `/api/system/health` 现在会返回 `service`、`timestamp`、`uptimeSeconds`、scheduler 摘要，以及 browser artifact 摘要：`browserArtifacts.laneRequests(total/pending/resolved)`、`browserArtifacts.handoffs(total/pending/resolved/obsolete/unmatched)` 和 `browserArtifacts.inboxReplyHandoffs(total/pending/resolved/obsolete)`，便于 PM2 / 运维探活。

## 重要限制

- `ADMIN_PASSWORD` 现在优先通过服务端 session cookie 保护后端 API；前端首次进入时会要求输入管理员密码。默认登录发会话级 `HttpOnly` cookie；如果勾选“记住这台浏览器”，则会改为持久 cookie。管理员 session 现已落到 SQLite，可跨 app 实例与重启继续生效。为了兼容自动化与 CLI，后端当前仍接受 `x-admin-password` 作为 fallback。
- allowlist 现在会从共享 settings 状态读取；共享同一 SQLite 的多个进程在下一次请求时都能看到最新 allowlist。
- `monitor/fetch` 已支持 RSS、V2EX、Reddit search，以及 Instagram / TikTok profile source configs；这两类 `profile+instagram` / `profile+tiktok` source config 的 `configJson` 现在也支持附带 `channelAccountId` / `accountKey`（兼容 `channelAccountKey`），抓到的 monitor item 会把这些 routing metadata 连同 `sourceUrl` / `profileUrl` / `profileHandle` 一起持久化，并在后续 `inbox/fetch -> send-reply` 链路里继续使用；`inbox/fetch` 与 `reputation/fetch` 现在也会直接基于 settings/source configs 调用 X、Reddit、V2EX 搜索，不再主要依赖 monitor 落库或骨架项。
- `Competitor Monitor` 的来源筛选现在也覆盖 `instagram`、`tiktok`、`xiaohongshu`、`weibo`、`v2ex`；`generate-follow-up` 除了 `x` / `reddit` 外，也支持 `instagram`、`tiktok`、`xiaohongshu`、`weibo` 这些已接入发布链路的社媒来源直接落草稿，`v2ex` 仍只作为监控来源筛选。
- `monitor / inbox / reputation` 在生产环境下已禁用 demo / seed 数据回退；没有真实配置或真实信号时会返回空态。
- `blog` 发布驱动不是自动探测的：未显式配置 `BLOG_PUBLISH_DRIVER` 时默认仍走 `file`；如果切到 `wordpress` 或 `ghost`，需要随部署一起补齐对应 CMS 凭证，否则 Settings / Channel Accounts 会把 `blog` readiness 标成 `needs_config`，实际发布也会直接失败。
- 浏览器 session 的采集 / relogin 还没接自动化；但 Session 元数据现在既支持继续填写现有 `storageStatePath`，也支持直接导入 storage state JSON 到受管 `browser-sessions/managed/` 目录。
- 手填 `storageStatePath` 时，路径现在必须落在允许的 session 根目录内，并且指向真实存在、结构合法的 Playwright storage state 文件；否则保存会直接失败，不再先写 metadata 再在读取阶段降级。
- 直接导入 `storageState` JSON 时，顶层至少要包含合法的 `cookies` / `origins` 数组；同时传 `storageStatePath` 和 `storageState` 会被拒绝。
- 如果 session metadata 仍在，但底层 storage state 文件已经消失，系统现在会自动把它降级成 `missing / needs_session`，不会继续误报可用。
- 请求登录 / 重新登录现在会额外生成 `artifacts/browser-lane-requests/` 下的接管工单文件，便于外部 browser lane 消费；同一渠道账号同一动作若已有未结单工单，后续请求会直接复用现有工单而不再重复排队。保存 session 成功后，对应工单会回写为 `resolved`，并附上 session 摘要。`System Queue` 里的 Browser Lane 工单区也支持直接粘贴 `storageState` JSON 并调用 importer API 结单，但真正的自动登录流程仍未接入。
- 外部 browser lane 现在也可以把结果写成 `browser_lane_result` artifact，然后调用 `POST /api/system/browser-lane-requests/import` 让服务端自动导入 `storageState`、更新渠道账号 session 元数据，并结掉对应 request artifact。这样第一刀无需内置 Playwright，也不用再手工回填 session 表单。
- 仓库同时提供了 `pnpm browser:lane:submit -- --request-artifact <path> --storage-state-file <path>`，用于从本地 Playwright storage state JSON 生成 `browser_lane_result` artifact；如果再附带 `--base-url` 和 `--admin-password`，会直接把 `requestArtifactPath + storageState` 提交给 importer API，因此 browser lane 不必和服务端共享同一份 result artifact 目录。
- 如果想把 `request_session`、publish handoff、reply handoff 三类 dispatch 都收敛到一个入口，仓库现在也提供了 `pnpm browser:lane:bridge`。它直接消费 `browserLaneDispatch` 注入的 `PROMOBOT_BROWSER_DISPATCH_KIND` / `PROMOBOT_BROWSER_ARTIFACT_PATH` 等 env，并按类型转调现有 submitter；外部 runner 只需要补上对应结果 env，例如 session request 可以显式传 `PROMOBOT_BROWSER_STORAGE_STATE_FILE`，也可以直接复用 dispatch 注入的 `PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH`。后者是 Promobot 自己维护的 canonical managed session 相对路径，bridge 会按当前数据根目录把它解析到真实文件。publish handoff 用 `PROMOBOT_BROWSER_PUBLISH_STATUS`，reply handoff 用 `PROMOBOT_BROWSER_REPLY_STATUS`。
- 如果只是想在源码 checkout 里把 `session_request` dispatch 直接回环到现有 importer / submitter，也可以显式打开 `PROMOBOT_BROWSER_LOCAL_AUTORUN=1`。在没有单独配置 `PROMOBOT_BROWSER_LANE_COMMAND` 时，session request 会自动回退到 `pnpm browser:lane:local`；如果需要换成别的本地包装命令，可改配 `PROMOBOT_BROWSER_LOCAL_RUNNER_COMMAND`。这个 local runner 只是复用当前受管 session 文件和既有 submitter / handoff 完成契约，不等于仓库已经内置了真正的 Playwright 登录 / 发布 / 回复自动化。它只会为 `session_request` 自动补默认结果 env；若手工调用它去处理 publish handoff 或 reply handoff，仍必须显式提供 `PROMOBOT_BROWSER_PUBLISH_STATUS` 或 `PROMOBOT_BROWSER_REPLY_STATUS`，避免误结单。
- 如果 browser lane 命令是在 artifact 已经生成之后才补上的，或者之前因为没有配置 worker / 本地 autorun 而留下了 `ready` 的未结单 artifact，现在可以用 `pnpm browser:lane:reconcile` 显式补偿。默认是 dry-run；加 `--apply` 才会重新 dispatch 这些 `session_request`、publish handoff、reply handoff，并按需补回缺失的 poll job。
- `facebook-group`、`instagram`、`tiktok`、`weibo`、`xiaohongshu` 的 browser handoff 现在也有正式完成入口：外部 lane 或人工接管完成后，可调用 `POST /api/system/browser-handoffs/import` 回写 `published/failed` 结果，系统会同步更新草稿状态、publish log 和 handoff artifact。
- 仓库同时提供了 `pnpm browser:handoff:complete -- --artifact-path <path> --status <published|failed>`，用于在本机直接结单 handoff；如果再附带 `--base-url` 和 `--admin-password`，则会走远程 API 导入。
- `Social Inbox` 的 reply handoff 也有同级完成入口：外部 lane 或人工接管完成回复后，可调用 `POST /api/system/inbox-reply-handoffs/import` 回写 `sent/failed` 结果，系统会同步更新 inbox item 状态和 handoff artifact；源码 checkout 场景可用 `pnpm inbox:reply:handoff:complete -- --artifact-path <path> --status <sent|failed>` 直接结单，bundle-only 场景则用 `node dist/server/cli/inboxReplyHandoffComplete.js --artifact-path <path> --status <sent|failed>`，两者都支持附带 `--message`、`--delivery-url`、`--external-id`、`--delivered-at`，再加 `--base-url` 和 `--admin-password` 时会改走远程 API。
- 仓库同时提供了 `pnpm browser:artifacts:archive -- [--older-than-hours <n>] [--include-results]`，用于把足够旧的已结单 browser artifacts 归档到 `artifacts/archive/`；当前归档范围同时覆盖 browser lane request/result、browser handoff 和 inbox reply handoff。默认是 dry-run，只有加 `--apply` 才会真正移动文件。
- `System Queue` 与 `Settings` 现在会直接展示 browser lane / browser handoff / inbox reply handoff 的最新工单状态与 resolution 摘要；`Dashboard` 提供总量与 pending 汇总，`Channel Accounts` 则展示当前渠道账号上的 session 元数据。其中 `System Queue` 还能直接导入 browser lane request 的 `storageState` JSON 并结掉工单。系统 API 也提供了 `/api/system/browser-lane-requests`、`/api/system/browser-handoffs` 与 `/api/system/inbox-reply-handoffs` 只读汇总入口，`/api/system/health` 里的 `browserArtifacts` 还会额外带上 `inboxReplyHandoffs(total/pending/resolved/obsolete)`。
- `Drafts` 在 `manual_required` 时现在不只展示 `browserHandoff` 细节；当 publish contract 能唯一解析到对应 `channelAccountId` 时，还支持直接发起 `request_session / relogin`，并可把 browser handoff inline 结单成 `published / failed`。`Review Queue` 会同步展示同一套 handoff 回执细节。

## 开发与验证

使用 `pnpm`。

```bash
pnpm install
pnpm dev
pnpm dev:server
pnpm test
pnpm build
pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD
pnpm release:bundle -- --output-dir /tmp/promobot-release
pnpm release:verify -- --input-dir /tmp/promobot-release
pnpm runtime:backup
pnpm runtime:restore -- --input-dir /tmp/promobot-backup
pnpm release:local -- --skip-build --output-dir /tmp/promobot-release
pnpm verify:release -- --input-dir /tmp/promobot-release
pnpm deploy:local -- --skip-smoke
pnpm rollback:local -- --backup-dir /tmp/promobot-backup --skip-smoke
pnpm preflight:local -- --require-env AI_API_KEY,ADMIN_PASSWORD --skip-smoke
pnpm browser:lane:bridge -- --help
pnpm browser:lane:local -- --help
pnpm browser:lane:reconcile -- --help
pnpm inbox:reply:handoff:complete -- --help
node dist/server/cli/inboxReplyHandoffComplete.js --help
pnpm browser:artifacts:archive -- --older-than-hours 72
```

- `pnpm dev`：Vite 前端，默认 `0.0.0.0:5173`，并内建 `/api` 代理到 `http://127.0.0.1:3001`；可用 `PROMOBOT_DEV_API_ORIGIN` 覆盖
- `pnpm dev:server`：Express API，默认 `3001`
- `pnpm build`：分别构建到 `dist/client` 和 `dist/server`
- `pnpm start`：启动 `dist/server/index.js`，并在 `dist/client` 存在时直接提供构建后的前端
- `pnpm preflight:prod -- [options]`：做静态上线前检查，输出 JSON summary，不启动服务
- `pnpm release:bundle -- --output-dir <path>`：把构建产物、PM2 配置、必要 ops 脚本和部署文档复制到目录型 release bundle，并生成带文件 checksum 信息的 manifest JSON
- `pnpm release:verify -- --input-dir <path>`：源码仓库里的目录型 release bundle 校验入口，校验 manifest、关键文件是否完整，并在 manifest 带 checksum 时重算 bundle 内现有文件内容做完整性校验；它不负责 tar.gz 下载文件本身的校验
- `pnpm runtime:backup`：把当前可定位的 SQLite 文件来源、真实运行时 `browser-sessions/` 根目录和仓库根 `.env` 复制到时间戳备份目录，并生成 manifest JSON；若有缺失项，会在 manifest 里标记并以非零退出码返回。自定义 `--output-dir` 时，目标目录必须不存在或为空
- `pnpm runtime:restore -- --input-dir <backupDir>`：按 backup manifest 恢复运行时数据，并在覆盖前为已有目标创建 `.pre-restore-<timestamp>` 备份
- `pnpm release:local -- [options]`：先按需执行 `pnpm build`，再调用 `release:bundle` 生成目录型可交付发布物
- `pnpm release:deploy -- [options]`：调用 `ops/deploy-release.sh`，用于从已打好的 release bundle 根目录直接部署；这和 `deploy:local` 的源码仓库部署不是同一条链路
- `pnpm verify:release -- --input-dir <path>`：调用 shell wrapper 校验目录型 release bundle；在源码仓库里会转到 `release:verify`，在已解压的 bundle 根目录里会改用 bundle 自带的 compiled verifier
- `pnpm verify:downloaded-release -- --archive-file <path>`：调用仓库内的 `ops/verify-downloaded-release.sh`；正式 GitHub Release 页面现在会额外挂出同内容的 standalone `verify-downloaded-release.sh` helper，下载方即使不 checkout 仓库，也可以只拿 `archive + .sha256 + .metadata.json + helper` 在本机跑同一条校验链。两者都会先校验已下载的 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar，再把解压目录交给 bundle 自带的 `releaseVerify` CLI
- `pnpm deploy:local -- [options]`：执行本机部署链路，封装 `pnpm install`、`pnpm build`、PM2 reload/start 和可选 smoke check
- `pnpm rollback:local -- --backup-dir <path> [options]`：先停 PM2、从已有 runtime backup 恢复数据，再按恢复后的环境重启服务，并按需追加 smoke check
- `pnpm preflight:local -- [options]`：先跑 `preflight:prod`，并把 `--require-env` 这类 prod preflight 参数透传过去，再按需追加 smoke check
- GitHub Actions `CI`：`main` 的 push / pull_request 现在会先跑 `lint` job，通过 `rhysd/actionlint@v1.7.12` 校验 workflow，并用 `bash -n ops/*.sh` 检查 ops shell wrapper 语法；`lint` 和 `ci` 两个 job 都显式收敛到 `permissions: contents: read`；随后 `ci` job 继续运行 `pnpm test`、`pnpm build`，并追加一轮目录型 release bundle smoke：基于已构建的 `dist/server/cli/releaseBundle.js` 产出 bundle，再调用 bundle 自带的 `ops/verify-release.sh` 校验，用于提前拦截 workflow / shell wrapper 语法、测试、构建以及 release bundle 交付链回归
- GitHub Actions `Release Bundle`：支持手动触发和 `v*` tag push；默认都会执行 `pnpm test`、`pnpm build`、静态 preflight、release bundle 生成与校验。
- 手动 preview run（`workflow_dispatch`）主要产出可下载的 Actions artifact，不额外承诺发布 `release asset`，也不会新建或更新 GitHub Release；因此它不会影响 `prerelease` 状态，`.metadata.json` metadata sidecar 里的 `release_url` 也应为 `null`。
- 手动 preview run（`workflow_dispatch`）可选传 `skip_tests=true`，作为只用于加速手动 preview 包的自担风险选项：默认仍会执行 `pnpm test`；只有这条手动 preview 入口能跳过，`v*` tag push 这条 tag release 入口不受影响，仍会执行测试。它只影响打包前是否执行 `pnpm test`，不会改变已生成 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar、bundle 内 `manifest.json` 和后续校验链语义。
- `prerelease` 状态只和 `v*` tag push 这条 tag release 有关。当前 workflow 会按 tag 名本身自动判定是否为 semver 预发布：像 `v1.2.3-rc.1`、`v1.2.3-beta.1` 这类会写成 `prerelease=true`，`v1.2.3` 这类正式版 tag 仍保持 `false`。这个判定不从 `asset_suffix`、`release body` 或 `summary` 推导。
- 手动 preview run（`workflow_dispatch`）可选传 `asset_suffix` 作为 preview suffix，只用于区分这次手动预览包命名：会影响 Actions artifact 名称，以及其中 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar 的命名；允许字符为 `1-32` 个小写字母、数字、`.`、`_`、`-`，并且必须以字母或数字开头和结尾。workflow run 页面的 `summary` 会直接列出这组带 preview suffix 的最终派生命名。它不会改变 bundle 内 `manifest.json` 的语义，也不会改变 `prerelease` 状态。
- workflow run 页面里的 `summary` 只是 Actions run 页面内的结果摘要，用来帮助定位这次 `Release Bundle` run 产出的 bundle、archive、`.sha256` sidecar、`.metadata.json` metadata sidecar 和解压后 `manifest.json` 的关系；对手动 preview run，它会显示带 preview suffix 的最终派生命名；对 tag release（`v*` tag push），它会显示带 tag 版本号的最终派生命名，并把下一步指向 GitHub Release 页面。它不是 `release asset`，也不替代 `release body`。
- `.metadata.json` metadata sidecar 的新增字段里，`schema_version` 记录这份 metadata sidecar 自身的 schema 版本，只用于让下载方 / 自动化方按对应 schema 解析 sidecar，不表示 release 版本、tag 版本，也不替代 bundle 内 `manifest.json` 的结构版本；`checksum_algorithm` 记录这条 archive 下载链路配套 checksum sidecar 使用的算法，当前和 `.sha256` sidecar 一起描述 archive 的 `sha256` 校验，不描述解压后 bundle 内文件的 checksum 规则；`archive_format` 记录这次 release asset 下载链路里 archive 的封装格式，当前对应版本化 `tar.gz` archive，不描述解压后的 bundle 目录格式。`artifact_name` 记录这组文件在 Actions run 里的 artifact 容器名，`event_name` 记录触发这次 workflow 的事件来源，例如 `workflow_dispatch` 或 `push`，`prerelease` 记录对应 GitHub Release 页面是否应标成 prerelease 的布尔状态；新增的 `generated_at` 记录这份 metadata sidecar 由 workflow 写出的时间戳，`run_url` 记录这次 workflow run 页面的链接，`release_url` 只在 `v*` tag push 这条 tag release 时记录对应 GitHub Release 页面的链接，手动 preview run（`workflow_dispatch`）则固定为 `null`；新增的 `tests_summary` 只描述这次 metadata sidecar 对应产物在 workflow 里如何执行 `pnpm test`，并固定写成三种状态之一：手动 preview run 显式传 `skip_tests=true` 时为 `skipped via manual workflow_dispatch input`，手动 preview run 没传或保持默认时为 `executed (default manual behavior)`，`v*` tag push 的 tag release 时为 `executed (required for tag release)`。它们和 sidecar 里的有序 asset 列表一样，都是给下载方 / 自动化方消费的机器可读发布上下文：有序 asset 列表表达的是 asset 清单顺序，按 workflow 对外提供下载与校验的顺序列出 `archive -> .sha256 sidecar -> .metadata.json metadata sidecar`，便于稳定展示、核对和串接后续步骤；其中 `schema_version` 只是 metadata sidecar 自身的 schema 版本，`checksum_algorithm` 只是 archive 下载链路的 checksum 算法，`archive_format` 只是 archive 下载链路的封装格式，`run_url` 只是 workflow run 页面链接，`release_url` 只是 GitHub Release 页面链接，`tests_summary` 只是 metadata sidecar 里的机器可读测试执行状态；这些内容都不等于 `release body`、workflow run `summary`，也不替代 workflow run 页面里给人读的 `summary` 或解压后 bundle 内的 `manifest.json`。
- 正式 `v*` tag push 会在保留 Actions artifact 的同时追加 `release asset`，并基于对应的 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar 自动生成 `release body`，也就是 Release 页面自带的 download / verify 说明；现在这段给人读的页面说明也会顺带写出 `prerelease` 和 `tests_summary` 对应的测试执行状态语义，方便人工核对。
- 这个手动 preview suffix（`asset_suffix`）不参与 tag release 这组 `release asset` 的版本化命名；tag release 文件名仍会带版本号，避免多版本下载时混淆，配套 sidecar 和 metadata sidecar 也会沿用同一个版本化 archive 名。workflow 还会把同一 ref 的 run 串行化，并给构建 / 发布 job 加超时保护，避免并发运行或卡死 runner 时互相踩资产。
- 要注意，`release body` 只是给人读的页面说明，不等于页面下方真正可下载的 `release asset`；workflow 真正附着的是 archive、checksum sidecar 和 metadata sidecar。即使 `release body` 现在会显示 `prerelease` 和测试执行状态语义，机器可读发布上下文仍以 `.metadata.json` metadata sidecar 里的 `prerelease`、`tests_summary` 等字段为准，它不替代 metadata sidecar。
- `release asset` 下载链路里的 `.metadata.json` metadata sidecar 仍是给下载方 / 自动化方消费的机器可读说明，用来描述这次 `Release Bundle` 产物及校验入口，并区分 `schema_version`、`checksum_algorithm`、`archive_format`、`run_url`、`release_url`、`tests_summary` 这些发布上下文字段；它不替代 tar.gz 的 sidecar，也不替代 workflow run 页面里给人读的 `summary`，更不替代解压后的 `manifest.json` 校验
- 生产访问时，浏览器可直接走同一个 Node 进程访问页面和 `/api`

更完整的本地开发、构建、LAN 访问、环境变量和限制说明见 `docs/DEPLOYMENT.md`。

## Release Bundle 直接部署

- `pnpm deploy:local` / `ops/deploy-promobot.sh` 面向“目标机上已有源码 checkout”的部署：脚本会在源码仓库里执行 install / build / PM2 切换。
- `pnpm release:deploy` / `ops/deploy-release.sh` 面向“目标机只拿到目录型 release bundle”的部署：bundle 会随产物带上 deploy 脚本，解压后直接在 bundle 根目录执行即可。
- 新生成的 bundle manifest 会记录 bundle 内文件 checksum；`pnpm release:verify`（源码仓库入口）和 `pnpm verify:release`（源码仓库或已解压 bundle 根目录入口）都会在文件存在时重算并比对，不匹配会返回失败。旧 manifest 没有 checksum 时，仍按原来的目录结构校验处理。
- GitHub Release 上和版本化 release archive 配套的 `.sha256` sidecar 只用于 tar.gz 下载完整性校验；这一步发生在解压前，和 bundle 内 `manifest.json` 的文件 checksum 校验不是一回事。
- GitHub Release 上与该版本化 archive 同名派生的 `.metadata.json` sidecar 是机器可读说明，帮助下载方 / 自动化方识别 bundle、archive 和 sidecar 的关系；它不替代 tar.gz sidecar，也不替代解压后对 `manifest.json` 以及 `pnpm verify:release` 的 bundle 校验。只有在源码仓库里手动复核 bundle 时，才需要直接调用 `pnpm release:verify`。
- `pnpm verify:downloaded-release` / `ops/verify-downloaded-release.sh` 则把“已下载 archive -> sidecar 校验 -> 解压 -> 目录校验”串成一条本地入口；正式 GitHub Release 页面现在会额外分发 standalone `verify-downloaded-release.sh` helper，它是同一份 helper 的 release 资产形态，方便下载方在没有源码 checkout 时直接运行。无论是仓库内的 `pnpm` 入口还是 release 页面分发的 helper，都会先校验 `.sha256` 和 `.metadata.json` 是否与 archive 对得上，再把解压目录交给 bundle 自带的 `dist/server/cli/releaseVerify.js`，因此不会再造第四套目录校验规则。
- 正式 `v*` tag push 生成的 GitHub Release 页面会自带一段 download / verify 说明；这段内容由 `Release Bundle` workflow 写进 `release body`，会列出该 tag 对应的版本化 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar、额外分发的 standalone `verify-downloaded-release.sh` helper，以及推荐的校验顺序，也会把该 tag 的 `prerelease` 和 `tests_summary` 对应的测试执行状态写成给人读的页面说明。真正要下载和核对的仍是页面下方这些 `release asset`，以及解压后 bundle 里的 `manifest.json`。
- 这里的 `prerelease` 只指 GitHub Release 页面上的 prerelease 状态，不影响 `release asset` 文件名，也不是从 `release body` 文案或 workflow run 页面里的 `summary` 反推。当前 workflow 会根据 tag 名自动设置它：带 semver 预发布后缀的 tag 会标成 `prerelease`，正式版 tag 不会；`release body` 现在只是把这个既有状态和对应测试执行状态以给人读的方式显示出来。
- `.metadata.json` metadata sidecar 里的 `schema_version`、`checksum_algorithm`、`archive_format`、`artifact_name`、`event_name`、`prerelease`、`generated_at`、`run_url`、`release_url`、`tests_summary` 和有序 asset 列表也应按同一层级理解：`schema_version` 对应 metadata sidecar 自身的 schema 版本，`checksum_algorithm` 对应 archive 下载链路的 checksum 算法，`archive_format` 对应 archive 下载链路的封装格式，`artifact_name` 对应 Actions artifact 下载入口，`event_name` 对应 workflow 触发来源，`prerelease` 对应 GitHub Release 状态，`generated_at` 对应 metadata sidecar 的生成时间，`run_url` 对应这次 workflow run 页面链接，`release_url` 对应 GitHub Release 页面链接，但只有 tag release 时有值、手动 preview run 为 `null`，`tests_summary` 对应这次产物的测试执行状态，并且只会是 `skipped via manual workflow_dispatch input`、`executed (default manual behavior)`、`executed (required for tag release)` 三种固定字符串之一，有序 asset 列表对应下载方 / 自动化方消费的 asset 清单顺序。这里这些字段只说明 metadata sidecar 的发布上下文，以及 `archive -> .sha256 sidecar -> .metadata.json metadata sidecar` 这组文件该按什么顺序识别与消费，不是 `release body` 文案，不是 workflow run `summary` 摘要，也不替代 workflow run 页面里给人读的 `summary`，更不是 bundle 内 `manifest.json` 的内容摘要。
- 推荐顺序是先在构建机生成并校验 bundle，再把 bundle 目录传到目标机部署。
- 如果不想在本地手动打包，也可以直接用 GitHub Actions `Release Bundle` workflow 取包：手动 preview run（`workflow_dispatch`）下载的是 Actions artifact，里面同时带 bundle 目录、archive、`.sha256` sidecar 和 `.metadata.json` metadata sidecar；如果这次手动 preview run 额外传了 `asset_suffix` 作为 preview suffix，那么 workflow run 页面的 `summary` 里也会直接显示这组带 preview suffix 的最终派生命名，包括 Actions artifact 名称。正式 tag release（`v*` tag push）会在保留 Actions artifact 的同时，把同一组版本化 `release asset` 挂到 Release 页面；对应的 workflow run `summary` 会显示带 tag 版本号的最终派生命名。两者对应的是同一套 release bundle 交付格式与校验链语义；即使手动 preview run 选择了 `skip_tests=true`，已生成 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar 和 bundle 内 `manifest.json` 的消费方式也不变，只是挂载位置和消费场景不同；如果拿的是 `release asset`，先用配套 sidecar 校验对应版本化 archive 的下载完整性，再用 `.metadata.json` 核对 `schema_version`、`checksum_algorithm`、`archive_format`、`run_url`、`release_url`、`tests_summary` 和资产信息，之后再解压并走后面的 `verify -> deploy -> smoke` 流程。

```bash
pnpm verify:downloaded-release -- --archive-file /tmp/promobot-release-bundle-v1.2.3.tar.gz
```

```bash
bash ./verify-downloaded-release.sh --archive-file /tmp/promobot-release-bundle-v1.2.3.tar.gz
```

```bash
pnpm release:local -- --output-dir /tmp/promobot-release
pnpm verify:release -- --input-dir /tmp/promobot-release

# 先把 /tmp/promobot-release 复制到目标机
cd /tmp/promobot-release
pnpm release:deploy
```

## 最终交付 / 验收流程

最终交付建议把记录统一按 `build -> preflight -> verify -> deploy -> smoke` 五段收口。如果走 release bundle 交付，则在 `preflight` 和 `verify` 之间补一段 `release bundle`。要注意：当前 `pnpm preflight:prod` / `pnpm preflight:local` 都会检查 `dist/server/index.js` 和 `dist/client/index.html`，所以实际执行时需要先拿到构建产物；下面的命令清单按“可直接执行”的最少顺序给出。

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
- `ops/verify-release.sh` 现在提供 release 校验脚本；在源码仓库里会先跑 `release:verify`，在已解压 bundle 根目录里会改用 bundled `releaseVerify.js`，并且只会在校验成功后、且显式开启时才追加 smoke。
- `ops/preflight-promobot.sh` 现在提供上线前预检脚本；它会先跑 `preflight:prod`，再按需追加 smoke check。
- `ops/deploy-promobot.sh` 现在提供一条可重复的本机部署脚本；默认会执行 install/build/PM2 切换，并默认启用 smoke check。脚本会优先读取 `--admin-password`，否则回退到 shell 里的 `PROMOBOT_ADMIN_PASSWORD` / `ADMIN_PASSWORD`，以及仓库根 `.env` 里的 `PROMOBOT_ADMIN_PASSWORD` / `ADMIN_PASSWORD`；如不想跑 smoke，可显式传 `--skip-smoke`。
- `ops/rollback-promobot.sh` 现在提供对应的本机回滚脚本；它会先停 PM2，再调用 `runtime:restore` 恢复运行时数据，最后重启服务并可选追加 smoke check。需要保留当前 `.env` 时，可给 rollback 传 `--skip-env`。
- 仓库提供 `ops/logrotate.promobot.conf` 作为 Linux `logrotate` 样例；使用前把其中的 `REPO_ROOT` 替换成实际仓库绝对路径。
- 仓库提供 `pnpm runtime:backup` / `pnpm runtime:restore`，可以先做本机快照，再按 manifest 恢复运行时状态。
- 详细步骤见 `docs/DEPLOYMENT.md`。

## 设计参考

- `docs/superpowers/specs/2026-04-19-promobot-design.md`
- `docs/superpowers/plans/2026-04-19-promobot-full-platform.md`
