import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createContentRouter } from '../../src/server/routes/content';
import type { DraftRecord, DraftStore } from '../../src/server/routes/drafts';
import type { ProjectStore } from '../../src/server/store/projects';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const originalEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

let activeTestDbRoot: string | undefined;

async function requestExpressApp(
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

async function requestApp(method: string, url: string, body?: unknown) {
  const app = createApp({
    allowedIps: ['127.0.0.1'],
    adminPassword: 'secret',
  });

  return requestExpressApp(app, method, url, body);
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

function createContentApp(draftStore: DraftStore, projectStore?: ProjectStore) {
  const app = express();
  app.use(express.json());
  app.use('/api/content', createContentRouter(draftStore, projectStore));
  return app;
}

beforeEach(() => {
  process.env.AI_BASE_URL = 'https://example.test/v1';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'test-model';
  activeTestDbRoot = createTestDatabasePath().rootDir;
});

afterEach(() => {
  process.env.AI_BASE_URL = originalEnv.AI_BASE_URL;
  process.env.AI_API_KEY = originalEnv.AI_API_KEY;
  process.env.AI_MODEL = originalEnv.AI_MODEL;
  vi.unstubAllGlobals();
  if (activeTestDbRoot) {
    cleanupTestDatabasePath(activeTestDbRoot);
    activeTestDbRoot = undefined;
  }
});

describe('content generation api', () => {
  it('returns generated drafts for selected platforms in request order', async () => {
    installFetchStub();

    const response = await requestApp('POST', '/api/content/generate', {
      topic: 'Claude support launched',
      platforms: ['x', 'instagram', 'tiktok', 'reddit'],
      tone: 'professional',
      saveAsDraft: true,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      results: [
        {
          draftId: 1,
          platform: 'x',
          content: 'x-draft-content',
          hashtags: [],
        },
        {
          draftId: 2,
          platform: 'instagram',
          content: 'instagram-draft-content',
          hashtags: [],
        },
        {
          draftId: 3,
          platform: 'tiktok',
          content: 'tiktok-draft-content',
          hashtags: [],
        },
        {
          draftId: 4,
          platform: 'reddit',
          content: 'reddit-draft-content',
          hashtags: [],
        },
      ],
    });
  });

  it('saves drafts durably when saveAsDraft is true', async () => {
    installFetchStub();

    await requestApp('POST', '/api/content/generate', {
      topic: 'Durable draft',
      platforms: ['x'],
      tone: 'professional',
      saveAsDraft: true,
    });

    const secondApp = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    const response = await requestExpressApp(secondApp, 'GET', '/api/drafts');

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      drafts: [
        expect.objectContaining({
          id: 1,
          platform: 'x',
          content: 'x-draft-content',
        }),
      ],
    });
  });

  it('passes projectId to draft creation when saving generated drafts', async () => {
    installFetchStub();

    type DraftRecordWithProjectId = DraftRecord & { projectId?: number };

    const savedDrafts: DraftRecordWithProjectId[] = [];
    const draftStore: DraftStore = {
      create(input) {
        const now = new Date().toISOString();
        const savedDraft: DraftRecordWithProjectId = {
          id: savedDrafts.length + 1,
          platform: input.platform,
          title: input.title,
          content: input.content,
          hashtags: [...(input.hashtags ?? [])],
          status: 'draft',
          createdAt: now,
          updatedAt: now,
          projectId:
            typeof (input as { projectId?: unknown }).projectId === 'number'
              ? ((input as { projectId?: number }).projectId)
              : undefined,
        };

        savedDrafts.push(savedDraft);
        return savedDraft;
      },
      getById(id) {
        return savedDrafts.find((draft) => draft.id === id);
      },
      list() {
        return savedDrafts;
      },
      update() {
        return undefined;
      },
    };
    const projectStore: ProjectStore = {
      create() {
        throw new Error('not implemented');
      },
      getById(id) {
        if (id !== 42) {
          return undefined;
        }

        return {
          id: 42,
          name: 'Scoped Project',
          siteName: 'PromoBot',
          siteUrl: 'https://promobot.test',
          siteDescription: 'Scoped project',
          sellingPoints: ['Project scoped'],
          brandVoice: '',
          ctas: [],
          archived: false,
          createdAt: new Date().toISOString(),
        };
      },
      list() {
        return [];
      },
      update() {
        return undefined;
      },
      archive() {
        return undefined;
      },
    };

    const response = await requestExpressApp(
      createContentApp(draftStore, projectStore),
      'POST',
      '/api/content/generate',
      {
        topic: 'Project scoped draft',
        platforms: ['x'],
        tone: 'professional',
        saveAsDraft: true,
        projectId: 42,
      },
    );

    expect(response.status).toBe(200);
    expect(savedDrafts).toEqual([
      expect.objectContaining({
        id: 1,
        platform: 'x',
        content: 'x-draft-content',
        hashtags: [],
        projectId: 42,
      }),
    ]);
  });

  it('hydrates site context from the saved project when projectId is provided', async () => {
    const projectCreateResponse = await requestApp('POST', '/api/projects', {
      name: 'Context Project',
      siteName: 'PromoBot',
      siteUrl: 'https://promobot.test',
      siteDescription: 'Multi-model API gateway for operators',
      sellingPoints: ['Fast routing', 'Lower cost'],
      brandVoice: 'Direct, calm, proof-first',
      ctas: ['Start free', 'Book a demo'],
    });

    expect(projectCreateResponse.status).toBe(201);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const userPrompt = payload.messages.find((message) => message.role === 'user')?.content ?? '';

        expect(userPrompt).toContain('Site Description: Multi-model API gateway for operators');
        expect(userPrompt).toContain('Selling Points: Fast routing, Lower cost');
        expect(userPrompt).toContain('Brand Voice: Direct, calm, proof-first');
        expect(userPrompt).toContain('CTAs: Start free, Book a demo');

        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'x-draft-content' } }],
          }),
        };
      }),
    );

    const response = await requestApp('POST', '/api/content/generate', {
      topic: 'Project aware draft',
      platforms: ['x'],
      tone: 'professional',
      projectId: 1,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      results: [
        {
          platform: 'x',
          content: 'x-draft-content',
          hashtags: [],
        },
      ],
    });
  });

  it('rejects generation when projectId points to a missing project', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await requestApp('POST', '/api/content/generate', {
      topic: 'Missing project draft',
      platforms: ['x'],
      tone: 'professional',
      projectId: 999,
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'project not found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not create a draft when saveAsDraft is true and projectId points to a missing project', async () => {
    const draftCreate = vi.fn();
    const draftStore: DraftStore = {
      create: draftCreate,
      getById() {
        return undefined;
      },
      list() {
        return [];
      },
      update() {
        return undefined;
      },
    };
    const projectStore: ProjectStore = {
      create() {
        throw new Error('not implemented');
      },
      getById() {
        return undefined;
      },
      list() {
        return [];
      },
      update() {
        return undefined;
      },
      archive() {
        return undefined;
      },
    };

    installFetchStub();

    const response = await requestExpressApp(
      createContentApp(draftStore, projectStore),
      'POST',
      '/api/content/generate',
      {
        topic: 'Missing project saved draft',
        platforms: ['x'],
        tone: 'professional',
        saveAsDraft: true,
        projectId: 999,
      },
    );

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'project not found',
    });
    expect(draftCreate).not.toHaveBeenCalled();
  });

  it('rejects generation when projectId points to an archived project', async () => {
    const created = await requestApp('POST', '/api/projects', {
      name: 'Archived Project',
      siteName: 'PromoBot Archive',
      siteUrl: 'https://archive.promobot.test',
      siteDescription: 'Archived project context',
      sellingPoints: ['Historical context'],
    });

    expect(created.status).toBe(201);

    const archived = await requestApp('POST', '/api/projects/1/archive');
    expect(archived.status).toBe(200);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await requestApp('POST', '/api/content/generate', {
      topic: 'Archived project draft',
      platforms: ['x'],
      tone: 'professional',
      projectId: 1,
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'project not found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not create a draft when saveAsDraft is true and projectId points to an archived project', async () => {
    const draftCreate = vi.fn();
    const draftStore: DraftStore = {
      create: draftCreate,
      getById() {
        return undefined;
      },
      list() {
        return [];
      },
      update() {
        return undefined;
      },
    };
    const projectStore: ProjectStore = {
      create() {
        throw new Error('not implemented');
      },
      getById(id) {
        if (id !== 12) {
          return undefined;
        }

        return {
          id: 12,
          name: 'Archived Project',
          siteName: 'Archive',
          siteUrl: 'https://archive.promobot.test',
          siteDescription: 'Archived project context',
          sellingPoints: ['Archived'],
          brandVoice: '',
          ctas: [],
          archived: true,
          createdAt: new Date().toISOString(),
        };
      },
      list() {
        return [];
      },
      update() {
        return undefined;
      },
      archive() {
        return undefined;
      },
    };

    installFetchStub();

    const response = await requestExpressApp(
      createContentApp(draftStore, projectStore),
      'POST',
      '/api/content/generate',
      {
        topic: 'Archived project saved draft',
        platforms: ['x'],
        tone: 'professional',
        saveAsDraft: true,
        projectId: 12,
      },
    );

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'project not found',
    });
    expect(draftCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid projectId instead of silently dropping it', async () => {
    installFetchStub();

    const response = await requestApp('POST', '/api/content/generate', {
      topic: 'Invalid scoped draft',
      platforms: ['x'],
      tone: 'professional',
      saveAsDraft: true,
      projectId: 0,
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'invalid project id',
    });
  });
});
