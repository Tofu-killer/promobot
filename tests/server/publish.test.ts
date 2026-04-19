import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPublishRouter,
  type PublishRouteDependencies,
} from '../../src/server/routes/publish';
import { initDb } from '../../src/server/db';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

let activeTestDbRoot: string | undefined;
let activeTestDatabasePath: string | undefined;
const originalEnv = {
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
          SELECT draft_id AS draftId, status, publish_url AS publishUrl, message
          FROM publish_logs
          ORDER BY id ASC
        `,
      )
      .all() as Array<{
      draftId: number;
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
  it('publishes an x draft through the default stub adapter and returns the enriched publish contract', async () => {
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
      draftStatus: 'published',
      platform: 'x',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/promobot/status/42',
      externalId: 'x-42',
      message: 'x stub publisher accepted draft 42',
      publishedAt: expect.any(String),
      details: {
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

  it('persists a publish log and updates the draft status after a successful publish', async () => {
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
        status: 'published',
        scheduledAt: undefined,
        publishedAt: expect.any(String),
      }),
    );
    expect(new Date(draftStore.getById(draft.id)?.publishedAt ?? '').toString()).not.toBe(
      'Invalid Date',
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'published',
        publishUrl: `https://x.com/promobot/status/${draft.id}`,
        message: `x stub publisher accepted draft ${draft.id}`,
      }),
    ]);
    expect(readJobQueue()).toEqual([]);
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

  it('uses an injected publish adapter when one is provided', async () => {
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
      lookupDraft: vi.fn().mockResolvedValue({
        id: 9,
        platform: 'custom',
        content: 'Needs manual review',
      }),
      publishDraft,
    });

    const response = await requestApp(app, 'POST', '/api/drafts/9/publish');

    expect(response.status).toBe(200);
    expect(publishDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9,
        platform: 'custom',
        content: 'Needs manual review',
      }),
      expect.any(Object),
    );
    expect(JSON.parse(response.body)).toEqual({
      draftId: 9,
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
        subreddit: 'promobot',
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
