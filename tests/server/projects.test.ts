import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { createSourceConfigStore } from '../../src/server/store/sourceConfigs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

async function requestApp(
  method: string,
  url: string,
  body?: unknown,
  dependencies?: Parameters<typeof createApp>[1],
) {
  const app = createApp({
    allowedIps: ['127.0.0.1'],
    adminPassword: 'secret',
  }, dependencies);

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
        riskPolicy: 'auto_approve',
      });

      expect(created.status).toBe(201);
      expect(JSON.parse(created.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          name: 'AU Launch',
          siteName: 'MyModelHub',
          brandVoice: 'Direct, calm, proof-first',
          ctas: ['Start free', 'Book a demo'],
          riskPolicy: 'auto_approve',
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
            riskPolicy: 'auto_approve',
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
          riskPolicy: 'requires_review',
          archived: false,
        }),
      });

      const updated = await requestApp('PATCH', '/api/projects/1', {
        brandVoice: 'Warm, operator-friendly, action-oriented',
        ctas: ['Talk to sales', 'See live examples'],
        riskPolicy: 'auto_approve',
      });

      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        project: expect.objectContaining({
          id: 1,
          name: 'Legacy Workspace',
          brandVoice: 'Warm, operator-friendly, action-oriented',
          ctas: ['Talk to sales', 'See live examples'],
          riskPolicy: 'auto_approve',
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
            riskPolicy: 'auto_approve',
            archived: false,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects invalid project update payloads instead of silently ignoring them', async () => {
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

      const invalidPayloads = [
        { name: 123 },
        { siteName: false },
        { siteUrl: { href: 'https://example.com' } },
        { siteDescription: ['Wrong shape'] },
        { brandVoice: 456 },
        { ctas: 'Talk to sales' },
        { riskPolicy: 'sometimes_review' },
      ];

      for (const payload of invalidPayloads) {
        const updated = await requestApp('PATCH', '/api/projects/1', payload);

        expect(updated.status).toBe(400);
        expect(JSON.parse(updated.body)).toEqual({
          error: 'invalid project payload',
        });
      }

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [
          expect.objectContaining({
            id: 1,
            ctas: [],
            riskPolicy: 'requires_review',
            archived: false,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects project update payloads that only send unknown fields', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const created = await requestApp('POST', '/api/projects', {
        name: 'Legacy Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://legacy.example.com',
        siteDescription: 'Legacy create payload',
        sellingPoints: ['Existing flow'],
        brandVoice: 'Direct and clear',
        ctas: ['Talk to sales'],
      });

      expect(created.status).toBe(201);

      for (const invalidPayload of [{ brandVoce: 'Warm' }, { foo: 'bar' }]) {
        const updated = await requestApp('PATCH', '/api/projects/1', invalidPayload);

        expect(updated.status).toBe(400);
        expect(JSON.parse(updated.body)).toEqual({
          error: 'invalid project payload',
        });
      }

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [
          expect.objectContaining({
            id: 1,
            name: 'Legacy Workspace',
            brandVoice: 'Direct and clear',
            ctas: ['Talk to sales'],
            archived: false,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects project create payloads that include unknown fields', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const created = await requestApp('POST', '/api/projects', {
        name: 'Strict Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://strict.example.com',
        siteDescription: 'Strict payload coverage',
        sellingPoints: ['Existing flow'],
        brandVoice: 'Direct and clear',
        ctas: ['Talk to sales'],
        foo: 'bar',
      });

      expect(created.status).toBe(400);
      expect(JSON.parse(created.body)).toEqual({
        error: 'invalid project payload',
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

  it('rejects project payload arrays that mix strings with non-string values', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const invalidCreate = await requestApp('POST', '/api/projects', {
        name: 'Mixed Payload Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://mixed.example.com',
        siteDescription: 'Mixed payload coverage',
        sellingPoints: ['Existing flow'],
        ctas: ['Talk to sales', 123],
      });

      expect(invalidCreate.status).toBe(400);
      expect(JSON.parse(invalidCreate.body)).toEqual({
        error: 'invalid project payload',
      });

      const created = await requestApp('POST', '/api/projects', {
        name: 'Strict Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://strict.example.com',
        siteDescription: 'Strict payload coverage',
        sellingPoints: ['Existing flow'],
      });

      expect(created.status).toBe(201);

      const invalidUpdate = await requestApp('PATCH', '/api/projects/1', {
        sellingPoints: ['Valid point', { bad: true }],
      });

      expect(invalidUpdate.status).toBe(400);
      expect(JSON.parse(invalidUpdate.body)).toEqual({
        error: 'invalid project payload',
      });

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [
          expect.objectContaining({
            id: 1,
            sellingPoints: ['Existing flow'],
            ctas: [],
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects archive mutations through PATCH and keeps the project visible until the archive route is used', async () => {
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

      expect(archived.status).toBe(400);
      expect(JSON.parse(archived.body)).toEqual({
        error: 'project archive must use POST /api/projects/:id/archive',
      });

      const listed = await requestApp('GET', '/api/projects');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        projects: [
          expect.objectContaining({
            id: 1,
            archived: false,
          }),
        ],
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
      const createdPayload = JSON.parse(created.body) as {
        sourceConfig: {
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(createdPayload).toEqual({
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
      const initialCreatedAt = createdPayload.sourceConfig.createdAt;
      const initialUpdatedAt = createdPayload.sourceConfig.updatedAt;

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
      const updatedPayload = JSON.parse(updated.body) as {
        sourceConfig: {
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(updatedPayload).toEqual({
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
      expect(updatedPayload.sourceConfig.createdAt).toBe(initialCreatedAt);
      expect(Date.parse(updatedPayload.sourceConfig.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(initialUpdatedAt),
      );

      const persisted = await requestApp('GET', '/api/projects/1/source-configs');

      expect(persisted.status).toBe(200);
      expect(JSON.parse(persisted.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
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
            createdAt: initialCreatedAt,
            updatedAt: updatedPayload.sourceConfig.updatedAt,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reloads scheduler runtime after source config create and update', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const schedulerRuntime = {
        reload: vi.fn(),
      };

      const projectResponse = await requestApp(
        'POST',
        '/api/projects',
        {
          name: 'Monitoring Workspace',
          siteName: 'PromoBot',
          siteUrl: 'https://example.com',
          siteDescription: 'Brand monitoring',
          sellingPoints: ['Fast iteration'],
        },
        { schedulerRuntime: schedulerRuntime as never },
      );

      expect(projectResponse.status).toBe(201);

      const created = await requestApp(
        'POST',
        '/api/projects/1/source-configs',
        {
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
        },
        { schedulerRuntime: schedulerRuntime as never },
      );

      expect(created.status).toBe(201);
      expect(schedulerRuntime.reload).toHaveBeenCalledTimes(1);

      const updated = await requestApp(
        'PATCH',
        '/api/projects/1/source-configs/1',
        {
          label: 'Brand mentions',
          enabled: false,
          pollIntervalMinutes: 60,
        },
        { schedulerRuntime: schedulerRuntime as never },
      );

      expect(updated.status).toBe(200);
      expect(schedulerRuntime.reload).toHaveBeenCalledTimes(2);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns scheduler reload warnings after source config create and update when persistence already succeeded', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const schedulerRuntime = {
        reload: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('scheduler unavailable after create');
          })
          .mockImplementationOnce(() => {
            throw new Error('scheduler unavailable after update');
          }),
      };

      const projectResponse = await requestApp(
        'POST',
        '/api/projects',
        {
          name: 'Monitoring Workspace',
          siteName: 'PromoBot',
          siteUrl: 'https://example.com',
          siteDescription: 'Brand monitoring',
          sellingPoints: ['Fast iteration'],
        },
        { schedulerRuntime: schedulerRuntime as never },
      );

      expect(projectResponse.status).toBe(201);

      const created = await requestApp(
        'POST',
        '/api/projects/1/source-configs',
        {
          projectId: 1,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Competitor mentions',
          configJson: {
            query: 'promobot',
          },
          enabled: true,
          pollIntervalMinutes: 30,
        },
        { schedulerRuntime: schedulerRuntime as never },
      );

      expect(created.status).toBe(201);
      expect(JSON.parse(created.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 1,
          label: 'Competitor mentions',
        }),
        warnings: [
          {
            code: 'scheduler_reload_failed',
            message: 'scheduler unavailable after create',
          },
        ],
      });

      const persistedAfterCreate = await requestApp('GET', '/api/projects/1/source-configs');
      expect(persistedAfterCreate.status).toBe(200);
      expect(JSON.parse(persistedAfterCreate.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            label: 'Competitor mentions',
            enabled: true,
            pollIntervalMinutes: 30,
          }),
        ],
      });

      const updated = await requestApp(
        'PATCH',
        '/api/projects/1/source-configs/1',
        {
          label: 'Brand mentions',
          enabled: false,
          pollIntervalMinutes: 60,
        },
        { schedulerRuntime: schedulerRuntime as never },
      );

      expect(updated.status).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 1,
          label: 'Brand mentions',
          enabled: false,
          pollIntervalMinutes: 60,
        }),
        warnings: [
          {
            code: 'scheduler_reload_failed',
            message: 'scheduler unavailable after update',
          },
        ],
      });

      const persistedAfterUpdate = await requestApp('GET', '/api/projects/1/source-configs');
      expect(persistedAfterUpdate.status).toBe(200);
      expect(JSON.parse(persistedAfterUpdate.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            label: 'Brand mentions',
            enabled: false,
            pollIntervalMinutes: 60,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects invalid source config payloads for create and merged update requests', async () => {
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

      const invalidCreate = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram profile',
        configJson: {
          handle: '',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(invalidCreate.status).toBe(400);
      expect(JSON.parse(invalidCreate.body)).toEqual({
        error: 'Profile source config 需要 handle、username、profileUrl 或 url',
      });

      const invalidInstagramProfileUrl = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram profile',
        configJson: {
          profileUrl: 'https://example.com/not-instagram',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(invalidInstagramProfileUrl.status).toBe(400);
      expect(JSON.parse(invalidInstagramProfileUrl.body)).toEqual({
        error: 'Instagram profile source config 需要有效的 handle、username、profileUrl 或 url',
      });

      const invalidInstagramHandle = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram profile',
        configJson: {
          handle: '@Explore',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(invalidInstagramHandle.status).toBe(400);
      expect(JSON.parse(invalidInstagramHandle.body)).toEqual({
        error: 'Instagram profile source config 需要有效的 handle、username、profileUrl 或 url',
      });

      const malformedInstagramHandle = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram profile',
        configJson: {
          handle: '@openai/reel/123',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(malformedInstagramHandle.status).toBe(400);
      expect(JSON.parse(malformedInstagramHandle.body)).toEqual({
        error: 'Instagram profile source config 需要有效的 handle、username、profileUrl 或 url',
      });

      const invalidTiktokProfileUrl = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok profile',
        configJson: {
          profileUrl: 'https://www.tiktok.com/@openai/video/123',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(invalidTiktokProfileUrl.status).toBe(400);
      expect(JSON.parse(invalidTiktokProfileUrl.body)).toEqual({
        error: 'TikTok profile source config 需要有效的 handle、username、profileUrl 或 url',
      });

      const malformedTiktokHandle = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok profile',
        configJson: {
          handle: 'open ai',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(malformedTiktokHandle.status).toBe(400);
      expect(JSON.parse(malformedTiktokHandle.body)).toEqual({
        error: 'TikTok profile source config 需要有效的 handle、username、profileUrl 或 url',
      });

      const created = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(created.status).toBe(201);

      const invalidUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        sourceType: 'profile+instagram',
        platform: 'instagram',
        configJson: {},
      });

      expect(invalidUpdate.status).toBe(400);
      expect(JSON.parse(invalidUpdate.body)).toEqual({
        error: 'Profile source config 需要 handle、username、profileUrl 或 url',
      });

      const invalidProfileUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        configJson: {
          profileUrl: 'https://www.tiktok.com/@openai/video/123',
        },
      });

      expect(invalidProfileUpdate.status).toBe(400);
      expect(JSON.parse(invalidProfileUpdate.body)).toEqual({
        error: 'TikTok profile source config 需要有效的 handle、username、profileUrl 或 url',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects source config payloads that try to rebind project ownership', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const firstProject = await requestApp('POST', '/api/projects', {
        name: 'Monitoring Workspace',
        siteName: 'PromoBot',
        siteUrl: 'https://example.com',
        siteDescription: 'Brand monitoring',
        sellingPoints: ['Fast iteration'],
      });
      expect(firstProject.status).toBe(201);

      const secondProject = await requestApp('POST', '/api/projects', {
        name: 'Second Workspace',
        siteName: 'PromoBot 2',
        siteUrl: 'https://example-two.com',
        siteDescription: 'Ownership boundary',
        sellingPoints: ['Strict routing'],
      });
      expect(secondProject.status).toBe(201);

      const invalidCreate = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 2,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Cross-wired source config',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(invalidCreate.status).toBe(400);
      expect(JSON.parse(invalidCreate.body)).toEqual({
        error: 'invalid source config payload',
      });

      const created = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      expect(created.status).toBe(201);

      const invalidUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        projectId: 2,
        label: 'Hijacked feed',
      });

      expect(invalidUpdate.status).toBe(400);
      expect(JSON.parse(invalidUpdate.body)).toEqual({
        error: 'invalid source config payload',
      });

      const firstProjectConfigs = await requestApp('GET', '/api/projects/1/source-configs');
      expect(firstProjectConfigs.status).toBe(200);
      expect(JSON.parse(firstProjectConfigs.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            label: 'Competitor mentions',
            configJson: {
              query: 'promobot',
            },
          }),
        ],
      });

      const secondProjectConfigs = await requestApp('GET', '/api/projects/2/source-configs');
      expect(secondProjectConfigs.status).toBe(200);
      expect(JSON.parse(secondProjectConfigs.body)).toEqual({
        sourceConfigs: [],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects source config create payloads that include unknown fields', async () => {
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
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
        foo: 'bar',
      });

      expect(created.status).toBe(400);
      expect(JSON.parse(created.body)).toEqual({
        error: 'invalid source config payload',
      });

      const listed = await requestApp('GET', '/api/projects/1/source-configs');
      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        sourceConfigs: [],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects source config patch payloads that include a project id even when it matches the route project', async () => {
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
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      expect(created.status).toBe(201);

      const createdPayload = JSON.parse(created.body) as {
        sourceConfig: {
          updatedAt: string;
        };
      };

      const invalidUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        projectId: 1,
      });

      expect(invalidUpdate.status).toBe(400);
      expect(JSON.parse(invalidUpdate.body)).toEqual({
        error: 'invalid source config payload',
      });

      const listResponse = await requestApp('GET', '/api/projects/1/source-configs');
      expect(listResponse.status).toBe(200);
      expect(JSON.parse(listResponse.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            label: 'Competitor mentions',
            configJson: {
              query: 'promobot',
            },
            updatedAt: createdPayload.sourceConfig.updatedAt,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects source config patch payloads that omit all supported fields or only send unknown fields', async () => {
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
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      expect(created.status).toBe(201);

      const createdPayload = JSON.parse(created.body) as {
        sourceConfig: {
          updatedAt: string;
        };
      };

      for (const invalidPayload of [{}, { lable: 'Brand mentions' }]) {
        const invalidUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', invalidPayload);

        expect(invalidUpdate.status).toBe(400);
        expect(JSON.parse(invalidUpdate.body)).toEqual({
          error: 'invalid source config payload',
        });
      }

      const listResponse = await requestApp('GET', '/api/projects/1/source-configs');
      expect(listResponse.status).toBe(200);
      expect(JSON.parse(listResponse.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            label: 'Competitor mentions',
            configJson: {
              query: 'promobot',
            },
            updatedAt: createdPayload.sourceConfig.updatedAt,
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('accepts profile source configs when either the handle or profile url remains canonical', async () => {
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

      const instagramHandleFallback = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram handle fallback',
        configJson: {
          handle: '@openai',
          profileUrl: 'https://example.com/not-instagram',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(instagramHandleFallback.status).toBe(201);
      expect(JSON.parse(instagramHandleFallback.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 1,
          projectId: 1,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram handle fallback',
          configJson: {
            handle: '@openai',
            profileUrl: 'https://example.com/not-instagram',
          },
        }),
      });

      const instagramUrlFallback = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram profile url fallback',
        configJson: {
          handle: '@Explore',
          profileUrl: 'https://www.instagram.com/openai/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(instagramUrlFallback.status).toBe(201);
      expect(JSON.parse(instagramUrlFallback.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 2,
          projectId: 1,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile url fallback',
          configJson: {
            handle: '@Explore',
            profileUrl: 'https://www.instagram.com/openai/',
          },
        }),
      });

      const tiktokHandleFallback = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok handle fallback',
        configJson: {
          handle: 'openai',
          profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      expect(tiktokHandleFallback.status).toBe(201);
      expect(JSON.parse(tiktokHandleFallback.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 3,
          projectId: 1,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok handle fallback',
          configJson: {
            handle: 'openai',
            profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
          },
        }),
      });

      const labelOnlyUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/3', {
        label: 'TikTok handle fallback archived',
      });

      expect(labelOnlyUpdate.status).toBe(200);
      expect(JSON.parse(labelOnlyUpdate.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 3,
          projectId: 1,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok handle fallback archived',
          configJson: {
            handle: 'openai',
            profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('allows metadata-only updates for legacy source types while keeping their contract fields unchanged', async () => {
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

      const sourceConfigStore = createSourceConfigStore();
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'custom-rss',
        platform: 'rss',
        label: 'Legacy RSS source',
        configJson: {
          url: 'https://example.com/feed.xml',
        },
        enabled: true,
        pollIntervalMinutes: 45,
      });

      const metadataOnlyUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        label: 'Legacy RSS source archived',
        enabled: false,
        pollIntervalMinutes: 60,
      });

      expect(metadataOnlyUpdate.status).toBe(200);
      expect(JSON.parse(metadataOnlyUpdate.body)).toEqual({
        sourceConfig: expect.objectContaining({
          id: 1,
          projectId: 1,
          sourceType: 'custom-rss',
          platform: 'rss',
          label: 'Legacy RSS source archived',
          configJson: {
            url: 'https://example.com/feed.xml',
          },
          enabled: false,
          pollIntervalMinutes: 60,
        }),
      });

      const invalidLegacyContractUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        configJson: {
          url: 'https://example.com/other.xml',
        },
      });

      expect(invalidLegacyContractUpdate.status).toBe(400);
      expect(JSON.parse(invalidLegacyContractUpdate.body)).toEqual({
        error: 'Unsupported Source Type custom-rss',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects mismatched source type and platform combinations for create and merged update requests', async () => {
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

      const invalidCreate = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'x',
        label: 'Cross-wired source config',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(invalidCreate.status).toBe(400);
      expect(JSON.parse(invalidCreate.body)).toEqual({
        error: 'Source Type keyword+reddit 只能搭配 platform reddit',
      });

      const created = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Competitor mentions',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(created.status).toBe(201);

      const invalidUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        platform: 'x',
      });

      expect(invalidUpdate.status).toBe(400);
      expect(JSON.parse(invalidUpdate.body)).toEqual({
        error: 'Source Type keyword+reddit 只能搭配 platform reddit',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects unsupported source types for create and merged update requests', async () => {
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

      const invalidCreate = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'custom-rss',
        platform: 'rss',
        label: 'Unsupported source type',
        configJson: {
          feedUrl: 'https://example.com/feed.xml',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(invalidCreate.status).toBe(400);
      expect(JSON.parse(invalidCreate.body)).toEqual({
        error: 'Unsupported Source Type custom-rss',
      });

      const created = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Competitor feed',
        configJson: {
          feedUrl: 'https://example.com/feed.xml',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(created.status).toBe(201);

      const invalidUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        sourceType: 'custom-rss',
      });

      expect(invalidUpdate.status).toBe(400);
      expect(JSON.parse(invalidUpdate.body)).toEqual({
        error: 'Unsupported Source Type custom-rss',
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
        platform: 'rss',
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

  it('returns 404 without mutating a source config owned by another project', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const firstProject = await requestApp('POST', '/api/projects', {
        name: 'Workspace One',
        siteName: 'Workspace One',
        siteUrl: 'https://workspace-one.test',
        siteDescription: 'Ownership coverage one',
        sellingPoints: ['Baseline feed'],
      });
      expect(firstProject.status).toBe(201);

      const secondProject = await requestApp('POST', '/api/projects', {
        name: 'Workspace Two',
        siteName: 'Workspace Two',
        siteUrl: 'https://workspace-two.test',
        siteDescription: 'Ownership coverage two',
        sellingPoints: ['Protected feed'],
      });
      expect(secondProject.status).toBe(201);

      const created = await requestApp('POST', '/api/projects/2/source-configs', {
        projectId: 2,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Protected feed',
        configJson: { feedUrl: 'https://example.com/protected.xml' },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      expect(created.status).toBe(201);

      const wrongProjectUpdate = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        label: 'Hijacked feed',
        configJson: { feedUrl: 'https://example.com/hijacked.xml' },
      });

      expect(wrongProjectUpdate.status).toBe(404);
      expect(JSON.parse(wrongProjectUpdate.body)).toEqual({
        error: 'source config not found',
      });

      const listed = await requestApp('GET', '/api/projects/2/source-configs');
      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        sourceConfigs: [
          expect.objectContaining({
            id: 1,
            projectId: 2,
            label: 'Protected feed',
            configJson: { feedUrl: 'https://example.com/protected.xml' },
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('excludes archived project source configs from enabled listings', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectResponse = await requestApp('POST', '/api/projects', {
        name: 'Archive Me',
        siteName: 'Archive Demo',
        siteUrl: 'https://archive.test',
        siteDescription: 'Archive coverage',
        sellingPoints: ['Quiet sunset'],
      });

      expect(projectResponse.status).toBe(201);

      const sourceConfigStore = createSourceConfigStore();
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Competitor feed',
        configJson: {
          feedUrl: 'https://example.com/feed.xml',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      expect(sourceConfigStore.listEnabled()).toEqual([
        expect.objectContaining({
          id: 1,
          projectId: 1,
          sourceType: 'rss',
          enabled: true,
        }),
      ]);

      const archived = await requestApp('POST', '/api/projects/1/archive');

      expect(archived.status).toBe(200);
      expect(sourceConfigStore.listEnabled()).toEqual([]);
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

  it('rejects updates for archived projects', async () => {
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

      const updated = await requestApp('PATCH', '/api/projects/1', {
        name: 'Archive Me Later',
      });

      expect(updated.status).toBe(404);
      expect(JSON.parse(updated.body)).toEqual({
        error: 'project not found',
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

  it('returns 404 for source config routes after a project is archived', async () => {
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

      const sourceConfigStore = createSourceConfigStore();
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Competitor feed',
        configJson: {
          feedUrl: 'https://example.com/feed.xml',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      const archived = await requestApp('POST', '/api/projects/1/archive');
      expect(archived.status).toBe(200);

      const listed = await requestApp('GET', '/api/projects/1/source-configs');
      expect(listed.status).toBe(404);
      expect(JSON.parse(listed.body)).toEqual({ error: 'project not found' });

      const posted = await requestApp('POST', '/api/projects/1/source-configs', {
        projectId: 1,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Second feed',
        configJson: { feedUrl: 'https://example.com/second.xml' },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      expect(posted.status).toBe(404);
      expect(JSON.parse(posted.body)).toEqual({ error: 'project not found' });

      const patched = await requestApp('PATCH', '/api/projects/1/source-configs/1', {
        label: 'Archived feed',
      });
      expect(patched.status).toBe(404);
      expect(JSON.parse(patched.body)).toEqual({ error: 'project not found' });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
