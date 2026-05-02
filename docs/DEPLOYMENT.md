# PromoBot 部署说明

## 适用范围

本文只描述当前仓库已经实现的部署方式。

当前真实状态：

- `pnpm build` 会生成 `dist/server/` 和 `dist/client/`
- `pnpm start` 与 `pm2.config.js` 都启动同一个 Node 进程：`dist/server/index.js`
- 当 `dist/client/index.html` 存在时，Express 会直接提供构建后的前端文件
- 非 API 的无扩展名路由会回退到前端 `index.html`
- `/api/*` 仍然优先走后端 API 路由，不会被前端 fallback 吞掉
- 持久化使用 SQLite
- scheduler runtime 运行在同一个 Node 进程内

这意味着当前仓库已经支持“单进程提供 API + 已构建前端”的生产启动形态。

## 前置条件

- Node.js 22+
- `pnpm`
- 仓库目录写权限

## 环境变量

`.env.example` 只是模板文件。

当前服务启动时会自动读取仓库根目录下的 `.env`（如果存在）。
已存在的 shell 环境变量优先，不会被 `.env` 覆盖，所以你仍然可以用 shell 覆盖局部配置。

如果你想从模板起步：

```bash
cp .env.example .env
```

关键行为如下：

- `PORT`
  - 服务监听端口，默认 `3001`
- `ALLOWED_IPS`
  - 逗号分隔的精确 IP 或 CIDR 子网
  - 支持 `*` 全放开
  - 中间件会把 `::ffff:1.2.3.4` 规范化为 `1.2.3.4`
  - Settings 页保存后会立即影响当前进程的访问控制
- `ADMIN_PASSWORD`
  - 进程启动时会读取
  - 在 `NODE_ENV=production` 下，若仍是默认值 `change-me`，服务会拒绝启动
  - 除 `/api/system/health` 外，其它 `/api/*` 请求都需要通过管理员鉴权
  - 当前前端登录成功后会得到 `HttpOnly` session cookie；默认是会话级 cookie，勾选“记住这台浏览器”后会改为持久 cookie
  - 管理员 session 现已持久化到 SQLite，可跨 app 实例与进程重启继续生效；`/api/auth/logout` 会全局撤销当前 session
  - 如果你轮换 `ADMIN_PASSWORD`，旧的管理员 session 会自动失效，不需要再手动清理 cookie
  - 为兼容自动化与 CLI，后端当前仍接受 `x-admin-password` 作为 fallback，但浏览器主路径已不再保存明文密码
- `PROMOBOT_DB_PATH`
  - 默认是 `<cwd>/data/promobot.sqlite`
  - 用仓库根目录启动或使用 `pm2.config.js` 时，默认值等同于 `<repo>/data/promobot.sqlite`
  - 浏览器 session 元数据默认会落在和 SQLite 文件相邻的 `browser-sessions/`
  - 如果 `PROMOBOT_DB_PATH` 不是普通文件路径（例如 `:memory:`），session 根目录会回退到 `<cwd>/data/browser-sessions/`
  - 通过 Channel Accounts 保存 browser session 时，直接导入的 storage state JSON 会写到 `browser-sessions/managed/<platform>/`
  - 手填 `storageStatePath` 时，该路径必须落在允许的 session 根目录内，并且指向真实存在、结构合法的 Playwright storage state 文件
  - `storageStatePath` 和 `storageState` 只能二选一；直接导入 JSON 时，至少要包含 `cookies` / `origins` 数组
  - 如果 metadata 指向的 storage state 文件已不存在，Channel Accounts / Settings / platform readiness 会把该 session 视为 `missing`
  - 请求登录 / 重新登录动作会在仓库下的 `artifacts/browser-lane-requests/<platform>/<account>/` 生成工单 JSON；同一渠道账号同一动作若已有未结单工单，后续请求会直接复用现有工单而不再重复排队
  - 当新的 session 元数据保存成功后，匹配的 browser lane request 工单会被回写为 `resolved`，并附带 session 摘要
  - 也可以先把 browser lane 结果写成同目录下的 `*.result.json`，再调用 `POST /api/system/browser-lane-requests/import` 让服务端自动导入 session
  - `POST /api/system/browser-lane-requests/import` 现在既支持旧的 `{ artifactPath }`，也支持直接提交 `{ requestArtifactPath, storageState, sessionStatus?, validatedAt?, notes?, completedAt? }`
  - 仓库内置 `pnpm browser:lane:submit -- --request-artifact <path> --storage-state-file <path>`；默认只生成本地 `browser_lane_result` artifact，若同时提供 `--base-url` 和 `--admin-password`，会把 inline `storageState` 直接提交给 importer API，因此不再要求和服务端共享 result artifact 目录
  - 若想把三类 browser lane dispatch 统一交给同一个外部 worker，可直接把 `PROMOBOT_BROWSER_LANE_COMMAND` 指向 `pnpm browser:lane:bridge`。该入口会读取 `PROMOBOT_BROWSER_DISPATCH_KIND` / `PROMOBOT_BROWSER_ARTIFACT_PATH` 等 dispatch env，并按类型要求补充结果 env：session request 可以显式传 `PROMOBOT_BROWSER_STORAGE_STATE_FILE`，也可以直接复用 dispatch 注入的 `PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH`；这个 managed path 是 Promobot 自己维护的 canonical session 相对路径，bridge 会按当前数据根目录解析到真实文件。publish handoff 用 `PROMOBOT_BROWSER_PUBLISH_STATUS`，reply handoff 用 `PROMOBOT_BROWSER_REPLY_STATUS`
  - 如果只是想在源码 checkout 里把现有 `session_request` dispatch 默认回环到本机 submitter，可设置 `PROMOBOT_BROWSER_LOCAL_AUTORUN=1`，且不单独配置 `PROMOBOT_BROWSER_LANE_COMMAND`。此时只有 session request 会自动回退到 `pnpm browser:lane:local`；如需替换包装命令，可改配 `PROMOBOT_BROWSER_LOCAL_RUNNER_COMMAND`。这个 local runner 只会基于当前 managed session 文件和既有 importer / handoff 完成契约调用 `browser:lane:bridge`，不等于仓库已经内置了真正的 Playwright 自动登录、自动发布或自动回复；其中 publish handoff / reply handoff 若手工走 `browser:lane:local`，仍必须显式提供 `PROMOBOT_BROWSER_PUBLISH_STATUS` / `PROMOBOT_BROWSER_REPLY_STATUS`，避免误结单
  - 如果 browser lane 命令是在 artifact 生成之后才补上，或者之前没有 worker / local autorun 导致留下了 `ready` 的未结单 artifact，可执行 `pnpm browser:lane:reconcile` 做显式补偿。默认只做 dry-run；加 `--apply` 后会重发 stranded 的 `session_request`、publish handoff、reply handoff，并且只在对应 poll job 缺失时补回一条
  - browser manual handoff artifact 会落在 `artifacts/browser-handoffs/<platform>/<account>/`，并维护 `pending / resolved / obsolete` 状态
  - 外部 browser lane 或人工接管完成发布后，可调用 `POST /api/system/browser-handoffs/import` 回写 `published/failed` 结果，系统会同步更新 draft、publish log 和 handoff artifact
  - 仓库内置 `pnpm browser:handoff:complete -- --artifact-path <path> --status <published|failed>`；默认直接在本机导入 handoff 完成结果，若同时提供 `--base-url` 和 `--admin-password`，则会走远程 API
  - inbox reply handoff artifact 会落在 `artifacts/inbox-reply-handoffs/<platform>/<account>/`，并维护 `pending / resolved / obsolete` 状态
  - 外部 browser lane 或人工接管完成回复后，可调用 `POST /api/system/inbox-reply-handoffs/import` 回写 `sent/failed` 结果；只有 `sent` 会把 inbox item 回写为 `handled`
  - 仓库内置 `pnpm inbox:reply:handoff:complete -- --artifact-path <path> --status <sent|failed>`；默认直接在源码仓库内导入 inbox reply handoff 完成结果。若只拿 release bundle，则改用 `node dist/server/cli/inboxReplyHandoffComplete.js --artifact-path <path> --status <sent|failed>`；两条入口都支持 `--message`、`--delivery-url`、`--external-id`、`--delivered-at`，同时提供 `--base-url` 和 `--admin-password` 时会走远程 API
  - 仓库内置 `pnpm browser:artifacts:archive -- [--older-than-hours <n>] [--include-results]`；默认只做 dry-run，输出机器可读 JSON summary；加 `--apply` 后会把足够旧的已结单 artifact 移到 `artifacts/archive/browser-lane-requests/`、`artifacts/archive/browser-handoffs/` 或 `artifacts/archive/inbox-reply-handoffs/`
  - `/api/system/health` 会汇总 `browserArtifacts.laneRequests`、`browserArtifacts.handoffs` 和 `browserArtifacts.inboxReplyHandoffs`
  - 控制台中的 `System Queue` / `Settings` / `Dashboard` / `Channel Accounts` 都会直接消费这些工单与 handoff 状态；`Channel Accounts` 还会返回 `latestInboxReplyHandoffArtifact`
- `AI_BASE_URL` / `AI_API_KEY`
  - 对服务启动本身可选
  - 对 AI 草稿生成、Inbox 回复建议等功能必需
- `AI_MODEL`
  - 可选
  - 未配置时默认 `gpt-4o-mini`
- `BLOG_PUBLISH_DRIVER`
  - 可选
  - 支持 `file`、`wordpress`、`ghost`
  - 未配置时默认 `file`
  - `file` 会把 blog 内容写到本地 Markdown；`wordpress` 和 `ghost` 会直接调用对应 CMS API
- `BLOG_PUBLISH_OUTPUT_DIR`
  - 可选
  - 只在 `BLOG_PUBLISH_DRIVER=file` 时生效
  - 控制 blog 发布时 Markdown 文件的输出目录
  - 未配置时默认 `<cwd>/data/blog-posts`
- `BLOG_WORDPRESS_SITE_URL` / `BLOG_WORDPRESS_USERNAME` / `BLOG_WORDPRESS_APP_PASSWORD`
  - 仅在 `BLOG_PUBLISH_DRIVER=wordpress` 时需要
  - 3 项需要一起配置；缺任意一项时，blog readiness 会显示 `needs_config`，实际发布也会直接失败
  - 发布时会调用 `<site-url>/wp-json/wp/v2/posts`
  - `BLOG_WORDPRESS_SITE_URL` 末尾如果带 `/` 会在运行时自动去掉
- `BLOG_GHOST_ADMIN_URL` / `BLOG_GHOST_ADMIN_API_KEY`
  - 仅在 `BLOG_PUBLISH_DRIVER=ghost` 时需要
  - 2 项需要一起配置；缺项或 API key 格式非法时，blog readiness 会显示 `needs_config`，实际发布也会直接失败
  - 发布时会调用 `<admin-url>/api/admin/posts/?source=html`
  - `BLOG_GHOST_ADMIN_URL` 可以写站点根地址，也可以直接写 `/ghost`；运行时会自动规范成以 `/ghost` 结尾的 Admin URL
  - `BLOG_GHOST_ADMIN_API_KEY` 需要使用 Ghost Admin API key 的 `<id>:<secret hex>` 格式
- `BROWSER_HANDOFF_OUTPUT_DIR`
  - 可选
  - 控制 browser manual handoff 与 inbox reply handoff artifact 的输出目录
  - 未配置时默认使用仓库 / 部署根目录
- `X_ACCESS_TOKEN` / `X_BEARER_TOKEN`
  - 任一存在时，`x` publisher 才会尝试真实 API
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USERNAME` / `REDDIT_PASSWORD`
  - 4 项齐全时，`reddit` publisher 才会尝试真实 API
- `REDDIT_USER_AGENT`
  - 可选
  - 未配置时默认 `promobot/0.1`
- `PROMOBOT_DEV_API_ORIGIN`
  - 可选
  - 控制 `pnpm dev` 时 Vite `/api` 代理的后端目标
  - 未配置时默认 `http://127.0.0.1:3001`

## 安装

```bash
pnpm install
```

## 开发模式

开发模式仍然建议前后端分开跑：

```bash
pnpm dev
pnpm dev:server
```

含义：

- `pnpm dev`
  - 启动 Vite 前端开发服务器，默认 `0.0.0.0:5173`
- `pnpm dev:server`
  - 启动 Express API，默认 `3001`

注意：

- 开发模式下 Vite 已内建 `/api` proxy
- 默认代理目标是 `http://127.0.0.1:3001`
- 如果你的后端不在默认端口，可通过 `PROMOBOT_DEV_API_ORIGIN` 覆盖，例如：

```bash
PROMOBOT_DEV_API_ORIGIN=http://127.0.0.1:4001 pnpm dev
```

## 构建

```bash
pnpm build
```

输出：

- `dist/server/`
- `dist/client/`

## 直接运行

```bash
pnpm start
```

真实行为：

```bash
node dist/server/index.js
```

`dist/server/index.js` 启动时同样会尝试读取仓库根目录 `.env`。

## 两种部署入口

当前仓库同时支持两条部署链路，使用前先区分清楚：

- `pnpm deploy:local` / `ops/deploy-promobot.sh`
  - 面向“目标机上已有源码仓库 checkout”的部署
  - 脚本会在源码目录里执行 install / build / PM2 reload 或 start / 可选 smoke
- `pnpm release:deploy` / `ops/deploy-release.sh`
  - 面向“目标机只拿到目录型 release bundle”的部署
  - 该入口依赖 `release:bundle` / `release:local` 产出的 bundle 内容；bundle 自带 `package.json`、`dist/**`、`pm2.config.js`、部署文档和 `ops/deploy-release.sh`
  - bundle 解压后应在 bundle 根目录执行，而不是回到源码仓库里再跑一遍源码部署脚本

如果你要在本机执行一条可重复的部署链路，而不是手动敲 install/build/pm2/smoke，可以直接运行：

```bash
pnpm deploy:local -- --base-url http://127.0.0.1:3001
```

脚本位置：`ops/deploy-promobot.sh`

支持的常用参数：

- `--skip-install`
- `--skip-smoke`
- `--base-url <url>`
- `--admin-password <secret>`

默认 smoke 会优先读取：

1. `--admin-password`
2. `PROMOBOT_ADMIN_PASSWORD`
3. `ADMIN_PASSWORD`
4. 仓库根 `.env` 里的 `PROMOBOT_ADMIN_PASSWORD`
5. 仓库根 `.env` 里的 `ADMIN_PASSWORD`

如果只是想先做静态预检，不想马上 deploy，可运行：

```bash
pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD
```

它会检查：

- `package.json`
- `pm2.config.js`
- `dist/server/index.js`
- `dist/client/index.html`
- 可选 `.env`
- 你通过 `--require-env` 指定的 env keys

输出是机器可读 JSON summary，不会启动服务。

如果你还想顺手追加一次 smoke，而不是手动再敲第二条命令，可运行：

```bash
pnpm preflight:local -- --require-env AI_API_KEY,ADMIN_PASSWORD --skip-smoke
```

脚本位置：`ops/preflight-promobot.sh`

它会先调用 `preflight:prod`，所以也支持把 `--require-env` 这类 prod preflight 参数透传过去，再按需追加 smoke check。

如果你需要一份可分发的目录型发布物，而不是直接拿源码目录上线，可运行：

```bash
pnpm release:bundle -- --output-dir /tmp/promobot-release
```

或者让 shell wrapper 先按需 build 再打包：

```bash
pnpm release:local -- --skip-build --output-dir /tmp/promobot-release
```

release bundle 当前会包含以下 bundle-safe 文件：

- `dist/server/**`
- `dist/client/**`
- `package.json`
- `pnpm-lock.yaml`
- `pm2.config.js`
- `ops/deploy-promobot.sh`
- `ops/deploy-release.sh`
- `ops/preflight-promobot.sh`
- `ops/rollback-promobot.sh`
- `ops/verify-downloaded-release.sh`
- `ops/verify-release.sh`
- `docs/DEPLOYMENT.md`
- `.env.example`

仓库侧的 `ops/release-promobot.sh` 只用于源码目录本地打包，不会随 release bundle 分发。

其中 `ops/preflight-promobot.sh` 和 `ops/rollback-promobot.sh` 虽然也是 shell wrapper，但它们在已解压的 bundle 根目录里不再回退到源码仓库专用的 `pnpm preflight:prod` / `pnpm runtime:restore`。为了保证这两条链路在 bundle-only 场景下仍然可执行，bundle manifest 现在会强制锁定 `dist/server/cli/preflightPromobot.js`、`dist/server/cli/runtimeRestore.js`，并与 `dist/server/cli/deploymentSmoke.js` 一起作为 wrapper 的 bundle-local compiled 入口。

输出目录下会同时生成 `manifest.json`，其中会记录 bundle 文件列表和可用的 checksum，便于交付前核对缺失项和完整性。这份 manifest 只描述解压后的目录型 release bundle 内容，不负责 GitHub Release 上 `.tar.gz` 下载文件本身的完整性校验。

交付前可以再做一次 release 目录校验：

```bash
pnpm release:verify -- --input-dir /tmp/promobot-release
```

如果 manifest 带 checksum，`release:verify` 会对 bundle 内现存文件重新计算并比对；只要有缺失项或 checksum 不匹配，summary 就会返回失败并带相应 warning。旧 bundle 的 manifest 如果还没有 checksum 字段，则继续按目录结构和 manifest 记录做兼容校验。

如果你更偏向 shell wrapper：

```bash
pnpm verify:release -- --input-dir /tmp/promobot-release
```

`verify:release` 默认只做目录结构和 manifest 校验，不会启动服务；在源码仓库里它会转到 `pnpm release:verify`，在已解压的 bundle 根目录里则会改用 bundle 自带的 compiled verifier。只有显式开启 smoke 时，才会在校验成功后追加 `smoke:server`。如果显式加 `--smoke`，当前 checkout 或已解压 bundle 根目录里还必须存在对应的 smoke CLI：源码仓库要有 `src/server/cli/deploymentSmoke.ts`，bundle 根目录要有 `dist/server/cli/deploymentSmoke.js`；缺少对应入口时 wrapper 会直接失败。

如果你拿到的是下载后的 archive，而不是已经解压好的目录型 bundle，可直接用：

```bash
pnpm verify:downloaded-release -- --archive-file /tmp/promobot-release-bundle-v1.2.3.tar.gz
```

这个入口会先校验 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar，再把解压出来的目录交给 bundle 自带的 `dist/server/cli/releaseVerify.js`；因此它复用的是同一套目录校验 contract，而不是再造一套平行逻辑。

如果你是 GitHub Release 页面的下载方，而且本机不保留源码 checkout，可额外下载 release 页面现在随包分发的 standalone `verify-downloaded-release.sh` helper，然后直接在本机运行：

```bash
bash ./verify-downloaded-release.sh --archive-file /tmp/promobot-release-bundle-v1.2.3.tar.gz
```

这里的 standalone helper 和仓库内的 `pnpm verify:downloaded-release` 是同一条校验链的两种入口：前者面向“只下载 release asset、不 checkout 仓库”的场景，后者只是对仓库里 `ops/verify-downloaded-release.sh` 的 `pnpm` 包装，适合已经有源码 checkout 的构建机或运维机。两者都会先核对本地 `archive + .sha256 + .metadata.json`，再复用解压后 bundle 自带的目录校验 CLI，不会引入第二套规则。

如果目标机不保留源码仓库，而是只接收 bundle 目录，可在 bundle 解压后直接部署：

```bash
cd /tmp/promobot-release
pnpm release:deploy
```

建议流程：

1. 在构建机的源码仓库里运行 `pnpm release:bundle` 或 `pnpm release:local`
2. 在源码仓库里用 `pnpm release:verify` 或 `pnpm verify:release` 校验 bundle
3. 把 bundle 目录复制到目标机
4. 在目标机进入 bundle 根目录，执行 `pnpm release:deploy`

如果你不想自己在构建机跑这几步，也可以直接使用仓库里的 GitHub Actions `Release Bundle` workflow：

- 与之分开的主 GitHub Actions `CI` workflow 会在所有 branch push（忽略 `v*` tag）和指向 `main` 的 pull request 上先跑 `lint` job：通过 `rhysd/actionlint@v1.7.12` 校验 workflow，并用 `bash -n ops/*.sh` 检查 ops shell wrapper 语法；`lint` 和 `ci` 两个 job 都显式收敛到 `permissions: contents: read`；随后 `ci` job 再执行 `pnpm test`、`pnpm build`，并追加一轮目录型 release bundle smoke：基于已构建的 `dist/server/cli/releaseBundle.js` 产出 bundle，再调用 bundle 自带的 `ops/verify-release.sh` 校验
- 支持手动触发 `workflow_dispatch`
- 支持在 `v*` tag push 时自动触发
- `Actions artifact` 指 workflow run 页面里的下载产物；`GitHub Release asset` 指挂在 GitHub Release 页面下的正式附件，两者不是同一个东西
- workflow run 页面里的 `summary` 只是 Actions run 页面内的结果摘要，用来帮助定位这次 `Release Bundle` run 产出的 bundle、archive、`.sha256` sidecar、`.metadata.json` metadata sidecar 和解压后 `manifest.json` 的关系；对手动 preview run，它会显示带 preview suffix 的最终派生命名；对 tag release（`v*` tag push），它会显示带 tag 版本号的最终派生命名，并把下一步指向 GitHub Release 页面。它不是 GitHub Release asset，也不替代 `release body`
- `.metadata.json` metadata sidecar 的新增字段里，`schema_version` 记录这份 metadata sidecar 自身的 schema 版本，只用于让下载方 / 自动化方按对应 schema 解析 sidecar，不表示 release 版本、tag 版本，也不替代 bundle 内 `manifest.json` 的结构版本；`checksum_algorithm` 记录这条 archive 下载链路配套 checksum sidecar 使用的算法，当前和 `.sha256` sidecar 一起描述 archive 的 `sha256` 校验，不描述解压后 bundle 内文件的 checksum 规则；`archive_format` 记录这次 release asset 下载链路里 archive 的封装格式，当前对应版本化 `tar.gz` archive，不描述解压后的 bundle 目录格式。`artifact_name` 记录这组文件在 Actions run 里的 artifact 容器名，`event_name` 记录触发这次 workflow 的事件来源，例如 `workflow_dispatch` 或 `push`，`prerelease` 记录对应 GitHub Release 页面是否应标成 prerelease 的布尔状态；新增的 `generated_at` 记录这份 metadata sidecar 由 workflow 写出的时间戳，`run_url` 记录这次 workflow run 页面的链接，`release_url` 只在 `v*` tag push 这条 tag release 时记录对应 GitHub Release 页面的链接，手动 preview run（`workflow_dispatch`）则固定为 `null`；新增的 `test_execution` 对象只描述这次 metadata sidecar 对应产物在 workflow 里如何执行 `pnpm test`：`test_execution.state` 记录这次产物是 `executed` 还是 `skipped`，`test_execution.mode` 记录为什么会得到这个状态，当前会是 `tag_release_forced`、`manual_default` 或 `manual_skip`，`test_execution.summary` 则固定写成给下载方 / 自动化方消费的测试执行摘要：手动 preview run 显式传 `skip_tests=true` 时为 `skipped via manual workflow_dispatch input`，手动 preview run 没传或保持默认时为 `executed (default manual behavior)`，`v*` tag push 的 tag release 时为 `executed (required for tag release)`。它们和 sidecar 里的有序 asset 列表一样，都是给下载方 / 自动化方消费的机器可读发布上下文：有序 asset 列表表达的是 asset 清单顺序，按 workflow 对外提供下载与校验的顺序列出 `archive -> .sha256 sidecar -> .metadata.json metadata sidecar`，便于稳定展示、核对和串接后续步骤；其中 `schema_version` 只是 metadata sidecar 自身的 schema 版本，`checksum_algorithm` 只是 archive 下载链路的 checksum 算法，`archive_format` 只是 archive 下载链路的封装格式，`run_url` 只是 workflow run 页面链接，`release_url` 只是 GitHub Release 页面链接，`test_execution.state`、`test_execution.mode`、`test_execution.summary` 只是 metadata sidecar 里的机器可读测试执行状态；这些内容都不等于 `release body`、workflow run `summary`，也不替代 workflow run 页面里给人读的 `summary` 或解压后 bundle 内的 `manifest.json`
- workflow 还会把同一 ref 的 run 串行化，并给 build / publish job 加超时保护，避免并发运行或卡死 runner 时互相踩资产
- 正式 `v*` tag push 生成的 GitHub Release 页面会自带 download / verify 说明；这段内容由 `Release Bundle` workflow 写进 `release body`，会列出该 tag 对应的版本化 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar、额外分发的 standalone `verify-downloaded-release.sh` helper 和推荐的校验顺序，也会把该 tag 的 `prerelease` 和 `test_execution.summary` 对应的测试执行状态写成给人读的页面说明。要注意，`release body` 只是给人读的页面说明；真正供下载和校验消费的仍是页面下方这些 GitHub Release asset，以及解压后 bundle 里的 `manifest.json`。即使 `release body` 现在会显示这些状态语义，机器可读发布上下文仍以 `.metadata.json` metadata sidecar 里的 `prerelease` 和 `test_execution` 等字段为准，它不替代 metadata sidecar
- 手动 preview run（`workflow_dispatch`）仍主要产出 Actions artifact，里面同时带 bundle 目录、archive、`.sha256` sidecar 和 `.metadata.json` metadata sidecar，适合作为交付件发往目标机；这里不额外承诺发布 GitHub Release asset，因此 `.metadata.json` metadata sidecar 里的 `release_url` 也固定为 `null`。手动 preview run 可选传 `asset_suffix` 作为 preview suffix，只用于区分这次手动预览包命名：会影响 Actions artifact 名称，以及其中 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar 的命名；允许字符为 `1-32` 个小写字母、数字、`.`、`_`、`-`，并且必须以字母或数字开头和结尾。workflow run 页面的 `summary` 会直接列出这组带 preview suffix 的最终派生命名，它也不会改变 bundle 内 `manifest.json` 的语义
- 手动 preview run（`workflow_dispatch`）还可选传 `skip_tests=true`，作为只用于加速手动 preview 包的自担风险选项：默认仍会执行 `pnpm test`；只有这条手动 preview 入口能跳过，`v*` tag push 这条 tag release 入口不受影响，仍会执行测试。它只影响打包前是否执行 `pnpm test`，不会改变已生成 archive、`.sha256` sidecar、`.metadata.json` metadata sidecar、bundle 内 `manifest.json` 和后续校验链语义
- `prerelease` 状态只和 `v*` tag push 这条 tag release 有关。当前 workflow 会按 tag 名本身自动判定是否为 semver 预发布：像 `v1.2.3-rc.1`、`v1.2.3-beta.1` 这类会标成 `prerelease=true`，`v1.2.3` 这类正式版 tag 仍保持 `false`。这个判定不从 `asset_suffix`、`release body` 或 `summary` 推导；`release body` 现在只是把这个既有状态和对应测试执行状态以给人读的方式显示出来
- 只有 `v*` tag push 这条正式发版入口，才会在保留 Actions artifact 的同时，把带版本号的 archive、`.sha256` sidecar 和 `.metadata.json` metadata sidecar 附着到 GitHub Release；这个手动 preview suffix（`asset_suffix`）不参与这条正式发版命名。新的 release asset sidecar 只服务这条 tar.gz 下载链路，如果只是临时取包 / 验包，直接下载 Actions artifact 即可
- 与版本化 archive 同名派生的 `.metadata.json` sidecar 的定位是给下载方 / 自动化方消费的机器可读说明，用来描述 `Release Bundle` workflow 产出的 bundle、archive 和校验入口；它不替代配套 `.sha256` sidecar，也不替代解压后对 `manifest.json` 以及 `pnpm verify:release` 的 bundle 校验。只有在源码仓库里手动复核 bundle 时，才需要直接调用 `pnpm release:verify`
- `.metadata.json` metadata sidecar 里的 `schema_version`、`checksum_algorithm`、`archive_format`、`artifact_name`、`event_name`、`prerelease`、`generated_at`、`run_url`、`release_url`、`test_execution.state`、`test_execution.mode`、`test_execution.summary` 和有序 asset 列表也应按同一层级理解：`schema_version` 对应 metadata sidecar 自身的 schema 版本，`checksum_algorithm` 对应 archive 下载链路的 checksum 算法，`archive_format` 对应 archive 下载链路的封装格式，`artifact_name` 对应 Actions artifact 下载入口，`event_name` 对应 workflow 触发来源，`prerelease` 对应 GitHub Release 状态，`generated_at` 对应 metadata sidecar 的生成时间，`run_url` 对应这次 workflow run 页面链接，`release_url` 对应 GitHub Release 页面链接，但只有 tag release 时有值、手动 preview run 为 `null`，`test_execution.state` 对应这次产物是否执行了测试，`test_execution.mode` 对应这次测试策略来自 tag release 强制执行、手动默认执行还是手动跳过，`test_execution.summary` 对应给下载方 / 自动化方消费的固定测试执行摘要，并且只会是 `skipped via manual workflow_dispatch input`、`executed (default manual behavior)`、`executed (required for tag release)` 三种固定字符串之一，有序 asset 列表对应下载方 / 自动化方消费的 asset 清单顺序。这里这些字段只说明 metadata sidecar 的发布上下文，以及 `archive -> .sha256 sidecar -> .metadata.json metadata sidecar` 这组文件该按什么顺序识别与消费，不是 `release body` 文案，不是 workflow run `summary` 摘要，也不替代 workflow run 页面里给人读的 `summary`，更不是 bundle 内 `manifest.json` 的内容摘要
- 默认会执行 `pnpm test`、`pnpm build`、静态 `preflight`、`release:bundle` 和 `release:verify`
- Actions artifact 里同时带 bundle 目录、archive、`.sha256` sidecar 和 `.metadata.json` metadata sidecar；正式 GitHub Release 页面则会在这组三件套之外额外分发 standalone `verify-downloaded-release.sh` helper，方便下载方不 checkout 仓库也能直接跑现成校验入口。GitHub Release asset 的 tar.gz 下载应先用配套 sidecar 做下载完整性校验，再用 `.metadata.json` 读取 `schema_version` / `checksum_algorithm` / `archive_format` / ref / commit / `generated_at` / `run_url` / `release_url` / `test_execution.state` / `test_execution.mode` / `test_execution.summary` / 文件名这些发布上下文，最后再解压拿到目录型 bundle。解压后的 `manifest.json` 和 `pnpm verify:release` 校验的是 bundle 内文件；只有仍在源码仓库里复核时，才直接调用 `pnpm release:verify`

如果你走 GitHub Release asset 下载链路，建议顺序是：

1. 下载该 tag 对应的版本化 archive、配套 `.sha256` sidecar 和 `.metadata.json` metadata sidecar；如果目标机没有源码 checkout，再额外下载 release 页面分发的 standalone `verify-downloaded-release.sh` helper
2. 无源码 checkout 时直接运行 `bash ./verify-downloaded-release.sh --archive-file <archive>`；有源码 checkout 时可运行 `pnpm verify:downloaded-release -- --archive-file <archive>`
3. 如果需要人工核对，再查看 `.metadata.json` 中的 `schema_version` / `checksum_algorithm` / `archive_format` / ref / commit / `generated_at` / `run_url` / `release_url` / `test_execution.state` / `test_execution.mode` / `test_execution.summary` / 资产文件名是否符合预期
4. helper / `pnpm verify:downloaded-release` 校验通过后，保留解压出来的目录型 release bundle 和其中的 `manifest.json`
5. 如需再次单独复核目录内容，可对解压后的目录运行 `pnpm verify:release -- --input-dir <path>`；如果是在源码仓库里复核同一个 bundle，也可以运行 `pnpm release:verify -- --input-dir <path>`
6. 校验通过后，再在 bundle 根目录执行 `pnpm release:deploy`

换句话说：

- `pnpm deploy:local` 解决的是“拿源码仓库直接上线”
- `pnpm release:deploy` 解决的是“拿打好的 release bundle 直接上线”

如果 `dist/client/index.html` 存在：

- `/` 会返回前端入口
- `/assets/*` 会返回构建产物
- 非 API 的无扩展名路由会 fallback 到 `index.html`

## 最终交付 / 验收流程

最终交付建议按同一套五段门禁收口：`build -> preflight -> verify -> deploy -> smoke`。如果走 release bundle 交付，则在 `preflight` 和 `verify` 之间补一段 `release bundle`。当前 `pnpm preflight:prod` / `pnpm preflight:local` 都会检查 `dist/server/index.js` 和 `dist/client/index.html`，所以实际执行时要先产出构建结果，再做 preflight；下面的命令按“可直接执行”的最少顺序列出来。

### 路径 A：源码仓库部署

适用场景：

- 目标机上已经有源码 checkout
- 目标机接受在仓库根目录执行 install / build / PM2 切换

阶段对应：

- `build`：`pnpm build`
- `preflight`：`pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD`
- `verify`：`pnpm test`
- `deploy`：`pnpm deploy:local -- --skip-install --skip-smoke`
- `smoke`：`pnpm smoke:server -- --base-url http://127.0.0.1:3001`

最少命令清单：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD
pnpm test
pnpm deploy:local -- --skip-install --skip-smoke
pnpm smoke:server -- --base-url http://127.0.0.1:3001
```

这条链路的交付物就是源码仓库本身；`deploy:local` 会在仓库目录里接手 PM2 reload / start，所以前面的 `install` 和 `build` 已经单独执行过时，建议显式加 `--skip-install --skip-smoke`，把 deploy 和 smoke 拆开，便于验收记录留痕。

### 路径 B：release bundle 直接部署

适用场景：

- 构建机负责打包
- 目标机不要求保留源码仓库，只接收目录型 release bundle

阶段对应：

- `build`：`pnpm build`
- `preflight`：`pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD`
- `release bundle`：`pnpm release:bundle -- --output-dir /tmp/promobot-release`
- `verify`：在源码仓库里执行 `pnpm verify:release -- --input-dir /tmp/promobot-release`
- `deploy`：在 bundle 根目录执行 `pnpm release:deploy -- --skip-smoke`
- `smoke`：在 bundle 根目录执行 `node dist/server/cli/deploymentSmoke.js --base-url http://127.0.0.1:3001`

最少命令清单：

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

这条链路建议在构建机先做一次 `verify:release`，再把 bundle 目录发往目标机。目标机如果只拿到已解压 bundle，也可以直接在 bundle 根目录复跑同一个 `verify:release` wrapper；它会自动切到 bundle 自带的 compiled verifier。独立 smoke 继续沿用 bundle 自带的 compiled CLI，与 `ops/deploy-release.sh` 内部的检查方式保持一致。

## 用 PM2 运行

```bash
pnpm build
pm2 start pm2.config.js
pm2 status promobot
pm2 logs promobot
```

当前 `pm2.config.js`：

- 固定 `cwd` 为仓库根目录
- 启动 `./dist/server/index.js`
- 继承当前 shell 环境
- 服务进程启动时会自动读取仓库根目录 `.env`（若存在）
- 启动前会确保 `<repo>/logs/` 存在
- stdout / stderr 默认写到 `<repo>/logs/promobot-out.log` 和 `<repo>/logs/promobot-error.log`
- 带 `min_uptime`、`max_restarts`、`exp_backoff_restart_delay`、`kill_timeout` 等基础保活参数

建议的 PM2 启动步骤：

```bash
mkdir -p logs data
pnpm build
pm2 start pm2.config.js --update-env
pm2 status promobot
```

如果你更偏向“一条命令执行 install/build/pm2/smoke”，也可以直接跑：

```bash
pnpm deploy:local -- --base-url http://127.0.0.1:3001
```

如果只是更新代码但不想重装依赖，可用：

```bash
pnpm deploy:local -- --skip-install --base-url http://127.0.0.1:3001
```

如果需要从一个已有 runtime backup 回滚，可运行：

```bash
pnpm rollback:local -- --backup-dir /tmp/promobot-backup-manual --skip-smoke
```

回滚脚本会先停掉现有 PM2 进程，再调用 `runtime:restore`，然后按恢复后的环境执行 `pm2 restart` / `pm2 start`，最后按需追加 smoke check。
如果你不想恢复 `.env`，可加：

```bash
pnpm rollback:local -- --backup-dir /tmp/promobot-backup-manual --skip-env --skip-smoke
```

## PM2 healthcheck

启动后至少做三层检查：

```bash
pm2 status promobot
curl http://127.0.0.1:3001/api/system/health
pm2 logs promobot --lines 100
```

`/api/system/health` 当前会返回：

- `ok`
- `service`
- `timestamp`
- `uptimeSeconds`
- `scheduler.available`
- `scheduler.started`
- 如果 runtime 已挂载，还会返回 `scheduler.queue.pending/running/failed/duePending`
- `browserArtifacts.laneRequests.total/pending/resolved`
- `browserArtifacts.handoffs.total/pending/resolved/obsolete/unmatched`
- `browserArtifacts.inboxReplyHandoffs.total/pending/resolved/obsolete`

最小通过标准：

- HTTP `200`
- JSON 中 `ok=true`
- `service=promobot`
- `scheduler.available` / `scheduler.started` 与当前部署形态一致

如果你想把这层检查脚本化，可直接运行：

```bash
pnpm smoke:server -- --base-url http://127.0.0.1:3001
```

`smoke:server` 会优先读取 `--admin-password`，否则回退到 `PROMOBOT_ADMIN_PASSWORD`、`ADMIN_PASSWORD`，以及仓库根 `.env` 里的 `PROMOBOT_ADMIN_PASSWORD` / `ADMIN_PASSWORD`。

当前 smoke CLI 会依次检查：

1. `GET /api/system/health`
2. `POST /api/auth/login`
3. `GET /api/settings`
4. `GET /api/system/browser-lane-requests?limit=1`
5. `GET /api/system/browser-handoffs?limit=1`
6. `GET /api/system/inbox-reply-handoffs?limit=1`
7. `POST /api/auth/logout`

## 日志轮转

当前仓库提供样例配置：`ops/logrotate.promobot.conf`

使用方式：

1. 把文件里的 `REPO_ROOT` 替换成实际仓库绝对路径
2. 复制到 `/etc/logrotate.d/promobot`
3. 确认它覆盖 `<repo>/logs/promobot-*.log`

样例策略：

- 每日轮转
- 保留 7 份
- 压缩旧日志
- `copytruncate`，避免直接截断正在被 PM2 持有的文件句柄

如果你更偏向 PM2 插件，也可以改用 `pm2-logrotate`，但当前仓库内置的是 Linux `logrotate` 样例而不是插件脚本。

## SQLite 备份与迁移

当前仓库没有单独的 migration CLI，也没有自动 schema 升级说明，所以生产迁移按“停服务 + 文件级备份”处理。

备份前建议先停服务：

```bash
pm2 stop promobot
```

需要一起备份/迁移的内容：

- `PROMOBOT_DB_PATH` 指向的 SQLite 文件
- 真实运行时 `browser-sessions/` 根目录
- 当前生效的 `.env` / shell 环境变量来源

如果你想在停机前先生成一个仓库内快照，可直接运行：

```bash
pnpm runtime:backup
```

默认会写到 `backups/<timestamp>/`，并生成 `manifest.json`。备份会保留当前有效 SQLite 来源的真实文件名，同时复制真实运行时 `browser-sessions/` 根目录。如果有缺失项，CLI 会保留 manifest，同时以非零退出码返回，便于自动化区分“完整备份”和“不完整快照”。也支持自定义输出目录：

```bash
pnpm runtime:backup -- --output-dir /tmp/promobot-backup-manual
```

自定义 `--output-dir` 时，目标目录必须不存在或为空；CLI 会拒绝写入已有非空目录，避免旧的 `browser-sessions` 或旧 manifest 残留被合并进新的 runtime 快照。

需要恢复时：

```bash
pnpm runtime:restore -- --input-dir /tmp/promobot-backup-manual
```

restore 会按 backup manifest 把文件恢复到原始 `sourcePath`，并在覆盖前为已有目标创建 `.pre-restore-<timestamp>` 备份。若不想恢复 `.env`，可加：

```bash
pnpm runtime:restore -- --input-dir /tmp/promobot-backup-manual --skip-env
```

迁移到新机器时：

1. 恢复 SQLite 文件到目标路径
2. 恢复运行时使用的 `browser-sessions/` 根目录
3. 设置正确的 `PROMOBOT_DB_PATH`
4. 重新导入环境变量
5. 再执行 `pm2 start pm2.config.js --update-env`

当前建议在相同代码版本或经过验证的兼容版本之间迁移；不要把仓库描述成已经具备独立数据库 migration 系统。

## 浏览器访问

当前生产形态下，你可以直接访问同一个 Node 端口：

- 页面入口：`http://<host>:3001/`
- API：`http://<host>:3001/api/*`

前提：

- `dist/client` 已构建
- 访问 IP 在 `ALLOWED_IPS` 范围内

## 当前能力边界

- `x`
  - 配置 token 时会尝试真实 API
  - 未配置凭证时会返回失败，不会伪造成功发布
- `reddit`
  - 配齐 OAuth 变量时会尝试真实 API
  - 未配置凭证时会返回失败，不会伪造成功发布
- `facebook-group`
  - 仍然是浏览器 handoff 合同，不会自动发帖
- `instagram`、`tiktok`、`weibo`、`xiaohongshu`
  - 当前会像 `facebook-group` 一样根据浏览器 session 返回有状态的 manual handoff 合同
  - 缺 session 时返回 `request_session`，session 过期时返回 `relogin`
  - 当 session 已就绪时，发布请求还会生成本地 handoff artifact 文件，便于人工接管或外部 browser lane 消费
  - 后续 publish 成功会把 handoff artifact 结单成 `resolved`；session 失效则会把旧 handoff 标成 `obsolete`
- `blog`
  - 当前支持 `file`、`wordpress`、`ghost` 三种发布 driver；默认是 `file`
  - `file` 会把发布内容写入本地 Markdown 文件；默认输出到 `data/blog-posts/`，可用 `BLOG_PUBLISH_OUTPUT_DIR` 覆盖
  - `wordpress` 需要完整配置 `BLOG_WORDPRESS_SITE_URL`、`BLOG_WORDPRESS_USERNAME`、`BLOG_WORDPRESS_APP_PASSWORD`，发布时会直接调用 WordPress Posts API
  - `ghost` 需要完整配置 `BLOG_GHOST_ADMIN_URL`、`BLOG_GHOST_ADMIN_API_KEY`，发布时会直接调用 Ghost Admin API
  - driver 不受支持、或 WordPress / Ghost 凭证不完整时，会明确返回失败，不会伪造成功发布
- 当前可落地发布范围建议收敛为：`X`、`Reddit`、`Blog（本地文件 / WordPress / Ghost）`、`Facebook Group / Instagram / TikTok / 小红书 / 微博（人工接管）`
- `monitor`、`inbox`、`reputation`
  - `monitor/fetch` 已支持 RSS、V2EX、Reddit search，以及 Instagram / TikTok profile source configs
  - `inbox/fetch` 与 `reputation/fetch` 现在会直接基于 settings/source configs 调用 X、Reddit、V2EX 搜索
  - 在开发/测试环境下，只有在完全没有配置时才会退回 seed 数据支撑原型视图
  - 在生产环境下，这些 demo / seed fallback 已禁用；没有真实配置或真实信号时会返回空态
  - `monitor_items`、`inbox_items`、`reputation_items` 现在会按各自内容键做幂等写入；同一抓取结果重复落库时会复用已有记录
- `settings`
  - 写入的 allowlist 会立即影响当前进程
  - 如果多个实例共享同一 SQLite settings，下一次请求时也会读到最新 allowlist

## 管理员登录

当前访问模型是两层保护：

1. `ALLOWED_IPS` 先限制来源 IP
2. 进入前端后再输入 `ADMIN_PASSWORD`

当前实现：

- 浏览器第一次打开控制台时会先显示登录页
- 登录成功后前端会拿到服务端签发的 `HttpOnly` session cookie
- 如果勾选“记住这台浏览器”，则会改为持久 cookie；未勾选时，关闭当前浏览器会话后需要重新登录
- 浏览器后续 API 请求会自动复用当前 cookie session
- 控制台侧边栏现在提供显式“退出登录”，会主动调用 `/api/auth/logout`
- 自动化脚本和 CLI 仍可继续使用 `x-admin-password` fallback
- 如果密码失效或填错，后端会返回 `401 unauthorized`

## 验证

至少执行：

```bash
pnpm test
pnpm build
curl http://127.0.0.1:3001/api/system/health
pnpm smoke:server -- --base-url http://127.0.0.1:3001
```

如果 `dist/client` 已存在，再验证：

```bash
curl http://127.0.0.1:3001/
```

预期：

- `/api/system/health` 返回 `200`
- 响应 JSON 里至少包含 `ok=true` 和 `service=promobot`
- 响应 JSON 里包含 `browserArtifacts.laneRequests`、`browserArtifacts.handoffs` 和 `browserArtifacts.inboxReplyHandoffs`
- 页面入口返回 HTML，而不是 404

如果你想先预览 browser artifact 归档计划而不真正移动文件，可运行：

```bash
pnpm browser:artifacts:archive -- --older-than-hours 72 --include-results
```

确认输出无误后再执行真正归档：

```bash
pnpm browser:artifacts:archive -- --apply --older-than-hours 72 --include-results
```
