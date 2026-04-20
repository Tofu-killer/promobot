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

当前代码不会自动读取 `.env`，所以如果你想使用本地 `.env`，先导入当前 shell：

```bash
cp .env.example .env
set -a
source .env
set +a
```

关键行为如下：

- `PORT`
  - 服务监听端口，默认 `3001`
- `ALLOWED_IPS`
  - 逗号分隔的精确 IP 字符串
  - 支持 `*` 全放开
  - 不支持 CIDR
  - 中间件会把 `::ffff:1.2.3.4` 规范化为 `1.2.3.4`
- `ADMIN_PASSWORD`
  - 进程启动时会读取
  - 在 `NODE_ENV=production` 下，若仍是默认值 `change-me`，服务会拒绝启动
  - 除 `/api/system/health` 外，其它 `/api/*` 请求都需要提供匹配的管理员密码
  - 当前前端会把登录时输入的密码保存在浏览器本地存储，并自动附加到后续 API 请求
- `PROMOBOT_DB_PATH`
  - 默认是 `<cwd>/data/promobot.sqlite`
  - 用仓库根目录启动或使用 `pm2.config.js` 时，默认值等同于 `<repo>/data/promobot.sqlite`
  - 浏览器 session 元数据会落在数据库目录旁边的 `browser-sessions/`
- `AI_BASE_URL` / `AI_API_KEY`
  - 对服务启动本身可选
  - 对 AI 草稿生成、Inbox 回复建议等功能必需
- `AI_MODEL`
  - 可选
  - 未配置时默认 `gpt-4o-mini`
- `X_ACCESS_TOKEN` / `X_BEARER_TOKEN`
  - 任一存在时，`x` publisher 才会尝试真实 API
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USERNAME` / `REDDIT_PASSWORD`
  - 4 项齐全时，`reddit` publisher 才会尝试真实 API
- `REDDIT_USER_AGENT`
  - 可选
  - 未配置时默认 `promobot/0.1`

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

- 开发模式下 Vite 还没有内建 `/api` proxy
- 如果你要在浏览器里完整联通前后端，仍建议额外加一层同源代理

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

如果 `dist/client/index.html` 存在：

- `/` 会返回前端入口
- `/assets/*` 会返回构建产物
- 非 API 的无扩展名路由会 fallback 到 `index.html`

## 用 PM2 运行

```bash
set -a
source .env
set +a
pnpm build
pm2 start pm2.config.js
pm2 status promobot
pm2 logs promobot
```

当前 `pm2.config.js`：

- 固定 `cwd` 为仓库根目录
- 启动 `./dist/server/index.js`
- 继承当前 shell 环境
- 不会主动解析 `.env`
- 启动前会确保 `<repo>/logs/` 存在
- stdout / stderr 默认写到 `<repo>/logs/promobot-out.log` 和 `<repo>/logs/promobot-error.log`
- 带 `min_uptime`、`max_restarts`、`exp_backoff_restart_delay`、`kill_timeout` 等基础保活参数

建议的 PM2 启动步骤：

```bash
mkdir -p logs data
set -a
source .env
set +a
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
- `weibo`、`xiaohongshu`、`blog`
  - 仍主要停留在 manual / stub 路径
- `monitor`、`inbox`、`reputation`
  - `monitor/fetch` 已支持 RSS、V2EX、Reddit search
  - `inbox/fetch` 与 `reputation/fetch` 目前优先复用已落库的 monitor 信号
  - 当 monitor 还没有命中时，会退回 monitor 查询配置生成骨架项
  - 还没有形成各自独立的实时网络抓取器，也没有去重层
- `settings`
  - 写入的 allowlist 不会热更新现有中间件
  - 真正生效的仍是进程启动时读取的 `ALLOWED_IPS`

## 管理员登录

当前访问模型是两层保护：

1. `ALLOWED_IPS` 先限制来源 IP
2. 进入前端后再输入 `ADMIN_PASSWORD`

当前实现：

- 浏览器第一次打开控制台时会先显示登录页
- 输入的管理员密码会保存到当前浏览器本地存储
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
