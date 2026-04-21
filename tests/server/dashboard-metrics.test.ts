import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { createInboxStore } from '../../src/server/store/inbox';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
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

describe('dashboard metrics api', () => {
  it('adds inbox and channel account metrics to the dashboard aggregation', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();

      inboxStore.create({
        source: 'x',
        status: 'needs_reply',
        author: 'Alice',
        title: 'Need pricing help',
        excerpt: 'Can you share the enterprise tier details?',
      });
      inboxStore.create({
        source: 'facebook',
        status: 'handled',
        author: 'Bob',
        title: 'Thanks for the fix',
        excerpt: 'The issue is resolved now.',
      });

      channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'healthy',
      });
      channelAccountStore.create({
        platform: 'facebook',
        accountKey: 'page-1',
        displayName: 'PromoBot FB',
        authType: 'cookie',
        status: 'failed',
      });

      jobQueueStore.enqueue({
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2026-04-19T09:00:00.000Z',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        inbox: {
          total: 2,
          unread: 1,
        },
        channelAccounts: {
          total: 2,
          connected: 1,
        },
        jobQueue: {
          pending: 1,
          duePending: 1,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('filters project-aware channel account metrics and excludes unscoped inbox and job queue rows from scoped views', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();

      inboxStore.create({
        source: 'x',
        status: 'needs_reply',
        author: 'Alice',
        title: 'Need pricing help',
        excerpt: 'Can you share the enterprise tier details?',
      });
      inboxStore.create({
        source: 'facebook',
        status: 'handled',
        author: 'Bob',
        title: 'Thanks for the fix',
        excerpt: 'The issue is resolved now.',
      });

      channelAccountStore.create({
        projectId: 11,
        platform: 'x',
        accountKey: '@promobot-project-11',
        displayName: 'PromoBot X 11',
        authType: 'api',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'facebook',
        accountKey: 'page-22',
        displayName: 'PromoBot FB 22',
        authType: 'cookie',
        status: 'failed',
      });

      jobQueueStore.enqueue({
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2026-04-19T09:00:00.000Z',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        channelAccounts: {
          total: 1,
          connected: 1,
        },
        jobQueue: {
          pending: 0,
          duePending: 0,
        },
      });
      expect(JSON.parse(response.body)).not.toHaveProperty('inbox');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('filters job queue metrics by projectId and excludes unscoped jobs from scoped views', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const jobQueueStore = createJobQueueStore();

      jobQueueStore.enqueue({
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2020-01-01T00:00:00.000Z',
      });
      jobQueueStore.schedulePublishJob(101, '2020-01-01T00:00:00.000Z', 11);
      const scopedRunningJob = jobQueueStore.schedulePublishJob(102, '2099-01-01T00:00:00.000Z', 11);
      const otherProjectJob = jobQueueStore.schedulePublishJob(201, '2020-01-01T00:00:00.000Z', 22);
      jobQueueStore.enqueue({
        type: 'publish',
        payload: { draftId: 999 },
        runAt: '2020-01-01T00:00:00.000Z',
      });

      await jobQueueStore.markRunning(scopedRunningJob.id, '2020-01-01T00:01:00.000Z');
      await jobQueueStore.markRunning(otherProjectJob.id, '2020-01-01T00:02:00.000Z');
      await jobQueueStore.markFailed(otherProjectJob.id, 'project 22 failed', '2020-01-01T00:03:00.000Z');

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        monitor: {
          total: 0,
          new: 0,
          followUpDrafts: 0,
        },
        drafts: {
          total: 0,
          review: 0,
        },
        totals: {
          items: 0,
          followUps: 0,
        },
        jobQueue: {
          pending: 1,
          running: 1,
          done: 0,
          failed: 0,
          canceled: 0,
          duePending: 1,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
