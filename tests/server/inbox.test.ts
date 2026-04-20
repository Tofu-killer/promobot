import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createInboxStore } from '../../src/server/store/inbox';
import { createMonitorStore } from '../../src/server/store/monitor';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const originalEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  NODE_ENV: process.env.NODE_ENV,
};

async function requestApp(method: string, url: string, body?: unknown) {
  const app = createApp({
    allowedIps: ['127.0.0.1'],
    adminPassword: 'secret',
  });

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

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.AI_BASE_URL = originalEnv.AI_BASE_URL;
  process.env.AI_API_KEY = originalEnv.AI_API_KEY;
  process.env.AI_MODEL = originalEnv.AI_MODEL;
  process.env.NODE_ENV = originalEnv.NODE_ENV;
});

function installFetchStub(replyText: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: string };
      };

      expect(payload.response_format).toEqual({ type: 'json_object' });
      expect(payload.messages[0]?.role).toBe('system');
      expect(payload.messages[1]?.role).toBe('user');

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ reply: replyText }) } }],
        }),
      };
    }),
  );
}

describe('inbox api', () => {
  it('returns an empty inbox feed in production when no signals or configs are available', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.NODE_ENV = 'production';

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [],
        inserted: 0,
        total: 0,
        unread: 0,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('collects source-specific inbox signals so one fetcher can use monitor items while another falls back to config', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorV2exQueries: ['cursor api'],
      });

      expect(settingsResponse.status).toBe(200);

      const monitorStore = createMonitorStore();
      monitorStore.create({
        projectId: 1,
        source: 'reddit',
        title: 'Claude latency in Australia',
        detail:
          'r/LocalLLaMA · latencywatch\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
        status: 'new',
      });

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            source: 'reddit',
            status: 'needs_reply',
            title: 'Claude latency in Australia',
            excerpt:
              'r/LocalLLaMA · latencywatch\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
          }),
          expect.objectContaining({
            id: 2,
            source: 'v2ex',
            status: 'needs_reply',
            title: 'Inbox follow-up for cursor api',
            excerpt: 'Configured from monitorV2exQueries before live fetch results arrive.',
          }),
        ],
        inserted: 2,
        total: 2,
        unread: 2,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('falls back to configured monitor queries when no monitor items exist yet', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude latency australia'],
        monitorV2exQueries: ['cursor api'],
      });

      expect(settingsResponse.status).toBe(200);

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'x',
            status: 'needs_review',
            title: 'Inbox follow-up for openrouter failover',
            excerpt: 'Configured from monitorXQueries before live fetch results arrive.',
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            status: 'needs_reply',
            title: 'Inbox follow-up for claude latency australia',
            excerpt: 'Configured from monitorRedditQueries before live fetch results arrive.',
          }),
          expect.objectContaining({
            id: 3,
            source: 'v2ex',
            status: 'needs_reply',
            title: 'Inbox follow-up for cursor api',
            excerpt: 'Configured from monitorV2exQueries before live fetch results arrive.',
          }),
        ],
        inserted: 3,
        total: 3,
        unread: 3,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('falls back to enabled source configs when monitor items and global settings are absent', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectResponse = await requestApp('POST', '/api/projects', {
        name: 'Inbox Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Inbox workspace',
        sellingPoints: ['fast'],
      });
      expect(projectResponse.status).toBe(201);

      const sourceConfigs = [
        {
          projectId: 1,
          sourceType: 'rss',
          platform: 'blog',
          label: 'Competitor RSS',
          configJson: {
            url: 'https://feeds.example.com/monitor.xml',
          },
          enabled: true,
          pollIntervalMinutes: 30,
        },
        {
          projectId: 1,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Reddit mentions',
          configJson: {
            keywords: ['claude latency australia'],
          },
          enabled: true,
          pollIntervalMinutes: 30,
        },
        {
          projectId: 1,
          sourceType: 'keyword+x',
          platform: 'x',
          label: 'X mentions',
          configJson: {
            keywords: ['openrouter failover'],
          },
          enabled: true,
          pollIntervalMinutes: 30,
        },
        {
          projectId: 1,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'V2EX mentions',
          configJson: {
            query: 'cursor api',
          },
          enabled: true,
          pollIntervalMinutes: 30,
        },
        {
          projectId: 1,
          sourceType: 'keyword+x',
          platform: 'x',
          label: 'Disabled X mentions',
          configJson: {
            keywords: ['disabled query'],
          },
          enabled: false,
          pollIntervalMinutes: 30,
        },
      ];

      for (const sourceConfig of sourceConfigs) {
        const sourceConfigResponse = await requestApp(
          'POST',
          '/api/projects/1/source-configs',
          sourceConfig,
        );
        expect(sourceConfigResponse.status).toBe(201);
      }

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            source: 'reddit',
            status: 'needs_reply',
            title: 'Inbox follow-up for claude latency australia',
            excerpt: 'Derived from source config "Reddit mentions" before live fetch results arrive.',
          }),
          expect.objectContaining({
            id: 2,
            projectId: 1,
            source: 'x',
            status: 'needs_review',
            title: 'Inbox follow-up for openrouter failover',
            excerpt: 'Derived from source config "X mentions" before live fetch results arrive.',
          }),
          expect.objectContaining({
            id: 3,
            projectId: 1,
            source: 'v2ex',
            status: 'needs_reply',
            title: 'Inbox follow-up for cursor api',
            excerpt: 'Derived from source config "V2EX mentions" before live fetch results arrive.',
          }),
        ],
        inserted: 3,
        total: 3,
        unread: 3,
      });

      const inboxStore = createInboxStore();
      expect(inboxStore.list(1).map((item) => item.id)).toEqual([1, 2, 3]);
      expect(inboxStore.list(2)).toEqual([]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('lists inbox items by optional projectId without breaking legacy rows', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const legacyItem = inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'legacy-user',
        title: 'Legacy inbox item',
        excerpt: 'No project id attached.',
      });
      const projectOneItem = inboxStore.create({
        projectId: 1,
        source: 'x',
        status: 'needs_review',
        author: 'project-one',
        title: 'Project 1 inbox item',
        excerpt: 'Project 1 detail.',
      });
      const projectTwoItem = inboxStore.create({
        projectId: 2,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'project-two',
        title: 'Project 2 inbox item',
        excerpt: 'Project 2 detail.',
      });

      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: legacyItem.id,
          projectId: undefined,
          title: 'Legacy inbox item',
        }),
        expect.objectContaining({
          id: projectOneItem.id,
          projectId: 1,
          title: 'Project 1 inbox item',
        }),
        expect.objectContaining({
          id: projectTwoItem.id,
          projectId: 2,
          title: 'Project 2 inbox item',
        }),
      ]);
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          id: projectOneItem.id,
          projectId: 1,
          title: 'Project 1 inbox item',
        }),
      ]);
      expect(inboxStore.list(2)).toEqual([
        expect.objectContaining({
          id: projectTwoItem.id,
          projectId: 2,
          title: 'Project 2 inbox item',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('filters inbox items by optional projectId query', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'legacy-user',
        title: 'Legacy inbox item',
        excerpt: 'No project id attached.',
      });
      inboxStore.create({
        projectId: 1,
        source: 'x',
        status: 'handled',
        author: 'project-one-handled',
        title: 'Project 1 handled item',
        excerpt: 'Handled detail.',
      });
      const projectOneUnreadItem = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_reply',
        author: 'project-one-unread',
        title: 'Project 1 unread item',
        excerpt: 'Unread detail.',
      });
      inboxStore.create({
        projectId: 2,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'project-two',
        title: 'Project 2 item',
        excerpt: 'Project 2 detail.',
      });

      const response = await requestApp('GET', '/api/inbox?projectId=1');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            projectId: 1,
            title: 'Project 1 handled item',
          }),
          expect.objectContaining({
            id: projectOneUnreadItem.id,
            projectId: 1,
            title: 'Project 1 unread item',
          }),
        ],
        total: 2,
        unread: 1,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fetches inbox items for only the requested projectId', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const monitorStore = createMonitorStore();

      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'legacy-user',
        title: 'Legacy inbox item',
        excerpt: 'No project id attached.',
      });
      inboxStore.create({
        projectId: 2,
        source: 'reddit',
        status: 'needs_reply',
        author: 'project-two',
        title: 'Project 2 existing inbox item',
        excerpt: 'Project 2 inbox detail.',
      });

      monitorStore.create({
        projectId: 2,
        source: 'reddit',
        title: 'Project 2 monitor signal',
        detail: 'r/LocalLLaMA · project-two\n\nhttps://www.reddit.com/r/test/comments/project2',
        status: 'new',
      });

      const projectPayload = {
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Scoped inbox workspace',
        sellingPoints: ['fast'],
      };
      expect(
        (await requestApp('POST', '/api/projects', { ...projectPayload, name: 'Project One' })).status,
      ).toBe(201);
      expect(
        (await requestApp('POST', '/api/projects', { ...projectPayload, name: 'Project Two' })).status,
      ).toBe(201);

      expect(
        (
          await requestApp('POST', '/api/projects/1/source-configs', {
            projectId: 1,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Project 1 Reddit',
            configJson: { keywords: ['project one query'] },
            enabled: true,
            pollIntervalMinutes: 30,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await requestApp('POST', '/api/projects/2/source-configs', {
            projectId: 2,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Project 2 Reddit',
            configJson: { keywords: ['project two query'] },
            enabled: true,
            pollIntervalMinutes: 30,
          })
        ).status,
      ).toBe(201);

      const response = await requestApp('POST', '/api/inbox/fetch', {
        projectId: 1,
      });

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            projectId: 1,
            source: 'reddit',
            status: 'needs_reply',
            title: 'Inbox follow-up for project one query',
            excerpt: 'Derived from source config "Project 1 Reddit" before live fetch results arrive.',
          }),
        ],
        inserted: 1,
        total: 1,
        unread: 1,
      });
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          projectId: 1,
          title: 'Inbox follow-up for project one query',
        }),
      ]);
      expect(inboxStore.list(2)).toEqual([
        expect.objectContaining({
          projectId: 2,
          title: 'Project 2 existing inbox item',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns inbox items with total and unread counts from SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
      });

      const response = await requestApp('GET', '/api/inbox');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Need lower latency in APAC',
          }),
        ],
        total: 1,
        unread: 1,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('updates inbox item status', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
      });

      const response = await requestApp('PATCH', '/api/inbox/1', {
        status: 'handled',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'handled',
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns an AI reply suggestion for an inbox item', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.AI_BASE_URL = 'https://example.test/v1';
      process.env.AI_API_KEY = 'test-key';
      process.env.AI_MODEL = 'test-model';
      installFetchStub('We are seeing strong APAC performance.');

      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
      });

      const response = await requestApp('POST', '/api/inbox/1/suggest-reply');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        suggestion: {
          reply: 'We are seeing strong APAC performance.',
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
