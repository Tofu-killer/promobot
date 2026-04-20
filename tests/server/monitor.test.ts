import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createMonitorStore } from '../../src/server/store/monitor';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

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

const originalEnv = {
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_USERNAME: process.env.REDDIT_USERNAME,
  REDDIT_PASSWORD: process.env.REDDIT_PASSWORD,
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
};

afterEach(() => {
  process.env.REDDIT_CLIENT_ID = originalEnv.REDDIT_CLIENT_ID;
  process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
  process.env.REDDIT_USERNAME = originalEnv.REDDIT_USERNAME;
  process.env.REDDIT_PASSWORD = originalEnv.REDDIT_PASSWORD;
  process.env.REDDIT_USER_AGENT = originalEnv.REDDIT_USER_AGENT;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('monitor api', () => {
  it('fetches monitor items into SQLite through the manual fetch endpoint', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const response = await requestApp('POST', '/api/monitor/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'rss',
            status: 'new',
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            status: 'new',
          }),
          expect.objectContaining({
            id: 3,
            source: 'x',
            status: 'new',
          }),
        ],
        inserted: 3,
        total: 3,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('uses configured reddit monitor queries before falling back to seed data', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.REDDIT_CLIENT_ID = 'reddit-id';
      process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
      process.env.REDDIT_USERNAME = 'reddit-user';
      process.env.REDDIT_PASSWORD = 'reddit-pass';
      process.env.REDDIT_USER_AGENT = 'promobot/test';

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'reddit-access-token',
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                children: [
                  {
                    data: {
                      id: 'abc123',
                      title: 'Claude latency in Australia',
                      selftext: 'Operators comparing AU routing for Claude requests.',
                      permalink: '/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
                      subreddit_name_prefixed: 'r/LocalLLaMA',
                      author: 'latencywatch',
                    },
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          ),
        );
      vi.stubGlobal('fetch', fetchMock);

      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorRedditQueries: ['claude latency australia'],
      });

      expect(settingsResponse.status).toBe(200);

      const response = await requestApp('POST', '/api/monitor/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'reddit',
            title: 'Claude latency in Australia',
            detail:
              'r/LocalLLaMA · latencywatch\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
            status: 'new',
          }),
        ],
        inserted: 1,
        total: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('creates a follow-up draft from a monitor item', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const draftStore = createSQLiteDraftStore();
      const item = monitorStore.create({
        source: 'x',
        title: 'Competitor launched a lower tier',
        detail: 'Observed a cheaper plan and a follow-up opportunity.',
        status: 'new',
      });

      const response = await requestApp('POST', `/api/monitor/${item.id}/generate-follow-up`, {
        platform: 'x',
      });

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        draft: expect.objectContaining({
          id: 1,
          platform: 'x',
          title: expect.stringContaining('Follow-up'),
          content: expect.stringContaining('Competitor launched a lower tier'),
          status: 'draft',
        }),
      });
      expect(draftStore.list()).toHaveLength(1);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns 404 when the monitor item is missing', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const response = await requestApp('POST', '/api/monitor/404/generate-follow-up');

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'monitor item not found' });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
