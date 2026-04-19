import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
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
      headers: {},
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

describe('reputation api', () => {
  it('returns a feed view and supports manual fetch into SQLite', async () => {
    const fetchResponse = await requestApp('POST', '/api/reputation/fetch');

    expect(fetchResponse.status).toBe(201);
    expect(JSON.parse(fetchResponse.body)).toEqual({
      items: [
        expect.objectContaining({
          id: 1,
          source: 'reddit',
          sentiment: 'positive',
        }),
        expect.objectContaining({
          id: 2,
          source: 'facebook-group',
          sentiment: 'negative',
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
