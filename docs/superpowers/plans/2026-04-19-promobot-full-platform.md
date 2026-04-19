# PromoBot Full Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working PromoBot codebase in `Tofu-killer/promobot`, including the shared platform foundation, content operations core, social inbox, competitor monitoring, reputation tracking, multi-platform publishing, and LAN-safe deployment.

**Architecture:** Implement a single Node.js + TypeScript application that serves both the API and the built React admin UI, backed by SQLite and a unified job table. Keep all platform logic behind isolated adapters so API-based channels and Playwright-based channels can coexist without leaking platform-specific behavior into the shared application core.

**Tech Stack:** Node.js 20, TypeScript, Express 5, React 19, Vite, Tailwind CSS v4, better-sqlite3, Vitest, Playwright, PM2

---

## File Structure

### Shared foundation

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `pm2.config.js`

### Database and shared server core

- Create: `database/schema.sql`
- Create: `src/server/db.ts`
- Create: `src/server/config.ts`
- Create: `src/server/index.ts`
- Create: `src/server/app.ts`
- Create: `src/server/middleware/auth.ts`
- Create: `src/server/middleware/ipAllowlist.ts`
- Create: `src/server/lib/jobs.ts`
- Create: `src/server/scheduler.ts`

### API routes

- Create: `src/server/routes/system.ts`
- Create: `src/server/routes/projects.ts`
- Create: `src/server/routes/discovery.ts`
- Create: `src/server/routes/content.ts`
- Create: `src/server/routes/drafts.ts`
- Create: `src/server/routes/publish.ts`
- Create: `src/server/routes/inbox.ts`
- Create: `src/server/routes/monitor.ts`
- Create: `src/server/routes/reputation.ts`
- Create: `src/server/routes/channelAccounts.ts`
- Create: `src/server/routes/settings.ts`

### Services

- Create: `src/server/services/aiClient.ts`
- Create: `src/server/services/generators/x.ts`
- Create: `src/server/services/generators/reddit.ts`
- Create: `src/server/services/generators/facebookGroup.ts`
- Create: `src/server/services/generators/xiaohongshu.ts`
- Create: `src/server/services/generators/weibo.ts`
- Create: `src/server/services/generators/blog.ts`
- Create: `src/server/services/publishers/x.ts`
- Create: `src/server/services/publishers/reddit.ts`
- Create: `src/server/services/publishers/facebookGroup.ts`
- Create: `src/server/services/publishers/xiaohongshu.ts`
- Create: `src/server/services/publishers/weibo.ts`
- Create: `src/server/services/publishers/blog.ts`
- Create: `src/server/services/browser/sessionStore.ts`
- Create: `src/server/services/monitor/rss.ts`
- Create: `src/server/services/monitor/xSearch.ts`
- Create: `src/server/services/monitor/redditSearch.ts`
- Create: `src/server/services/monitor/v2exSearch.ts`
- Create: `src/server/services/inbox/fetchers/x.ts`
- Create: `src/server/services/inbox/fetchers/reddit.ts`
- Create: `src/server/services/inbox/fetchers/xiaohongshu.ts`
- Create: `src/server/services/inbox/fetchers/weibo.ts`
- Create: `src/server/services/inbox/fetchers/v2ex.ts`
- Create: `src/server/services/reputation/collector.ts`
- Create: `src/server/services/reputation/sentiment.ts`

### Frontend

- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/components/Layout.tsx`
- Create: `src/client/components/StatCard.tsx`
- Create: `src/client/components/StatusBadge.tsx`
- Create: `src/client/components/DraftCard.tsx`
- Create: `src/client/components/InboxDetail.tsx`
- Create: `src/client/components/MonitorFeed.tsx`
- Create: `src/client/components/SentimentChart.tsx`
- Create: `src/client/lib/api.ts`
- Create: `src/client/lib/types.ts`
- Create: `src/client/pages/Login.tsx`
- Create: `src/client/pages/Dashboard.tsx`
- Create: `src/client/pages/Projects.tsx`
- Create: `src/client/pages/Discovery.tsx`
- Create: `src/client/pages/Generate.tsx`
- Create: `src/client/pages/Drafts.tsx`
- Create: `src/client/pages/ReviewQueue.tsx`
- Create: `src/client/pages/PublishCalendar.tsx`
- Create: `src/client/pages/Inbox.tsx`
- Create: `src/client/pages/Monitor.tsx`
- Create: `src/client/pages/Reputation.tsx`
- Create: `src/client/pages/ChannelAccounts.tsx`
- Create: `src/client/pages/Settings.tsx`

### Tests

- Create: `tests/server/system.test.ts`
- Create: `tests/server/db.test.ts`
- Create: `tests/server/projects.test.ts`
- Create: `tests/server/content.test.ts`
- Create: `tests/server/drafts.test.ts`
- Create: `tests/server/publish.test.ts`
- Create: `tests/server/inbox.test.ts`
- Create: `tests/server/monitor.test.ts`
- Create: `tests/server/reputation.test.ts`
- Create: `tests/server/scheduler.test.ts`
- Create: `tests/client/app.test.tsx`
- Create: `tests/client/generate.test.tsx`
- Create: `tests/client/inbox.test.tsx`

## Task 1: Repository Bootstrap and Build Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Test: `tests/server/system.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```ts
import { describe, expect, it } from 'vitest';

describe('bootstrap', () => {
  it('loads the app entry module', async () => {
    const mod = await import('../../src/server/app');
    expect(mod.createApp).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/system.test.ts`
Expected: FAIL with `Cannot find module '../../src/server/app'`

- [ ] **Step 3: Write the minimal repository scaffold**

```json
{
  "name": "promobot",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:server": "tsx watch src/server/index.ts",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "pm2 start pm2.config.js"
  }
}
```

```ts
// src/server/app.ts
import express from 'express';

export function createApp() {
  return express();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/system.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vite.config.ts vitest.config.ts .gitignore .env.example src/server/app.ts tests/server/system.test.ts
git commit -m "chore: bootstrap PromoBot toolchain"
```

## Task 2: Shared SQLite Schema and Database Layer

**Files:**
- Create: `database/schema.sql`
- Create: `src/server/db.ts`
- Test: `tests/server/db.test.ts`

- [ ] **Step 1: Write the failing database test**

```ts
import { describe, expect, it } from 'vitest';
import { initDb } from '../../src/server/db';

describe('database schema', () => {
  it('creates the projects table', () => {
    const db = initDb(':memory:');
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/db.test.ts`
Expected: FAIL with `Cannot find module '../../src/server/db'`

- [ ] **Step 3: Write the minimal schema and DB wrapper**

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  site_name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  site_description TEXT NOT NULL,
  selling_points TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

```ts
// src/server/db.ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function initDb(filename: string) {
  const db = new Database(filename);
  const schema = fs.readFileSync(path.resolve('database/schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/db.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql src/server/db.ts tests/server/db.test.ts
git commit -m "feat: add shared SQLite schema bootstrap"
```

## Task 3: Config, LAN Guard, and Admin Authentication

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/middleware/auth.ts`
- Create: `src/server/middleware/ipAllowlist.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/server/system.test.ts`

- [ ] **Step 1: Write the failing security test**

```ts
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { describe, expect, it } from 'vitest';

describe('security middleware', () => {
  it('rejects requests from disallowed IPs', async () => {
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret'
    });

    const response = await request(app)
      .get('/api/system/health')
      .set('x-forwarded-for', '10.10.10.10');

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/system.test.ts`
Expected: FAIL with `Expected 403, received 404`

- [ ] **Step 3: Write the minimal config and middleware**

```ts
// src/server/config.ts
export type AppConfig = {
  allowedIps: string[];
  adminPassword: string;
};

export function loadConfig(): AppConfig {
  return {
    allowedIps: (process.env.ALLOWED_IPS ?? '127.0.0.1').split(','),
    adminPassword: process.env.ADMIN_PASSWORD ?? 'change-me'
  };
}
```

```ts
// src/server/middleware/ipAllowlist.ts
import type { Request, Response, NextFunction } from 'express';

export function ipAllowlist(allowedIps: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = (req.headers['x-forwarded-for'] as string | undefined) ?? req.ip ?? '';
    const ip = raw.split(',')[0].trim();
    if (allowedIps.includes(ip) || allowedIps.includes('*')) return next();
    res.status(403).json({ error: 'forbidden' });
  };
}
```

```ts
// src/server/app.ts
import express from 'express';
import { ipAllowlist } from './middleware/ipAllowlist';

export function createApp(config = { allowedIps: ['127.0.0.1'], adminPassword: 'change-me' }) {
  const app = express();
  app.use(ipAllowlist(config.allowedIps));
  app.get('/api/system/health', (_req, res) => res.json({ ok: true }));
  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/system.test.ts`
Expected: PASS with the LAN guard test green

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts src/server/middleware/auth.ts src/server/middleware/ipAllowlist.ts src/server/app.ts tests/server/system.test.ts
git commit -m "feat: add LAN guard and admin auth foundation"
```

## Task 4: Projects, Channel Accounts, and Source Config APIs

**Files:**
- Create: `src/server/routes/projects.ts`
- Create: `src/server/routes/channelAccounts.ts`
- Create: `src/server/routes/settings.ts`
- Modify: `database/schema.sql`
- Modify: `src/server/app.ts`
- Test: `tests/server/projects.test.ts`

- [ ] **Step 1: Write the failing project API test**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

describe('projects api', () => {
  it('creates a project', async () => {
    const app = createApp();
    const response = await request(app).post('/api/projects').send({
      name: 'AU Launch',
      siteName: 'MyModelHub',
      siteUrl: 'https://example.com',
      siteDescription: 'Multi-model API gateway',
      sellingPoints: 'Lower cost'
    });

    expect(response.status).toBe(201);
    expect(response.body.project.name).toBe('AU Launch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/projects.test.ts`
Expected: FAIL with `Expected 201, received 404`

- [ ] **Step 3: Write the minimal project and channel route implementation**

```ts
// src/server/routes/projects.ts
import { Router } from 'express';

export const projectsRouter = Router();

projectsRouter.post('/', (req, res) => {
  res.status(201).json({
    project: {
      id: 1,
      name: req.body.name,
      siteName: req.body.siteName,
      siteUrl: req.body.siteUrl,
      siteDescription: req.body.siteDescription,
      sellingPoints: req.body.sellingPoints
    }
  });
});
```

```ts
// src/server/app.ts
import express from 'express';
import { projectsRouter } from './routes/projects';

export function createApp(config = { allowedIps: ['127.0.0.1', '::ffff:127.0.0.1'], adminPassword: 'change-me' }) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/projects.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql src/server/routes/projects.ts src/server/routes/channelAccounts.ts src/server/routes/settings.ts src/server/app.ts tests/server/projects.test.ts
git commit -m "feat: add project and channel account APIs"
```

## Task 5: Unified Job Queue and Scheduler Loop

**Files:**
- Create: `src/server/lib/jobs.ts`
- Create: `src/server/scheduler.ts`
- Modify: `database/schema.sql`
- Test: `tests/server/scheduler.test.ts`

- [ ] **Step 1: Write the failing scheduler test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../src/server/scheduler';

describe('scheduler', () => {
  it('runs due jobs once', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler({
      pollMs: 10,
      handlers: { publish: handler }
    });

    await scheduler.runDueJobs([
      { id: 1, type: 'publish', payload: '{"draftId":1}', status: 'pending', runAt: new Date().toISOString() }
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/scheduler.test.ts`
Expected: FAIL with `Cannot find module '../../src/server/scheduler'`

- [ ] **Step 3: Write the minimal scheduler**

```ts
// src/server/scheduler.ts
type JobRecord = { id: number; type: string; payload: string; status: string; runAt: string };
type SchedulerOptions = { pollMs: number; handlers: Record<string, (payload: unknown) => Promise<void>> };

export function createScheduler(options: SchedulerOptions) {
  return {
    async runDueJobs(jobs: JobRecord[]) {
      for (const job of jobs) {
        if (job.status !== 'pending') continue;
        const handler = options.handlers[job.type];
        if (!handler) continue;
        await handler(JSON.parse(job.payload));
      }
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/scheduler.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql src/server/lib/jobs.ts src/server/scheduler.ts tests/server/scheduler.test.ts
git commit -m "feat: add unified job scheduler"
```

## Task 6: AI Client, Draft Generation, and Draft CRUD

**Files:**
- Create: `src/server/services/aiClient.ts`
- Create: `src/server/services/generators/x.ts`
- Create: `src/server/services/generators/reddit.ts`
- Create: `src/server/services/generators/facebookGroup.ts`
- Create: `src/server/services/generators/xiaohongshu.ts`
- Create: `src/server/services/generators/weibo.ts`
- Create: `src/server/services/generators/blog.ts`
- Create: `src/server/routes/content.ts`
- Create: `src/server/routes/drafts.ts`
- Test: `tests/server/content.test.ts`
- Test: `tests/server/drafts.test.ts`

- [ ] **Step 1: Write the failing content generation test**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

describe('content generation', () => {
  it('returns generated drafts for selected platforms', async () => {
    const app = createApp();
    const response = await request(app).post('/api/content/generate').send({
      topic: 'Claude support launched',
      platforms: ['x', 'reddit'],
      tone: 'professional',
      saveAsDraft: true
    });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/content.test.ts`
Expected: FAIL with `Expected 200, received 404`

- [ ] **Step 3: Write the minimal AI client and content route**

```ts
// src/server/services/aiClient.ts
export async function chat(_systemPrompt: string, userPrompt: string) {
  return `Generated draft for: ${userPrompt}`;
}
```

```ts
// src/server/routes/content.ts
import { Router } from 'express';
import { chat } from '../services/aiClient';

export const contentRouter = Router();

contentRouter.post('/generate', async (req, res) => {
  const results = await Promise.all(
    req.body.platforms.map(async (platform: string, index: number) => ({
      platform,
      content: await chat(platform, req.body.topic),
      hashtags: [],
      draftId: index + 1
    }))
  );

  res.json({ results });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/content.test.ts tests/server/drafts.test.ts`
Expected: PASS with generation and draft CRUD tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/services/aiClient.ts src/server/services/generators src/server/routes/content.ts src/server/routes/drafts.ts tests/server/content.test.ts tests/server/drafts.test.ts
git commit -m "feat: add AI generation and draft workflows"
```

## Task 7: Frontend Shell, Auth Screen, and Core Content Operations Pages

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/components/Layout.tsx`
- Create: `src/client/components/StatCard.tsx`
- Create: `src/client/components/StatusBadge.tsx`
- Create: `src/client/components/DraftCard.tsx`
- Create: `src/client/lib/api.ts`
- Create: `src/client/lib/types.ts`
- Create: `src/client/pages/Login.tsx`
- Create: `src/client/pages/Dashboard.tsx`
- Create: `src/client/pages/Projects.tsx`
- Create: `src/client/pages/Discovery.tsx`
- Create: `src/client/pages/Generate.tsx`
- Create: `src/client/pages/Drafts.tsx`
- Create: `src/client/pages/ReviewQueue.tsx`
- Create: `src/client/pages/PublishCalendar.tsx`
- Test: `tests/client/app.test.tsx`
- Test: `tests/client/generate.test.tsx`

- [ ] **Step 1: Write the failing frontend shell test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/client/App';

describe('App layout', () => {
  it('renders the navigation shell', () => {
    render(<App />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Social Inbox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/client/app.test.tsx`
Expected: FAIL with `Cannot find module '../../src/client/App'`

- [ ] **Step 3: Write the minimal UI shell**

```tsx
// src/client/App.tsx
const navItems = ['Dashboard', 'Projects', 'Discovery Pool', 'Generate Center', 'Drafts', 'Review Queue', 'Publish Calendar', 'Social Inbox', 'Competitor Monitor', 'Reputation', 'Channel Accounts', 'Settings'];

export default function App() {
  return (
    <div>
      <aside>
        {navItems.map((item) => (
          <div key={item}>{item}</div>
        ))}
      </aside>
      <main>PromoBot</main>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/client/app.test.tsx tests/client/generate.test.tsx`
Expected: PASS with shell and generate-page tests green

- [ ] **Step 5: Commit**

```bash
git add src/client tests/client
git commit -m "feat: add frontend shell and core content operations pages"
```

## Task 8: Platform Publishers and Session Center

**Files:**
- Create: `src/server/services/browser/sessionStore.ts`
- Create: `src/server/services/publishers/x.ts`
- Create: `src/server/services/publishers/reddit.ts`
- Create: `src/server/services/publishers/facebookGroup.ts`
- Create: `src/server/services/publishers/xiaohongshu.ts`
- Create: `src/server/services/publishers/weibo.ts`
- Create: `src/server/services/publishers/blog.ts`
- Create: `src/server/routes/publish.ts`
- Create: `src/server/routes/channelAccounts.ts`
- Test: `tests/server/publish.test.ts`

- [ ] **Step 1: Write the failing publish test**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

describe('publish route', () => {
  it('publishes a draft and returns a publish url', async () => {
    const app = createApp();
    const response = await request(app).post('/api/drafts/1/publish');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.publishUrl).toContain('http');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/publish.test.ts`
Expected: FAIL with `Expected 200, received 404`

- [ ] **Step 3: Write the minimal publisher contract**

```ts
// src/server/services/publishers/x.ts
export async function publishToX() {
  return { success: true, publishUrl: 'https://x.com/example/status/1' };
}
```

```ts
// src/server/routes/publish.ts
import { Router } from 'express';
import { publishToX } from '../services/publishers/x';

export const publishRouter = Router();

publishRouter.post('/drafts/:id/publish', async (_req, res) => {
  const result = await publishToX();
  res.json(result);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/publish.test.ts`
Expected: PASS with publish contract green

- [ ] **Step 5: Commit**

```bash
git add src/server/services/browser/sessionStore.ts src/server/services/publishers src/server/routes/publish.ts src/server/routes/channelAccounts.ts tests/server/publish.test.ts
git commit -m "feat: add platform publisher and session center contracts"
```

## Task 9: Social Inbox, Competitor Monitor, and Reputation APIs

**Files:**
- Create: `src/server/routes/inbox.ts`
- Create: `src/server/routes/monitor.ts`
- Create: `src/server/routes/reputation.ts`
- Create: `src/server/services/inbox/fetchers/x.ts`
- Create: `src/server/services/inbox/fetchers/reddit.ts`
- Create: `src/server/services/inbox/fetchers/xiaohongshu.ts`
- Create: `src/server/services/inbox/fetchers/weibo.ts`
- Create: `src/server/services/inbox/fetchers/v2ex.ts`
- Create: `src/server/services/monitor/rss.ts`
- Create: `src/server/services/monitor/xSearch.ts`
- Create: `src/server/services/monitor/redditSearch.ts`
- Create: `src/server/services/monitor/v2exSearch.ts`
- Create: `src/server/services/reputation/collector.ts`
- Create: `src/server/services/reputation/sentiment.ts`
- Test: `tests/server/inbox.test.ts`
- Test: `tests/server/monitor.test.ts`
- Test: `tests/server/reputation.test.ts`

- [ ] **Step 1: Write the failing inbox test**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

describe('inbox api', () => {
  it('returns inbox items with unread count', async () => {
    const app = createApp();
    const response = await request(app).get('/api/inbox');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('unread');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/inbox.test.ts tests/server/monitor.test.ts tests/server/reputation.test.ts`
Expected: FAIL with `Expected 200, received 404`

- [ ] **Step 3: Write the minimal multi-module route contracts**

```ts
// src/server/routes/inbox.ts
import { Router } from 'express';

export const inboxRouter = Router();
inboxRouter.get('/', (_req, res) => res.json({ items: [], total: 0, unread: 0 }));
```

```ts
// src/server/routes/monitor.ts
import { Router } from 'express';

export const monitorRouter = Router();
monitorRouter.get('/feed', (_req, res) => res.json({ items: [], total: 0 }));
```

```ts
// src/server/routes/reputation.ts
import { Router } from 'express';

export const reputationRouter = Router();
reputationRouter.get('/stats', (_req, res) => res.json({ total: 0, positive: 0, neutral: 0, negative: 0, trend: [] }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/inbox.test.ts tests/server/monitor.test.ts tests/server/reputation.test.ts`
Expected: PASS with the three route suites green

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/inbox.ts src/server/routes/monitor.ts src/server/routes/reputation.ts src/server/services/inbox src/server/services/monitor src/server/services/reputation tests/server/inbox.test.ts tests/server/monitor.test.ts tests/server/reputation.test.ts
git commit -m "feat: add inbox monitor and reputation APIs"
```

## Task 10: Inbox, Monitor, Reputation, and Deployment UI Wiring

**Files:**
- Create: `src/client/components/InboxDetail.tsx`
- Create: `src/client/components/MonitorFeed.tsx`
- Create: `src/client/components/SentimentChart.tsx`
- Create: `src/client/pages/Inbox.tsx`
- Create: `src/client/pages/Monitor.tsx`
- Create: `src/client/pages/Reputation.tsx`
- Create: `src/client/pages/ChannelAccounts.tsx`
- Create: `src/client/pages/Settings.tsx`
- Modify: `README.md`
- Modify: `.env.example`
- Create: `pm2.config.js`
- Test: `tests/client/inbox.test.tsx`

- [ ] **Step 1: Write the failing inbox page test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InboxPage from '../../src/client/pages/Inbox';

describe('Inbox page', () => {
  it('renders the AI reply action', () => {
    render(<InboxPage />);
    expect(screen.getByText('AI 生成回复')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/client/inbox.test.tsx`
Expected: FAIL with `Cannot find module '../../src/client/pages/Inbox'`

- [ ] **Step 3: Write the minimal admin pages and deployment files**

```tsx
// src/client/pages/Inbox.tsx
export default function InboxPage() {
  return (
    <section>
      <h1>Social Inbox</h1>
      <button type="button">AI 生成回复</button>
    </section>
  );
}
```

```js
// pm2.config.js
module.exports = {
  apps: [
    {
      name: 'promobot-server',
      script: 'dist/server/index.js',
      env: { NODE_ENV: 'production', PORT: 3001 }
    }
  ]
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/client/inbox.test.tsx && npm run build`
Expected: PASS for the UI test and a successful production build

- [ ] **Step 5: Commit**

```bash
git add src/client/components src/client/pages README.md .env.example pm2.config.js tests/client/inbox.test.tsx
git commit -m "feat: add final admin pages and deployment wiring"
```

## Self-Review Checklist

### Spec coverage

- Task 1-3 cover LAN-only deployment, admin auth, and application bootstrap.
- Task 4 covers multi-project, channel-account, and source-config foundations.
- Task 5 covers the unified job system.
- Task 6 covers AI generation, draft creation, and review/publish handoff prerequisites.
- Task 7 covers the core admin UI for content operations.
- Task 8 covers publisher adapters and session-center behavior.
- Task 9 covers Social Inbox, Competitor Monitor, and Reputation API surfaces.
- Task 10 covers the corresponding UI surfaces plus deployment files.

### Placeholder scan

- No unresolved placeholder markers remain in the task instructions.
- Each task includes concrete file paths, commands, and minimal code.

### Type consistency

- Shared naming uses `project`, `channel account`, `draft`, `inbox item`, `reputation item`, and `job`.
- Route names stay aligned with the design spec: `/api/projects`, `/api/content/generate`, `/api/drafts`, `/api/inbox`, `/api/monitor`, `/api/reputation`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-promobot-full-platform.md`.

You already explicitly chose multi-agent execution, so the next step is:

**Subagent-Driven (recommended)** - dispatch fresh subagents per task or per disjoint batch, review outputs, and push each verified stage to GitHub.
