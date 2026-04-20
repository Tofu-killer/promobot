import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { initDb } from '../../src/server/db';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const originalEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

let activeTestDbRoot: string | undefined;
let activeTestDatabasePath: string | undefined;

async function requestApp(
  app: ReturnType<typeof createApp>,
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

function installFetchStub() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const userPrompt = payload.messages.find((message) => message.role === 'user')?.content ?? '';
      const platform = userPrompt.match(/Platform: ([^\n]+)/)?.[1] ?? 'unknown';

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: `${platform}-draft-content` } }],
        }),
      };
    }),
  );
}

beforeEach(() => {
  process.env.AI_BASE_URL = 'https://example.test/v1';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'test-model';
  const testDatabase = createTestDatabasePath();
  activeTestDbRoot = testDatabase.rootDir;
  activeTestDatabasePath = testDatabase.databasePath;
});

afterEach(() => {
  process.env.AI_BASE_URL = originalEnv.AI_BASE_URL;
  process.env.AI_API_KEY = originalEnv.AI_API_KEY;
  process.env.AI_MODEL = originalEnv.AI_MODEL;
  vi.unstubAllGlobals();
  if (activeTestDbRoot) {
    cleanupTestDatabasePath(activeTestDbRoot);
    activeTestDbRoot = undefined;
    activeTestDatabasePath = undefined;
  }
});

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

describe('drafts api', () => {
  it('preserves projectId through draft store create list and update', () => {
    const store = createSQLiteDraftStore();

    const created = store.create({
      platform: 'x',
      content: 'x-draft-content',
      projectId: 7,
    });

    expect(created).toEqual(
      expect.objectContaining({
        id: 1,
        platform: 'x',
        content: 'x-draft-content',
        projectId: 7,
      }),
    );
    expect(store.list()).toEqual([
      expect.objectContaining({
        id: 1,
        projectId: 7,
      }),
    ]);

    const updated = store.update(created.id, {
      content: 'updated-x-draft-content',
      projectId: 9,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: 1,
        content: 'updated-x-draft-content',
        projectId: 9,
      }),
    );
    expect(store.getById(created.id)).toEqual(
      expect.objectContaining({
        id: 1,
        projectId: 9,
      }),
    );
  });

  it('lists drafts saved from content generation', async () => {
    installFetchStub();
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    await requestApp(app, 'POST', '/api/content/generate', {
      topic: 'Claude support launched',
      platforms: ['x'],
      tone: 'professional',
      saveAsDraft: true,
    });

    const response = await requestApp(app, 'GET', '/api/drafts');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      drafts: [
        expect.objectContaining({
          id: 1,
          platform: 'x',
          content: 'x-draft-content',
          hashtags: [],
          projectId: null,
          status: 'draft',
        }),
      ],
    });
  });

  it('filters drafts by query projectId and keeps legacy list behavior when omitted', async () => {
    const store = createSQLiteDraftStore();
    store.create({
      platform: 'x',
      content: 'project-11-draft',
      projectId: 11,
    });
    store.create({
      platform: 'reddit',
      content: 'project-22-draft',
      projectId: 22,
    });
    store.create({
      platform: 'blog',
      content: 'legacy-draft',
    });
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    const filtered = await requestApp(app, 'GET', '/api/drafts?projectId=11');
    const unfiltered = await requestApp(app, 'GET', '/api/drafts');

    expect(filtered.status).toBe(200);
    expect(JSON.parse(filtered.body)).toEqual({
      drafts: [
        expect.objectContaining({
          id: 1,
          projectId: 11,
          content: 'project-11-draft',
        }),
      ],
    });

    expect(unfiltered.status).toBe(200);
    expect(JSON.parse(unfiltered.body)).toEqual({
      drafts: [
        expect.objectContaining({
          id: 1,
          projectId: 11,
        }),
        expect.objectContaining({
          id: 2,
          projectId: 22,
        }),
        expect.objectContaining({
          id: 3,
          projectId: null,
        }),
      ],
    });
  });

  it('updates draft content and status', async () => {
    const store = createSQLiteDraftStore();
    store.create({
      platform: 'reddit',
      content: 'reddit-draft-content',
    });
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    const response = await requestApp(app, 'PATCH', '/api/drafts/1', {
      content: 'updated-reddit-draft',
      hashtags: ['#launch'],
      projectId: 12,
      status: 'review',
      title: 'Updated Reddit Draft',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draft: expect.objectContaining({
        id: 1,
        platform: 'reddit',
        title: 'Updated Reddit Draft',
        content: 'updated-reddit-draft',
        hashtags: ['#launch'],
        projectId: 12,
        status: 'review',
      }),
    });
  });

  it('updates draft scheduledAt and enqueues a publish job', async () => {
    installFetchStub();
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    await requestApp(app, 'POST', '/api/content/generate', {
      topic: 'Claude support launched',
      platforms: ['x'],
      tone: 'professional',
      saveAsDraft: true,
    });

    const response = await requestApp(app, 'PATCH', '/api/drafts/1', {
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      draft: expect.objectContaining({
        id: 1,
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30:00.000Z',
      }),
      publishJob: expect.objectContaining({
        type: 'publish',
        status: 'pending',
        runAt: '2026-04-20T09:30:00.000Z',
      }),
    });

    expect(readJobQueue()).toEqual([
      expect.objectContaining({
        type: 'publish',
        payload: '{"draftId":1}',
        status: 'pending',
        runAt: '2026-04-20T09:30:00.000Z',
      }),
    ]);
  });

  it('reschedules and clears publish jobs when scheduled drafts are edited', async () => {
    installFetchStub();
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    await requestApp(app, 'POST', '/api/content/generate', {
      topic: 'Claude support launched',
      platforms: ['x'],
      tone: 'professional',
      saveAsDraft: true,
    });

    await requestApp(app, 'PATCH', '/api/drafts/1', {
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });

    const rescheduled = await requestApp(app, 'PATCH', '/api/drafts/1', {
      scheduledAt: '2026-04-20T11:00:00.000Z',
    });

    expect(rescheduled.status).toBe(200);
    expect(JSON.parse(rescheduled.body)).toEqual({
      draft: expect.objectContaining({
        id: 1,
        status: 'scheduled',
        scheduledAt: '2026-04-20T11:00:00.000Z',
      }),
      publishJob: expect.objectContaining({
        type: 'publish',
        status: 'pending',
        runAt: '2026-04-20T11:00:00.000Z',
      }),
    });
    expect(readJobQueue()).toEqual([
      expect.objectContaining({
        type: 'publish',
        payload: '{"draftId":1}',
        status: 'pending',
        runAt: '2026-04-20T11:00:00.000Z',
      }),
    ]);

    const cleared = await requestApp(app, 'PATCH', '/api/drafts/1', {
      scheduledAt: null,
    });

    expect(cleared.status).toBe(200);
    expect(JSON.parse(cleared.body)).toEqual({
      draft: expect.objectContaining({
        id: 1,
        status: 'approved',
      }),
    });
    expect(readJobQueue()).toEqual([]);
  });
});
