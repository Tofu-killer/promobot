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
});

afterEach(() => {
  vi.clearAllMocks();
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

describe('publish api', () => {
  it('publishes an x draft through the default stub adapter and returns the minimal contract', async () => {
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
      success: true,
      publishUrl: 'https://x.com/promobot/status/42',
      message: 'x stub publisher accepted draft 42',
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
      }),
    );
    expect(readPublishLogs()).toEqual([
      expect.objectContaining({
        draftId: draft.id,
        status: 'published',
        publishUrl: `https://x.com/promobot/status/${draft.id}`,
        message: `x stub publisher accepted draft ${draft.id}`,
      }),
    ]);
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
      success: false,
      publishUrl: null,
      message: 'queued for manual review',
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
      success: false,
      publishUrl: null,
      message: 'queued for manual review',
    });
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
        status: 'draft',
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
