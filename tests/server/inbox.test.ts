import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createInboxReplyService } from '../../src/server/services/inboxReply';
import { createSessionStore } from '../../src/server/services/browser/sessionStore';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import * as inboxStoreModule from '../../src/server/store/inbox';
import { createInboxStore } from '../../src/server/store/inbox';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { createMonitorStore } from '../../src/server/store/monitor';
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
  BROWSER_HANDOFF_OUTPUT_DIR: process.env.BROWSER_HANDOFF_OUTPUT_DIR,
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
};
const inboxReplyHandoffPollJobType = 'inbox_reply_handoff_poll';

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
  vi.restoreAllMocks();
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
  restoreEnv('BROWSER_HANDOFF_OUTPUT_DIR', originalEnv.BROWSER_HANDOFF_OUTPUT_DIR);
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

function installXReplyFetchStub() {
  process.env.X_ACCESS_TOKEN = 'x-access-token';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.twitter.com/2/tweets');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual(
        expect.objectContaining({
          authorization: 'Bearer x-access-token',
          'content-type': 'application/json',
        }),
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        text: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        reply: {
          in_reply_to_tweet_id: 'tweet-1',
        },
      });

      return new Response(JSON.stringify({ data: { id: 'tweet-reply-1' } }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }),
  );
}

function installRedditReplyFetchStub(expectedThingId = 't3_abc123') {
  process.env.REDDIT_CLIENT_ID = 'reddit-id';
  process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
  process.env.REDDIT_USERNAME = 'reddit-user';
  process.env.REDDIT_PASSWORD = 'reddit-pass';
  process.env.REDDIT_USER_AGENT = 'promobot/test';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl === 'https://www.reddit.com/api/v1/access_token') {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({ access_token: 'reddit-access-token' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      if (requestUrl === 'https://oauth.reddit.com/api/comment') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual(
          expect.objectContaining({
            authorization: 'Bearer reddit-access-token',
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'promobot/test',
          }),
        );
        expect(String(init?.body)).toBe([
          'api_type=json',
          `thing_id=${expectedThingId}`,
          'text=Thanks+for+reaching+out.+We+can+share+current+APAC+latency+benchmarks.',
        ].join('&'));

        return new Response(
          JSON.stringify({
            json: {
              data: {
                things: [
                  {
                    data: {
                      id: 'reply123',
                      name: 't1_reply123',
                      permalink: '/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/reply123/',
                    },
                  },
                ],
              },
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

      throw new Error(`unexpected fetch request in inbox reply test: ${requestUrl}`);
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
            metadata: expect.objectContaining({
              sourceUrl: 'https://x.com/routerwatch/status/tweet-1',
              externalId: 'tweet-1',
              replyTargetId: 'tweet-1',
              replyTargetType: 'tweet',
            }),
          }),
          expect.objectContaining({
            id: 2,
            source: 'reddit',
            author: 'latencywatch',
            status: 'needs_reply',
            title: 'Claude latency in Australia',
            excerpt:
              'r/LocalLLaMA · latencywatch\n\nOperators comparing AU routing for Claude requests.\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
            metadata: expect.objectContaining({
              sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
              externalId: 'abc123',
              replyTargetId: 'abc123',
              replyTargetType: 'reddit_submission',
              replyThingFullname: 't3_abc123',
              permalink: '/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
            }),
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
            channelAccountId: 7,
            accountKey: 'reddit-main',
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
            metadata: expect.objectContaining({
              channelAccountId: 7,
              accountKey: 'reddit-main',
              sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
              replyTargetId: 'abc123',
              replyTargetType: 'reddit_submission',
              replyThingFullname: 't3_abc123',
            }),
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

  it('promotes instagram, tiktok, xiaohongshu, weibo, and facebook-group monitor signals into inbox fetch results', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();

      monitorStore.create({
        projectId: 1,
        source: 'instagram',
        title: 'Instagram 评论跟进',
        detail: 'instagram comment · creator_ops\n需要人工确认评论语气。',
        metadata: {
          channelAccountId: 21,
          accountKey: 'instagram-main',
          sourceUrl: 'https://www.instagram.com/p/post-1/',
          profileUrl: 'https://www.instagram.com/creator_ops/',
          profileHandle: '@creator_ops',
        },
      });
      monitorStore.create({
        projectId: 2,
        source: 'tiktok',
        title: 'TikTok 提及跟进',
        detail: 'tiktok mention · short_video_ops\n需要尽快回复该提及。',
        metadata: {
          channelAccountId: 22,
          accountKey: 'tiktok-main',
          sourceUrl: 'https://www.tiktok.com/@short_video_ops/video/1',
          profileUrl: 'https://www.tiktok.com/@short_video_ops',
          profileHandle: '@short_video_ops',
        },
      });
      monitorStore.create({
        projectId: 3,
        source: 'xiaohongshu',
        title: '小红书评论跟进',
        detail: 'xhs note · note_author\n需要人工确认评论语气。',
      });
      monitorStore.create({
        projectId: 4,
        source: 'weibo',
        title: '微博提及跟进',
        detail: 'weibo mention · brand_ops\n需要尽快回复该提及。',
      });
      monitorStore.create({
        projectId: 5,
        source: 'facebook-group',
        title: 'Facebook Group 帖子回复',
        detail: 'facebook group post · community_admin\n需要尽快回复这条帖子。',
        metadata: {
          channelAccountId: 23,
          accountKey: 'facebook-group-main',
          sourceUrl: 'https://www.facebook.com/groups/launch-campaign/posts/42',
          replyTargetId: 'fb-post-42',
          replyTargetType: 'facebook_group_post',
        },
      });

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            source: 'instagram',
            author: 'creator_ops',
            status: 'needs_review',
            title: 'Instagram 评论跟进',
            metadata: expect.objectContaining({
              channelAccountId: 21,
              accountKey: 'instagram-main',
              sourceUrl: 'https://www.instagram.com/p/post-1/',
              profileUrl: 'https://www.instagram.com/creator_ops/',
              profileHandle: '@creator_ops',
            }),
          }),
          expect.objectContaining({
            id: 2,
            projectId: 2,
            source: 'tiktok',
            author: 'short_video_ops',
            status: 'needs_review',
            title: 'TikTok 提及跟进',
            metadata: expect.objectContaining({
              channelAccountId: 22,
              accountKey: 'tiktok-main',
              sourceUrl: 'https://www.tiktok.com/@short_video_ops/video/1',
              profileUrl: 'https://www.tiktok.com/@short_video_ops',
              profileHandle: '@short_video_ops',
            }),
          }),
          expect.objectContaining({
            id: 3,
            projectId: 3,
            source: 'xiaohongshu',
            author: 'note_author',
            status: 'needs_review',
            title: '小红书评论跟进',
          }),
          expect.objectContaining({
            id: 4,
            projectId: 4,
            source: 'weibo',
            author: 'brand_ops',
            status: 'needs_review',
            title: '微博提及跟进',
          }),
          expect.objectContaining({
            id: 5,
            projectId: 5,
            source: 'facebook-group',
            author: 'community_admin',
            status: 'needs_reply',
            title: 'Facebook Group 帖子回复',
            metadata: expect.objectContaining({
              channelAccountId: 23,
              accountKey: 'facebook-group-main',
              sourceUrl: 'https://www.facebook.com/groups/launch-campaign/posts/42',
              replyTargetId: 'fb-post-42',
              replyTargetType: 'facebook_group_post',
            }),
          }),
        ],
        inserted: 5,
        total: 5,
        unread: 5,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not promote ignored browser-platform monitor signals into inbox fetch results', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();

      monitorStore.create({
        projectId: 1,
        source: 'instagram',
        status: 'ignored',
        title: 'Instagram 评论跟进',
        detail: 'instagram comment · creator_ops\n这个信号已被忽略。',
      });
      monitorStore.create({
        projectId: 2,
        source: 'tiktok',
        status: 'saved',
        title: 'TikTok 提及跟进',
        detail: 'tiktok mention · short_video_ops\n这个信号仍应进入 inbox。',
      });
      monitorStore.create({
        projectId: 3,
        source: 'xiaohongshu',
        status: 'ignored',
        title: '小红书评论跟进',
        detail: 'xhs note · note_author\n这个信号已被忽略。',
      });
      monitorStore.create({
        projectId: 4,
        source: 'weibo',
        status: 'saved',
        title: '微博提及跟进',
        detail: 'weibo mention · brand_ops\n这个信号仍应进入 inbox。',
      });
      monitorStore.create({
        projectId: 5,
        source: 'facebook-group',
        status: 'ignored',
        title: 'Facebook Group 帖子回复',
        detail: 'facebook group post · community_admin\n这个信号已被忽略。',
      });
      monitorStore.create({
        projectId: 6,
        source: 'facebook-group',
        status: 'saved',
        title: 'Facebook Group 评论跟进',
        detail: 'facebook group comment · moderator\n这个信号仍应进入 inbox。',
      });

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 2,
            source: 'tiktok',
            author: 'short_video_ops',
            status: 'needs_review',
            title: 'TikTok 提及跟进',
          }),
          expect.objectContaining({
            id: 2,
            projectId: 4,
            source: 'weibo',
            author: 'brand_ops',
            status: 'needs_review',
            title: '微博提及跟进',
          }),
          expect.objectContaining({
            id: 3,
            projectId: 6,
            source: 'facebook-group',
            author: 'moderator',
            status: 'needs_reply',
            title: 'Facebook Group 评论跟进',
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

  it('does not promote ignored browser-platform monitor signals into inbox fetch results', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();

      monitorStore.create({
        projectId: 1,
        source: 'xiaohongshu',
        title: '已忽略的小红书评论',
        detail: 'xhs note · ignored_author\n这条 monitor item 已被忽略。',
        status: 'ignored',
      });
      monitorStore.create({
        projectId: 2,
        source: 'weibo',
        title: '正常微博提及',
        detail: 'weibo mention · brand_ops\n这条提及仍需要进入 Inbox。',
      });

      const response = await requestApp('POST', '/api/inbox/fetch');

      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 2,
            source: 'weibo',
            author: 'brand_ops',
            status: 'needs_review',
            title: '正常微博提及',
          }),
        ],
        inserted: 1,
        total: 1,
        unread: 1,
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

  it('backfills metadata when a duplicate inbox item is written later with routing context', async () => {
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
        metadata: {
          sourceUrl: 'https://www.reddit.com/r/Promobot/comments/dup123/duplicate_inbox_item/',
          channelAccountId: 9,
          accountKey: 'reddit-main',
        },
      });

      expect(secondItem.id).toBe(firstItem.id);
      expect(secondItem.metadata).toEqual({
        sourceUrl: 'https://www.reddit.com/r/Promobot/comments/dup123/duplicate_inbox_item/',
        channelAccountId: 9,
        accountKey: 'reddit-main',
      });
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          id: firstItem.id,
          metadata: {
            sourceUrl: 'https://www.reddit.com/r/Promobot/comments/dup123/duplicate_inbox_item/',
            channelAccountId: 9,
            accountKey: 'reddit-main',
          },
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('merges duplicate inbox item metadata when later writes add missing routing fields', async () => {
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
        metadata: {
          sourceUrl: 'https://www.reddit.com/r/Promobot/comments/dup123/duplicate_inbox_item/',
        },
      });
      const secondItem = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_reply',
        author: 'duplicate-user',
        title: 'Duplicate inbox item',
        excerpt: 'Same source payload should not be inserted twice.',
        metadata: {
          channelAccountId: 9,
          accountKey: 'reddit-main',
        },
      });

      expect(secondItem.id).toBe(firstItem.id);
      expect(secondItem.metadata).toEqual({
        sourceUrl: 'https://www.reddit.com/r/Promobot/comments/dup123/duplicate_inbox_item/',
        channelAccountId: 9,
        accountKey: 'reddit-main',
      });
      expect(inboxStore.list(1)).toEqual([
        expect.objectContaining({
          id: firstItem.id,
          metadata: {
            sourceUrl: 'https://www.reddit.com/r/Promobot/comments/dup123/duplicate_inbox_item/',
            channelAccountId: 9,
            accountKey: 'reddit-main',
          },
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('omits empty metadata when an inbox item was stored without routing context', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_reply',
        author: 'no-metadata-user',
        title: 'Inbox item without routing metadata',
        excerpt: 'Default metadata should stay hidden from the API contract.',
      });

      expect(item).not.toHaveProperty('metadata');
      expect(inboxStore.list(1)).toEqual([
        expect.not.objectContaining({
          metadata: expect.anything(),
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

  it('sends an x reply through the api and marks the inbox item handled', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installXReplyFetchStub();

      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'x',
        status: 'needs_review',
        author: 'routerwatch',
        title: 'Need lower latency in APAC',
        excerpt:
          '@routerwatch · matched x search seed for openrouter failover\n\nRoute around outages faster.\n\nhttps://x.com/routerwatch/status/tweet-1',
        metadata: {
          sourceUrl: 'https://x.com/routerwatch/status/tweet-1',
          replyTargetId: 'tweet-1',
          replyTargetType: 'tweet',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'handled',
        }),
        delivery: {
          success: true,
          status: 'sent',
          mode: 'api',
          message: 'X reply sent to https://x.com/routerwatch/status/tweet-1.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: 'https://x.com/i/web/status/tweet-reply-1',
          externalId: 'tweet-reply-1',
          details: expect.objectContaining({
            replyTo: 'tweet-1',
            retry: {
              publish: {
                attempts: 1,
                maxAttempts: 3,
                stage: 'publish',
                lastHttpStatus: 200,
              },
            },
            context: expect.objectContaining({
              selection: 'environment',
              readiness: expect.objectContaining({
                platform: 'x',
                ready: true,
                mode: 'api',
                status: 'ready',
              }),
            }),
          }),
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('sends a reddit reply through the api and marks the inbox item handled', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installRedditReplyFetchStub();

      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'latencywatch',
        title: 'Claude latency in Australia',
        excerpt:
          'r/LocalLLaMA · latencywatch\n\nOperators comparing AU routing for Claude requests.\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
        metadata: {
          sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
          replyTargetId: 'abc123',
          replyTargetType: 'reddit_submission',
          replyThingFullname: 't3_abc123',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'handled',
        }),
        delivery: {
          success: true,
          status: 'sent',
          mode: 'api',
          message:
            'Reddit reply sent to https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl:
            'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/reply123/',
          externalId: 'reply123',
          details: expect.objectContaining({
            replyTo: 't3_abc123',
            retry: {
              oauth: {
                attempts: 1,
                maxAttempts: 3,
                stage: 'oauth',
                lastHttpStatus: 200,
              },
              submit: {
                attempts: 1,
                maxAttempts: 3,
                stage: 'submit',
                lastHttpStatus: 200,
              },
            },
            context: expect.objectContaining({
              selection: 'environment',
              readiness: expect.objectContaining({
                platform: 'reddit',
                ready: true,
                mode: 'api',
                status: 'ready',
              }),
            }),
          }),
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns manual_required for unsupported platforms and keeps the inbox item pending', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const body = JSON.parse(response.body) as {
        delivery: { details?: { browserReplyHandoff?: { artifactPath?: string } } };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'manual',
          message: 'Reply requires manual delivery.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns manual reply assistance for v2ex items and keeps the inbox item pending', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'v2ex',
        status: 'needs_review',
        author: 'alice',
        title: 'Cursor API follow-up',
        excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
        metadata: {
          sourceUrl: 'https://www.v2ex.com/t/888888',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      const responseBody = JSON.parse(response.body) as {
        delivery: {
          details?: {
            browserReplyHandoff?: {
              artifactPath?: string;
            };
          };
        };
      };
      expect(responseBody).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'manual',
          message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            manualReplyAssistant: {
              platform: 'v2ex',
              label: 'V2EX',
              copyText: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
              sourceUrl: 'https://www.v2ex.com/t/888888',
              openUrl: 'https://www.v2ex.com/t/888888',
              title: 'Cursor API follow-up',
            },
          }),
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns manual_required for browser-auth channel accounts and keeps the inbox item pending', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'x',
        accountKey: 'x-browser-main',
        displayName: 'X Browser Main',
        authType: 'browser',
        status: 'healthy',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'x',
        status: 'needs_review',
        author: 'routerwatch',
        title: 'Need lower latency in APAC',
        excerpt:
          '@routerwatch · matched x search seed for openrouter failover\n\nRoute around outages faster.\n\nhttps://x.com/routerwatch/status/tweet-1',
        metadata: {
          channelAccountId: channelAccount.id,
          sourceUrl: 'https://x.com/routerwatch/status/tweet-1',
          replyTargetId: 'tweet-1',
          replyTargetType: 'tweet',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const responseBody = JSON.parse(response.body) as {
        delivery: {
          details?: {
            browserReplyHandoff?: {
              artifactPath?: string;
            };
          };
        };
      };

      expect(response.status).toBe(200);
      expect(responseBody).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: 'X reply requires a saved browser session before manual handoff.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              platform: 'x',
              channelAccountId: channelAccount.id,
              accountKey: 'x-browser-main',
              readiness: 'blocked',
              sessionAction: 'request_session',
              artifactPath: 'artifacts/inbox-reply-handoffs/x/x-browser-main/x-inbox-item-1.json',
            }),
            context: {
              selection: 'channelAccountId',
              channelAccount: {
                id: channelAccount.id,
                projectId: 1,
                platform: 'x',
                accountKey: 'x-browser-main',
                displayName: 'X Browser Main',
                authType: 'browser',
                status: 'healthy',
              },
              readiness: expect.objectContaining({
                platform: 'x',
                ready: false,
                mode: 'browser',
                status: 'needs_session',
                action: 'request_session',
              }),
            },
          }),
        }),
      });
      const artifactPath = responseBody.delivery.details?.browserReplyHandoff?.artifactPath;
      expect(artifactPath).toBe('artifacts/inbox-reply-handoffs/x/x-browser-main/x-inbox-item-1.json');
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          channelAccountId: channelAccount.id,
          projectId: 1,
          status: 'pending',
          readiness: 'blocked',
          sessionAction: 'request_session',
          platform: 'x',
          itemId: '1',
          accountKey: 'x-browser-main',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns a ready browser reply handoff with an artifact path when a saved session exists', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
          sourceUrl: 'https://weibo.test/post/1',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      const body = JSON.parse(response.body) as {
        item: { status: string };
        delivery: {
          status: string;
          mode: string;
          details?: {
            browserReplyHandoff?: {
              artifactPath?: string;
              readiness: string;
              sessionAction: string | null;
              accountKey: string;
            };
          };
        };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: '微博 reply is ready for manual browser handoff with the saved session.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              platform: 'weibo',
              channelAccountId: channelAccount.id,
              accountKey: 'weibo-browser-main',
              readiness: 'ready',
              sessionAction: null,
              artifactPath:
                'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
            }),
            context: expect.objectContaining({
              selection: 'channelAccountId',
              readiness: expect.objectContaining({
                platform: 'weibo',
                ready: true,
                mode: 'browser',
                status: 'ready',
              }),
            }),
          }),
        }),
      });
      expect(artifactPath).toBeTruthy();
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          ownership: 'direct',
          channelAccountId: channelAccount.id,
          projectId: 1,
          status: 'pending',
          readiness: 'ready',
          sessionAction: null,
          platform: 'weibo',
          itemId: '1',
          accountKey: 'weibo-browser-main',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns a ready browser reply handoff with an artifact path for instagram when a saved session exists', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'instagram',
        accountKey: 'instagram-browser-main',
        displayName: 'Instagram Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'instagram',
        accountKey: 'instagram-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'instagram',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'instagram-browser-main',
          sourceUrl: 'https://www.instagram.com/p/post-1/',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      const body = JSON.parse(response.body) as {
        item: { status: string };
        delivery: {
          status: string;
          mode: string;
          details?: {
            browserReplyHandoff?: {
              artifactPath?: string;
              readiness: string;
              sessionAction: string | null;
              accountKey: string;
            };
          };
        };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: 'Instagram reply is ready for manual browser handoff with the saved session.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              platform: 'instagram',
              channelAccountId: channelAccount.id,
              accountKey: 'instagram-browser-main',
              readiness: 'ready',
              sessionAction: null,
              artifactPath:
                'artifacts/inbox-reply-handoffs/instagram/instagram-browser-main/instagram-inbox-item-1.json',
            }),
            context: expect.objectContaining({
              selection: 'channelAccountId',
              readiness: expect.objectContaining({
                platform: 'instagram',
                ready: true,
                mode: 'browser',
                status: 'ready',
              }),
            }),
          }),
        }),
      });
      expect(artifactPath).toBeTruthy();
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          channelAccountId: channelAccount.id,
          ownership: 'direct',
          projectId: 1,
          status: 'pending',
          readiness: 'ready',
          sessionAction: null,
          platform: 'instagram',
          itemId: '1',
          source: 'instagram',
          title: 'Need lower latency in APAC',
          excerpt: 'Can you share current response times?',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          author: 'ops-user',
          sourceUrl: 'https://www.instagram.com/p/post-1/',
          accountKey: 'instagram-browser-main',
          session: expect.objectContaining({
            hasSession: true,
            id: 'instagram:instagram-browser-main',
            status: 'active',
          }),
          resolvedAt: null,
          resolution: null,
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('restores a managed instagram browser session for reply handoff when metadata has not been written yet', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    const validatedAt = '2026-04-26T09:17:15.000Z';
    const managedStorageStatePath = path.join(
      rootDir,
      'browser-sessions',
      'managed',
      'instagram',
      'instagram-browser-main.json',
    );
    fs.mkdirSync(path.dirname(managedStorageStatePath), { recursive: true });
    fs.writeFileSync(
      managedStorageStatePath,
      JSON.stringify({
        cookies: [],
        origins: [],
      }),
    );
    fs.utimesSync(
      managedStorageStatePath,
      new Date(validatedAt),
      new Date(validatedAt),
    );

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'instagram',
        accountKey: 'instagram-browser-main',
        displayName: 'Instagram Browser Main',
        authType: 'browser',
        status: 'healthy',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'instagram',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'instagram-browser-main',
          sourceUrl: 'https://www.instagram.com/p/post-1/',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      const body = JSON.parse(response.body) as {
        delivery: {
          details?: {
            browserReplyHandoff?: {
              artifactPath?: string;
            };
          };
        };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: 'Instagram reply is ready for manual browser handoff with the saved session.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              platform: 'instagram',
              channelAccountId: channelAccount.id,
              accountKey: 'instagram-browser-main',
              readiness: 'ready',
              sessionAction: null,
              artifactPath:
                'artifacts/inbox-reply-handoffs/instagram/instagram-browser-main/instagram-inbox-item-1.json',
            }),
            context: expect.objectContaining({
              selection: 'channelAccountId',
              readiness: expect.objectContaining({
                platform: 'instagram',
                ready: true,
                mode: 'browser',
                status: 'ready',
              }),
            }),
          }),
        }),
      });
      expect(artifactPath).toBeTruthy();
      expect(createSessionStore().getSession('instagram', 'instagram-browser-main')).toMatchObject({
        id: 'instagram:instagram-browser-main',
        platform: 'instagram',
        accountKey: 'instagram-browser-main',
        storageStatePath: 'browser-sessions/managed/instagram/instagram-browser-main.json',
        status: 'active',
        lastValidatedAt: validatedAt,
      });
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          channelAccountId: channelAccount.id,
          ownership: 'direct',
          projectId: 1,
          status: 'pending',
          readiness: 'ready',
          sessionAction: null,
          platform: 'instagram',
          itemId: '1',
          accountKey: 'instagram-browser-main',
          session: expect.objectContaining({
            hasSession: true,
            id: 'instagram:instagram-browser-main',
            status: 'active',
            storageStatePath: 'browser-sessions/managed/instagram/instagram-browser-main.json',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('dispatches ready browser reply handoffs through the shared inbox service path', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
          sourceUrl: 'https://weibo.test/post/1',
        },
      });
      const browserLaneDispatch = vi.fn();
      const inboxReplyService = createInboxReplyService({
        channelAccountStore,
        jobQueueStore,
        browserLaneDispatch,
      });

      const delivery = await inboxReplyService.deliver({
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(delivery).toEqual(
        expect.objectContaining({
          status: 'manual_required',
          mode: 'browser',
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              readiness: 'ready',
              artifactPath:
                'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
            }),
          }),
        }),
      );
      expect(browserLaneDispatch).toHaveBeenCalledTimes(1);
      expect(browserLaneDispatch).toHaveBeenCalledWith({
        kind: 'inbox_reply_handoff',
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        channelAccountId: channelAccount.id,
        itemId: String(item.id),
        handoffAttempt: 1,
      });
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not dispatch blocked browser reply handoffs through the shared inbox service path', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'expired',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
          sourceUrl: 'https://weibo.test/post/1',
        },
      });
      const browserLaneDispatch = vi.fn();
      const inboxReplyService = createInboxReplyService({
        channelAccountStore,
        jobQueueStore,
        browserLaneDispatch,
      });

      const delivery = await inboxReplyService.deliver({
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(delivery).toEqual(
        expect.objectContaining({
          status: 'manual_required',
          mode: 'browser',
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              readiness: 'blocked',
              sessionAction: 'relogin',
            }),
          }),
        }),
      );
      expect(browserLaneDispatch).not.toHaveBeenCalled();
      expect(jobQueueStore.list({ limit: 10 })).toEqual([]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('queues one inbox reply handoff poll job per ready handoff attempt', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T08:00:00.000Z'));
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
          sourceUrl: 'https://weibo.test/post/1',
        },
      });

      await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      const jobQueueStore = createJobQueueStore();
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:01:00.000Z',
        }),
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:01:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        handoffAttempt: 1,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[1]?.payload ?? '{}')).toEqual({
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        handoffAttempt: 2,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('redispatches ready browser reply handoffs even when the poll job already exists', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T08:00:00.000Z'));
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
          sourceUrl: 'https://weibo.test/post/1',
        },
      });
      const browserLaneDispatch = vi.fn();
      const inboxReplyService = createInboxReplyService({
        channelAccountStore,
        jobQueueStore,
        browserLaneDispatch,
      });

      await inboxReplyService.deliver({
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      await inboxReplyService.deliver({
        item,
        reply: 'Updated reply copy for the same browser handoff artifact.',
      });

      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:01:00.000Z',
        }),
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:01:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        handoffAttempt: 1,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[1]?.payload ?? '{}')).toEqual({
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        handoffAttempt: 2,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
      expect(browserLaneDispatch).toHaveBeenCalledTimes(2);
      expect(browserLaneDispatch).toHaveBeenNthCalledWith(1, {
        kind: 'inbox_reply_handoff',
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        channelAccountId: channelAccount.id,
        itemId: String(item.id),
        handoffAttempt: 1,
      });
      expect(browserLaneDispatch).toHaveBeenNthCalledWith(2, {
        kind: 'inbox_reply_handoff',
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        channelAccountId: channelAccount.id,
        itemId: String(item.id),
        handoffAttempt: 2,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('routes a promoted instagram monitor reply handoff through the metadata-selected channel account', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const selectedAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'instagram',
        accountKey: 'instagram-selected',
        displayName: 'Instagram Selected',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 1,
        platform: 'instagram',
        accountKey: 'instagram-secondary',
        displayName: 'Instagram Secondary',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'instagram',
        accountKey: 'instagram-selected',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const monitorStore = createMonitorStore();
      monitorStore.create({
        projectId: 1,
        source: 'instagram',
        title: 'Instagram 评论跟进',
        detail: 'instagram comment · creator_ops\n需要人工确认评论语气。',
        metadata: {
          channelAccountId: selectedAccount.id,
          accountKey: 'instagram-selected',
          sourceUrl: 'https://www.instagram.com/p/post-selected/',
          profileUrl: 'https://www.instagram.com/creator_ops/',
          profileHandle: '@creator_ops',
        },
      });

      const fetchResponse = await requestApp('POST', '/api/inbox/fetch');
      expect(fetchResponse.status).toBe(201);
      expect(JSON.parse(fetchResponse.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            source: 'instagram',
            author: 'creator_ops',
            status: 'needs_review',
            title: 'Instagram 评论跟进',
            metadata: expect.objectContaining({
              channelAccountId: selectedAccount.id,
              accountKey: 'instagram-selected',
              sourceUrl: 'https://www.instagram.com/p/post-selected/',
              profileUrl: 'https://www.instagram.com/creator_ops/',
              profileHandle: '@creator_ops',
            }),
          }),
        ],
        inserted: 1,
        total: 1,
        unread: 1,
      });

      const replyResponse = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for the comment. We can share current APAC latency benchmarks.',
      });

      const body = JSON.parse(replyResponse.body) as {
        delivery: {
          details?: {
            browserReplyHandoff?: {
              channelAccountId?: number;
              accountKey?: string;
              artifactPath?: string;
              readiness?: string;
            };
            context?: {
              selection?: string;
            };
          };
        };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(replyResponse.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: 'Instagram reply is ready for manual browser handoff with the saved session.',
          reply: 'Thanks for the comment. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            context: expect.objectContaining({
              selection: 'channelAccountId',
            }),
            browserReplyHandoff: expect.objectContaining({
              platform: 'instagram',
              channelAccountId: selectedAccount.id,
              accountKey: 'instagram-selected',
              readiness: 'ready',
              sessionAction: null,
              artifactPath:
                'artifacts/inbox-reply-handoffs/instagram/instagram-selected/instagram-inbox-item-1.json',
            }),
          }),
        }),
      });
      expect(artifactPath).toBeTruthy();
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          ownership: 'direct',
          channelAccountId: selectedAccount.id,
          projectId: 1,
          status: 'pending',
          platform: 'instagram',
          itemId: '1',
          source: 'instagram',
          sourceUrl: 'https://www.instagram.com/p/post-selected/',
          accountKey: 'instagram-selected',
          reply: 'Thanks for the comment. We can share current APAC latency benchmarks.',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('routes a promoted tiktok monitor reply handoff through the metadata-selected channel account', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const selectedAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'tiktok',
        accountKey: 'tiktok-selected',
        displayName: 'TikTok Selected',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 1,
        platform: 'tiktok',
        accountKey: 'tiktok-secondary',
        displayName: 'TikTok Secondary',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'tiktok',
        accountKey: 'tiktok-selected',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const monitorStore = createMonitorStore();
      monitorStore.create({
        projectId: 1,
        source: 'tiktok',
        title: 'TikTok 提及跟进',
        detail: 'tiktok mention · short_video_ops\n需要尽快回复该提及。',
        metadata: {
          channelAccountId: selectedAccount.id,
          accountKey: 'tiktok-selected',
          sourceUrl: 'https://www.tiktok.com/@short_video_ops/video/selected',
          profileUrl: 'https://www.tiktok.com/@short_video_ops',
          profileHandle: '@short_video_ops',
        },
      });

      const fetchResponse = await requestApp('POST', '/api/inbox/fetch');
      expect(fetchResponse.status).toBe(201);
      expect(JSON.parse(fetchResponse.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            source: 'tiktok',
            author: 'short_video_ops',
            status: 'needs_review',
            title: 'TikTok 提及跟进',
            metadata: expect.objectContaining({
              channelAccountId: selectedAccount.id,
              accountKey: 'tiktok-selected',
              sourceUrl: 'https://www.tiktok.com/@short_video_ops/video/selected',
              profileUrl: 'https://www.tiktok.com/@short_video_ops',
              profileHandle: '@short_video_ops',
            }),
          }),
        ],
        inserted: 1,
        total: 1,
        unread: 1,
      });

      const replyResponse = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for the mention. We can share current APAC latency benchmarks.',
      });

      const body = JSON.parse(replyResponse.body) as {
        delivery: {
          details?: {
            browserReplyHandoff?: {
              channelAccountId?: number;
              accountKey?: string;
              artifactPath?: string;
              readiness?: string;
            };
            context?: {
              selection?: string;
            };
          };
        };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(replyResponse.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: 'TikTok reply is ready for manual browser handoff with the saved session.',
          reply: 'Thanks for the mention. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            context: expect.objectContaining({
              selection: 'channelAccountId',
            }),
            browserReplyHandoff: expect.objectContaining({
              platform: 'tiktok',
              channelAccountId: selectedAccount.id,
              accountKey: 'tiktok-selected',
              readiness: 'ready',
              sessionAction: null,
              artifactPath:
                'artifacts/inbox-reply-handoffs/tiktok/tiktok-selected/tiktok-inbox-item-1.json',
            }),
          }),
        }),
      });
      expect(artifactPath).toBeTruthy();
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          ownership: 'direct',
          channelAccountId: selectedAccount.id,
          projectId: 1,
          status: 'pending',
          platform: 'tiktok',
          itemId: '1',
          source: 'tiktok',
          sourceUrl: 'https://www.tiktok.com/@short_video_ops/video/selected',
          accountKey: 'tiktok-selected',
          reply: 'Thanks for the mention. We can share current APAC latency benchmarks.',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('keeps a browser inbox item pending when a browser reply handoff import reports failure', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
        },
      });

      const sendReplyResponse = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const artifactPath = (
        JSON.parse(sendReplyResponse.body) as {
          delivery: { details?: { browserReplyHandoff?: { artifactPath?: string } } };
        }
      ).delivery.details?.browserReplyHandoff?.artifactPath;

      const importResponse = await requestApp('POST', '/api/system/inbox-reply-handoffs/import', {
        artifactPath,
        handoffAttempt: 1,
        replyStatus: 'failed',
        message: 'manual reply failed',
      });

      expect(importResponse.status).toBe(200);
      expect(JSON.parse(importResponse.body)).toEqual({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        itemId: 1,
        itemStatus: 'needs_review',
        platform: 'weibo',
        mode: 'browser',
        status: 'failed',
        success: false,
        deliveryUrl: null,
        externalId: null,
        message: 'manual reply failed',
        deliveredAt: null,
      });
      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('marks the inbox item handled after a browser reply handoff import reports sent', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
        },
      });

      const sendReplyResponse = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const artifactPath = (
        JSON.parse(sendReplyResponse.body) as {
          delivery: { details?: { browserReplyHandoff?: { artifactPath?: string } } };
        }
      ).delivery.details?.browserReplyHandoff?.artifactPath;

      const importResponse = await requestApp('POST', '/api/system/inbox-reply-handoffs/import', {
        artifactPath,
        handoffAttempt: 1,
        replyStatus: 'sent',
        message: 'manual browser reply sent',
        deliveryUrl: 'https://weibo.test/post/1#reply-9',
        externalId: 'reply-9',
        deliveredAt: '2026-04-25T10:05:00.000Z',
      });

      expect(importResponse.status).toBe(200);
      expect(JSON.parse(importResponse.body)).toEqual({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        itemId: 1,
        itemStatus: 'handled',
        platform: 'weibo',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://weibo.test/post/1#reply-9',
        externalId: 'reply-9',
        message: 'manual browser reply sent',
        deliveredAt: '2026-04-25T10:05:00.000Z',
      });
      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: 1,
          status: 'handled',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('keeps browser reply handoff sent imports successful when the local inbox status update fails', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'active',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
        },
      });

      const sendReplyResponse = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const artifactPath = (
        JSON.parse(sendReplyResponse.body) as {
          delivery: { details?: { browserReplyHandoff?: { artifactPath?: string } } };
        }
      ).delivery.details?.browserReplyHandoff?.artifactPath;

      vi.spyOn(inboxStoreModule, 'createInboxStore').mockReturnValue({
        create: inboxStore.create,
        list: inboxStore.list,
        updateStatus: () => undefined,
      });

      const importResponse = await requestApp('POST', '/api/system/inbox-reply-handoffs/import', {
        artifactPath,
        handoffAttempt: 1,
        replyStatus: 'sent',
        message: 'manual browser reply sent',
        deliveryUrl: 'https://weibo.test/post/1#reply-10',
        externalId: 'reply-10',
        deliveredAt: '2026-04-25T10:06:00.000Z',
      });

      expect(importResponse.status).toBe(200);
      expect(JSON.parse(importResponse.body)).toEqual({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        itemId: 1,
        itemStatus: 'needs_review',
        platform: 'weibo',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://weibo.test/post/1#reply-10',
        externalId: 'reply-10',
        message: 'manual browser reply sent',
        deliveredAt: '2026-04-25T10:06:00.000Z',
      });
      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('persists a blocked browser reply handoff artifact when the saved session requires relogin', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'Weibo Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'expired',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const body = JSON.parse(response.body) as {
        delivery: { details?: { browserReplyHandoff?: { artifactPath?: string } } };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: '微博 reply requires the browser session to be refreshed before manual handoff.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              platform: 'weibo',
              channelAccountId: channelAccount.id,
              accountKey: 'weibo-browser-main',
              readiness: 'blocked',
              sessionAction: 'relogin',
              artifactPath:
                'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
            }),
          }),
        }),
      });
      expect(artifactPath).toBe(
        'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
      );
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          channelAccountId: channelAccount.id,
          projectId: 1,
          status: 'pending',
          readiness: 'blocked',
          sessionAction: 'relogin',
          platform: 'weibo',
          itemId: '1',
          accountKey: 'weibo-browser-main',
          session: expect.objectContaining({
            hasSession: true,
            status: 'expired',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('persists a blocked browser reply handoff artifact for tiktok when the saved session requires relogin', async () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'tiktok',
        accountKey: 'tiktok-browser-main',
        displayName: 'TikTok Browser Main',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionStore().saveSession({
        platform: 'tiktok',
        accountKey: 'tiktok-browser-main',
        storageState: {
          cookies: [],
          origins: [],
        },
        status: 'expired',
        lastValidatedAt: '2026-04-25T10:00:00.000Z',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'tiktok',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'tiktok-browser-main',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });
      const body = JSON.parse(response.body) as {
        delivery: { details?: { browserReplyHandoff?: { artifactPath?: string } } };
      };
      const artifactPath = body.delivery.details?.browserReplyHandoff?.artifactPath;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'manual_required',
          mode: 'browser',
          message: 'TikTok reply requires the browser session to be refreshed before manual handoff.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            browserReplyHandoff: expect.objectContaining({
              platform: 'tiktok',
              channelAccountId: channelAccount.id,
              accountKey: 'tiktok-browser-main',
              readiness: 'blocked',
              sessionAction: 'relogin',
              artifactPath:
                'artifacts/inbox-reply-handoffs/tiktok/tiktok-browser-main/tiktok-inbox-item-1.json',
            }),
          }),
        }),
      });
      expect(artifactPath).toBe(
        'artifacts/inbox-reply-handoffs/tiktok/tiktok-browser-main/tiktok-inbox-item-1.json',
      );
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath as string), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          channelAccountId: channelAccount.id,
          projectId: 1,
          status: 'pending',
          readiness: 'blocked',
          sessionAction: 'relogin',
          platform: 'tiktok',
          itemId: '1',
          accountKey: 'tiktok-browser-main',
          session: expect.objectContaining({
            hasSession: true,
            status: 'expired',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails reply delivery when multiple channel accounts match the same project and platform', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      channelAccountStore.create({
        projectId: 1,
        platform: 'x',
        accountKey: 'x-main-a',
        displayName: 'X Main A',
        authType: 'api',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 1,
        platform: 'x',
        accountKey: 'x-main-b',
        displayName: 'X Main B',
        authType: 'api',
        status: 'healthy',
      });

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'x',
        status: 'needs_review',
        author: 'routerwatch',
        title: 'Need lower latency in APAC',
        excerpt:
          '@routerwatch · matched x search seed for openrouter failover\n\nRoute around outages faster.\n\nhttps://x.com/routerwatch/status/tweet-1',
        metadata: {
          sourceUrl: 'https://x.com/routerwatch/status/tweet-1',
          replyTargetId: 'tweet-1',
          replyTargetType: 'tweet',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'failed',
          mode: 'api',
          message: 'Multiple X channel accounts matched project 1. Add channelAccountId or accountKey to inbox metadata.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: {
            lookup: {
              projectId: 1,
              platform: 'x',
            },
            error: {
              category: 'validation',
              retriable: false,
              stage: 'account_resolution',
            },
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails reply delivery when an explicit accountKey has no matching channel account', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installXReplyFetchStub();

      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'x',
        status: 'needs_review',
        author: 'routerwatch',
        title: 'Need lower latency in APAC',
        excerpt:
          '@routerwatch · matched x search seed for openrouter failover\n\nRoute around outages faster.\n\nhttps://x.com/routerwatch/status/tweet-1',
        metadata: {
          accountKey: 'x-missing',
          sourceUrl: 'https://x.com/routerwatch/status/tweet-1',
          replyTargetId: 'tweet-1',
          replyTargetType: 'tweet',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'failed',
          mode: 'api',
          message: 'No X channel account matched accountKey "x-missing" in project 1.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: {
            lookup: {
              accountKey: 'x-missing',
              projectId: 1,
              platform: 'x',
            },
            error: {
              category: 'validation',
              retriable: false,
              stage: 'account_resolution',
            },
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('keeps browser-only platforms in browser mode when account resolution fails', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_review',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?\n\nhttps://weibo.test/post/1',
        metadata: {
          accountKey: 'weibo-missing',
          sourceUrl: 'https://weibo.test/post/1',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_review',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'failed',
          mode: 'browser',
          message: 'No 微博 channel account matched accountKey "weibo-missing" in project 1.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: {
            lookup: {
              accountKey: 'weibo-missing',
              projectId: 1,
              platform: 'weibo',
            },
            error: {
              category: 'validation',
              retriable: false,
              stage: 'account_resolution',
            },
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('preserves reddit comment reply targets instead of collapsing them to the submission id', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installRedditReplyFetchStub('t1_comment123');

      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'latencywatch',
        title: 'Claude latency in Australia',
        excerpt:
          'r/LocalLLaMA · latencywatch\n\nOperators comparing AU routing for Claude requests.\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/comment123/',
        metadata: {
          sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/comment123/',
          replyTargetId: 'abc123',
          replyTargetType: 'reddit_comment',
          replyThingFullname: 't1_comment123',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'handled',
        }),
        delivery: expect.objectContaining({
          success: true,
          status: 'sent',
          mode: 'api',
          message:
            'Reddit reply sent to https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/comment123/.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl:
            'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/reply123/',
          externalId: 'reply123',
          details: expect.objectContaining({
            replyTo: 't1_comment123',
            context: expect.objectContaining({
              selection: 'environment',
            }),
          }),
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('uses reddit comment target ids when replyThingFullname is absent', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      installRedditReplyFetchStub('t1_comment123');

      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'latencywatch',
        title: 'Claude latency in Australia',
        excerpt:
          'r/LocalLLaMA · latencywatch\n\nOperators comparing AU routing for Claude requests.\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/comment123/',
        metadata: {
          sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/comment123/',
          replyTargetId: 'comment123',
          replyTargetType: 'reddit_comment',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'handled',
        }),
        delivery: expect.objectContaining({
          success: true,
          status: 'sent',
          mode: 'api',
          message:
            'Reddit reply sent to https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/comment123/.',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl:
            'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/reply123/',
          externalId: 'reply123',
          details: expect.objectContaining({
            replyTo: 't1_comment123',
            context: expect.objectContaining({
              selection: 'environment',
            }),
          }),
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns a failed reddit delivery and keeps the inbox item pending when credentials are missing', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'latencywatch',
        title: 'Claude latency in Australia',
        excerpt:
          'r/LocalLLaMA · latencywatch\n\nOperators comparing AU routing for Claude requests.\n\nhttps://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
        metadata: {
          sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/claude_latency_in_australia/',
          replyTargetId: 'abc123',
          replyTargetType: 'reddit_submission',
        },
      });

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        item: expect.objectContaining({
          id: 1,
          status: 'needs_reply',
        }),
        delivery: expect.objectContaining({
          success: false,
          status: 'failed',
          mode: 'api',
          message:
            'missing reddit credentials: configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD',
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
          deliveryUrl: null,
          externalId: null,
          details: expect.objectContaining({
            replyTo: 't3_abc123',
            retry: {
              oauth: {
                attempts: 0,
                maxAttempts: 0,
                stage: 'oauth',
              },
            },
            context: expect.objectContaining({
              selection: 'environment',
              readiness: expect.objectContaining({
                platform: 'reddit',
                ready: false,
                mode: 'api',
                status: 'needs_config',
              }),
            }),
            error: {
              category: 'auth',
              retriable: false,
              stage: 'oauth',
            },
          }),
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects empty inbox send-reply payloads', async () => {
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

      const response = await requestApp('POST', '/api/inbox/1/send-reply', {
        reply: '   ',
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'invalid inbox reply',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it.each(['handled', 'snoozed'] as const)(
    'rejects send-reply requests for %s inbox items',
    async (status) => {
      const { rootDir } = createTestDatabasePath();
      try {
        installXReplyFetchStub();

        const inboxStore = createInboxStore();
        inboxStore.create({
          source: 'x',
          status,
          author: 'routerwatch',
          title: 'Need lower latency in APAC',
          excerpt:
            '@routerwatch · matched x search seed for openrouter failover\n\nRoute around outages faster.\n\nhttps://x.com/routerwatch/status/tweet-1',
          metadata: {
            sourceUrl: 'https://x.com/routerwatch/status/tweet-1',
            replyTargetId: 'tweet-1',
            replyTargetType: 'tweet',
          },
        });

        const response = await requestApp('POST', '/api/inbox/1/send-reply', {
          reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        });

        expect(response.status).toBe(409);
        expect(JSON.parse(response.body)).toEqual({
          error: 'inbox item cannot be replied to',
        });
        expect(inboxStore.list()).toEqual([
          expect.objectContaining({
            id: 1,
            status,
          }),
        ]);
      } finally {
        cleanupTestDatabasePath(rootDir);
      }
    },
  );

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
