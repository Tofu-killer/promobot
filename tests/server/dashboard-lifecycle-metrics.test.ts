import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
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

describe('dashboard lifecycle metrics api', () => {
  it('adds scheduled and published draft metrics plus failed publish log counts', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const scheduledDraft = draftStore.create({
        platform: 'x',
        title: 'Scheduled launch note',
        content: 'Rollout starts tomorrow.',
        status: 'scheduled',
      });
      const publishedDraft = draftStore.create({
        platform: 'x',
        title: 'Published release note',
        content: 'Launch is live.',
        status: 'published',
      });

      draftStore.update(scheduledDraft.id, {
        scheduledAt: '2026-04-20T09:30:00.000Z',
      });
      draftStore.update(publishedDraft.id, {
        publishedAt: '2026-04-19T08:15:00.000Z',
      });
      draftStore.create({
        platform: 'x',
        title: 'Needs review',
        content: 'Review before posting.',
        status: 'review',
      });

      publishLogStore.create({
        draftId: scheduledDraft.id,
        status: 'failed',
        message: 'rate limited',
      });
      publishLogStore.create({
        draftId: publishedDraft.id,
        status: 'failed',
        message: 'temporary upstream error',
      });
      publishLogStore.create({
        draftId: publishedDraft.id,
        status: 'published',
        publishUrl: 'https://x.com/promobot/status/42',
        message: 'publish succeeded',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        monitor: {
          total: 0,
          new: 0,
          followUpDrafts: 0,
        },
        drafts: {
          total: 3,
          review: 1,
          scheduled: 1,
          published: 1,
        },
        totals: {
          items: 3,
          followUps: 0,
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
        publishLogs: {
          failedCount: 2,
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

  it('keeps the existing response shape when lifecycle metrics are absent', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      draftStore.create({
        platform: 'x',
        title: 'Review only',
        content: 'Still in review.',
        status: 'review',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        monitor: {
          total: 0,
          new: 0,
          followUpDrafts: 0,
        },
        drafts: {
          total: 1,
          review: 1,
        },
        totals: {
          items: 1,
          followUps: 0,
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

  it('filters lifecycle and publish log metrics by projectId through project-aware drafts', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();

      const projectOneScheduled = draftStore.create({
        projectId: 1,
        platform: 'x',
        title: 'Project 1 scheduled launch note',
        content: 'Rollout starts tomorrow.',
        status: 'scheduled',
      });
      const projectOnePublished = draftStore.create({
        projectId: 1,
        platform: 'x',
        title: 'Project 1 published release note',
        content: 'Launch is live.',
        status: 'published',
      });
      const projectTwoReview = draftStore.create({
        projectId: 2,
        platform: 'x',
        title: 'Project 2 needs review',
        content: 'Review before posting.',
        status: 'review',
      });

      draftStore.update(projectOneScheduled.id, {
        scheduledAt: '2026-04-20T09:30:00.000Z',
      });
      draftStore.update(projectOnePublished.id, {
        publishedAt: '2026-04-19T08:15:00.000Z',
      });

      publishLogStore.create({
        draftId: projectOneScheduled.id,
        status: 'failed',
        message: 'project 1 rate limited',
      });
      publishLogStore.create({
        draftId: projectOnePublished.id,
        status: 'published',
        publishUrl: 'https://x.com/promobot/status/1',
        message: 'project 1 publish succeeded',
      });
      publishLogStore.create({
        draftId: projectTwoReview.id,
        status: 'failed',
        message: 'project 2 upstream error',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=1');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        monitor: {
          total: 0,
          new: 0,
          followUpDrafts: 0,
        },
        drafts: {
          total: 2,
          review: 0,
          scheduled: 1,
          published: 1,
        },
        totals: {
          items: 2,
          followUps: 0,
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
        publishLogs: {
          failedCount: 1,
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
