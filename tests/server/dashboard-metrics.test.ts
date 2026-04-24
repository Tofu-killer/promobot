import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createInboxStore } from '../../src/server/store/inbox';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { createSourceConfigStore } from '../../src/server/store/sourceConfigs';
import { createSettingsStore } from '../../src/server/store/settings';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

let restoreCwd: (() => void) | null = null;

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
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
  });

  it('adds inbox and channel account metrics to the dashboard aggregation', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const settingsStore = createSettingsStore();
      const sourceConfigStore = createSourceConfigStore();
      const artifactDir = path.join(rootDir, 'artifacts', 'browser-lane-requests', 'x', '-promobot');
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(
        path.join(artifactDir, 'request-session-job-17.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          requestedAt: '2026-04-21T09:00:00.000Z',
          jobId: 17,
          jobStatus: 'pending',
          nextStep: '/api/channel-accounts/1/session',
        }),
      );
      writeFileSync(
        path.join(artifactDir, 'relogin-job-18.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'relogin',
          requestedAt: '2026-04-21T09:10:00.000Z',
          jobId: 18,
          jobStatus: 'resolved',
          nextStep: '/api/channel-accounts/1/session',
          resolvedAt: '2026-04-21T09:12:00.000Z',
          resolution: {
            status: 'resolved',
          },
          savedStorageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        }),
      );
      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-17.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '17',
          title: 'Community update',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T08:55:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T09:00:00.000Z',
          updatedAt: '2026-04-21T09:00:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-18.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'obsolete',
          platform: 'facebookGroup',
          draftId: '18',
          title: 'Stale handoff',
          content: 'Need relogin',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'expired',
            validatedAt: '2026-04-21T09:05:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T09:10:00.000Z',
          updatedAt: '2026-04-21T09:20:00.000Z',
          resolvedAt: '2026-04-21T09:20:00.000Z',
          resolution: {
            status: 'obsolete',
            reason: 'relogin',
          },
        }),
      );

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
      settingsStore.update({
        monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude latency'],
        monitorV2exQueries: ['llm router'],
      });
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Reddit mentions',
        configJson: {
          keywords: ['brand latency'],
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      const response = await requestApp('GET', '/api/monitor/dashboard');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        inbox: {
          total: 2,
          unread: 1,
        },
        browserLaneRequests: {
          total: 2,
          pending: 1,
          resolved: 1,
        },
        browserHandoffs: {
          total: 2,
          pending: 1,
          resolved: 0,
          obsolete: 1,
          unmatched: 2,
        },
        monitorConfig: {
          directFeeds: 1,
          directQueries: 3,
          enabledSourceConfigs: 1,
          totalInputs: 5,
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
      const sourceConfigStore = createSourceConfigStore();
      const projectOneArtifactDir = path.join(rootDir, 'artifacts', 'browser-lane-requests', 'x', '-promobot-project-11');
      const projectTwoArtifactDir = path.join(rootDir, 'artifacts', 'browser-lane-requests', 'facebook', 'page-22');
      mkdirSync(projectOneArtifactDir, { recursive: true });
      mkdirSync(projectTwoArtifactDir, { recursive: true });
      writeFileSync(
        path.join(projectOneArtifactDir, 'request-session-job-31.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 1,
          platform: 'x',
          accountKey: '@promobot-project-11',
          action: 'request_session',
          requestedAt: '2026-04-21T10:00:00.000Z',
          jobId: 31,
          jobStatus: 'pending',
          nextStep: '/api/channel-accounts/1/session',
        }),
      );
      writeFileSync(
        path.join(projectTwoArtifactDir, 'request-session-job-32.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 2,
          platform: 'facebook',
          accountKey: 'page-22',
          action: 'request_session',
          requestedAt: '2026-04-21T10:01:00.000Z',
          jobId: 32,
          jobStatus: 'pending',
          nextStep: '/api/channel-accounts/2/session',
        }),
      );

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
      sourceConfigStore.create({
        projectId: 11,
        sourceType: 'keyword+x',
        platform: 'x',
        label: 'Project 11 X',
        configJson: {
          keywords: ['project 11 keyword'],
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      sourceConfigStore.create({
        projectId: 22,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Project 22 Reddit',
        configJson: {
          keywords: ['project 22 keyword'],
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        monitorConfig: {
          directFeeds: 0,
          directQueries: 0,
          enabledSourceConfigs: 1,
          totalInputs: 1,
        },
        browserLaneRequests: {
          total: 1,
          pending: 1,
          resolved: 0,
        },
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

  it('scopes browser lane request metrics by normalized platform and accountKey when artifact channelAccountId is stale', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      const artifactDir = path.join(
        rootDir,
        'artifacts',
        'browser-lane-requests',
        'facebook-group',
        'launch-campaign',
      );
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(
        path.join(artifactDir, 'request-session-job-41.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 999,
          platform: 'facebook-group',
          accountKey: 'launch-campaign',
          action: 'request_session',
          requestedAt: '2026-04-21T11:00:00.000Z',
          jobId: 41,
          jobStatus: 'pending',
          nextStep: '/api/channel-accounts/999/session',
        }),
      );

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group 11',
        authType: 'browser',
        status: 'healthy',
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserLaneRequests: {
          total: 1,
          pending: 1,
          resolved: 0,
        },
        channelAccounts: {
          total: 1,
          connected: 1,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('prefers channelAccountId over accountKey when scoping browser lane requests for shared keys', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      const artifactDir = path.join(
        rootDir,
        'artifacts',
        'browser-lane-requests',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(artifactDir, { recursive: true });

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 22',
        authType: 'browser',
        status: 'healthy',
      });

      writeFileSync(
        path.join(artifactDir, 'request-session-job-42.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 2,
          platform: 'facebookGroup',
          accountKey: 'launch-campaign',
          action: 'request_session',
          requestedAt: '2026-04-21T11:10:00.000Z',
          jobId: 42,
          jobStatus: 'pending',
          nextStep: '/api/channel-accounts/2/session',
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserLaneRequests: {
          total: 0,
          pending: 0,
          resolved: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not attribute stale browser lane requests when normalized platform and accountKey are shared across projects', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      const artifactDir = path.join(
        rootDir,
        'artifacts',
        'browser-lane-requests',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(artifactDir, { recursive: true });

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 22',
        authType: 'browser',
        status: 'healthy',
      });

      writeFileSync(
        path.join(artifactDir, 'request-session-job-43.json'),
        JSON.stringify({
          type: 'browser_lane_request',
          channelAccountId: 999,
          platform: 'facebookGroup',
          accountKey: 'launch-campaign',
          action: 'request_session',
          requestedAt: '2026-04-21T11:20:00.000Z',
          jobId: 43,
          jobStatus: 'pending',
          nextStep: '/api/channel-accounts/999/session',
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserLaneRequests: {
          total: 0,
          pending: 0,
          resolved: 0,
        },
      });
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

  it('counts parsed source-config queries in totalInputs instead of raw enabled config rows', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const sourceConfigStore = createSourceConfigStore();

      sourceConfigStore.create({
        projectId: 11,
        sourceType: 'keyword+x',
        platform: 'x',
        label: 'Project 11 X',
        configJson: {
          query: 'primary keyword',
          keywords: ['secondary keyword', 'tertiary keyword'],
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        monitorConfig: {
          directFeeds: 0,
          directQueries: 0,
          enabledSourceConfigs: 1,
          totalInputs: 3,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('excludes invalid enabled source configs from totalInputs while preserving enabledSourceConfigs count', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const sourceConfigStore = createSourceConfigStore();

      sourceConfigStore.create({
        projectId: 11,
        sourceType: 'keyword+x',
        platform: 'x',
        label: 'Invalid Project 11 X',
        configJson: {
          query: '   ',
          keywords: [],
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        monitorConfig: {
          directFeeds: 0,
          directQueries: 0,
          enabledSourceConfigs: 1,
          totalInputs: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('normalizes facebook-group channel accounts when scoping browser handoff metrics by projectId', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebook-group',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });

      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-41.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '41',
          title: 'Community update',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T08:55:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T09:00:00.000Z',
          updatedAt: '2026-04-21T09:00:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserHandoffs: {
          total: 1,
          pending: 1,
          resolved: 0,
          obsolete: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('scopes browser handoff metrics by normalized platform and accountKey when artifact channelAccountId is stale', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });

      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-51.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          channelAccountId: 999,
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '51',
          title: 'Stale scoped handoff',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T11:05:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T11:05:00.000Z',
          updatedAt: '2026-04-21T11:05:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserHandoffs: {
          total: 1,
          pending: 1,
          resolved: 0,
          obsolete: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('prefers channelAccountId when project-scoping browser handoff metrics for shared account keys', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 22',
        authType: 'browser',
        status: 'healthy',
      });

      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-42.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          channelAccountId: 2,
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '42',
          title: 'Scoped handoff',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T11:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T11:00:00.000Z',
          updatedAt: '2026-04-21T11:00:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not attribute stale browser handoffs when normalized platform and accountKey are shared across projects', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 22',
        authType: 'browser',
        status: 'healthy',
      });

      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-52.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          channelAccountId: 999,
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '52',
          title: 'Shared stale handoff',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T11:10:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T11:10:00.000Z',
          updatedAt: '2026-04-21T11:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not attribute browser handoffs with missing channelAccountId when the key is globally unique but the draft belongs to another project', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      const draftStore = createSQLiteDraftStore();

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });
      draftStore.create({
        projectId: 22,
        platform: 'facebook-group',
        title: 'Scoped handoff draft',
        content: 'Need handoff',
        status: 'review',
      });

      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-1.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '1',
          title: 'Scoped handoff draft',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T11:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T11:00:00.000Z',
          updatedAt: '2026-04-21T11:00:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('infers browser handoff project scope from draft projectId when channelAccountId is missing', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const channelAccountStore = createChannelAccountStore();
      const draftStore = createSQLiteDraftStore();

      channelAccountStore.create({
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 11',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB 22',
        authType: 'browser',
        status: 'healthy',
      });
      draftStore.create({
        projectId: 22,
        platform: 'facebook-group',
        title: 'Scoped handoff draft',
        content: 'Need handoff',
        status: 'review',
      });

      const handoffDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        path.join(handoffDir, 'facebookGroup-draft-1.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '1',
          title: 'Scoped handoff draft',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T11:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T11:00:00.000Z',
          updatedAt: '2026-04-21T11:00:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const response = await requestApp('GET', '/api/monitor/dashboard?projectId=11');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        browserHandoffs: {
          total: 0,
          pending: 0,
          resolved: 0,
          obsolete: 0,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
