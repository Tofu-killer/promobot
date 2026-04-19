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
  - 但当前请求链路并没有真正启用 admin password 校验
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
  - 否则回退 stub
- `reddit`
  - 配齐 OAuth 变量时会尝试真实 API
  - 否则回退 stub
- `facebook-group`
  - 仍然是浏览器 handoff 合同，不会自动发帖
- `weibo`、`xiaohongshu`、`blog`
  - 仍主要停留在 manual / stub 路径
- `monitor`、`inbox`、`reputation`
  - `fetch` 目前仍写入 seed 数据，不是实时外部抓取
- `settings`
  - 写入的 allowlist 不会热更新现有中间件
  - 真正生效的仍是进程启动时读取的 `ALLOWED_IPS`

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

预期能看到 HTML 入口，而不是 404。
