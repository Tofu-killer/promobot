import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

async function requestApp(
  method: string,
  url: string,
  body?: unknown,
  dependencies?: Parameters<typeof createApp>[1],
) {
  const app = createApp({
    allowedIps: ['127.0.0.1'],
    adminPassword: 'secret',
  }, dependencies);

  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = Object.assign(Object.create(app.request), {
      app,
      method,
      url,
      originalUrl: url,
      headers: { 'x-admin-password': 'secret' },
      socket: { remoteAddress: '127.0.0.1' },
      connection: { remoteAddress: '127.0.0.1' },
    });

    let responseBody = '';
    const responseHeaders = new Map<string, string>();
    const res = Object.create(app.response);
    Object.assign(res, {
      app,
      req,
      locals: {},
      statusCode: 200,
      setHeader(name: string, value: string) {
        responseHeaders.set(name.toLowerCase(), value);
      },
      getHeader(name: string) {
        return responseHeaders.get(name.toLowerCase());
      },
      removeHeader(name: string) {
        responseHeaders.delete(name.toLowerCase());
      },
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
        return this;
      },
      write(chunk: string) {
        responseBody += chunk;
        return true;
      },
      end(chunk?: string) {
        if (chunk) responseBody += chunk;
        resolve({ status: this.statusCode, body: responseBody });
        return this;
      },
    });
    Object.defineProperty(res, 'headersSent', {
      configurable: true,
      enumerable: true,
      get() {
        return false;
      },
    });

    req.res = res;
    res.socket = req.socket;

    let settled = false;
    const finish = (result: { status: number; body: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    res.end = (chunk?: string) => {
      if (chunk) responseBody += chunk;
      finish({ status: res.statusCode, body: responseBody });
      return res;
    };

    if (body !== undefined) {
      req.body = body;
    }

    app.handle(req, res, (error?: unknown) => {
      if (settled) return;
      if (error) {
        settled = true;
        reject(error);
        return;
      }
      finish({ status: 404, body: responseBody });
    });
  });
}

describe('settings api', () => {
  it('persists allowlist and scheduler settings in SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.X_ACCESS_TOKEN = 'x-token';
      process.env.REDDIT_CLIENT_ID = 'reddit-id';
      process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
      process.env.REDDIT_USERNAME = 'reddit-user';
      process.env.REDDIT_PASSWORD = 'reddit-pass';

      const updated = await requestApp('PATCH', '/api/settings', {
        allowlist: ['127.0.0.1', '10.0.0.0/24'],
        schedulerIntervalMinutes: 30,
        rssDefaults: ['OpenAI blog', 'Anthropic news'],
        monitorRssFeeds: ['https://openai.com/blog/rss.xml', 'https://example.com/feed.xml'],
        monitorXQueries: ['openrouter failover', 'claude latency'],
        monitorRedditQueries: ['claude api latency', 'openrouter australia'],
        monitorV2exQueries: ['openai api', 'llm router'],
      });

      expect(updated.status).toBe(200);

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.objectContaining({
          allowlist: ['127.0.0.1', '10.0.0.0/24'],
          schedulerIntervalMinutes: 30,
          rssDefaults: ['OpenAI blog', 'Anthropic news'],
          monitorRssFeeds: ['https://openai.com/blog/rss.xml', 'https://example.com/feed.xml'],
          monitorXQueries: ['openrouter failover', 'claude latency'],
          monitorRedditQueries: ['claude api latency', 'openrouter australia'],
          monitorV2exQueries: ['openai api', 'llm router'],
        }),
        platforms: [
          expect.objectContaining({
            platform: 'x',
            ready: true,
            status: 'ready',
          }),
          expect.objectContaining({
            platform: 'reddit',
            ready: true,
            status: 'ready',
          }),
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: false,
            status: 'needs_session',
          }),
        ],
      });
    } finally {
      delete process.env.X_ACCESS_TOKEN;
      delete process.env.REDDIT_CLIENT_ID;
      delete process.env.REDDIT_CLIENT_SECRET;
      delete process.env.REDDIT_USERNAME;
      delete process.env.REDDIT_PASSWORD;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('supports patching monitor source settings without breaking legacy settings', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const initial = await requestApp('PATCH', '/api/settings', {
        allowlist: ['127.0.0.1', '10.0.0.0/24'],
        schedulerIntervalMinutes: 45,
        rssDefaults: ['OpenAI blog'],
      });

      expect(initial.status).toBe(200);

      const updated = await requestApp('PATCH', '/api/settings', {
        monitorRssFeeds: ['https://news.ycombinator.com/rss', 'https://example.com/alerts.xml'],
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['local llm'],
        monitorV2exQueries: ['australia saas'],
      });

      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        settings: expect.objectContaining({
          allowlist: ['127.0.0.1', '10.0.0.0/24'],
          schedulerIntervalMinutes: 45,
          rssDefaults: ['OpenAI blog'],
          monitorRssFeeds: ['https://news.ycombinator.com/rss', 'https://example.com/alerts.xml'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['local llm'],
          monitorV2exQueries: ['australia saas'],
        }),
        platforms: expect.any(Array),
      });

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.objectContaining({
          allowlist: ['127.0.0.1', '10.0.0.0/24'],
          schedulerIntervalMinutes: 45,
          rssDefaults: ['OpenAI blog'],
          monitorRssFeeds: ['https://news.ycombinator.com/rss', 'https://example.com/alerts.xml'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['local llm'],
          monitorV2exQueries: ['australia saas'],
        }),
        platforms: expect.any(Array),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('includes runtime status and reloads scheduler when runtime is provided', async () => {
    const { rootDir } = createTestDatabasePath();
    const calls: string[] = [];
    const schedulerRuntime = {
      getStatus() {
        calls.push('getStatus');
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: '2026-04-19T12:00:00.000Z',
          lastTickAt: null,
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      reload() {
        calls.push('reload');
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 30,
          pollMs: 1800000,
          bootedAt: '2026-04-19T12:00:00.000Z',
          lastTickAt: null,
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      async tickNow() {
        return [];
      },
      enqueueJob() {
        throw new Error('not implemented');
      },
      stop() {},
    };

    try {
      const loaded = await requestApp('GET', '/api/settings', undefined, {
        schedulerRuntime,
      });

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.objectContaining({
          schedulerIntervalMinutes: 15,
          monitorRssFeeds: [],
          monitorXQueries: [],
          monitorRedditQueries: [],
          monitorV2exQueries: [],
        }),
        platforms: expect.any(Array),
        runtime: expect.objectContaining({
          available: true,
          started: true,
        }),
      });

      const updated = await requestApp(
        'PATCH',
        '/api/settings',
        {
          allowlist: ['127.0.0.1'],
          schedulerIntervalMinutes: 30,
          rssDefaults: ['OpenAI blog'],
        },
        {
          schedulerRuntime,
        },
      );

      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        settings: expect.objectContaining({
          schedulerIntervalMinutes: 30,
          monitorRssFeeds: [],
          monitorXQueries: [],
          monitorRedditQueries: [],
          monitorV2exQueries: [],
        }),
        platforms: expect.any(Array),
        runtime: expect.objectContaining({
          schedulerIntervalMinutes: 30,
          pollMs: 1800000,
        }),
      });
      expect(calls).toEqual(['getStatus', 'reload']);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reports facebookGroup readiness as relogin when only expired browser sessions exist', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'unknown',
      });

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        status: 'expired',
        validatedAt: '2026-04-19T12:34:56.000Z',
      });

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: false,
            mode: 'browser',
            status: 'needs_relogin',
            message: '已有 Facebook Group 浏览器 session，但需要重新登录刷新。',
            action: 'relogin',
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
