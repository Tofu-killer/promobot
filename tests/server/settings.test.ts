import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

const originalBlogEnv = {
  BLOG_PUBLISH_DRIVER: process.env.BLOG_PUBLISH_DRIVER,
  BLOG_PUBLISH_OUTPUT_DIR: process.env.BLOG_PUBLISH_OUTPUT_DIR,
  BLOG_WORDPRESS_SITE_URL: process.env.BLOG_WORDPRESS_SITE_URL,
  BLOG_WORDPRESS_USERNAME: process.env.BLOG_WORDPRESS_USERNAME,
  BLOG_WORDPRESS_APP_PASSWORD: process.env.BLOG_WORDPRESS_APP_PASSWORD,
  BLOG_GHOST_ADMIN_URL: process.env.BLOG_GHOST_ADMIN_URL,
  BLOG_GHOST_ADMIN_API_KEY: process.env.BLOG_GHOST_ADMIN_API_KEY,
};

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
  let restoreCwd: (() => void) | null = null;

  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
    process.env.BLOG_PUBLISH_DRIVER = 'file';
    delete process.env.BLOG_PUBLISH_OUTPUT_DIR;
    delete process.env.BLOG_WORDPRESS_SITE_URL;
    delete process.env.BLOG_WORDPRESS_USERNAME;
    delete process.env.BLOG_WORDPRESS_APP_PASSWORD;
    delete process.env.BLOG_GHOST_ADMIN_URL;
    delete process.env.BLOG_GHOST_ADMIN_API_KEY;
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
    process.env.BLOG_PUBLISH_DRIVER = originalBlogEnv.BLOG_PUBLISH_DRIVER;
    process.env.BLOG_PUBLISH_OUTPUT_DIR = originalBlogEnv.BLOG_PUBLISH_OUTPUT_DIR;
    process.env.BLOG_WORDPRESS_SITE_URL = originalBlogEnv.BLOG_WORDPRESS_SITE_URL;
    process.env.BLOG_WORDPRESS_USERNAME = originalBlogEnv.BLOG_WORDPRESS_USERNAME;
    process.env.BLOG_WORDPRESS_APP_PASSWORD = originalBlogEnv.BLOG_WORDPRESS_APP_PASSWORD;
    process.env.BLOG_GHOST_ADMIN_URL = originalBlogEnv.BLOG_GHOST_ADMIN_URL;
    process.env.BLOG_GHOST_ADMIN_API_KEY = originalBlogEnv.BLOG_GHOST_ADMIN_API_KEY;
  });

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
            platform: 'blog',
            ready: true,
            status: 'ready',
          }),
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: false,
            status: 'needs_session',
          }),
          expect.objectContaining({
            platform: 'instagram',
            ready: false,
            status: 'needs_session',
          }),
          expect.objectContaining({
            platform: 'tiktok',
            ready: false,
            status: 'needs_session',
          }),
          expect.objectContaining({
            platform: 'xiaohongshu',
            ready: false,
            status: 'needs_session',
          }),
          expect.objectContaining({
            platform: 'weibo',
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

  it('surfaces wordpress blog readiness as needs_config when cms credentials are incomplete', async () => {
    const { rootDir } = createTestDatabasePath();
    const originalDriver = process.env.BLOG_PUBLISH_DRIVER;
    const originalSiteUrl = process.env.BLOG_WORDPRESS_SITE_URL;
    const originalUsername = process.env.BLOG_WORDPRESS_USERNAME;
    const originalAppPassword = process.env.BLOG_WORDPRESS_APP_PASSWORD;

    try {
      process.env.BLOG_PUBLISH_DRIVER = 'wordpress';
      process.env.BLOG_WORDPRESS_SITE_URL = 'https://cms.example.com';
      delete process.env.BLOG_WORDPRESS_USERNAME;
      delete process.env.BLOG_WORDPRESS_APP_PASSWORD;

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'blog',
            ready: false,
            mode: 'api',
            status: 'needs_config',
            action: 'configure_credentials',
            details: expect.objectContaining({
              driver: 'wordpress',
              credentials: {
                hasSiteUrl: true,
                hasUsername: false,
                hasAppPassword: false,
              },
            }),
          }),
        ]),
      });
    } finally {
      process.env.BLOG_PUBLISH_DRIVER = originalDriver;
      process.env.BLOG_WORDPRESS_SITE_URL = originalSiteUrl;
      process.env.BLOG_WORDPRESS_USERNAME = originalUsername;
      process.env.BLOG_WORDPRESS_APP_PASSWORD = originalAppPassword;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('surfaces ghost blog readiness as ready when admin api credentials are configured', async () => {
    const { rootDir } = createTestDatabasePath();
    const originalDriver = process.env.BLOG_PUBLISH_DRIVER;
    const originalAdminUrl = process.env.BLOG_GHOST_ADMIN_URL;
    const originalApiKey = process.env.BLOG_GHOST_ADMIN_API_KEY;

    try {
      process.env.BLOG_PUBLISH_DRIVER = 'ghost';
      process.env.BLOG_GHOST_ADMIN_URL = 'https://ghost.example.com';
      process.env.BLOG_GHOST_ADMIN_API_KEY =
        '1234567890abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'blog',
            ready: true,
            mode: 'api',
            status: 'ready',
            details: expect.objectContaining({
              driver: 'ghost',
              adminUrl: 'https://ghost.example.com/ghost',
            }),
          }),
        ]),
      });
    } finally {
      process.env.BLOG_PUBLISH_DRIVER = originalDriver;
      process.env.BLOG_GHOST_ADMIN_URL = originalAdminUrl;
      process.env.BLOG_GHOST_ADMIN_API_KEY = originalApiKey;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('surfaces ghost blog readiness as needs_config when admin api key format is invalid', async () => {
    const { rootDir } = createTestDatabasePath();
    const originalDriver = process.env.BLOG_PUBLISH_DRIVER;
    const originalAdminUrl = process.env.BLOG_GHOST_ADMIN_URL;
    const originalApiKey = process.env.BLOG_GHOST_ADMIN_API_KEY;

    try {
      process.env.BLOG_PUBLISH_DRIVER = 'ghost';
      process.env.BLOG_GHOST_ADMIN_URL = 'https://ghost.example.com/';
      process.env.BLOG_GHOST_ADMIN_API_KEY = 'invalid-key';

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'blog',
            ready: false,
            mode: 'api',
            status: 'needs_config',
            action: 'configure_credentials',
            details: expect.objectContaining({
              driver: 'ghost',
              adminUrl: 'https://ghost.example.com/ghost',
              credentials: {
                hasAdminUrl: true,
                hasAdminApiKey: true,
                ghostAdminApiKeyValid: false,
              },
            }),
          }),
        ]),
      });
    } finally {
      process.env.BLOG_PUBLISH_DRIVER = originalDriver;
      process.env.BLOG_GHOST_ADMIN_URL = originalAdminUrl;
      process.env.BLOG_GHOST_ADMIN_API_KEY = originalApiKey;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('supports patching monitor source settings without breaking legacy settings', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const initial = await requestApp('PATCH', '/api/settings', {
        allowlist: ['127.0.0.1', '10.0.0.24'],
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
          allowlist: ['127.0.0.1', '10.0.0.24'],
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
          allowlist: ['127.0.0.1', '10.0.0.24'],
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

  it('rejects invalid allowlist entries when CIDR syntax is malformed', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const response = await requestApp('PATCH', '/api/settings', {
        allowlist: ['127.0.0.1', '10.0.0.0/33'],
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'invalid allowlist',
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

      const storageStatePath = path.join(rootDir, 'artifacts', 'browser-sessions', 'facebook-group.json');
      mkdirSync(path.dirname(storageStatePath), { recursive: true });
      writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

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

  it('reports facebookGroup readiness as needs_session when the saved storage state file is missing', async () => {
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
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        validatedAt: '2026-04-19T12:34:56.000Z',
      });

      rmSync(path.join(rootDir, 'browser-sessions', 'managed', 'facebookGroup', 'launch-campaign.json'));

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: false,
            mode: 'browser',
            status: 'needs_session',
            message: 'Facebook Group 需要先保存浏览器 session，发布时再手动接管。',
            action: 'request_session',
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reports facebookGroup readiness as ready when a managed session file exists without saved metadata', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'unknown',
      });

      const storageStatePath = path.join(
        rootDir,
        'browser-sessions',
        'managed',
        'facebookGroup',
        'launch-campaign.json',
      );
      mkdirSync(path.dirname(storageStatePath), { recursive: true });
      writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: 'Facebook Group 已检测到 1 个可用浏览器 session。',
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reports facebookGroup readiness as ready again when a managed session file reappears after a missing downgrade', async () => {
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
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        validatedAt: '2026-04-19T12:34:56.000Z',
      });

      const storageStatePath = path.join(
        rootDir,
        'browser-sessions',
        'managed',
        'facebookGroup',
        'launch-campaign.json',
      );
      rmSync(storageStatePath);

      const missing = await requestApp('GET', '/api/settings');
      expect(missing.status).toBe(200);
      expect(JSON.parse(missing.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: false,
            mode: 'browser',
            status: 'needs_session',
            action: 'request_session',
          }),
        ]),
      });

      mkdirSync(path.dirname(storageStatePath), { recursive: true });
      writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

      const restored = await requestApp('GET', '/api/settings');
      expect(restored.status).toBe(200);
      expect(JSON.parse(restored.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'facebookGroup',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: 'Facebook Group 已检测到 1 个可用浏览器 session。',
            details: expect.objectContaining({
              activeSessionCount: 1,
              expiredSessionCount: 0,
              missingSessionCount: 0,
            }),
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reports xiaohongshu and weibo readiness from browser session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'xiaohongshu',
        accountKey: 'brand-notes',
        displayName: 'Brand Notes',
        authType: 'browser',
        status: 'unknown',
      });
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'weibo',
        accountKey: '@promobot',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'unknown',
      });

      const xiaohongshuStorageStatePath = path.join(
        rootDir,
        'artifacts',
        'browser-sessions',
        'xiaohongshu-brand-notes.json',
      );
      mkdirSync(path.dirname(xiaohongshuStorageStatePath), { recursive: true });
      writeFileSync(xiaohongshuStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

      const weiboStorageStatePath = path.join(
        rootDir,
        'artifacts',
        'browser-sessions',
        'weibo-promobot.json',
      );
      mkdirSync(path.dirname(weiboStorageStatePath), { recursive: true });
      writeFileSync(weiboStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/xiaohongshu-brand-notes.json',
        status: 'expired',
        validatedAt: '2026-04-20T12:34:56.000Z',
      });
      await requestApp('POST', '/api/channel-accounts/2/session', {
        storageStatePath: 'artifacts/browser-sessions/weibo-promobot.json',
        status: 'active',
        validatedAt: '2026-04-20T12:35:56.000Z',
      });

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'xiaohongshu',
            ready: false,
            mode: 'browser',
            status: 'needs_relogin',
            message: '已有 小红书 浏览器 session，但需要重新登录刷新。',
            action: 'relogin',
          }),
          expect.objectContaining({
            platform: 'weibo',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: '微博 已检测到 1 个可用浏览器 session。',
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reports xiaohongshu and weibo readiness from browser session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'xiaohongshu',
        accountKey: 'xhs-main',
        displayName: 'PromoBot XHS',
        authType: 'browser',
        status: 'unknown',
      });
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'weibo',
        accountKey: 'weibo-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'unknown',
      });

      const xhsStorageStatePath = path.join(rootDir, 'artifacts', 'browser-sessions', 'xiaohongshu.json');
      const weiboStorageStatePath = path.join(rootDir, 'artifacts', 'browser-sessions', 'weibo.json');
      mkdirSync(path.dirname(xhsStorageStatePath), { recursive: true });
      writeFileSync(xhsStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));
      writeFileSync(weiboStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
        status: 'active',
      });
      await requestApp('POST', '/api/channel-accounts/2/session', {
        storageStatePath: 'artifacts/browser-sessions/weibo.json',
        status: 'expired',
      });

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'xiaohongshu',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: '小红书 已检测到 1 个可用浏览器 session。',
          }),
          expect.objectContaining({
            platform: 'weibo',
            ready: false,
            mode: 'browser',
            status: 'needs_relogin',
            message: '已有 微博 浏览器 session，但需要重新登录刷新。',
            action: 'relogin',
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reports instagram and tiktok readiness from browser session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'instagram',
        accountKey: 'instagram-main',
        displayName: 'PromoBot Instagram',
        authType: 'browser',
        status: 'unknown',
      });
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'tiktok',
        accountKey: 'tiktok-main',
        displayName: 'PromoBot TikTok',
        authType: 'browser',
        status: 'unknown',
      });

      const instagramStorageStatePath = path.join(rootDir, 'artifacts', 'browser-sessions', 'instagram.json');
      const tiktokStorageStatePath = path.join(rootDir, 'artifacts', 'browser-sessions', 'tiktok.json');
      mkdirSync(path.dirname(instagramStorageStatePath), { recursive: true });
      writeFileSync(instagramStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));
      writeFileSync(tiktokStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/instagram.json',
        status: 'active',
      });
      await requestApp('POST', '/api/channel-accounts/2/session', {
        storageStatePath: 'artifacts/browser-sessions/tiktok.json',
        status: 'expired',
      });

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.any(Object),
        platforms: expect.arrayContaining([
          expect.objectContaining({
            platform: 'instagram',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: 'Instagram 已检测到 1 个可用浏览器 session。',
          }),
          expect.objectContaining({
            platform: 'tiktok',
            ready: false,
            mode: 'browser',
            status: 'needs_relogin',
            message: '已有 TikTok 浏览器 session，但需要重新登录刷新。',
            action: 'relogin',
          }),
        ]),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
