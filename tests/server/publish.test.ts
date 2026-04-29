import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPublishRouter,
  UnsupportedDraftPlatformError,
  type PublishRouteDependencies,
} from '../../src/server/routes/publish';
import { initDb } from '../../src/server/db';
import type { SessionMetadata } from '../../src/server/services/browser/sessionStore';
import * as sessionStoreModule from '../../src/server/services/browser/sessionStore';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

let activeTestDbRoot: string | undefined;
let activeTestDatabasePath: string | undefined;
let restoreCwd: (() => void) | null = null;
const originalEnv = {
  BLOG_PUBLISH_OUTPUT_DIR: process.env.BLOG_PUBLISH_OUTPUT_DIR,
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_USERNAME: process.env.REDDIT_USERNAME,
  REDDIT_PASSWORD: process.env.REDDIT_PASSWORD,
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
};

async function requestApp(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
) {
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

function createTestApp(
  dependencies: PublishRouteDependencies,
  options?: { useDefaultPersistence?: boolean },
) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/drafts',
    createPublishRouter(
      options?.useDefaultPersistence
        ? dependencies
        : {
            persistPublishResult: vi.fn().mockResolvedValue(undefined),
            recordPublishFailure: vi.fn().mockResolvedValue(undefined),
            ...dependencies,
          },
    ),
  );
  return app;
}

beforeEach(() => {
  restoreCwd = isolateProcessCwd();
  activeTestDbRoot = undefined;
  activeTestDatabasePath = undefined;
  delete process.env.X_ACCESS_TOKEN;
  delete process.env.X_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
  delete process.env.REDDIT_USERNAME;
  delete process.env.REDDIT_PASSWORD;
  delete process.env.REDDIT_USER_AGENT;
});

afterEach(() => {
  restoreCwd?.();
  restoreCwd = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env.BLOG_PUBLISH_OUTPUT_DIR = originalEnv.BLOG_PUBLISH_OUTPUT_DIR;
  process.env.X_ACCESS_TOKEN = originalEnv.X_ACCESS_TOKEN;
  process.env.X_BEARER_TOKEN = originalEnv.X_BEARER_TOKEN;
  process.env.REDDIT_CLIENT_ID = originalEnv.REDDIT_CLIENT_ID;
  process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
  process.env.REDDIT_USERNAME = originalEnv.REDDIT_USERNAME;
  process.env.REDDIT_PASSWORD = originalEnv.REDDIT_PASSWORD;
  process.env.REDDIT_USER_AGENT = originalEnv.REDDIT_USER_AGENT;
  if (activeTestDbRoot) {
    cleanupTestDatabasePath(activeTestDbRoot);
    activeTestDbRoot = undefined;
  }
});

function readPublishLogs() {
  if (!activeTestDatabasePath) {
    throw new Error('active test database path is not configured');
  }

  const db = initDb(activeTestDatabasePath);

  try {
    return db
      .prepare(
        `
          SELECT draft_id AS draftId, project_id AS projectId, status, publish_url AS publishUrl, message
          FROM publish_logs
          ORDER BY id ASC
        `,
      )
      .all() as Array<{
      draftId: number;
      projectId: number | null;
      status: string;
      publishUrl?: string;
      message: string;
    }>;
  } finally {
    db.close();
  }
}

function readJobQueue() {
  if (!activeTestDatabasePath) {
    throw new Error('active test database path is not configured');
  }

  const db = initDb(activeTestDatabasePath);

  try {
    return db
      .prepare(
        `
          SELECT id, type, payload, status, run_at AS runAt
          FROM job_queue
          ORDER BY id ASC
        `,
      )
      .all() as Array<{
      id: number;
      type: string;
      payload: string;
      status: string;
      runAt: string;
    }>;
  } finally {
    db.close();
  }
}

function insertPendingPublishJob(draftId: number, runAt: string) {
  if (!activeTestDatabasePath) {
    throw new Error('active test database path is not configured');
  }

  const db = initDb(activeTestDatabasePath);

  try {
    db.prepare(
      `
        INSERT INTO job_queue (type, payload, status, run_at, attempts, created_at, updated_at)
        VALUES ('publish', @payload, 'pending', @run_at, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run({
      payload: JSON.stringify({ draftId }),
      run_at: runAt,
    });
  } finally {
    db.close();
  }
}

describe('publish api', () => {
  it('returns a failed x publish contract when x credentials are missing', async () => {
    const lookupDraft = vi.fn().mockResolvedValue({
      id: 42,
      platform: 'x',
      title: 'Launch update',
      content: 'Claude 3.5 Sonnet is now available.',
      target: '@promobot',
    });
    const app = createTestApp({ lookupDraft });

    const response = await requestApp(app, 'POST', '/api/drafts/42/publish');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: 42,
      draftStatus: 'failed',
      platform: 'x',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
      publishedAt: null,
      details: {
        error: {
          category: 'auth',
          retriable: false,
          stage: 'publish',
        },
        retry: {
          publish: {
            attempts: 0,
            maxAttempts: 0,
            stage: 'publish',
          },
        },
        target: '@promobot',
      },
    });
  });

  it('returns manual_required publish contracts without collapsing them into a generic failure', async () => {
    const app = createTestApp({
      lookupDraft: vi.fn().mockResolvedValue({
        id: 12,
        platform: 'facebook-group',
        title: 'Community update',
        content: 'Needs browser handoff',
        target: 'group-123',
      }),
    });

    const response = await requestApp(app, 'POST', '/api/drafts/12/publish');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: 12,
      draftStatus: 'review',
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'facebookGroup stub publisher accepted draft 12',
      publishedAt: null,
      details: {
        target: 'group-123',
      },
    });
  });

  it('persists a failed publish log and updates the draft status when x credentials are missing', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'x',
      title: 'Launch update',
      content: 'Claude 3.5 Sonnet is now available.',
    });
    draftStore.update(draft.id, {
      status: 'scheduled',
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });
    insertPendingPublishJob(draft.id, '2026-04-20T09:30:00.000Z');
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'failed',
        scheduledAt: undefined,
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        projectId: null,
        status: 'failed',
        publishUrl: null,
        message: 'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
      }),
    ]);
    expect(readJobQueue()).toEqual([]);
  });

  it('persists projectId on failed publish logs for project-aware x drafts', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      projectId: 77,
      platform: 'x',
      title: 'Project launch update',
      content: 'Project-aware publish log',
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            projectId: storedDraft.projectId ?? undefined,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        projectId: 77,
        status: 'failed',
        publishUrl: null,
        message: 'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
      }),
    ]);
  });

  it('persists queued publish semantics without backfilling publishedAt', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'x',
      title: 'Queued thread',
      content: 'Queued for async publish',
    });
    const publishDraft = vi.fn().mockResolvedValue({
      platform: 'x',
      mode: 'api',
      status: 'queued',
      success: false,
      publishUrl: null,
      externalId: 'queue-job-17',
      message: 'queued for downstream publisher',
      publishedAt: null,
      details: {
        queueName: 'social-x',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
        publishDraft,
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'queued',
      platform: 'x',
      mode: 'api',
      status: 'queued',
      success: false,
      publishUrl: null,
      externalId: 'queue-job-17',
      message: 'queued for downstream publisher',
      publishedAt: null,
      details: {
        queueName: 'social-x',
      },
    });
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'queued',
        scheduledAt: undefined,
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        projectId: null,
        status: 'queued',
        publishUrl: null,
        message: 'queued for downstream publisher',
      }),
    ]);
    expect(readJobQueue()).toEqual([]);
  });

  it('returns 404 when the draft lookup misses', async () => {
    const app = createTestApp({
      lookupDraft: vi.fn().mockResolvedValue(undefined),
    });

    const response = await requestApp(app, 'POST', '/api/drafts/404/publish');

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'draft not found',
    });
  });

  it('returns 400 when the draft platform is not supported by the stub publishers', async () => {
    const app = createTestApp({
      lookupDraft: vi.fn().mockResolvedValue({
        id: 7,
        platform: 'linkedin',
        content: 'Unsupported draft',
      }),
    });

    const response = await requestApp(app, 'POST', '/api/drafts/7/publish');

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'unsupported draft platform',
    });
  });

  it('does not mark a scheduled draft failed when the platform is unsupported before publishing starts', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'linkedin',
      content: 'Unsupported platform draft',
    });
    draftStore.update(draft.id, {
      status: 'scheduled',
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });
    insertPendingPublishJob(draft.id, '2026-04-20T09:30:00.000Z');
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'unsupported draft platform',
    });
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30:00.000Z',
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([]);
    expect(readJobQueue()).toEqual([
      expect.objectContaining({
        type: 'publish',
        payload: JSON.stringify({ draftId: draft.id }),
        status: 'pending',
        runAt: '2026-04-20T09:30:00.000Z',
      }),
    ]);
  });

  it('uses an injected publish adapter when one is provided', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'custom',
      content: 'Needs manual review',
      projectId: 17,
    });
    const publishDraft = vi.fn().mockResolvedValue({
      platform: 'x',
      mode: 'api',
      status: 'queued',
      success: false,
      publishUrl: null,
      externalId: 'queue-job-9',
      message: 'queued for manual review',
      publishedAt: null,
      details: {
        queueName: 'manual-review',
      },
    });
    const app = createTestApp({
      lookupDraft(id) {
        const storedDraft = draftStore.getById(id);
        if (!storedDraft) {
          return undefined;
        }

        return {
          id: storedDraft.id,
          platform: storedDraft.platform,
          content: storedDraft.content,
        };
      },
      publishDraft,
    });

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(publishDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        id: draft.id,
        platform: 'custom',
        content: 'Needs manual review',
        projectId: 17,
      }),
      expect.any(Object),
    );
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'queued',
      platform: 'x',
      mode: 'api',
      status: 'queued',
      success: false,
      publishUrl: null,
      externalId: 'queue-job-9',
      message: 'queued for manual review',
      publishedAt: null,
      details: {
        queueName: 'manual-review',
      },
    });
  });

  it('persists failed publish results that are returned explicitly, instead of only thrown errors', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'x',
      content: 'Provider may reject this draft',
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
        publishDraft: vi.fn().mockResolvedValue({
          platform: 'x',
          mode: 'api',
          status: 'failed',
          success: false,
          publishUrl: null,
          externalId: null,
          message: 'provider rejected draft',
          publishedAt: null,
          details: {
            code: 'POLICY_BLOCK',
          },
        }),
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'failed',
      platform: 'x',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'provider rejected draft',
      publishedAt: null,
      details: {
        code: 'POLICY_BLOCK',
      },
    });
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'failed',
        scheduledAt: undefined,
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'failed',
        publishUrl: null,
        message: 'provider rejected draft',
      }),
    ]);
    expect(readJobQueue()).toEqual([]);
  });

  it('records a failed publish log when publishing throws', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'x',
      content: 'Will fail to publish',
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
        publishDraft: vi.fn().mockRejectedValue(new Error('publisher exploded')),
      },
      { useDefaultPersistence: true },
    );

    await expect(requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`)).rejects.toThrow(
      'publisher exploded',
    );
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'failed',
        scheduledAt: undefined,
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'failed',
        publishUrl: null,
        message: 'publisher exploded',
      }),
    ]);
    expect(readJobQueue()).toEqual([]);
  });

  it('records a failed publish log when an injected adapter throws UnsupportedDraftPlatformError', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'custom',
      content: 'Injected adapter will reject this draft',
    });
    draftStore.update(draft.id, {
      status: 'scheduled',
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });
    insertPendingPublishJob(draft.id, '2026-04-20T09:30:00.000Z');
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
          };
        },
        publishDraft: vi
          .fn()
          .mockRejectedValue(new UnsupportedDraftPlatformError('custom')),
      },
      { useDefaultPersistence: true },
    );

    await expect(requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`)).rejects.toThrow(
      'unsupported draft platform: custom',
    );
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'failed',
        scheduledAt: undefined,
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'failed',
        publishUrl: null,
        message: 'unsupported draft platform: custom',
      }),
    ]);
    expect(readJobQueue()).toEqual([]);
  });

  it('does not mark a scheduled draft failed when draft lookup throws before publishing starts', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'x',
      content: 'Should stay scheduled if lookup fails',
    });
    draftStore.update(draft.id, {
      status: 'scheduled',
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });
    insertPendingPublishJob(draft.id, '2026-04-20T09:30:00.000Z');
    const app = createTestApp(
      {
        lookupDraft: vi.fn().mockRejectedValue(new Error('db read timeout')),
      },
      { useDefaultPersistence: true },
    );

    await expect(requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`)).rejects.toThrow(
      'db read timeout',
    );
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30:00.000Z',
        publishedAt: undefined,
      }),
    );
    expect(readPublishLogs()).toEqual([]);
    expect(readJobQueue()).toEqual([
      expect.objectContaining({
        type: 'publish',
        status: 'pending',
      }),
    ]);
  });

  it('does not record a publish failure when local persistence fails after a successful publish result', async () => {
    const publishDraft = vi.fn().mockResolvedValue({
      platform: 'x',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/i/web/status/2888888888888',
      externalId: '2888888888888',
      message: 'publisher already succeeded',
      publishedAt: '2026-04-21T01:23:45.000Z',
    });
    const persistPublishResult = vi
      .fn<PublishRouteDependencies['persistPublishResult']>()
      .mockRejectedValue(new Error('local persistence exploded'));
    const recordPublishFailure = vi
      .fn<PublishRouteDependencies['recordPublishFailure']>()
      .mockResolvedValue(undefined);
    const app = createTestApp({
      lookupDraft: vi.fn().mockResolvedValue({
        id: 51,
        platform: 'x',
        title: 'Already published',
        content: 'This publish reached the platform.',
      }),
      publishDraft,
      persistPublishResult,
      recordPublishFailure,
    });

    await expect(requestApp(app, 'POST', '/api/drafts/51/publish')).rejects.toThrow(
      'local persistence exploded',
    );
    expect(publishDraft).toHaveBeenCalledTimes(1);
    expect(persistPublishResult).toHaveBeenCalledWith(
      51,
      expect.objectContaining({
        draftId: 51,
        draftStatus: 'published',
        platform: 'x',
        mode: 'api',
        status: 'published',
        success: true,
        publishUrl: 'https://x.com/i/web/status/2888888888888',
        externalId: '2888888888888',
        message: 'publisher already succeeded',
        publishedAt: '2026-04-21T01:23:45.000Z',
      }),
      expect.any(Object),
      expect.objectContaining({
        id: 51,
      }),
    );
    expect(recordPublishFailure).not.toHaveBeenCalled();
  });

  it('does not resolve a pending browser handoff artifact when local persistence fails after browser publish success', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = testDatabase.rootDir;

    const artifactDir = path.join(
      testDatabase.rootDir,
      'artifacts',
      'browser-handoffs',
      'facebookGroup',
      'launch-campaign',
    );
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, 'facebookGroup-draft-51.json');
    writeFileSync(
      artifactPath,
      JSON.stringify({
        type: 'browser_manual_handoff',
        status: 'pending',
        platform: 'facebookGroup',
        draftId: '51',
        title: 'Already handed off',
        content: 'Draft body',
        target: 'group-123',
        accountKey: 'launch-campaign',
        session: {
          hasSession: true,
          id: 'facebookGroup:launch-campaign',
          status: 'active',
          validatedAt: '2026-04-21T01:20:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        },
        createdAt: '2026-04-21T01:22:00.000Z',
        updatedAt: '2026-04-21T01:22:00.000Z',
        resolvedAt: null,
        resolution: null,
      }),
      'utf8',
    );

    const publishDraft = vi.fn().mockResolvedValue({
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'published',
      success: true,
      publishUrl: 'https://facebook.com/groups/group-123/posts/51',
      externalId: 'fb-post-51',
      message: 'browser lane completed publish',
      publishedAt: '2026-04-21T01:23:45.000Z',
    });
    const persistPublishResult = vi
      .fn<PublishRouteDependencies['persistPublishResult']>()
      .mockRejectedValue(new Error('local persistence exploded'));
    const recordPublishFailure = vi
      .fn<PublishRouteDependencies['recordPublishFailure']>()
      .mockResolvedValue(undefined);
    const app = createTestApp({
      lookupDraft: vi.fn().mockResolvedValue({
        id: 51,
        platform: 'facebook-group',
        title: 'Already handed off',
        content: 'Draft body',
        target: 'group-123',
        metadata: {
          accountKey: 'launch-campaign',
        },
      }),
      publishDraft,
      persistPublishResult,
      recordPublishFailure,
    });

    await expect(requestApp(app, 'POST', '/api/drafts/51/publish')).rejects.toThrow(
      'local persistence exploded',
    );
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual({
      type: 'browser_manual_handoff',
      status: 'pending',
      platform: 'facebookGroup',
      draftId: '51',
      title: 'Already handed off',
      content: 'Draft body',
      target: 'group-123',
      accountKey: 'launch-campaign',
      session: {
        hasSession: true,
        id: 'facebookGroup:launch-campaign',
        status: 'active',
        validatedAt: '2026-04-21T01:20:00.000Z',
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      },
      createdAt: '2026-04-21T01:22:00.000Z',
      updatedAt: '2026-04-21T01:22:00.000Z',
      resolvedAt: null,
      resolution: null,
    });
    expect(recordPublishFailure).not.toHaveBeenCalled();
  });

  it('retries transient x publisher failures through the publish route and persists the final published contract', async () => {
    process.env.X_ACCESS_TOKEN = 'x-access-token';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            title: 'Service unavailable',
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: '2888888888888',
            },
          }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'x',
      title: 'Retry publish',
      content: 'Retry route-level x publish',
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'published',
      platform: 'x',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/i/web/status/2888888888888',
      externalId: '2888888888888',
      message: `x api published draft ${draft.id}`,
      publishedAt: expect.any(String),
      details: {
        retry: {
          publish: {
            attempts: 2,
            maxAttempts: 3,
            stage: 'publish',
            lastHttpStatus: 201,
          },
        },
      },
    });
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'published',
        publishUrl: 'https://x.com/i/web/status/2888888888888',
        message: `x api published draft ${draft.id}`,
      }),
    ]);
  });

  it('returns a failed reddit publish contract instead of throwing when oauth auth fails', async () => {
    process.env.REDDIT_CLIENT_ID = 'client-id';
    process.env.REDDIT_CLIENT_SECRET = 'client-secret';
    process.env.REDDIT_USERNAME = 'promo-user';
    process.env.REDDIT_PASSWORD = 'promo-pass';
    process.env.REDDIT_USER_AGENT = 'promobot/test';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'reddit',
      title: 'OAuth fail publish',
      content: 'OAuth should fail without throwing.',
      target: 'LocalLLaMA',
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'failed',
      platform: 'reddit',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'reddit oauth failed with status 401',
      publishedAt: null,
      details: {
        subreddit: 'LocalLLaMA',
        error: {
          category: 'auth',
          retriable: false,
          httpStatus: 401,
          stage: 'oauth',
          bodySnippet: '{"error":"invalid_grant"}',
        },
        retry: {
          oauth: {
            attempts: 1,
            maxAttempts: 3,
            stage: 'oauth',
            lastHttpStatus: 401,
          },
        },
      },
    });
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'failed',
        publishUrl: null,
        message: 'reddit oauth failed with status 401',
      }),
    ]);
  });

  it('reuses persisted accountKey metadata for facebookGroup manual handoff contracts', async () => {
    const session: SessionMetadata = {
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      status: 'active',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    };
    vi.spyOn(sessionStoreModule, 'createSessionStore').mockReturnValue({
      getSession: vi.fn().mockReturnValue(session),
    } as unknown as sessionStoreModule.SessionStore);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'facebook-group',
      title: 'Community update',
      content: 'Needs browser handoff',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'review',
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'facebookGroup draft 1 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: 'group-123',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          sessionAction: null,
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-1.json',
        },
      },
    });
  });

  it('writes channelAccountId into browser handoff artifacts when a unique matching channel account exists', async () => {
    const session: SessionMetadata = {
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      status: 'active',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    };
    vi.spyOn(sessionStoreModule, 'createSessionStore').mockReturnValue({
      getSession: vi.fn().mockReturnValue(session),
    } as unknown as sessionStoreModule.SessionStore);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = testDatabase.rootDir;

    const channelAccountStore = createChannelAccountStore();
    channelAccountStore.create({
      projectId: 77,
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      displayName: 'PromoBot FB 77',
      authType: 'browser',
      status: 'healthy',
    });

    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      projectId: 77,
      platform: 'facebook-group',
      title: 'Community update',
      content: 'Needs browser handoff',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            projectId: storedDraft.projectId ?? undefined,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          browserHandoff: expect.objectContaining({
            channelAccountId: 1,
          }),
        }),
      }),
    );
    const artifactPath = path.join(
      testDatabase.rootDir,
      'artifacts',
      'browser-handoffs',
      'facebookGroup',
      'launch-campaign',
      `facebookGroup-draft-${draft.id}.json`,
    );
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(
      expect.objectContaining({
        channelAccountId: 1,
        platform: 'facebookGroup',
        draftId: String(draft.id),
      }),
    );
  });

  it('returns a ready manual handoff contract for xiaohongshu drafts with a saved browser session', async () => {
    const session: SessionMetadata = {
      id: 'xiaohongshu:launch-campaign',
      platform: 'xiaohongshu',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
      status: 'active',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    };
    vi.spyOn(sessionStoreModule, 'createSessionStore').mockReturnValue({
      getSession: vi.fn().mockReturnValue(session),
    } as unknown as sessionStoreModule.SessionStore);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'xiaohongshu',
      title: 'Community note',
      content: 'Needs browser handoff',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'review',
      platform: 'xiaohongshu',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'xiaohongshu draft 1 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: 'brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'xiaohongshu:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
          },
          sessionAction: null,
          artifactPath:
            'artifacts/browser-handoffs/xiaohongshu/launch-campaign/xiaohongshu-draft-1.json',
        },
      },
    });
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'manual_required',
        publishUrl: null,
        message: 'xiaohongshu draft 1 is ready for manual browser handoff with the saved session.',
      }),
    ]);
  });

  it('returns a relogin manual handoff contract for weibo drafts with an expired browser session', async () => {
    const session: SessionMetadata = {
      id: 'weibo:launch-campaign',
      platform: 'weibo',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/weibo.json',
      status: 'expired',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    };
    vi.spyOn(sessionStoreModule, 'createSessionStore').mockReturnValue({
      getSession: vi.fn().mockReturnValue(session),
    } as unknown as sessionStoreModule.SessionStore);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'weibo',
      title: 'Weibo handoff',
      content: 'Needs relogin',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'review',
      platform: 'weibo',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'weibo draft 1 requires the browser session to be refreshed before manual handoff.',
      publishedAt: null,
      details: {
        target: 'brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'blocked',
          session: {
            hasSession: true,
            id: 'weibo:launch-campaign',
            status: 'expired',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/weibo.json',
          },
          sessionAction: 'relogin',
          artifactPath: 'artifacts/browser-handoffs/weibo/launch-campaign/weibo-draft-1.json',
        },
      },
    });
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'manual_required',
        publishUrl: null,
        message: 'weibo draft 1 requires the browser session to be refreshed before manual handoff.',
      }),
    ]);
  });

  it('returns a ready manual handoff contract for instagram drafts with a saved browser session', async () => {
    const session: SessionMetadata = {
      id: 'instagram:launch-campaign',
      platform: 'instagram',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/instagram.json',
      status: 'active',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    };
    vi.spyOn(sessionStoreModule, 'createSessionStore').mockReturnValue({
      getSession: vi.fn().mockReturnValue(session),
    } as unknown as sessionStoreModule.SessionStore);

    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'instagram',
      title: 'Instagram launch reel',
      content: 'Needs browser handoff',
      target: '@brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'review',
      platform: 'instagram',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'instagram draft 1 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: '@brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'instagram:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/instagram.json',
          },
          sessionAction: null,
          artifactPath: 'artifacts/browser-handoffs/instagram/launch-campaign/instagram-draft-1.json',
        },
      },
    });
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'manual_required',
        publishUrl: null,
        message: 'instagram draft 1 is ready for manual browser handoff with the saved session.',
      }),
    ]);
  });

  it('restores a managed instagram browser session when metadata has not been written yet', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;

    const validatedAt = '2026-04-21T09:17:15.000Z';
    const managedStorageStatePath = path.join(
      testDatabase.rootDir,
      'browser-sessions',
      'managed',
      'instagram',
      'launch-campaign.json',
    );
    mkdirSync(path.dirname(managedStorageStatePath), { recursive: true });
    writeFileSync(
      managedStorageStatePath,
      JSON.stringify({
        cookies: [],
        origins: [],
      }),
    );
    utimesSync(
      managedStorageStatePath,
      new Date(validatedAt),
      new Date(validatedAt),
    );

    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'instagram',
      title: 'Instagram launch reel',
      content: 'Needs browser handoff',
      target: '@brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'review',
      platform: 'instagram',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'instagram draft 1 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: '@brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'instagram:launch-campaign',
            status: 'active',
            validatedAt,
            storageStatePath: 'browser-sessions/managed/instagram/launch-campaign.json',
          },
          sessionAction: null,
          artifactPath: 'artifacts/browser-handoffs/instagram/launch-campaign/instagram-draft-1.json',
        },
      },
    });
    expect(sessionStoreModule.createSessionStore().getSession('instagram', 'launch-campaign')).toMatchObject({
      id: 'instagram:launch-campaign',
      platform: 'instagram',
      accountKey: 'launch-campaign',
      storageStatePath: 'browser-sessions/managed/instagram/launch-campaign.json',
      status: 'active',
      lastValidatedAt: validatedAt,
    });
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'manual_required',
        publishUrl: null,
        message: 'instagram draft 1 is ready for manual browser handoff with the saved session.',
      }),
    ]);
  });

  it('preserves relogin handoff contracts when an expired instagram session still has a managed storage file', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;

    const managedStorageStatePath = path.join(
      testDatabase.rootDir,
      'browser-sessions',
      'managed',
      'instagram',
      'launch-campaign.json',
    );
    mkdirSync(path.dirname(managedStorageStatePath), { recursive: true });
    writeFileSync(
      managedStorageStatePath,
      JSON.stringify({
        cookies: [],
        origins: [],
      }),
    );
    utimesSync(
      managedStorageStatePath,
      new Date('2026-04-21T09:17:15.000Z'),
      new Date('2026-04-21T09:17:15.000Z'),
    );

    sessionStoreModule.createSessionStore().saveSession({
      platform: 'instagram',
      accountKey: 'launch-campaign',
      storageStatePath: 'browser-sessions/managed/instagram/launch-campaign.json',
      status: 'expired',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'instagram',
      title: 'Instagram launch reel',
      content: 'Needs relogin',
      target: '@brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });
    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'review',
      platform: 'instagram',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'instagram draft 1 requires the browser session to be refreshed before manual handoff.',
      publishedAt: null,
      details: {
        target: '@brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'blocked',
          session: {
            hasSession: true,
            id: 'instagram:launch-campaign',
            status: 'expired',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'browser-sessions/managed/instagram/launch-campaign.json',
          },
          sessionAction: 'relogin',
          artifactPath: 'artifacts/browser-handoffs/instagram/launch-campaign/instagram-draft-1.json',
        },
      },
    });
  });

  it('resolves a pending browser handoff artifact when a later browser publish succeeds', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = testDatabase.rootDir;

    vi.spyOn(sessionStoreModule, 'createSessionStore').mockReturnValue({
      getSession: vi.fn().mockReturnValue({
        id: 'facebookGroup:launch-campaign',
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        status: 'active',
        createdAt: '2026-04-19T10:00:00.000Z',
        updatedAt: '2026-04-19T10:30:00.000Z',
        lastValidatedAt: '2026-04-19T10:25:00.000Z',
      }),
    } as unknown as sessionStoreModule.SessionStore);

    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'facebook-group',
      title: 'Community update',
      content: 'Needs browser handoff',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const firstResponse = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);
    expect(firstResponse.status).toBe(200);

    const completionApp = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
        publishDraft: vi.fn().mockResolvedValue({
          platform: 'facebookGroup',
          mode: 'browser',
          status: 'published',
          success: true,
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
          externalId: 'fb-post-42',
          message: 'browser lane completed publish',
          publishedAt: '2026-04-22T09:30:00.000Z',
        }),
      },
      { useDefaultPersistence: true },
    );

    const secondResponse = await requestApp(
      completionApp,
      'POST',
      `/api/drafts/${draft.id}/publish`,
    );

    expect(secondResponse.status).toBe(200);
    expect(JSON.parse(secondResponse.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'published',
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'published',
      success: true,
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      externalId: 'fb-post-42',
      message: 'browser lane completed publish',
      publishedAt: '2026-04-22T09:30:00.000Z',
    });

    const artifactPath = path.join(
      testDatabase.rootDir,
      'artifacts',
      'browser-handoffs',
      'facebookGroup',
      'launch-campaign',
      `facebookGroup-draft-${draft.id}.json`,
    );
    expect(existsSync(artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(
      expect.objectContaining({
        type: 'browser_manual_handoff',
        status: 'resolved',
        resolvedAt: expect.any(String),
        resolution: {
          status: 'resolved',
          publishStatus: 'published',
          draftStatus: 'published',
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
          externalId: 'fb-post-42',
          message: 'browser lane completed publish',
          publishedAt: '2026-04-22T09:30:00.000Z',
        },
      }),
    );
  });

  it('publishes blog drafts to a local markdown file and persists a published contract', async () => {
    const testDatabase = createTestDatabasePath();
    activeTestDbRoot = testDatabase.rootDir;
    activeTestDatabasePath = testDatabase.databasePath;
    process.env.BLOG_PUBLISH_OUTPUT_DIR = path.join(testDatabase.rootDir, 'blog-posts');

    const draftStore = createSQLiteDraftStore();
    const draft = draftStore.create({
      platform: 'blog',
      title: 'Launch post',
      content: 'Blog draft body',
      target: 'blog-main',
    });
    insertPendingPublishJob(draft.id, '2026-04-21T10:11:12.000Z');

    const app = createTestApp(
      {
        lookupDraft(id) {
          const storedDraft = draftStore.getById(id);
          if (!storedDraft) {
            return undefined;
          }

          return {
            id: storedDraft.id,
            platform: storedDraft.platform,
            title: storedDraft.title,
            content: storedDraft.content,
            target: storedDraft.target,
            metadata: storedDraft.metadata,
          };
        },
      },
      { useDefaultPersistence: true },
    );

    const response = await requestApp(app, 'POST', `/api/drafts/${draft.id}/publish`);
    const outputPath = path.join(testDatabase.rootDir, 'blog-posts', 'blog-1-launch-post.md');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draftId: draft.id,
      draftStatus: 'published',
      platform: 'blog',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: `file://${outputPath}`,
      externalId: 'blog-1-launch-post',
      message: `blog publisher wrote draft 1 to ${outputPath}`,
      publishedAt: expect.any(String),
      details: {
        target: 'blog-main',
        outputPath,
      },
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, 'utf8')).toContain('Blog draft body');
    expect(readFileSync(outputPath, 'utf8')).toContain('target: "blog-main"');

    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'published',
        publishUrl: `file://${outputPath}`,
        message: `blog publisher wrote draft 1 to ${outputPath}`,
      }),
    ]);
    expect(draftStore.getById(draft.id)).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: 'published',
        publishedAt: expect.any(String),
      }),
    );
    expect(readJobQueue()).toEqual([]);
  });

  it('returns 400 for an invalid draft id', async () => {
    const app = createTestApp({
      lookupDraft: vi.fn(),
    });

    const response = await requestApp(app, 'POST', '/api/drafts/not-a-number/publish');

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'invalid draft id',
    });
  });
});
