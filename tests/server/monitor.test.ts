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
  NODE_ENV: process.env.NODE_ENV,
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
  restoreEnv('NODE_ENV', originalEnv.NODE_ENV);
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
  it('returns an empty monitor feed in production when no real sources are configured', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.NODE_ENV = 'production';

      const response = await requestApp('POST', '/api/monitor/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [],
        inserted: 0,
        total: 0,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

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

  it('uses configured x monitor queries from saved settings before falling back to seed data', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
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

      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorXQueries: ['openrouter failover'],
      });

      expect(settingsResponse.status).toBe(200);

      const response = await requestApp('POST', '/api/monitor/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'x',
            title: 'OpenRouter failover thread',
            detail:
              '@routingwatch · matched x search seed for openrouter failover\n\nhttps://x.com/routingwatch/status/1888888888888',
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
          platform: 'rss',
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
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@instagram',
            channelAccountId: 9,
            accountKey: 'instagram-main',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
        {
          projectId: 1,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            profileUrl: 'https://www.tiktok.com/@tiktok',
            channelAccountId: '11',
            channelAccountKey: 'tiktok-main',
          },
          enabled: true,
          pollIntervalMinutes: 60,
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

          if (url === 'https://www.instagram.com/instagram/') {
            return new Response(
              `
              <html>
                <head>
                  <meta property="og:title" content="Instagram (@instagram) • Instagram photos and videos" />
                  <meta property="og:description" content="701M Followers, 250 Following, 8,416 Posts - See Instagram photos and videos from Instagram (@instagram)" />
                </head>
              </html>
              `,
              {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              },
            );
          }

          if (url === 'https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40tiktok') {
            return new Response(
              JSON.stringify({
                title: "TikTok's Creator Profile",
                author_name: 'TikTok',
                author_url: 'https://www.tiktok.com/@tiktok',
                provider_name: 'TikTok',
                embed_type: 'profile',
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
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
          expect.objectContaining({
            id: 5,
            projectId: 1,
            source: 'instagram',
            title: 'Instagram profile update: @instagram',
            detail:
              '701M followers · 250 following · 8,416 posts\n\nhttps://www.instagram.com/instagram/',
            status: 'new',
            metadata: expect.objectContaining({
              channelAccountId: 9,
              accountKey: 'instagram-main',
              sourceUrl: 'https://www.instagram.com/instagram/',
              profileUrl: 'https://www.instagram.com/instagram/',
              profileHandle: '@instagram',
            }),
          }),
          expect.objectContaining({
            id: 6,
            projectId: 1,
            source: 'tiktok',
            title: 'TikTok profile update: @tiktok',
            detail:
              "TikTok · TikTok's Creator Profile\n\nhttps://www.tiktok.com/@tiktok",
            status: 'new',
            metadata: expect.objectContaining({
              channelAccountId: 11,
              accountKey: 'tiktok-main',
              sourceUrl: 'https://www.tiktok.com/@tiktok',
              profileUrl: 'https://www.tiktok.com/@tiktok',
              profileHandle: '@tiktok',
            }),
          }),
        ],
        inserted: 6,
        total: 6,
      });

      const monitorStore = createMonitorStore();
      expect(monitorStore.list(1).map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6]);
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

  it('dedupes monitor writes by project, source, title, and detail', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const legacyItem = monitorStore.create({
        source: 'rss',
        title: 'Latency signal',
        detail: 'Repeated legacy scrape payload.',
        status: 'new',
      });
      const duplicateLegacyItem = monitorStore.create({
        source: 'rss',
        title: 'Latency signal',
        detail: 'Repeated legacy scrape payload.',
        status: 'new',
      });
      const projectOneItem = monitorStore.create({
        projectId: 1,
        source: 'rss',
        title: 'Latency signal',
        detail: 'Repeated legacy scrape payload.',
        status: 'new',
      });
      const duplicateProjectOneItem = monitorStore.create({
        projectId: 1,
        source: 'rss',
        title: 'Latency signal',
        detail: 'Repeated legacy scrape payload.',
        status: 'new',
      });

      expect(duplicateLegacyItem.id).toBe(legacyItem.id);
      expect(duplicateProjectOneItem.id).toBe(projectOneItem.id);
      expect(projectOneItem.id).not.toBe(legacyItem.id);
      expect(monitorStore.list()).toEqual([
        expect.objectContaining({
          id: legacyItem.id,
          projectId: undefined,
          source: 'rss',
          title: 'Latency signal',
        }),
        expect.objectContaining({
          id: projectOneItem.id,
          projectId: 1,
          source: 'rss',
          title: 'Latency signal',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('backfills metadata onto an existing deduped monitor item', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const originalItem = monitorStore.create({
        projectId: 1,
        source: 'instagram',
        title: 'Instagram profile update: @instagram',
        detail: '701M followers · 250 following · 8,416 posts\n\nhttps://www.instagram.com/instagram/',
        status: 'new',
      });
      const duplicateItem = monitorStore.create({
        projectId: 1,
        source: 'instagram',
        title: 'Instagram profile update: @instagram',
        detail: '701M followers · 250 following · 8,416 posts\n\nhttps://www.instagram.com/instagram/',
        status: 'new',
        metadata: {
          channelAccountId: 9,
          accountKey: 'instagram-main',
          sourceUrl: 'https://www.instagram.com/instagram/',
          profileUrl: 'https://www.instagram.com/instagram/',
          profileHandle: '@instagram',
        },
      });

      expect(duplicateItem.id).toBe(originalItem.id);
      expect(monitorStore.list(1)).toEqual([
        expect.objectContaining({
          id: originalItem.id,
          metadata: {
            channelAccountId: 9,
            accountKey: 'instagram-main',
            sourceUrl: 'https://www.instagram.com/instagram/',
            profileUrl: 'https://www.instagram.com/instagram/',
            profileHandle: '@instagram',
          },
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('filters the monitor feed by optional projectId query', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      monitorStore.create({
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
      monitorStore.create({
        projectId: 2,
        source: 'x',
        title: 'Project 2 signal',
        detail: 'Project 2 detail.',
        status: 'new',
      });

      const response = await requestApp('GET', '/api/monitor/feed?projectId=1');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: projectOneItem.id,
            projectId: 1,
            title: 'Project 1 signal',
          }),
        ],
        total: 1,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fetches monitor items for only the requested projectId', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      delete process.env.X_ACCESS_TOKEN;
      delete process.env.X_BEARER_TOKEN;
      delete process.env.MONITOR_X_QUERIES;
      process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
        {
          id: '1001',
          query: 'project one query',
          title: 'Project 1 X signal',
          text: 'Project 1 content.',
          author: 'projectone',
          url: 'https://x.com/projectone/status/1001',
        },
        {
          id: '2002',
          query: 'project two query',
          title: 'Project 2 X signal',
          text: 'Project 2 content.',
          author: 'projecttwo',
          url: 'https://x.com/projecttwo/status/2002',
        },
      ]);

      const monitorStore = createMonitorStore();
      monitorStore.create({
        source: 'rss',
        title: 'Legacy signal',
        detail: 'No project id attached.',
        status: 'new',
      });
      monitorStore.create({
        projectId: 2,
        source: 'reddit',
        title: 'Project 2 existing signal',
        detail: 'Project 2 existing detail.',
        status: 'new',
      });

      const projectPayload = {
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Scoped monitor workspace',
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
            sourceType: 'keyword+x',
            platform: 'x',
            label: 'Project 1 X',
            configJson: { keywords: ['project one query'] },
            enabled: true,
            pollIntervalMinutes: 15,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await requestApp('POST', '/api/projects/2/source-configs', {
            projectId: 2,
            sourceType: 'keyword+x',
            platform: 'x',
            label: 'Project 2 X',
            configJson: { keywords: ['project two query'] },
            enabled: true,
            pollIntervalMinutes: 15,
          })
        ).status,
      ).toBe(201);

      const response = await requestApp('POST', '/api/monitor/fetch', {
        projectId: 1,
      });

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            projectId: 1,
            source: 'x',
            title: 'Project 1 X signal',
            detail:
              '@projectone · matched x search seed for project one query\n\nhttps://x.com/projectone/status/1001',
            status: 'new',
          }),
        ],
        inserted: 1,
        total: 1,
      });
      expect(monitorStore.list(1)).toEqual([
        expect.objectContaining({
          projectId: 1,
          title: 'Project 1 X signal',
        }),
      ]);
      expect(monitorStore.list(2)).toEqual([
        expect.objectContaining({
          projectId: 2,
          title: 'Project 2 existing signal',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  }, 10000);

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
        monitorXQueries: [],
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

  it('treats a non-profile instagram html response as a failed fetch instead of a profile update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `
        <html>
          <head>
            <meta property="og:title" content="Instagram (@instagram) • Instagram photos and videos" />
            <meta property="og:description" content="701M Followers, 250 Following, 8,416 Posts - See Instagram photos and videos from Instagram (@instagram)" />
          </head>
          <body>Sign in to see photos and videos from friends.</body>
        </html>
        `,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@instagram',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'instagram',
        title: 'Instagram fetch failed: @instagram',
        detail: 'instagram profile response did not look like a public profile page',
      },
    ]);
  });

  it('treats an instagram summary-only response without upstream identity as a failed fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.instagram.com/openai/',
      text: async () => `
        <html>
          <head>
            <meta property="og:description" content="10 Followers, 20 Following, 30 Posts - See Instagram photos and videos from OpenAI" />
          </head>
        </html>
      `,
    });
    vi.stubGlobal('fetch', fetchMock);

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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@openai',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'instagram',
        title: 'Instagram fetch failed: @openai',
        detail: 'instagram profile response did not include a verifiable profile identity',
      },
    ]);
  });

  it('treats an instagram response that resolves to a non-profile url as a failed fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.instagram.com/p/abc123/',
      text: async () => `
        <html>
          <head>
            <meta property="og:title" content="OpenAI (@openai) • Instagram photos and videos" />
            <meta property="og:description" content="10 Followers, 20 Following, 30 Posts - See Instagram photos and videos from OpenAI" />
          </head>
        </html>
      `,
    });
    vi.stubGlobal('fetch', fetchMock);

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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@openai',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'instagram',
        title: 'Instagram fetch failed: @openai',
        detail: 'instagram profile response did not resolve to a canonical profile url',
      },
    ]);
  });

  it('treats a non-profile tiktok oembed response as a failed fetch instead of a profile update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          author_name: 'TikTok',
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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            handle: '@tiktok',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'tiktok',
        title: 'TikTok fetch failed: @tiktok',
        detail: 'tiktok oembed response did not look like a profile payload',
      },
    ]);
  });

  it('treats a typed non-profile tiktok oembed response as a failed fetch instead of a profile update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'video',
          author_name: 'TikTok',
          author_url: 'https://www.tiktok.com/@tiktok',
          title: 'Pinned clip',
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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            handle: '@tiktok',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'tiktok',
        title: 'TikTok fetch failed: @tiktok',
        detail: 'tiktok oembed response did not look like a profile payload',
      },
    ]);
  });

  it('treats a tiktok profile response with a non-canonical author_url as a failed fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'profile',
          author_name: 'OpenAI',
          author_url: 'https://example.com/@openai',
          title: 'OpenAI on TikTok',
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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            handle: '@openai',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'tiktok',
        title: 'TikTok fetch failed: @openai',
        detail: 'tiktok oembed response did not include a canonical profile url',
      },
    ]);
  });

  it('treats a tiktok profile response with a non-profile author_url as a failed fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'profile',
          author_name: 'OpenAI',
          author_url: 'https://www.tiktok.com/@openai/video/123',
          title: 'OpenAI on TikTok',
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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 7,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            handle: '@openai',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 7,
        source: 'tiktok',
        title: 'TikTok fetch failed: @openai',
        detail: 'tiktok oembed response did not include a canonical profile url',
      },
    ]);
  });

  it('only accepts canonical instagram and tiktok profile urls from source config inputs', async () => {
    const { resolveSourceConfigInputs } = await import('../../src/server/services/monitorFetch');
    const inputs = resolveSourceConfigInputs([
      {
        id: 1,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram post url should be ignored',
        configJson: {
          profileUrl: 'https://www.instagram.com/p/abc123/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 2,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram reserved route should be ignored',
        configJson: {
          profileUrl: 'https://www.instagram.com/explore/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 3,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram handle fallback remains valid',
        configJson: {
          profileUrl: 'https://example.com/not-instagram',
          handle: '@openai',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 4,
        projectId: 7,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok short link should be ignored',
        configJson: {
          profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 5,
        projectId: 7,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok handle fallback remains valid',
        configJson: {
          profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
          handle: 'openai',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
    ]);

    expect(inputs.instagramProfiles).toEqual([
      {
        sourceConfigId: 3,
        projectId: 7,
        handle: '@openai',
        profileUrl: 'https://www.instagram.com/openai/',
      },
    ]);
    expect(inputs.tiktokProfiles).toEqual([
      {
        sourceConfigId: 5,
        projectId: 7,
        handle: '@openai',
        profileUrl: 'https://www.tiktok.com/@openai',
      },
    ]);
  });

  it('normalizes profile handles case-insensitively and rejects reserved instagram handles', async () => {
    const { resolveSourceConfigInputs } = await import('../../src/server/services/monitorFetch');
    const inputs = resolveSourceConfigInputs([
      {
        id: 1,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram reserved handle should be ignored',
        configJson: {
          handle: '@Explore',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 2,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram mixed-case handle should normalize',
        configJson: {
          handle: '@OpenAI',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 3,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram lower-case duplicate should dedupe',
        configJson: {
          handle: '@openai',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 4,
        projectId: 7,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok mixed-case handle should normalize',
        configJson: {
          handle: '@OpenAI',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 5,
        projectId: 7,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok lower-case duplicate should dedupe',
        configJson: {
          handle: '@openai',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
    ]);

    expect(inputs.instagramProfiles).toEqual([
      {
        sourceConfigId: 2,
        projectId: 7,
        handle: '@openai',
        profileUrl: 'https://www.instagram.com/openai/',
      },
    ]);
    expect(inputs.tiktokProfiles).toEqual([
      {
        sourceConfigId: 4,
        projectId: 7,
        handle: '@openai',
        profileUrl: 'https://www.tiktok.com/@openai',
      },
    ]);
  });

  it('ignores malformed profile handles when no canonical profile url is available', async () => {
    const { resolveSourceConfigInputs } = await import('../../src/server/services/monitorFetch');
    const inputs = resolveSourceConfigInputs([
      {
        id: 1,
        projectId: 9,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram malformed handle should be ignored',
        configJson: {
          handle: '@openai/reel/123',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 2,
        projectId: 9,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok malformed handle should be ignored',
        configJson: {
          handle: 'open ai',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
    ]);

    expect(inputs.instagramProfiles).toEqual([]);
    expect(inputs.tiktokProfiles).toEqual([]);
  });

  it('uses canonical profile urls as the source of truth when source config handles conflict', async () => {
    const { resolveSourceConfigInputs } = await import('../../src/server/services/monitorFetch');
    const inputs = resolveSourceConfigInputs([
      {
        id: 1,
        projectId: 8,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram canonical url wins',
        configJson: {
          profileUrl: 'https://www.instagram.com/openai/',
          handle: '@wronghandle',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
      {
        id: 2,
        projectId: 8,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok canonical url wins',
        configJson: {
          profileUrl: 'https://www.tiktok.com/@openai',
          handle: 'wronghandle',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
    ]);

    expect(inputs.instagramProfiles).toEqual([
      {
        sourceConfigId: 1,
        projectId: 8,
        handle: '@openai',
        profileUrl: 'https://www.instagram.com/openai/',
      },
    ]);
    expect(inputs.tiktokProfiles).toEqual([
      {
        sourceConfigId: 2,
        projectId: 8,
        handle: '@openai',
        profileUrl: 'https://www.tiktok.com/@openai',
      },
    ]);
  });

  it('treats case-only upstream handle differences as the same instagram and tiktok profiles', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          `
          <html>
            <head>
              <meta property="og:title" content="OpenAI (@openai) • Instagram photos and videos" />
              <meta property="og:description" content="1 Followers, 2 Following, 3 Posts - See Instagram photos and videos from OpenAI (@openai)" />
            </head>
          </html>
          `,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            author_name: 'OpenAI',
            author_url: 'https://www.tiktok.com/@openai',
            embed_type: 'profile',
            title: 'OpenAI on TikTok',
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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 9,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@OpenAI',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
        {
          id: 2,
          projectId: 9,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            handle: '@OpenAI',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 9,
        source: 'instagram',
        title: 'Instagram profile update: @openai',
        detail: '1 followers · 2 following · 3 posts\n\nhttps://www.instagram.com/openai/',
        metadata: {
          sourceConfigId: 1,
          sourceUrl: 'https://www.instagram.com/openai/',
          profileUrl: 'https://www.instagram.com/openai/',
          profileHandle: '@openai',
        },
      },
      {
        projectId: 9,
        source: 'tiktok',
        title: 'TikTok profile update: @openai',
        detail: 'OpenAI · OpenAI on TikTok\n\nhttps://www.tiktok.com/@openai',
        metadata: {
          sourceConfigId: 2,
          sourceUrl: 'https://www.tiktok.com/@openai',
          profileUrl: 'https://www.tiktok.com/@openai',
          profileHandle: '@openai',
        },
      },
    ]);
  });

  it('treats mismatched upstream profile identities as failed fetches instead of mislabeling monitor items', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          `
          <html>
            <head>
              <meta property="og:title" content="Mismatch (@otheraccount) • Instagram photos and videos" />
              <meta property="og:description" content="10 Followers, 20 Following, 30 Posts - See Instagram photos and videos from Mismatch (@otheraccount)" />
            </head>
          </html>
          `,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            author_name: 'Other Account',
            author_url: 'https://www.tiktok.com/@otheraccount',
            embed_type: 'profile',
            title: 'Other Account on TikTok',
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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 9,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@openai',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
        {
          id: 2,
          projectId: 9,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: {
            handle: '@openai',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 9,
        source: 'instagram',
        title: 'Instagram fetch failed: @openai',
        detail: 'instagram profile response resolved to @otheraccount instead of @openai',
      },
      {
        projectId: 9,
        source: 'tiktok',
        title: 'TikTok fetch failed: @openai',
        detail: 'tiktok oembed response resolved to @otheraccount instead of @openai',
      },
    ]);
  });

  it('treats instagram profile redirects to renamed handles as failed fetches instead of mislabeling monitor items', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.instagram.com/newhandle/',
      text: async () => `
        <html>
          <head>
            <meta property="og:description" content="10 Followers, 20 Following, 30 Posts - See Instagram photos and videos from Renamed Account" />
          </head>
        </html>
      `,
    });
    vi.stubGlobal('fetch', fetchMock);

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
        monitorXQueries: [],
        monitorRedditQueries: [],
        monitorV2exQueries: [],
      },
      [
        {
          id: 1,
          projectId: 10,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: {
            handle: '@oldhandle',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    );

    expect(signals).toEqual([
      {
        projectId: 10,
        source: 'instagram',
        title: 'Instagram fetch failed: @oldhandle',
        detail: 'instagram profile response resolved to @newhandle instead of @oldhandle',
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

  it('does not insert duplicate monitor items when the same fetch result is collected twice', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
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

      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorXQueries: ['openrouter failover'],
      });
      expect(settingsResponse.status).toBe(200);

      const firstResponse = await requestApp('POST', '/api/monitor/fetch');
      const firstBody = JSON.parse(firstResponse.body) as {
        items: Array<{ id: number; projectId?: number; source: string; title: string; detail: string }>;
        inserted: number;
        total: number;
      };

      expect(firstResponse.status).toBe(201);
      expect(firstBody).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'x',
            title: 'OpenRouter failover thread',
            detail:
              '@routingwatch · matched x search seed for openrouter failover\n\nhttps://x.com/routingwatch/status/1888888888888',
            status: 'new',
          }),
        ],
        inserted: 1,
        total: 1,
      });

      const secondResponse = await requestApp('POST', '/api/monitor/fetch');
      const secondBody = JSON.parse(secondResponse.body) as {
        items: Array<{ id: number; source: string; title: string; detail: string }>;
        inserted: number;
        total: number;
      };

      expect(secondResponse.status).toBe(201);
      expect(secondBody).toEqual({
        items: [
          expect.objectContaining({
            id: firstBody.items[0]?.id,
            source: 'x',
            title: 'OpenRouter failover thread',
            detail:
              '@routingwatch · matched x search seed for openrouter failover\n\nhttps://x.com/routingwatch/status/1888888888888',
            status: 'new',
          }),
        ],
        inserted: 0,
        total: 1,
      });
      expect(createMonitorStore().list()).toEqual([
        expect.objectContaining({
          id: firstBody.items[0]?.id,
          source: 'x',
          title: 'OpenRouter failover thread',
        }),
      ]);
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
        projectId: 12,
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
          projectId: 12,
          platform: 'x',
          title: expect.stringContaining('Follow-up'),
          content: expect.stringContaining('Competitor launched a lower tier'),
          status: 'draft',
        }),
      });
      expect(draftStore.list()).toHaveLength(1);
      expect(draftStore.getById(1)).toEqual(
        expect.objectContaining({
          id: 1,
          projectId: 12,
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it.each([
    ['instagram', 'instagram', 'Instagram creator benchmark'],
    ['tiktok', 'tiktok', 'TikTok creator benchmark'],
    ['xiaohongshu', '小红书', '小红书内容节奏观察'],
    ['weibo', '微博', '微博热点互动观察'],
  ] as const)(
    'creates a follow-up draft from a %s monitor item using the source fallback platform',
    async (platform, source, title) => {
      const { rootDir } = createTestDatabasePath();
      try {
        const monitorStore = createMonitorStore();
        const draftStore = createSQLiteDraftStore();
        const item = monitorStore.create({
          projectId: 18,
          source,
          title,
          detail: `Observed a follow-up opportunity on ${platform}.`,
          status: 'new',
        });

        const response = await requestApp('POST', `/api/monitor/${item.id}/generate-follow-up`);

        expect(response.status).toBe(201);
        expect(JSON.parse(response.body)).toEqual({
          draft: expect.objectContaining({
            id: 1,
            projectId: 18,
            platform,
            title: expect.stringContaining('Follow-up'),
            content: expect.stringContaining(title),
            status: 'draft',
          }),
        });
        expect(draftStore.list()).toHaveLength(1);
      } finally {
        cleanupTestDatabasePath(rootDir);
      }
    },
  );

  it('rejects an unsupported follow-up target even when the monitor source is launch-ready', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const item = monitorStore.create({
        source: 'instagram',
        title: 'Instagram creator benchmark',
        detail: 'Observed a follow-up opportunity on Instagram.',
        status: 'new',
      });

      const response = await requestApp('POST', `/api/monitor/${item.id}/generate-follow-up`, {
        platform: 'rss',
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'unsupported follow-up platform',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it.each([
    ['rss', 'RSS pricing watch', { platform: 'x' }],
    ['v2ex', 'V2EX creator benchmark', { platform: 'instagram' }],
  ] as const)('rejects follow-up drafts for non-launch monitor sources even when %s requests a supported target platform', async (source, title, body) => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const item = monitorStore.create({
        source,
        title,
        detail: 'Observed a cheaper plan and a follow-up opportunity.',
        status: 'new',
      });

      const response = await requestApp('POST', `/api/monitor/${item.id}/generate-follow-up`, body);

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'unsupported follow-up platform',
      });
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
