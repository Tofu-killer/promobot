import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createMonitorStore } from '../../src/server/store/monitor';
import { createReputationStore } from '../../src/server/store/reputation';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

let activeTestDbRoot: string | undefined;

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
  if (activeTestDbRoot) {
    cleanupTestDatabasePath(activeTestDbRoot);
    activeTestDbRoot = undefined;
  }
});

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
  it('maps existing monitor signals into the reputation feed before seed fallback', async () => {
    const monitorStore = createMonitorStore();
    monitorStore.create({
      source: 'reddit',
      title: 'Lower APAC latency praise',
      detail: 'Users praised lower Claude routing latency from Perth.',
      status: 'new',
    });
    monitorStore.create({
      source: 'v2ex',
      title: 'Billing confusion mention',
      detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
      status: 'new',
    });

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          source: 'reddit',
          sentiment: 'positive',
          title: 'Lower APAC latency praise',
        }),
        expect.objectContaining({
          id: 2,
          source: 'v2ex',
          sentiment: 'negative',
          title: 'Billing confusion mention',
        }),
      ],
      inserted: 2,
      total: 2,
    });

    const feedResponse = await requestApp('GET', '/api/reputation/feed');

      expect(feedResponse.status).toBe(200);
      expect(JSON.parse(feedResponse.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
          title: expect.stringContaining('Lower APAC latency praise'),
        }),
        expect.objectContaining({
          id: 2,
          title: expect.stringContaining('Billing confusion mention'),
        }),
      ],
      total: 2,
    });
  });

  it('falls back to configured monitor queries when reputation feed has no monitor items yet', async () => {
    const settingsResponse = await requestApp('PATCH', '/api/settings', {
      monitorRedditQueries: ['brand latency'],
      monitorV2exQueries: ['billing transparency'],
    });

    expect(settingsResponse.status).toBe(200);

    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          source: 'reddit',
          sentiment: 'neutral',
          status: 'new',
          title: 'Watching reputation query: brand latency',
          detail: 'Configured from monitorRedditQueries before live mentions arrive.',
        }),
        expect.objectContaining({
          id: 2,
          source: 'v2ex',
          sentiment: 'neutral',
          status: 'new',
          title: 'Watching reputation query: billing transparency',
          detail: 'Configured from monitorV2exQueries before live mentions arrive.',
        }),
      ],
      inserted: 2,
      total: 2,
    });
  });

  it('falls back to enabled source configs when monitor items and global settings are absent', async () => {
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
        platform: 'blog',
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
          keywords: ['billing transparency'],
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
          source: 'reddit',
          sentiment: 'neutral',
          status: 'new',
          title: 'Watching reputation query: brand latency',
          detail: 'Derived from source config "Reddit mentions" before live mentions arrive.',
        }),
        expect.objectContaining({
          id: 2,
          source: 'x',
          sentiment: 'neutral',
          status: 'new',
          title: 'Watching reputation query: billing transparency',
          detail: 'Derived from source config "X mentions" before live mentions arrive.',
        }),
        expect.objectContaining({
          id: 3,
          source: 'v2ex',
          sentiment: 'neutral',
          status: 'new',
          title: 'Watching reputation query: cursor api',
          detail: 'Derived from source config "V2EX mentions" before live mentions arrive.',
        }),
      ],
      inserted: 3,
      total: 3,
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
});
