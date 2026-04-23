import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

async function requestApp(method: string, url: string, body?: unknown) {
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

describe('projects api', () => {
  it('persists created projects in SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const created = await requestApp('POST', '/api/projects', {
        name: 'AU Launch',
        siteName: 'MyModelHub',
        siteUrl: 'https://example.com',
        siteDescription: 'Multi-model API gateway',
        sellingPoints: ['Lower cost'],
        brandVoice: 'Direct, calm, proof-first',
        ctas: ['Start free', 'Book a demo'],
      });

      expect(created.status).toBe(201);
      expect(JSON.parse(created.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          name: 'AU Launch',
          siteName: 'MyModelHub',
          brandVoice: 'Direct, calm, proof-first',
          ctas: ['Start free', 'Book a demo'],
        }),
      });

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [
          expect.objectContaining({
            id: 1,
            name: 'AU Launch',
            siteName: 'MyModelHub',
            siteUrl: 'https://example.com',
            sellingPoints: ['Lower cost'],
            brandVoice: 'Direct, calm, proof-first',
            ctas: ['Start free', 'Book a demo'],
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('defaults and updates brand voice plus ctas for legacy project payloads', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const created = await requestApp('POST', '/api/projects', {
        name: 'Legacy Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://legacy.example.com',
        siteDescription: 'Legacy create payload',
        sellingPoints: ['Existing flow'],
      });

      expect(created.status).toBe(201);
      expect(JSON.parse(created.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          brandVoice: '',
          ctas: [],
          archived: false,
        }),
      });

      const updated = await requestApp('PATCH', '/api/projects/1', {
        brandVoice: 'Warm, operator-friendly, action-oriented',
        ctas: ['Talk to sales', 'See live examples'],
      });

      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          name: 'Legacy Workspace',
          brandVoice: 'Warm, operator-friendly, action-oriented',
          ctas: ['Talk to sales', 'See live examples'],
        }),
      });

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [
          expect.objectContaining({
            id: 1,
            brandVoice: 'Warm, operator-friendly, action-oriented',
            ctas: ['Talk to sales', 'See live examples'],
            archived: false,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('archives a project and hides it from the default projects list', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const created = await requestApp('POST', '/api/projects', {
        name: 'AU Launch',
        siteName: 'MyModelHub',
        siteUrl: 'https://example.com',
        siteDescription: 'Multi-model API gateway',
        sellingPoints: ['Lower cost'],
      });

      expect(created.status).toBe(201);

      const archived = await requestApp('PATCH', '/api/projects/1', {
        archived: true,
      });

      expect(archived.status).toBe(200);
      expect(JSON.parse(archived.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          archived: true,
        }),
      });

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('creates, lists, and updates project source configs in SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectResponse = await requestApp('POST', '/api/projects', {
        name: 'Monitoring Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Brand monitoring',
        sellingPoints: ['Fast iteration'],
      });

      expect(projectResponse.status).toBe(201);

      const created = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'keyword',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          keywords: ['promobot', 'openai'],
          subreddit: 'LocalLLaMA',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(created.status).toBe(201);
      expect(JSON.parse(created.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 1,
          projectId: 1,
          sourceType: 'keyword',
          platform: 'reddit',
          label: 'Competitor mentions',
          configJson: {
            keywords: ['promobot', 'openai'],
            subreddit: 'LocalLLaMA',
          },
          enabled: true,
          pollIntervalMinutes: 30,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      });

      const listed = await requestApp('GET', '/api/projects/1/source-configs');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            sourceType: 'keyword',
            platform: 'reddit',
            label: 'Competitor mentions',
            configJson: {
              keywords: ['promobot', 'openai'],
              subreddit: 'LocalLLaMA',
            },
            enabled: true,
            pollIntervalMinutes: 30,
          }),
        ],
      });

      const updated = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        label: 'Brand mentions',
        configJson: {
          keywords: ['promobot'],
          subreddit: 'r/LocalLLaMA',
        },
        enabled: false,
        pollIntervalMinutes: 60,
      });

      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 1,
          projectId: 1,
          sourceType: 'keyword',
          platform: 'reddit',
          label: 'Brand mentions',
          configJson: {
            keywords: ['promobot'],
            subreddit: 'r/LocalLLaMA',
          },
          enabled: false,
          pollIntervalMinutes: 60,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns 404 for source config operations when the project is missing', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const listed = await requestApp('GET', '/api/projects/999/source-configs');
      expect(listed.status).toBe(404);
      expect(JSON.parse(listed.body)).toEqual({ error: 'project not found' });

      const created = await requestApp('POST', '/api/projects/999/source-configs', {
        projectId: 999,
        sourceType: 'rss',
        platform: 'blog',
        label: 'Competitor RSS',
        configJson: { url: 'https://example.com/feed.xml' },
        enabled: true,
        pollIntervalMinutes: 15,
      });

      expect(created.status).toBe(404);
      expect(JSON.parse(created.body)).toEqual({ error: 'project not found' });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('archives projects and excludes them from the default list', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const created = await requestApp('POST', '/api/projects', {
        name: 'Archive Me',
        siteName: 'Archive Demo',
        siteUrl: 'https://archive.test',
        siteDescription: 'Archive coverage',
        sellingPoints: ['Quiet sunset'],
      });

      expect(created.status).toBe(201);

      const archived = await requestApp('POST', '/api/projects/1/archive');

      expect(archived.status).toBe(200);
      expect(JSON.parse(archived.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          name: 'Archive Me',
          archived: true,
          archivedAt: expect.any(String),
        }),
      });

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
