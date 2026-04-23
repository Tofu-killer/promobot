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

- Node.js 20+
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
  - 除 `/api/system/health` 外，其它 `/api/*` 请求都需要提供匹配的管理员密码
  - 当前前端默认会把登录时输入的密码保存在浏览器 `sessionStorage`（当前标签页会话级），并自动附加到后续 API 请求
  - 若用户显式勾选“记住这台浏览器”，则会改为长期保存
- `PROMOBOT_DB_PATH`
  - 默认是 `<cwd>/data/promobot.sqlite`
  - 用仓库根目录启动或使用 `pm2.config.js` 时，默认值等同于 `<repo>/data/promobot.sqlite`
  - 浏览器 session 元数据会落在数据库目录旁边的 `browser-sessions/`
  - 通过 Channel Accounts 保存 browser session 时，直接导入的 storage state JSON 会写到 `browser-sessions/managed/<platform>/`
  - 手填 `storageStatePath` 时，该路径必须落在允许的 session 根目录内，并且指向真实存在、结构合法的 Playwright storage state 文件
  - `storageStatePath` 和 `storageState` 只能二选一；直接导入 JSON 时，至少要包含 `cookies` / `origins` 数组
  - 如果 metadata 指向的 storage state 文件已不存在，Channel Accounts / Settings / platform readiness 会把该 session 视为 `missing`
  - 请求登录 / 重新登录动作会在仓库下的 `artifacts/browser-lane-requests/<platform>/<account>/` 生成工单 JSON
  - 当新的 session 元数据保存成功后，匹配的 browser lane request 工单会被回写为 `resolved`，并附带 session 摘要
  - 也可以先把 browser lane 结果写成同目录下的 `*.result.json`，再调用 `POST /api/system/browser-lane-requests/import` 让服务端自动导入 session
  - 仓库内置 `pnpm browser:lane:submit -- --request-artifact <path> --storage-state-file <path>`，会生成 `browser_lane_result` artifact；若同时提供 `--base-url` 和 `--admin-password`，会立即调用 importer API
  - 上面这条 CLI 依赖和服务端共享同一份 artifact 根目录，因为 importer API 只接收 `artifactPath`，不会上传 `storageState` 内容本身
  - browser manual handoff artifact 会落在 `artifacts/browser-handoffs/<platform>/<account>/`，并维护 `pending / resolved / obsolete` 状态
  - 控制台中的 `System Queue` / `Settings` / `Dashboard` / `Channel Accounts` 都会直接消费这些工单与 handoff 状态
- `AI_BASE_URL` / `AI_API_KEY`
  - 对服务启动本身可选
  - 对 AI 草稿生成、Inbox 回复建议等功能必需
- `AI_MODEL`
  - 可选
  - 未配置时默认 `gpt-4o-mini`
- `BLOG_PUBLISH_OUTPUT_DIR`
  - 可选
  - 控制 blog 发布时 Markdown 文件的输出目录
  - 未配置时默认 `<cwd>/data/blog-posts`
- `BROWSER_HANDOFF_OUTPUT_DIR`
  - 可选
  - 控制 browser manual handoff artifact 的输出目录
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

如果 `dist/client/index.html` 存在：

- `/` 会返回前端入口
- `/assets/*` 会返回构建产物
- 非 API 的无扩展名路由会 fallback 到 `index.html`

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

最小通过标准：

- HTTP `200`
- JSON 中 `ok=true`
- `service=promobot`
- `scheduler.available` / `scheduler.started` 与当前部署形态一致

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
- 该数据库目录旁边的 `browser-sessions/`
- 当前生效的 `.env` / shell 环境变量来源

迁移到新机器时：

1. 恢复 SQLite 文件到目标路径
2. 恢复同级 `browser-sessions/`
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
- `weibo`、`xiaohongshu`
  - 当前会像 `facebook-group` 一样根据浏览器 session 返回有状态的 manual handoff 合同
  - 缺 session 时返回 `request_session`，session 过期时返回 `relogin`
  - 当 session 已就绪时，发布请求还会生成本地 handoff artifact 文件，便于人工接管或外部 browser lane 消费
  - 后续 publish 成功会把 handoff artifact 结单成 `resolved`；session 失效则会把旧 handoff 标成 `obsolete`
- `blog`
  - 当前会把发布内容写入本地 Markdown 文件
  - 默认输出到 `data/blog-posts/`；可用 `BLOG_PUBLISH_OUTPUT_DIR` 覆盖
- 当前可落地发布范围建议收敛为：`X`、`Reddit`、`Blog（本地文件）`、`Facebook Group / 小红书 / 微博（人工接管）`
- `monitor`、`inbox`、`reputation`
  - `monitor/fetch` 已支持 RSS、V2EX、Reddit search
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
- 输入的管理员密码默认会保存到当前浏览器 `sessionStorage`（当前标签页会话级）
- 如果勾选“记住这台浏览器”，则会改为长期保存
- 未勾选时，关闭当前标签页或当前浏览器会话结束后，需要重新输入管理员密码
- 后续前端 API 请求会自动带 `x-admin-password`
- 如果密码失效或填错，后端会返回 `401 unauthorized`

## 验证

至少执行：

```bash
pnpm test
pnpm build
curl http://127.0.0.1:3001/api/system/health
```

如果 `dist/client` 已存在，再验证：

```bash
curl http://127.0.0.1:3001/
```

预期：

- `/api/system/health` 返回 `200`
- 响应 JSON 里至少包含 `ok=true` 和 `service=promobot`
- 页面入口返回 HTML，而不是 404
