import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createInboxStore } from '../../src/server/store/inbox';
import { createReputationStore } from '../../src/server/store/reputation';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

let activeTestDbRoot: string | undefined;
const originalNodeEnv = process.env.NODE_ENV;
const originalRedditClientId = process.env.REDDIT_CLIENT_ID;
const originalRedditClientSecret = process.env.REDDIT_CLIENT_SECRET;
const originalRedditUsername = process.env.REDDIT_USERNAME;
const originalRedditPassword = process.env.REDDIT_PASSWORD;
const originalRedditUserAgent = process.env.REDDIT_USER_AGENT;
const originalMonitorXSearchSeeds = process.env.MONITOR_X_SEARCH_SEEDS;
const originalXAccessToken = process.env.X_ACCESS_TOKEN;
const originalXBearerToken = process.env.X_BEARER_TOKEN;

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

beforeEach(() => {
  activeTestDbRoot = createTestDatabasePath().rootDir;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  restoreEnv('REDDIT_CLIENT_ID', originalRedditClientId);
  restoreEnv('REDDIT_CLIENT_SECRET', originalRedditClientSecret);
  restoreEnv('REDDIT_USERNAME', originalRedditUsername);
  restoreEnv('REDDIT_PASSWORD', originalRedditPassword);
  restoreEnv('REDDIT_USER_AGENT', originalRedditUserAgent);
  restoreEnv('MONITOR_X_SEARCH_SEEDS', originalMonitorXSearchSeeds);
  restoreEnv('X_ACCESS_TOKEN', originalXAccessToken);
  restoreEnv('X_BEARER_TOKEN', originalXBearerToken);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (activeTestDbRoot) {
    cleanupTestDatabasePath(activeTestDbRoot);
    activeTestDbRoot = undefined;
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function installReputationSearchFixtures() {
  process.env.REDDIT_CLIENT_ID = 'reddit-id';
  process.env.REDDIT_CLIENT_SECRET = 'reddit-secret';
  process.env.REDDIT_USERNAME = 'reddit-user';
  process.env.REDDIT_PASSWORD = 'reddit-pass';
  process.env.REDDIT_USER_AGENT = 'promobot/test';
  process.env.MONITOR_X_SEARCH_SEEDS = JSON.stringify([
    {
      query: 'openrouter failover',
      id: 'tweet-1',
      title: 'Fast routing praise',
      text: 'Users praised fast APAC routing.',
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

        if (query === 'brand latency') {
          return createRedditSearchResponse({
            id: 'brand-1',
            title: 'Billing confusion mention',
            selftext: 'Agency buyers asked whether billing is transparent enough.',
            permalink: '/r/LocalLLaMA/comments/brand1/billing_confusion_mention/',
            subredditNamePrefixed: 'r/LocalLLaMA',
            author: 'latencywatch',
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
                  <a href="/t/888888">Cursor API operator thread</a>
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

        if (query === 'project two v2ex') {
          return new Response(
            `
              <div class="cell item">
                <span class="item_title">
                  <a href="/t/999999">Project two operators thread</a>
                </span>
                <strong><a href="/member/bob">bob</a></strong>
                <span class="topic_info">
                  <a class="node" href="/go/ops">Ops</a>
                  • <a class="count" href="/t/999999#reply4">4 replies</a>
                </span>
              </div>
            `,
            { status: 200 },
          );
        }
      }

      throw new Error(`unexpected fetch request in reputation test: ${requestUrl}`);
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

describe('reputation services', () => {
  it('classifies sentiment and follow-up status from mention copy', async () => {
    const { createReputationSentimentService } = await import(
      '../../src/server/services/reputation/sentiment'
    );

    const sentimentService = createReputationSentimentService();

    expect(
      sentimentService.analyze({
        title: 'Lower APAC latency praise',
        detail: 'Users praised lower Claude routing latency from Perth.',
      }),
    ).toEqual({
      sentiment: 'positive',
      status: 'new',
    });

    expect(
      sentimentService.analyze({
        title: 'Billing confusion mention',
        detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
      }),
    ).toEqual({
      sentiment: 'negative',
      status: 'escalate',
    });

    expect(
      sentimentService.analyze({
        title: 'Watching reputation query: brand latency',
        detail: 'Configured from monitorRedditQueries before live mentions arrive.',
      }),
    ).toEqual({
      sentiment: 'neutral',
      status: 'new',
    });
  });

  it('collects non-rss monitor items before configured reputation fallbacks', async () => {
    const { createReputationCollectorService } = await import(
      '../../src/server/services/reputation/collector'
    );

    const collector = createReputationCollectorService({
      sentimentService: {
        analyze({ title }: { title: string; detail: string }) {
          return title.includes('Billing')
            ? { sentiment: 'negative', status: 'escalate' }
            : { sentiment: 'positive', status: 'new' };
        },
      },
    });

    expect(
      collector.collect({
        monitorItems: [
          {
            id: 1,
            source: 'rss',
            title: 'RSS should be ignored',
            detail: 'This should not appear in reputation.',
            status: 'new',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
          {
            id: 2,
            source: 'reddit',
            title: 'Lower APAC latency praise',
            detail: 'Observed strong praise from Australia buyers.',
            status: 'new',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
          {
            id: 3,
            source: 'v2ex',
            title: 'Billing confusion mention',
            detail: 'Need pricing clarity before procurement.',
            status: 'new',
            createdAt: '2026-04-20T00:00:00.000Z',
          },
        ],
        settings: {
          monitorRedditQueries: ['brand latency'],
          monitorV2exQueries: ['billing transparency'],
        },
      }),
    ).toEqual([
      {
        source: 'reddit',
        sentiment: 'positive',
        status: 'new',
        title: 'Lower APAC latency praise',
        detail: 'Observed strong praise from Australia buyers.',
      },
      {
        source: 'v2ex',
        sentiment: 'negative',
        status: 'escalate',
        title: 'Billing confusion mention',
        detail: 'Need pricing clarity before procurement.',
      },
    ]);
  });
});

describe('reputation api', () => {
  it('returns an empty reputation feed in production when no real signals or configs are available', async () => {
    process.env.NODE_ENV = 'production';

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [],
      inserted: 0,
      total: 0,
    });
  });

  it('fetches live reputation mentions from configured search queries', async () => {
    installReputationSearchFixtures();

    const settingsResponse = await requestApp('PATCH', '/api/settings', {
      monitorXQueries: ['openrouter failover'],
      monitorRedditQueries: ['brand latency'],
      monitorV2exQueries: ['cursor api'],
    });

    expect(settingsResponse.status).toBe(200);

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          source: 'x',
          sentiment: 'positive',
          status: 'new',
          title: 'Fast routing praise',
        }),
        expect.objectContaining({
          id: 2,
          source: 'reddit',
          sentiment: 'negative',
          status: 'escalate',
          title: 'Billing confusion mention',
        }),
        expect.objectContaining({
          id: 3,
          source: 'v2ex',
          sentiment: 'neutral',
          status: 'new',
          title: 'Cursor API operator thread',
        }),
      ],
      inserted: 3,
      total: 3,
    });

    const feedResponse = await requestApp('GET', '/api/reputation/feed');

    expect(feedResponse.status).toBe(200);
    expect(JSON.parse(feedResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          title: expect.stringContaining('Fast routing praise'),
        }),
        expect.objectContaining({
          id: 2,
          title: expect.stringContaining('Billing confusion mention'),
        }),
        expect.objectContaining({
          id: 3,
          title: expect.stringContaining('Cursor API operator thread'),
        }),
      ],
      total: 3,
    });
  });

  it('does not insert duplicate reputation items when the same live mentions are fetched twice', async () => {
    installReputationSearchFixtures();

    const settingsResponse = await requestApp('PATCH', '/api/settings', {
      monitorXQueries: ['openrouter failover'],
      monitorRedditQueries: ['brand latency'],
      monitorV2exQueries: ['cursor api'],
    });

    expect(settingsResponse.status).toBe(200);

    const firstFetchResponse = await requestApp('POST', '/api/reputation/fetch');
    expect(firstFetchResponse.status).toBe(201);
    expect(JSON.parse(firstFetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({ id: 1, source: 'x', title: 'Fast routing praise' }),
        expect.objectContaining({ id: 2, source: 'reddit', title: 'Billing confusion mention' }),
        expect.objectContaining({ id: 3, source: 'v2ex', title: 'Cursor API operator thread' }),
      ],
      inserted: 3,
      total: 3,
    });

    const secondFetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(secondFetchResponse.status).toBe(201);
    expect(JSON.parse(secondFetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({ id: 1, source: 'x', title: 'Fast routing praise' }),
        expect.objectContaining({ id: 2, source: 'reddit', title: 'Billing confusion mention' }),
        expect.objectContaining({ id: 3, source: 'v2ex', title: 'Cursor API operator thread' }),
      ],
      inserted: 0,
      total: 3,
    });

    const reputationStore = createReputationStore();
    expect(reputationStore.getStats().items.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('does not fall back to placeholder reputation items when configured searches return no live matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 })));

    const settingsResponse = await requestApp('PATCH', '/api/settings', {
      monitorV2exQueries: ['cursor api'],
    });

    expect(settingsResponse.status).toBe(200);

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [],
      inserted: 0,
      total: 0,
    });
  });

  it('fetches live reputation mentions from enabled source configs when global settings are absent', async () => {
    installReputationSearchFixtures();

    const projectResponse = await requestApp('POST', '/api/projects', {
      name: 'Reputation Signals',
      siteName: 'PromoBot',
      siteUrl: 'https://example.com',
      siteDescription: 'Reputation workspace',
      sellingPoints: ['fast'],
    });

    expect(projectResponse.status).toBe(201);

    const sourceConfigs = [
      {
        projectId: 1,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Competitor RSS',
        configJson: {
          url: 'https://feeds.example.com/monitor.xml',
        },
        enabled: true,
        pollIntervalMinutes: 45,
      },
      {
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Reddit mentions',
        configJson: {
          keywords: ['brand latency'],
        },
        enabled: true,
        pollIntervalMinutes: 45,
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
        pollIntervalMinutes: 45,
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
        pollIntervalMinutes: 45,
      },
      {
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Disabled Reddit mentions',
        configJson: {
          keywords: ['disabled query'],
        },
        enabled: false,
        pollIntervalMinutes: 45,
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

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          projectId: 1,
          source: 'x',
          sentiment: 'positive',
          status: 'new',
          title: 'Fast routing praise',
        }),
        expect.objectContaining({
          id: 2,
          projectId: 1,
          source: 'reddit',
          sentiment: 'negative',
          status: 'escalate',
          title: 'Billing confusion mention',
        }),
        expect.objectContaining({
          id: 3,
          projectId: 1,
          source: 'v2ex',
          sentiment: 'neutral',
          status: 'new',
          title: 'Cursor API operator thread',
        }),
      ],
      inserted: 3,
      total: 3,
    });

    const reputationStore = createReputationStore();
    expect(reputationStore.getStats(1).items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(reputationStore.getStats(2)).toEqual({
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      trend: [
        { label: '正向', value: 0 },
        { label: '中性', value: 0 },
        { label: '负向', value: 0 },
      ],
      items: [],
    });
  });

  it('fetches reputation only from source configs for the requested projectId', async () => {
    installReputationSearchFixtures();

    const settingsResponse = await requestApp('PATCH', '/api/settings', {
      monitorRedditQueries: ['global reddit query'],
      monitorV2exQueries: ['global v2ex query'],
    });

    expect(settingsResponse.status).toBe(200);

    const firstProjectResponse = await requestApp('POST', '/api/projects', {
      name: 'Project One',
      siteName: 'PromoBot',
      siteUrl: 'https://one.example.com',
      siteDescription: 'Project one workspace',
      sellingPoints: ['fast'],
    });
    expect(firstProjectResponse.status).toBe(201);

    const secondProjectResponse = await requestApp('POST', '/api/projects', {
      name: 'Project Two',
      siteName: 'PromoBot',
      siteUrl: 'https://two.example.com',
      siteDescription: 'Project two workspace',
      sellingPoints: ['clear'],
    });
    expect(secondProjectResponse.status).toBe(201);

    const projectOneConfigResponse = await requestApp('POST', '/api/projects/1/source-configs', {
      projectId: 1,
      sourceType: 'keyword+reddit',
      platform: 'reddit',
      label: 'Project 1 Reddit mentions',
      configJson: {
        keywords: ['project one reddit'],
      },
      enabled: true,
      pollIntervalMinutes: 30,
    });
    expect(projectOneConfigResponse.status).toBe(201);

    const projectTwoConfigResponse = await requestApp('POST', '/api/projects/2/source-configs', {
      projectId: 2,
      sourceType: 'v2ex_search',
      platform: 'v2ex',
      label: 'Project 2 V2EX mentions',
      configJson: {
        query: 'project two v2ex',
      },
      enabled: true,
      pollIntervalMinutes: 30,
    });
    expect(projectTwoConfigResponse.status).toBe(201);

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch', {
      projectId: 2,
    });

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          projectId: 2,
          source: 'v2ex',
          sentiment: 'neutral',
          status: 'new',
          title: 'Project two operators thread',
        }),
      ],
      inserted: 1,
      total: 1,
    });

    const reputationStore = createReputationStore();
    expect(reputationStore.getStats(1).items).toEqual([]);
    expect(reputationStore.getStats(2).items).toEqual([
      expect.objectContaining({
        id: 1,
        projectId: 2,
        title: 'Project two operators thread',
      }),
    ]);
  });

  it('filters reputation stats by optional projectId without breaking legacy rows', async () => {
    const reputationStore = createReputationStore();
    reputationStore.create({
      source: 'facebook-group',
      sentiment: 'negative',
      status: 'escalate',
      title: 'Legacy complaint',
      detail: 'No project id attached.',
    });
    reputationStore.create({
      projectId: 1,
      source: 'reddit',
      sentiment: 'positive',
      status: 'new',
      title: 'Project 1 praise',
      detail: 'Project 1 detail.',
    });
    reputationStore.create({
      projectId: 2,
      source: 'x',
      sentiment: 'neutral',
      status: 'handled',
      title: 'Project 2 mention',
      detail: 'Project 2 detail.',
    });

    expect(reputationStore.getStats()).toMatchObject({
      total: 3,
      positive: 1,
      neutral: 1,
      negative: 1,
      items: [
        expect.objectContaining({
          projectId: undefined,
          title: 'Legacy complaint',
        }),
        expect.objectContaining({
          projectId: 1,
          title: 'Project 1 praise',
        }),
        expect.objectContaining({
          projectId: 2,
          title: 'Project 2 mention',
        }),
      ],
    });
    expect(reputationStore.getStats(1)).toMatchObject({
      total: 1,
      positive: 1,
      neutral: 0,
      negative: 0,
      items: [
        expect.objectContaining({
          projectId: 1,
          title: 'Project 1 praise',
        }),
      ],
    });
    expect(reputationStore.getStats(2)).toMatchObject({
      total: 1,
      positive: 0,
      neutral: 1,
      negative: 0,
      items: [
        expect.objectContaining({
          projectId: 2,
          title: 'Project 2 mention',
        }),
      ],
    });
  });

  it('deduplicates identical reputation items for the same project and content fields', async () => {
    const reputationStore = createReputationStore();
    const first = reputationStore.create({
      projectId: 1,
      source: 'reddit',
      sentiment: 'negative',
      status: 'new',
      title: 'Billing confusion mention',
      detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
    });
    const duplicate = reputationStore.create({
      projectId: 1,
      source: 'reddit',
      sentiment: 'negative',
      status: 'new',
      title: 'Billing confusion mention',
      detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
    });
    const otherProject = reputationStore.create({
      projectId: 2,
      source: 'reddit',
      sentiment: 'negative',
      status: 'new',
      title: 'Billing confusion mention',
      detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
    });

    expect(duplicate).toEqual(first);
    expect(otherProject.id).not.toBe(first.id);
    expect(reputationStore.getStats().total).toBe(2);
    expect(reputationStore.getStats(1).items.map((item) => item.id)).toEqual([first.id]);
    expect(reputationStore.getStats(2).items.map((item) => item.id)).toEqual([otherProject.id]);
  });

  it('filters reputation feed and stats by optional projectId query', async () => {
    const reputationStore = createReputationStore();
    reputationStore.create({
      source: 'facebook-group',
      sentiment: 'negative',
      status: 'escalate',
      title: 'Legacy complaint',
      detail: 'No project id attached.',
    });
    reputationStore.create({
      projectId: 1,
      source: 'reddit',
      sentiment: 'positive',
      status: 'new',
      title: 'Project 1 praise',
      detail: 'Project 1 detail.',
    });
    reputationStore.create({
      projectId: 2,
      source: 'x',
      sentiment: 'neutral',
      status: 'handled',
      title: 'Project 2 mention',
      detail: 'Project 2 detail.',
    });

    const feedResponse = await requestApp('GET', '/api/reputation/feed?projectId=1');

    expect(feedResponse.status).toBe(200);
    expect(JSON.parse(feedResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 2,
          projectId: 1,
          title: 'Project 1 praise',
        }),
      ],
      total: 1,
    });

    const statsResponse = await requestApp('GET', '/api/reputation/stats?projectId=1');

    expect(statsResponse.status).toBe(200);
    expect(JSON.parse(statsResponse.body)).toEqual({
      total: 1,
      positive: 1,
      neutral: 0,
      negative: 0,
      trend: [
        { label: '正向', value: 1 },
        { label: '中性', value: 0 },
        { label: '负向', value: 0 },
      ],
      items: [
        expect.objectContaining({
          id: 2,
          projectId: 1,
          sentiment: 'positive',
          title: 'Project 1 praise',
        }),
      ],
    });
  });

  it('returns aggregated reputation stats and items from SQLite', async () => {
    const reputationStore = createReputationStore();
    reputationStore.create({
      source: 'facebook-group',
      sentiment: 'negative',
      status: 'escalate',
      title: 'Session expired complaint',
      detail: 'Users report being logged out unexpectedly.',
    });
    reputationStore.create({
      source: 'reddit',
      sentiment: 'positive',
      status: 'handled',
      title: 'Lower APAC latency praise',
      detail: 'Users report improved latency in Australia.',
    });

    const response = await requestApp('GET', '/api/reputation/stats');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      total: 2,
      positive: 1,
      neutral: 0,
      negative: 1,
      trend: [
        { label: '正向', value: 1 },
        { label: '中性', value: 0 },
        { label: '负向', value: 1 },
      ],
      items: [
        expect.objectContaining({
          id: 1,
          sentiment: 'negative',
          status: 'escalate',
          title: 'Session expired complaint',
        }),
        expect.objectContaining({
          id: 2,
          sentiment: 'positive',
          status: 'handled',
          title: 'Lower APAC latency praise',
        }),
      ],
    });
  });

  it('updates a reputation item status through PATCH and preserves stats aggregation', async () => {
    const reputationStore = createReputationStore();
    const item = reputationStore.create({
      source: 'x',
      sentiment: 'neutral',
      status: 'new',
      title: 'Needs review',
      detail: 'Initial triage required.',
    });

    const response = await requestApp('PATCH', `/api/reputation/${item.id}`, {
      status: 'handled',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      item: {
        id: item.id,
        source: 'x',
        sentiment: 'neutral',
        status: 'handled',
        title: 'Needs review',
        detail: 'Initial triage required.',
        createdAt: item.createdAt,
      },
    });

    const statsResponse = await requestApp('GET', '/api/reputation/stats');

    expect(statsResponse.status).toBe(200);
    expect(JSON.parse(statsResponse.body)).toEqual({
      total: 1,
      positive: 0,
      neutral: 1,
      negative: 0,
      trend: [
        { label: '正向', value: 0 },
        { label: '中性', value: 1 },
        { label: '负向', value: 0 },
      ],
      items: [
        expect.objectContaining({
          id: item.id,
          status: 'handled',
          sentiment: 'neutral',
        }),
      ],
    });
  });

  it('creates a social inbox item when a reputation item is escalated', async () => {
    const reputationStore = createReputationStore();
    const inboxStore = createInboxStore();
    const item = reputationStore.create({
      projectId: 7,
      source: 'reddit',
      sentiment: 'negative',
      status: 'new',
      title: 'Billing confusion mention',
      detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
    });

    const response = await requestApp('PATCH', `/api/reputation/${item.id}`, {
      status: 'escalate',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      item: {
        id: item.id,
        projectId: 7,
        source: 'reddit',
        sentiment: 'negative',
        status: 'escalate',
        title: 'Billing confusion mention',
        detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
        createdAt: item.createdAt,
      },
      inboxItem: expect.objectContaining({
        id: 1,
        projectId: 7,
        source: 'reddit',
        status: 'needs_reply',
        title: 'Billing confusion mention',
        excerpt: 'Agency buyers asked whether billing and usage caps are transparent enough.',
      }),
    });

    expect(inboxStore.list()).toEqual([
      expect.objectContaining({
        id: 1,
        projectId: 7,
        source: 'reddit',
        status: 'needs_reply',
        title: 'Billing confusion mention',
      }),
    ]);
  });
});
