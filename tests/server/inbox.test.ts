import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createInboxStore } from '../../src/server/store/inbox';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const originalEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  NODE_ENV: process.env.NODE_ENV,
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_USERNAME: process.env.REDDIT_USERNAME,
  REDDIT_PASSWORD: process.env.REDDIT_PASSWORD,
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
  MONITOR_X_SEARCH_SEEDS: process.env.MONITOR_X_SEARCH_SEEDS,
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
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
  restoreEnv('AI_BASE_URL', originalEnv.AI_BASE_URL);
  restoreEnv('AI_API_KEY', originalEnv.AI_API_KEY);
  restoreEnv('AI_MODEL', originalEnv.AI_MODEL);
  restoreEnv('NODE_ENV', originalEnv.NODE_ENV);
  restoreEnv('REDDIT_CLIENT_ID', originalEnv.REDDIT_CLIENT_ID);
  restoreEnv('REDDIT_CLIENT_SECRET', originalEnv.REDDIT_CLIENT_SECRET);
  restoreEnv('REDDIT_USERNAME', originalEnv.REDDIT_USERNAME);
  restoreEnv('REDDIT_PASSWORD', originalEnv.REDDIT_PASSWORD);
  restoreEnv('REDDIT_USER_AGENT', originalEnv.REDDIT_USER_AGENT);
  restoreEnv('MONITOR_X_SEARCH_SEEDS', originalEnv.MONITOR_X_SEARCH_SEEDS);
  restoreEnv('X_ACCESS_TOKEN', originalEnv.X_ACCESS_TOKEN);
  restoreEnv('X_BEARER_TOKEN', originalEnv.X_BEARER_TOKEN);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

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

function installCommunitySearchFixtures() {
  process.env.REDDIT_CLIENT_ID = 'reddit-id';
  process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
  process.env.REDDIT_USERNAME = 'reddit-user';
  process.env.REDDIT_PASSWORD = 'reddit-pass';
  process.env.REDDIT_USER_AGENT = 'promobot/test';
  process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
    {
      query: 'openrouter failover',
      id: 'tweet-1',
      title: 'OpenRouter failover thread',
      text: 'Route around outages faster.',
      author: 'routerwatch',
      url: 'https://x.com/routerwatch/status/tweet-1',
    },
  ]);

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      const requestUrl = String(url);

      if (requestUrl === 'https://www.reddit.com/api/v1/access_token') {
        return new Response(JSON.stringify({ access_token: 'reddit-access-token' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      if (requestUrl.startsWith('https://oauth.reddit.com/search?')) {
        const query = new URL(requestUrl).searchParams.get('q');

        if (query === 'claude latency australia') {
          return createRedditSearchResponse({
            id: 'abc123',
            title: 'Claude latency in Australia',
            selftext: 'Operators comparing AU routing for Claude requests.',
            permalink: '/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
            subredditNamePrefixed: 'r/LocalLLaMA',
            author: 'latencywatch',
          });
        }

        if (query === 'project one query') {
          return createRedditSearchResponse({
            id: 'project1',
            title: 'Project one reddit result',
            selftext: 'Project one reply needed.',
            permalink: '/r/Promobot/comments/project1/project_one_reddit_result/',
            subredditNamePrefixed: 'r/Promobot',
            author: 'builderone',
          });
        }
      }

      if (requestUrl.startsWith('https://www.v2ex.com/search?')) {
        const query = new URL(requestUrl).searchParams.get('q');

        if (query === 'cursor api') {
          return new Response(
            `
              <div class="cell item">
                <span class="item_title">
                  <a href="/t/888888">Cursor API follow-up</a>
                </span>
                <strong><a href="/member/alice">alice</a></strong>
                <span class="topic_info">
                  <a class="node" href="/go/devops">DevOps</a>
                  • <a class="count" href="/t/888888#reply2">2 replies</a>
                </span>
              </div>
            `,
            { status: 200 },
          );
        }
      }

      throw new Error(`unexpected fetch request in inbox test: ${requestUrl}`);
    }),
  );
}

function createRedditSearchResponse(input: {
  id: string;
  title: string;
  selftext: string;
  permalink: string;
  subredditNamePrefixed: string;
  author: string;
}) {
  return new Response(
    JSON.stringify({
      data: {
        children: [
          {
            data: {
              id: input.id,
              title: input.title,
              selftext: input.selftext,
              permalink: input.permalink,
              subreddit_name_prefixed: input.subredditNamePrefixed,
              author: input.author,
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

  it('fetches live inbox items from configured search queries', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installCommunitySearchFixtures();

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
            author: 'routerwatch',
            status: 'needs_review',
            title: 'OpenRouter failover thread',
            excerpt:
              '@routerwatch · matched x search seed for openrouter failover\n\nRoute around outages faster.\n\nhttps://x.com/routerwatch/status/tweet-1',
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            author: 'latencywatch',
            status: 'needs_reply',
            title: 'Claude latency in Australia',
            excerpt:
              'r/LocalLLaMA · latencywatch\n\nOperators comparing AU routing for Claude requests.\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
          }),
          expect.objectContaining({
            id: 3,
            source: 'v2ex',
            author: 'alice',
            status: 'needs_reply',
            title: 'Cursor API follow-up',
            excerpt:
              'V2EX DevOps · alice · 2 replies\n\nCursor API follow-up\n\nhttps://www.v2ex.com/t/888888',
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

  it('reports only newly inserted inbox rows when the same fetch runs twice', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installCommunitySearchFixtures();

      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude latency australia'],
        monitorV2exQueries: ['cursor api'],
      });

      expect(settingsResponse.status).toBe(200);

      const firstResponse = await requestApp('POST', '/api/inbox/fetch');
      expect(firstResponse.status).toBe(201);
      expect(JSON.parse(firstResponse.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'x',
            author: 'routerwatch',
            status: 'needs_review',
            title: 'OpenRouter failover thread',
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            author: 'latencywatch',
            status: 'needs_reply',
            title: 'Claude latency in Australia',
          }),
          expect.objectContaining({
            id: 3,
            source: 'v2ex',
            author: 'alice',
            status: 'needs_reply',
            title: 'Cursor API follow-up',
          }),
        ],
        inserted: 3,
        total: 3,
        unread: 3,
      });

      const secondResponse = await requestApp('POST', '/api/inbox/fetch');

      expect(secondResponse.status).toBe(201);
      expect(JSON.parse(secondResponse.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'x',
            author: 'routerwatch',
            status: 'needs_review',
            title: 'OpenRouter failover thread',
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            author: 'latencywatch',
            status: 'needs_reply',
            title: 'Claude latency in Australia',
          }),
          expect.objectContaining({
            id: 3,
            source: 'v2ex',
            author: 'alice',
            status: 'needs_reply',
            title: 'Cursor API follow-up',
          }),
        ],
        inserted: 0,
        total: 3,
        unread: 3,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fetches live inbox items from enabled source configs when global settings are absent', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installCommunitySearchFixtures();

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
            source: 'x',
            author: 'routerwatch',
            status: 'needs_review',
            title: 'OpenRouter failover thread',
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            author: 'latencywatch',
            status: 'needs_reply',
            title: 'Claude latency in Australia',
          }),
          expect.objectContaining({
            id: 3,
            source: 'v2ex',
            author: 'alice',
            status: 'needs_reply',
            title: 'Cursor API follow-up',
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

  it('does not fall back to placeholder inbox items when configured searches return no live matches', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 })));

      const settingsResponse = await requestApp('PATCH', '/api/settings', {
        monitorV2exQueries: ['cursor api'],
      });
      expect(settingsResponse.status).toBe(200);

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

  it('reuses the existing inbox item when the same project and content is written twice', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const firstItem = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_reply',
        author: 'duplicate-user',
        title: 'Duplicate inbox item',
        excerpt: 'Same source payload should not be inserted twice.',
      });
      const secondItem = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_reply',
        author: 'duplicate-user',
        title: 'Duplicate inbox item',
        excerpt: 'Same source payload should not be inserted twice.',
      });

      expect(secondItem).toEqual(expect.objectContaining({ id: firstItem.id }));
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          id: firstItem.id,
          projectId: 1,
          source: 'reddit',
          status: 'needs_reply',
          author: 'duplicate-user',
          title: 'Duplicate inbox item',
          excerpt: 'Same source payload should not be inserted twice.',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not dedupe inbox items when status differs', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const firstItem = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_review',
        author: 'status-user',
        title: 'Status transition item',
        excerpt: 'Status is part of the dedupe key.',
      });
      const secondItem = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'handled',
        author: 'status-user',
        title: 'Status transition item',
        excerpt: 'Status is part of the dedupe key.',
      });

      expect(secondItem.id).not.toBe(firstItem.id);
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          id: firstItem.id,
          status: 'needs_review',
        }),
        expect.objectContaining({
          id: secondItem.id,
          status: 'handled',
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
      installCommunitySearchFixtures();

      const inboxStore = createInboxStore();

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
            author: 'builderone',
            status: 'needs_reply',
            title: 'Project one reddit result',
            excerpt:
              'r/Promobot · builderone\n\nProject one reply needed.\n\nhttps://www.reddit.com/r/Promobot/comments/project1/project_one_reddit_result/',
          }),
        ],
        inserted: 1,
        total: 1,
        unread: 1,
      });
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          projectId: 1,
          title: 'Project one reddit result',
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
