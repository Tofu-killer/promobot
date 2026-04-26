import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createMonitorStore } from '../../src/server/store/monitor';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

function countDashboardRouteRegistrations(layers: unknown[]): number {
  let count = 0;

  for (const layer of layers) {
    const currentLayer = layer as {
      route?: { path?: string; methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    };

    if (currentLayer.route?.path === '/dashboard' && currentLayer.route.methods?.get) {
      count += 1;
    }

    if (Array.isArray(currentLayer.handle?.stack)) {
      count += countDashboardRouteRegistrations(currentLayer.handle.stack);
    }
  }

  return count;
}

async function requestApp(method: string, url: string) {
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

describe('dashboard api', () => {
  it('registers /api/monitor/dashboard only once through the app', () => {
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });
    const stack =
      ((app as { router?: { stack?: unknown[] }; _router?: { stack?: unknown[] } }).router?.stack ??
        (app as { _router?: { stack?: unknown[] } })._router?.stack ??
        []) as unknown[];

    expect(countDashboardRouteRegistrations(stack)).toBe(1);
  });

  it('returns dashboard stats from monitor and draft stores', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const draftStore = createSQLiteDraftStore();
      monitorStore.create({
        source: 'x',
        title: 'New pricing move',
        detail: 'Competitor lowered entry tier.',
        status: 'new',
      });
      draftStore.create({
        platform: 'x',
        title: 'Follow-up draft',
        content: 'Draft body',
        status: 'review',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        monitor: {
          total: 1,
          new: 1,
          followUpDrafts: 1,
        },
        drafts: {
          total: 1,
          review: 1,
        },
        totals: {
          items: 2,
          followUps: 1,
        },
        monitorConfig: {
          directFeeds: 0,
          directQueries: 0,
          enabledSourceConfigs: 0,
          totalInputs: 0,
        },
        browserLaneRequests: {
          total: 0,
          pending: 0,
          resolved: 0,
        },
        browserHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
          unmatched: 0,
        },
        inboxReplyHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
        },
        jobQueue: {
          pending: 0,
          running: 0,
          done: 0,
          failed: 0,
          canceled: 0,
          duePending: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('filters dashboard monitor and draft metrics by projectId once both stores are project-aware', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const monitorStore = createMonitorStore();
      const draftStore = createSQLiteDraftStore();

      monitorStore.create({
        projectId: 1,
        source: 'x',
        title: 'Shared signal 1',
        detail: 'Project 1 monitor signal.',
        status: 'new',
      });
      monitorStore.create({
        projectId: 2,
        source: 'x',
        title: 'Shared signal 2',
        detail: 'Project 2 monitor signal.',
        status: 'new',
      });
      draftStore.create({
        projectId: 1,
        platform: 'x',
        title: 'Project 1 follow-up draft',
        content: 'Draft body 1',
        status: 'review',
      });
      draftStore.create({
        projectId: 2,
        platform: 'x',
        title: 'Project 2 follow-up draft',
        content: 'Draft body 2',
        status: 'review',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=1');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        monitor: {
          total: 1,
          new: 1,
          followUpDrafts: 1,
        },
        drafts: {
          total: 1,
          review: 1,
        },
        totals: {
          items: 2,
          followUps: 1,
        },
        monitorConfig: {
          directFeeds: 0,
          directQueries: 0,
          enabledSourceConfigs: 0,
          totalInputs: 0,
        },
        browserLaneRequests: {
          total: 0,
          pending: 0,
          resolved: 0,
        },
        browserHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
          unmatched: 0,
        },
        inboxReplyHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
        },
        jobQueue: {
          pending: 0,
          running: 0,
          done: 0,
          failed: 0,
          canceled: 0,
          duePending: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
