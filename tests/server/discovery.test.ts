import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createInboxStore } from '../../src/server/store/inbox';
import { createMonitorStore } from '../../src/server/store/monitor';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

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

describe('discovery api', () => {
  it('returns a unified discovery pool from inbox and monitor items with total', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const monitorStore = createMonitorStore();

      inboxStore.create({
        source: 'reddit',
        status: 'needs_review',
        author: 'prospect-1',
        title: 'Users asking for SOC 2 proof',
        excerpt: 'Several buyers want a compliance checklist.',
      });
      monitorStore.create({
        source: 'x',
        status: 'new',
        title: 'Competitor launched a new onboarding flow',
        detail: 'Observed a pricing teaser and migration CTA.',
      });

      const response = await requestApp('GET', '/api/discovery');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 'inbox-1',
            source: 'reddit',
            type: 'inbox',
            title: 'Users asking for SOC 2 proof',
            detail: 'Several buyers want a compliance checklist.',
            status: 'needs_review',
          }),
          expect.objectContaining({
            id: 'monitor-1',
            source: 'x',
            type: 'monitor',
            title: 'Competitor launched a new onboarding flow',
            detail: 'Observed a pricing teaser and migration CTA.',
            status: 'new',
          }),
        ],
        total: 2,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('filters discovery items strictly once signal stores become project-aware', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const monitorStore = createMonitorStore();

      inboxStore.create({
        projectId: 1,
        source: 'reddit',
        status: 'needs_review',
        author: 'project-one',
        title: 'Project 1 inbox item',
        excerpt: 'Only project 1 should see this.',
      });
      inboxStore.create({
        projectId: 2,
        source: 'reddit',
        status: 'needs_review',
        author: 'project-two',
        title: 'Project 2 inbox item',
        excerpt: 'Only project 2 should see this.',
      });
      monitorStore.create({
        projectId: 1,
        source: 'x',
        status: 'new',
        title: 'Project 1 monitor item',
        detail: 'Project 1 signal.',
      });
      monitorStore.create({
        projectId: 2,
        source: 'x',
        status: 'new',
        title: 'Project 2 monitor item',
        detail: 'Project 2 signal.',
      });

      const response = await requestApp('GET', '/api/discovery?projectId=1');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 'inbox-1',
            title: 'Project 1 inbox item',
          }),
          expect.objectContaining({
            id: 'monitor-1',
            title: 'Project 1 monitor item',
          }),
        ],
        total: 2,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
