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
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  MONITOR_X_QUERIES: process.env.MONITOR_X_QUERIES,
  MONITOR_X_SEARCH_SEEDS: process.env.MONITOR_X_SEARCH_SEEDS,
};

afterEach(() => {
  restoreEnv('REDDIT_CLIENT_ID', originalEnv.REDDIT_CLIENT_ID);
  restoreEnv('REDDIT_CLIENT_SECRET', originalEnv.REDDIT_CLIENT_SECRET);
  restoreEnv('REDDIT_USERNAME', originalEnv.REDDIT_USERNAME);
  restoreEnv('REDDIT_PASSWORD', originalEnv.REDDIT_PASSWORD);
  restoreEnv('REDDIT_USER_AGENT', originalEnv.REDDIT_USER_AGENT);
  restoreEnv('X_ACCESS_TOKEN', originalEnv.X_ACCESS_TOKEN);
  restoreEnv('X_BEARER_TOKEN', originalEnv.X_BEARER_TOKEN);
  restoreEnv('MONITOR_X_QUERIES', originalEnv.MONITOR_X_QUERIES);
  restoreEnv('MONITOR_X_SEARCH_SEEDS', originalEnv.MONITOR_X_SEARCH_SEEDS);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

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

  it('fetches monitor items from enabled source configs before generic seed fallback', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.REDDIT_CLIENT_ID = 'reddit-id';
      process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
      process.env.REDDIT_USERNAME = 'reddit-user';
      process.env.REDDIT_PASSWORD = 'reddit-pass';
      process.env.REDDIT_USER_AGENT = 'promobot/test';
      delete process.env.X_ACCESS_TOKEN;
      delete process.env.X_BEARER_TOKEN;
      process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
        {
          id: '1888888888888',
          query: 'openrouter failover',
          title: 'OpenRouter failover thread',
          text: 'Operators comparing AU routing and warm failover.',
          author: 'routingwatch',
          url: 'https://x.com/routingwatch/status/1888888888888',
        },
      ]);

      const projectResponse = await requestApp('POST', '/api/projects', {
        name: 'Monitor Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Monitoring workspace',
        sellingPoints: ['fast'],
      });
      expect(projectResponse.status).toBe(201);

      const sourceConfigs = [
        {
          projectId: 1,
          sourceType: 'rss',
          platform: 'blog',
          label: 'Competitor RSS',
          configJson: { url: 'https://feeds.example.com/monitor.xml' },
          enabled: true,
          pollIntervalMinutes: 15,
        },
        {
          projectId: 1,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Reddit mentions',
          configJson: { keywords: ['claude latency australia'] },
          enabled: true,
          pollIntervalMinutes: 15,
        },
        {
          projectId: 1,
          sourceType: 'keyword+x',
          platform: 'x',
          label: 'X mentions',
          configJson: { keywords: ['openrouter failover'] },
          enabled: true,
          pollIntervalMinutes: 15,
        },
        {
          projectId: 1,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'V2EX mentions',
          configJson: { query: 'cursor api' },
          enabled: true,
          pollIntervalMinutes: 15,
        },
        {
          projectId: 1,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Disabled Reddit mentions',
          configJson: { keywords: ['should stay disabled'] },
          enabled: false,
          pollIntervalMinutes: 15,
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

      const requestedUrls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (input: string | URL | Request) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          requestedUrls.push(url);

          if (url === 'https://feeds.example.com/monitor.xml') {
            return new Response(
              `<?xml version="1.0" encoding="UTF-8"?>
              <rss version="2.0">
                <channel>
                  <title>Example Feed</title>
                  <item>
                    <title>AU pricing update</title>
                    <description>Tracked pricing change for APAC buyers.</description>
                    <link>https://example.com/posts/au-pricing</link>
                  </item>
                </channel>
              </rss>`,
              {
                status: 200,
                headers: { 'Content-Type': 'application/rss+xml' },
              },
            );
          }

          if (url === 'https://www.reddit.com/api/v1/access_token') {
            return new Response(JSON.stringify({ access_token: 'reddit-access-token' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (url.startsWith('https://oauth.reddit.com/search?')) {
            expect(new URL(url).searchParams.get('q')).toBe('claude latency australia');

            return new Response(
              JSON.stringify({
                data: {
                  children: [
                    {
                      data: {
                        id: 'abc123',
                        title: 'Claude latency in Australia',
                        selftext: 'Operators comparing AU routing for Claude requests.',
                        permalink:
                          '/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
                        subreddit_name_prefixed: 'r/LocalLLaMA',
                        author: 'latencywatch',
                      },
                    },
                  ],
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          if (url.startsWith('https://www.v2ex.com/search?')) {
            expect(new URL(url).searchParams.get('q')).toBe('cursor api');

            return new Response(
              `
              <div class="cell item">
                <span class="item_title">
                  <a href="/t/123456">Cursor API pricing discussion</a>
                </span>
                <a class="node" href="/go/openai">OpenAI</a>
                <a href="/member/builder">builder</a>
                <a class="count_livid" href="/t/123456#reply3">3 replies</a>
              </div>
              `,
              {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              },
            );
          }

          throw new Error(`unexpected fetch url: ${url}`);
        }),
      );

      const response = await requestApp('POST', '/api/monitor/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            source: 'rss',
            title: 'AU pricing update',
            detail: 'Tracked pricing change for APAC buyers.\n\nhttps://example.com/posts/au-pricing',
            status: 'new',
          }),
          expect.objectContaining({
            id: 2,
            projectId: 1,
            source: 'reddit',
            title: 'Claude latency in Australia',
            detail:
              'r/LocalLLaMA · latencywatch\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
            status: 'new',
          }),
          expect.objectContaining({
            id: 3,
            projectId: 1,
            source: 'x',
            title: 'OpenRouter failover thread',
            detail:
              '@routingwatch · matched x search seed for openrouter failover\n\nhttps://x.com/routingwatch/status/1888888888888',
            status: 'new',
          }),
          expect.objectContaining({
            id: 4,
            projectId: 1,
            source: 'v2ex',
            title: 'Cursor API pricing discussion',
            detail:
              'V2EX OpenAI · builder · 3 replies\n\nhttps://www.v2ex.com/t/123456',
            status: 'new',
          }),
        ],
        inserted: 4,
        total: 4,
      });

      const monitorStore = createMonitorStore();
      expect(monitorStore.list(1).map((item) => item.id)).toEqual([1, 2, 3, 4]);
      expect(monitorStore.list(2)).toEqual([]);
      expect(requestedUrls.join('\n')).not.toContain('should%20stay%20disabled');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('lists monitor items by optional projectId without breaking legacy rows', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const legacyItem = monitorStore.create({
        source: 'rss',
        title: 'Legacy signal',
        detail: 'No project id attached.',
        status: 'new',
      });
      const projectOneItem = monitorStore.create({
        projectId: 1,
        source: 'reddit',
        title: 'Project 1 signal',
        detail: 'Project 1 detail.',
        status: 'new',
      });
      const projectTwoItem = monitorStore.create({
        projectId: 2,
        source: 'x',
        title: 'Project 2 signal',
        detail: 'Project 2 detail.',
        status: 'new',
      });

      expect(monitorStore.list()).toEqual([
        expect.objectContaining({
          id: legacyItem.id,
          projectId: undefined,
          title: 'Legacy signal',
        }),
        expect.objectContaining({
          id: projectOneItem.id,
          projectId: 1,
          title: 'Project 1 signal',
        }),
        expect.objectContaining({
          id: projectTwoItem.id,
          projectId: 2,
          title: 'Project 2 signal',
        }),
      ]);
      expect(monitorStore.list(1)).toEqual([
        expect.objectContaining({
          id: projectOneItem.id,
          projectId: 1,
          title: 'Project 1 signal',
        }),
      ]);
      expect(monitorStore.list(2)).toEqual([
        expect.objectContaining({
          id: projectTwoItem.id,
          projectId: 2,
          title: 'Project 2 signal',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('falls back to configured x search seeds when no x token is available', async () => {
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_BEARER_TOKEN;
    process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
      {
        id: '1888888888888',
        query: 'openrouter failover',
        title: 'OpenRouter failover thread',
        text: 'Operators comparing AU routing and warm failover.',
        author: 'routingwatch',
        url: 'https://x.com/routingwatch/status/1888888888888',
      },
    ]);

    const { searchX } = await import('../../src/server/services/monitor/xSearch');
    const items = await searchX('openrouter failover');

    expect(items).toEqual([
      expect.objectContaining({
        externalId: '1888888888888',
        source: 'x',
        sourceType: 'x_search',
        title: 'OpenRouter failover thread',
        detail: '@routingwatch · matched x search seed for openrouter failover',
        content: 'Operators comparing AU routing and warm failover.',
        summary: 'OpenRouter failover thread',
        url: 'https://x.com/routingwatch/status/1888888888888',
        matchedKeywords: ['openrouter failover'],
        metadata: expect.objectContaining({
          mode: 'seed',
          searchQuery: 'openrouter failover',
        }),
      }),
    ]);
  });

  it('collects x search signals through monitorFetch before generic seed fallback', async () => {
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_BEARER_TOKEN;
    process.env.MONITOR_X_QUERIES = 'openrouter failover';
    process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
      {
        id: '1888888888888',
        query: 'openrouter failover',
        title: 'OpenRouter failover thread',
        text: 'Operators comparing AU routing and warm failover.',
        author: 'routingwatch',
        url: 'https://x.com/routingwatch/status/1888888888888',
      },
    ]);

    const { collectConfiguredSignals } = await import('../../src/server/services/monitorFetch');
    const signals = await collectConfiguredSignals(
      {
        fetchFeeds: vi.fn().mockResolvedValue({
          items: [],
          failures: [],
        }),
      } as never,
      {
        monitorRssFeeds: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
    );

    expect(signals).toEqual([
      {
        source: 'x',
        title: 'OpenRouter failover thread',
        detail:
          '@routingwatch · matched x search seed for openrouter failover\n\nhttps://x.com/routingwatch/status/1888888888888',
      },
    ]);
  });

  it('uses enabled source configs to drive monitor fetch when env settings are absent', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      delete process.env.MONITOR_X_QUERIES;
      delete process.env.MONITOR_X_SEARCH_SEEDS;
      process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
        {
          id: '1777777777777',
          query: 'router failover',
          title: 'Router failover mention',
          text: 'Comparing failover setups for APAC traffic.',
          author: 'queuewatch',
          url: 'https://x.com/queuewatch/status/1777777777777',
        },
      ]);

      const projectResponse = await requestApp('POST', '/api/projects', {
        name: 'Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Signals workspace',
        sellingPoints: ['fast'],
      });
      expect(projectResponse.status).toBe(201);

      const sourceConfigResponse = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'keyword',
        platform: 'x',
        label: 'X failover',
        configJson: {
          query: 'router failover',
        },
        enabled: true,
        pollIntervalMinutes: 15,
      });
      expect(sourceConfigResponse.status).toBe(201);

      const response = await requestApp('POST', '/api/monitor/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'x',
            title: 'Router failover mention',
            detail:
              '@queuewatch · matched x search seed for router failover\n\nhttps://x.com/queuewatch/status/1777777777777',
            status: 'new',
          }),
        ],
        inserted: 1,
        total: 1,
      });
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
