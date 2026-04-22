import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { channelAccountsRouter } from '../../src/server/routes/channelAccounts';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const defaultStorageState = {
  cookies: [],
  origins: [],
};

function writeStorageStateFile(rootDir: string, storageStatePath: string) {
  const filePath = path.join(rootDir, storageStatePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultStorageState, null, 2));
  return filePath;
}

async function requestApp(method: string, url: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/channel-accounts', channelAccountsRouter);

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

describe('channel accounts api', () => {
  it('rejects channel account creation when the platform is not supported', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const response = await requestApp('POST', '/api/channel-accounts', {
        platform: 'discord',
        accountKey: '@promobot',
        displayName: 'PromoBot Discord',
        authType: 'api',
        status: 'healthy',
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'invalid channel account payload',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('creates and lists a channel account with an optional projectId binding', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/projects', {
        name: 'AU Launch',
        siteName: 'MyModelHub',
        siteUrl: 'https://example.com',
        siteDescription: 'Multi-model API gateway',
        sellingPoints: ['Lower cost'],
      });

      const created = await requestApp('POST', '/api/channel-accounts', {
        projectId: 1,
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'healthy',
      });

      expect(created.status).toBe(201);
      expect(JSON.parse(created.body)).toEqual({
        channelAccount: expect.objectContaining({
          id: 1,
          projectId: 1,
          platform: 'x',
          accountKey: '@promobot',
        }),
      });

      const listed = await requestApp('GET', '/api/channel-accounts');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            projectId: 1,
            platform: 'x',
            accountKey: '@promobot',
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('preserves and updates projectId bindings when patching a channel account', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/projects', {
        name: 'AU Launch',
        siteName: 'MyModelHub',
        siteUrl: 'https://example.com',
        siteDescription: 'Multi-model API gateway',
        sellingPoints: ['Lower cost'],
      });
      await requestApp('POST', '/api/projects', {
        name: 'US Launch',
        siteName: 'MyModelHub US',
        siteUrl: 'https://us.example.com',
        siteDescription: 'Multi-model API gateway',
        sellingPoints: ['Faster response'],
      });
      await requestApp('POST', '/api/channel-accounts', {
        projectId: 1,
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'healthy',
      });

      const preserved = await requestApp('PATCH', '/api/channel-accounts/1', {
        displayName: 'PromoBot X Ops',
      });

      expect(preserved.status).toBe(200);
      expect(JSON.parse(preserved.body)).toEqual({
        channelAccount: expect.objectContaining({
          id: 1,
          projectId: 1,
          displayName: 'PromoBot X Ops',
        }),
      });

      const rebound = await requestApp('PATCH', '/api/channel-accounts/1', {
        projectId: 2,
      });

      expect(rebound.status).toBe(200);
      expect(JSON.parse(rebound.body)).toEqual({
        channelAccount: expect.objectContaining({
          id: 1,
          projectId: 2,
          displayName: 'PromoBot X Ops',
        }),
      });

      const listed = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            projectId: 2,
            displayName: 'PromoBot X Ops',
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects platform changes to unsupported channel account values', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'healthy',
      });

      const response = await requestApp('PATCH', '/api/channel-accounts/1', {
        platform: 'discord',
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'invalid channel account payload',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('persists channel accounts in SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.X_ACCESS_TOKEN = 'x-token';

      const created = await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'healthy',
      });

      expect(created.status).toBe(201);

      const listed = await requestApp('GET', '/api/channel-accounts');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            platform: 'x',
            accountKey: '@promobot',
            displayName: 'PromoBot X',
            authType: 'api',
            status: 'healthy',
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
            publishReadiness: expect.objectContaining({
              platform: 'x',
              ready: true,
              status: 'ready',
            }),
          }),
        ],
      });
    } finally {
      delete process.env.X_ACCESS_TOKEN;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tests a channel account without changing its status by default', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'unknown',
      });

      const response = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(response.status).toBe(200);

      const body = JSON.parse(response.body) as {
        ok: boolean;
        test: {
          checkedAt: string;
          status: string;
          summary: string;
          message: string;
          action?: string;
          nextStep?: string;
          details: {
            ready: boolean;
            mode: string;
            authType: string;
            credentials: Record<string, unknown>;
          };
        };
        channelAccount: { id: number; status: string };
      };

      expect(body).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'needs_config',
          summary: '缺少配置',
          message: 'X API 账号缺少可用凭证，请配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。',
          action: 'configure_credentials',
          nextStep: '/api/channel-accounts/1',
          details: {
            ready: false,
            mode: 'api',
            authType: 'api',
            credentials: {
              hasAccessToken: false,
              hasBearerToken: false,
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          status: 'unknown',
        }),
      });

      const listed = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            status: 'unknown',
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tests a channel account and updates its status when requested', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      process.env.X_ACCESS_TOKEN = 'x-token';

      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'api',
        status: 'unknown',
      });

      const response = await requestApp('POST', '/api/channel-accounts/1/test', {
        status: 'healthy',
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'ready',
          summary: '可用',
          message: 'X API 账号已检测到可用凭证。',
          details: {
            ready: true,
            mode: 'api',
            authType: 'api',
            credentials: {
              hasAccessToken: true,
              hasBearerToken: false,
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          status: 'healthy',
        }),
      });

      const listed = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            status: 'healthy',
          }),
        ],
      });
    } finally {
      delete process.env.X_ACCESS_TOKEN;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tests a reddit browser account using saved session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'reddit',
        accountKey: 'u/promobot',
        displayName: 'PromoBot Reddit',
        authType: 'browser',
        status: 'unknown',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/reddit-promobot.json');

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/reddit-promobot.json',
        status: 'expired',
        validatedAt: '2026-04-19T12:34:56.000Z',
      });

      const response = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'needs_relogin',
          summary: '需要重新登录',
          message: 'Reddit 浏览器 session 已过期，需要重新登录并重新保存 session 元数据。',
          action: 'relogin',
          nextStep: '/api/channel-accounts/1/session',
          details: {
            ready: false,
            mode: 'browser',
            authType: 'browser',
            session: {
              hasSession: true,
              id: 'reddit:u-promobot',
              status: 'expired',
              validatedAt: '2026-04-19T12:34:56.000Z',
              storageStatePath: 'artifacts/browser-sessions/reddit-promobot.json',
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          status: 'unknown',
          session: {
            hasSession: true,
            id: 'reddit:u-promobot',
            status: 'expired',
            validatedAt: '2026-04-19T12:34:56.000Z',
            storageStatePath: 'artifacts/browser-sessions/reddit-promobot.json',
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tests an x browser account without a saved session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X Browser',
        authType: 'browser',
        status: 'unknown',
      });

      const response = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'needs_session',
          summary: '需要登录会话',
          message: 'X 浏览器 session 缺失，请先登录并保存 session 元数据。',
          action: 'request_session',
          nextStep: '/api/channel-accounts/1/session',
          details: {
            ready: false,
            mode: 'browser',
            authType: 'browser',
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          status: 'unknown',
          session: {
            hasSession: false,
            status: 'missing',
            validatedAt: null,
            storageStatePath: null,
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tests a facebookGroup browser account using saved session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'unknown',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/facebook-group.json');

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        status: 'active',
        validatedAt: '2026-04-19T12:34:56.000Z',
      });

      const response = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'ready',
          summary: '可用',
          message: 'Facebook Group 浏览器 session 可用，可以继续发布流程。',
          details: {
            ready: true,
            mode: 'browser',
            authType: 'browser',
            session: {
              hasSession: true,
              id: 'facebookGroup:launch-campaign',
              status: 'active',
              validatedAt: '2026-04-19T12:34:56.000Z',
              storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          status: 'unknown',
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tests a facebookGroup browser account without a saved session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'unknown',
      });

      const response = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'needs_session',
          summary: '需要登录会话',
          message: 'Facebook Group 浏览器 session 缺失，请先登录并保存 session 元数据。',
          action: 'request_session',
          nextStep: '/api/channel-accounts/1/session',
          details: {
            ready: false,
            mode: 'browser',
            authType: 'browser',
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          status: 'unknown',
          session: {
            hasSession: false,
            status: 'missing',
            validatedAt: null,
            storageStatePath: null,
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns 404 when testing a missing channel account', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const response = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: 'channel account not found',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('associates session metadata with a channel account and returns session summary in the list', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/x-promobot.json');

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        status: 'active',
        validatedAt: '2026-04-19T12:34:56.000Z',
        notes: 'manual relogin completed',
      });

      expect(attachResponse.status).toBe(200);
      expect(JSON.parse(attachResponse.body)).toEqual({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:-promobot',
          status: 'active',
          validatedAt: '2026-04-19T12:34:56.000Z',
          storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
          notes: 'manual relogin completed',
        },
        channelAccount: expect.objectContaining({
          id: 1,
          authType: 'browser',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: '2026-04-19T12:34:56.000Z',
            storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
            notes: 'manual relogin completed',
          },
          metadata: expect.objectContaining({
            session: expect.objectContaining({
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-19T12:34:56.000Z',
              storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
              notes: 'manual relogin completed',
            }),
          }),
        }),
      });

      const listed = await requestApp('GET', '/api/channel-accounts');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            session: {
              hasSession: true,
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-19T12:34:56.000Z',
              storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
              notes: 'manual relogin completed',
            },
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('clears stale session metadata when the channel account identity changes', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/x-promobot.json');

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        status: 'active',
        validatedAt: '2026-04-19T12:34:56.000Z',
      });

      const patched = await requestApp('PATCH', '/api/channel-accounts/1', {
        accountKey: '@promobot-apac',
      });

      expect(patched.status).toBe(200);
      expect(JSON.parse(patched.body)).toEqual({
        channelAccount: expect.objectContaining({
          id: 1,
          accountKey: '@promobot-apac',
          session: {
            hasSession: false,
            status: 'missing',
            validatedAt: null,
            storageStatePath: null,
          },
          metadata: {},
        }),
      });

      const listed = await requestApp('GET', '/api/channel-accounts');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            accountKey: '@promobot-apac',
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
            metadata: {},
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects session metadata saves when the provided storage state path does not exist', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/missing.json',
        status: 'active',
      });

      expect(attachResponse.status).toBe(400);
      expect(JSON.parse(attachResponse.body)).toEqual({
        error: 'storage state path does not exist for platform x: artifacts/browser-sessions/missing.json',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects session metadata saves when the provided storage state file is not a Playwright storage state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const invalidStorageStatePath = path.join(rootDir, 'artifacts', 'browser-sessions', 'invalid.json');
      mkdirSync(path.dirname(invalidStorageStatePath), { recursive: true });
      writeFileSync(invalidStorageStatePath, JSON.stringify({ foo: 'bar' }, null, 2));

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/invalid.json',
        status: 'active',
      });

      expect(attachResponse.status).toBe(400);
      expect(JSON.parse(attachResponse.body)).toEqual({
        error:
          'storage state file is invalid for platform x: artifacts/browser-sessions/invalid.json',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects absolute storage state paths outside the allowed session roots', async () => {
    const { rootDir } = createTestDatabasePath();
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'promobot-session-external-'));
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const externalStorageStatePath = path.join(externalRoot, 'storage-state.json');
      writeFileSync(
        externalStorageStatePath,
        JSON.stringify({ cookies: [], origins: [] }, null, 2),
      );

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: externalStorageStatePath,
        status: 'active',
      });

      expect(attachResponse.status).toBe(400);
      expect(JSON.parse(attachResponse.body)).toEqual({
        error: `storage state path is outside allowed roots for platform x: ${externalStorageStatePath}`,
      });
    } finally {
      rmSync(externalRoot, { force: true, recursive: true });
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects inline storageState payloads that are not valid Playwright storage state JSON', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageState: {
          foo: 'bar',
        },
        status: 'active',
      });

      expect(attachResponse.status).toBe(400);
      expect(JSON.parse(attachResponse.body)).toEqual({
        error: 'storage state payload is invalid for platform x',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects session saves that provide both storageStatePath and storageState', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/x-promobot.json');

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        storageState: defaultStorageState,
        status: 'active',
      });

      expect(attachResponse.status).toBe(400);
      expect(JSON.parse(attachResponse.body)).toEqual({
        error: 'provide either storageStatePath or storageState, not both',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('degrades browser session summaries to missing when the storage state file disappears', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'healthy',
      });

      const storageStatePath = 'artifacts/browser-sessions/facebook-group.json';
      const filePath = writeStorageStateFile(rootDir, storageStatePath);

      const attached = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath,
        status: 'active',
        validatedAt: '2026-04-20T12:34:56.000Z',
      });

      expect(attached.status).toBe(200);
      expect(JSON.parse(attached.body)).toEqual({
        ok: true,
        session: {
          hasSession: true,
          id: 'facebookGroup:launch-campaign',
          status: 'active',
          validatedAt: '2026-04-20T12:34:56.000Z',
          storageStatePath,
        },
        channelAccount: expect.objectContaining({
          id: 1,
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-20T12:34:56.000Z',
            storageStatePath,
          },
        }),
      });

      rmSync(filePath, { force: true });

      const listed = await requestApp('GET', '/api/channel-accounts');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            session: {
              hasSession: false,
              id: 'facebookGroup:launch-campaign',
              status: 'missing',
              validatedAt: '2026-04-20T12:34:56.000Z',
              storageStatePath,
            },
            publishReadiness: expect.objectContaining({
              platform: 'facebookGroup',
              ready: false,
              status: 'needs_session',
              action: 'request_session',
            }),
          }),
        ],
      });

      const tested = await requestApp('POST', '/api/channel-accounts/1/test');

      expect(tested.status).toBe(200);
      expect(JSON.parse(tested.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'needs_session',
          summary: '需要登录会话',
          message: 'Facebook Group 浏览器 session 缺失，请先登录并保存 session 元数据。',
          action: 'request_session',
          nextStep: '/api/channel-accounts/1/session',
          details: {
            ready: false,
            mode: 'browser',
            authType: 'browser',
            session: {
              hasSession: false,
              id: 'facebookGroup:launch-campaign',
              status: 'missing',
              validatedAt: '2026-04-20T12:34:56.000Z',
              storageStatePath,
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          session: {
            hasSession: false,
            id: 'facebookGroup:launch-campaign',
            status: 'missing',
            validatedAt: '2026-04-20T12:34:56.000Z',
            storageStatePath,
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports storage state JSON into a managed session file and returns its managed path', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const storageState = {
        cookies: [
          {
            name: 'auth_token',
            value: 'secret',
            domain: '.x.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ],
        origins: [
          {
            origin: 'https://x.com',
            localStorage: [
              {
                name: 'session',
                value: 'managed-import',
              },
            ],
          },
        ],
      };

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageState,
        status: 'active',
        validatedAt: '2026-04-20T12:34:56.000Z',
        notes: 'managed import',
      });

      const managedPath = path.join('browser-sessions', 'managed', 'x', '-promobot.json');
      const managedFilePath = path.join(rootDir, managedPath);

      expect(attachResponse.status).toBe(200);
      expect(JSON.parse(attachResponse.body)).toEqual({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:-promobot',
          status: 'active',
          validatedAt: '2026-04-20T12:34:56.000Z',
          storageStatePath: managedPath,
          notes: 'managed import',
        },
        channelAccount: expect.objectContaining({
          id: 1,
          authType: 'browser',
          metadata: expect.objectContaining({
            session: expect.objectContaining({
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-20T12:34:56.000Z',
              storageStatePath: managedPath,
            }),
          }),
        }),
      });

      expect(existsSync(managedFilePath)).toBe(true);
      expect(JSON.parse(readFileSync(managedFilePath, 'utf8'))).toEqual(storageState);

      const listed = await requestApp('GET', '/api/channel-accounts');

      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            session: {
              hasSession: true,
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-20T12:34:56.000Z',
              storageStatePath: managedPath,
              notes: 'managed import',
            },
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('downgrades a saved browser session to missing when the storage state file disappears', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const attachResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageState: defaultStorageState,
        status: 'active',
        validatedAt: '2026-04-20T12:34:56.000Z',
        notes: 'managed import',
      });
      expect(attachResponse.status).toBe(200);

      const managedPath = path.join('browser-sessions', 'managed', 'x', '-promobot.json');
      const managedFilePath = path.join(rootDir, managedPath);
      expect(existsSync(managedFilePath)).toBe(true);

      rmSync(managedFilePath);

      const listed = await requestApp('GET', '/api/channel-accounts');
      expect(listed.status).toBe(200);
      expect(JSON.parse(listed.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            session: {
              hasSession: false,
              id: 'x:-promobot',
              status: 'missing',
              validatedAt: '2026-04-20T12:34:56.000Z',
              storageStatePath: managedPath,
              notes: 'managed import',
            },
          }),
        ],
      });

      const testResponse = await requestApp('POST', '/api/channel-accounts/1/test');
      expect(testResponse.status).toBe(200);
      expect(JSON.parse(testResponse.body)).toEqual({
        ok: true,
        test: {
          checkedAt: expect.any(String),
          status: 'needs_session',
          summary: '需要登录会话',
          message: 'X 浏览器 session 缺失，请先登录并保存 session 元数据。',
          action: 'request_session',
          nextStep: '/api/channel-accounts/1/session',
          details: {
            ready: false,
            mode: 'browser',
            authType: 'browser',
            session: {
              hasSession: false,
              id: 'x:-promobot',
              status: 'missing',
              validatedAt: '2026-04-20T12:34:56.000Z',
              storageStatePath: managedPath,
              notes: 'managed import',
            },
          },
        },
        channelAccount: expect.objectContaining({
          id: 1,
          session: {
            hasSession: false,
            id: 'x:-promobot',
            status: 'missing',
            validatedAt: '2026-04-20T12:34:56.000Z',
            storageStatePath: managedPath,
            notes: 'managed import',
          },
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('enqueues traceable session-request jobs for request-session and relogin actions', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const jobQueueStore = createJobQueueStore();

      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const requestSessionResponse = await requestApp(
        'POST',
        '/api/channel-accounts/1/session/request',
      );

      expect(requestSessionResponse.status).toBe(200);
      const requestSessionBody = JSON.parse(requestSessionResponse.body) as {
        ok: boolean;
        job: {
          id: number;
          type: string;
          status: string;
          attempts: number;
          runAt: string;
          payload: {
            accountId: number;
            platform: string;
            accountKey: string;
            action: string;
          };
        };
        sessionAction: {
          action: string;
          accountId: number;
          status: string;
          requestedAt: string;
          message: string;
          nextStep: string;
          jobId: number;
          jobStatus: string;
          artifactPath: string;
        };
        channelAccount: { id: number };
      };

      expect(requestSessionBody).toEqual({
        ok: true,
        job: {
          id: expect.any(Number),
          type: 'channel_account_session_request',
          status: 'pending',
          attempts: 0,
          runAt: expect.any(String),
          payload: {
            accountId: 1,
            platform: 'x',
            accountKey: '@promobot',
            action: 'request_session',
          },
        },
        sessionAction: {
          action: 'request_session',
          accountId: 1,
          status: 'pending',
          requestedAt: expect.any(String),
          message: 'Browser session request queued. Complete login manually and attach session metadata after the browser lane picks up the job.',
          nextStep: '/api/channel-accounts/1/session',
          jobId: expect.any(Number),
          jobStatus: 'pending',
          artifactPath:
            'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.json',
        },
        channelAccount: expect.objectContaining({
          id: 1,
        }),
      });

      expect(requestSessionBody.sessionAction.jobId).toBe(requestSessionBody.job.id);
      expect(requestSessionBody.sessionAction.requestedAt).toBe(requestSessionBody.job.runAt);
      expect(
        existsSync(path.join(rootDir, requestSessionBody.sessionAction.artifactPath)),
      ).toBe(true);
      expect(
        JSON.parse(
          readFileSync(
            path.join(rootDir, requestSessionBody.sessionAction.artifactPath),
            'utf8',
          ),
        ),
      ).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: requestSessionBody.job.runAt,
        jobId: requestSessionBody.job.id,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });

      const listedAfterRequest = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listedAfterRequest.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            latestBrowserLaneArtifact: expect.objectContaining({
              channelAccountId: 1,
              platform: 'x',
              accountKey: '@promobot',
              action: 'request_session',
              jobStatus: 'pending',
              requestedAt: requestSessionBody.job.runAt,
              artifactPath:
                'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.json',
              resolvedAt: null,
            }),
          }),
        ],
      });

      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          id: requestSessionBody.job.id,
          type: 'channel_account_session_request',
          status: 'pending',
          attempts: 0,
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        accountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/x-promobot.json');

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        status: 'expired',
      });

      const reloginResponse = await requestApp('POST', '/api/channel-accounts/1/session/request', {
        action: 'relogin',
      });

      expect(reloginResponse.status).toBe(200);
      const reloginBody = JSON.parse(reloginResponse.body) as {
        ok: boolean;
        job: {
          id: number;
          type: string;
          status: string;
          attempts: number;
          runAt: string;
          payload: {
            accountId: number;
            platform: string;
            accountKey: string;
            action: string;
          };
        };
        sessionAction: {
          action: string;
          accountId: number;
          status: string;
          requestedAt: string;
          message: string;
          nextStep: string;
          jobId: number;
          jobStatus: string;
          artifactPath: string;
        };
        channelAccount: { id: number };
      };

      expect(reloginBody).toEqual({
        ok: true,
        job: {
          id: expect.any(Number),
          type: 'channel_account_session_request',
          status: 'pending',
          attempts: 0,
          runAt: expect.any(String),
          payload: {
            accountId: 1,
            platform: 'x',
            accountKey: '@promobot',
            action: 'relogin',
          },
        },
        sessionAction: {
          action: 'relogin',
          accountId: 1,
          status: 'pending',
          requestedAt: expect.any(String),
          message: 'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
          nextStep: '/api/channel-accounts/1/session',
          jobId: expect.any(Number),
          jobStatus: 'pending',
          artifactPath: 'artifacts/browser-lane-requests/x/-promobot/relogin-job-2.json',
        },
        channelAccount: expect.objectContaining({
          id: 1,
        }),
      });

      expect(reloginBody.job.id).not.toBe(requestSessionBody.job.id);
      expect(reloginBody.sessionAction.jobId).toBe(reloginBody.job.id);
      expect(reloginBody.sessionAction.requestedAt).toBe(reloginBody.job.runAt);
      expect(existsSync(path.join(rootDir, reloginBody.sessionAction.artifactPath))).toBe(true);
      expect(
        JSON.parse(
          readFileSync(path.join(rootDir, reloginBody.sessionAction.artifactPath), 'utf8'),
        ),
      ).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'relogin',
        requestedAt: reloginBody.job.runAt,
        jobId: reloginBody.job.id,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });

      const queuedJobs = jobQueueStore.list({ limit: 10 });
      expect(queuedJobs).toHaveLength(2);
      expect(queuedJobs).toEqual([
        expect.objectContaining({
          id: requestSessionBody.job.id,
          type: 'channel_account_session_request',
          status: 'pending',
        }),
        expect.objectContaining({
          id: reloginBody.job.id,
          type: 'channel_account_session_request',
          status: 'pending',
        }),
      ]);
      expect(queuedJobs.map((job) => JSON.parse(job.payload))).toEqual([
        {
          accountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
        },
        {
          accountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'relogin',
        },
      ]);
      expect(reloginBody.channelAccount).toEqual(
        expect.objectContaining({
          id: 1,
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('marks browser lane request artifacts as resolved after session metadata is saved', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const requestSessionResponse = await requestApp('POST', '/api/channel-accounts/1/session/request');
      const requestSessionBody = JSON.parse(requestSessionResponse.body) as {
        sessionAction: {
          artifactPath: string;
        };
      };
      const artifactAbsolutePath = path.join(rootDir, requestSessionBody.sessionAction.artifactPath);

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/x-promobot.json');

      const saveResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        status: 'active',
        validatedAt: '2026-04-20T12:34:56.000Z',
      });

      expect(saveResponse.status).toBe(200);
      expect(JSON.parse(readFileSync(artifactAbsolutePath, 'utf8'))).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: expect.any(String),
        jobId: 1,
        jobStatus: 'resolved',
        nextStep: '/api/channel-accounts/1/session',
        resolvedAt: expect.any(String),
        resolution: {
          status: 'resolved',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: '2026-04-20T12:34:56.000Z',
            storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
          },
        },
        savedStorageStatePath: 'artifacts/browser-sessions/x-promobot.json',
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('marks related browser-lane request artifacts as resolved after saving a session', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const requestSessionResponse = await requestApp(
        'POST',
        '/api/channel-accounts/1/session/request',
      );
      expect(requestSessionResponse.status).toBe(200);

      const requestSessionBody = JSON.parse(requestSessionResponse.body) as {
        sessionAction: {
          artifactPath: string;
        };
      };

      const savedStorageStatePath = 'artifacts/browser-sessions/x-promobot.json';
      writeStorageStateFile(rootDir, savedStorageStatePath);

      const saveSessionResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: savedStorageStatePath,
        status: 'expired',
      });

      expect(saveSessionResponse.status).toBe(200);
      expect(
        JSON.parse(
          readFileSync(path.join(rootDir, requestSessionBody.sessionAction.artifactPath), 'utf8'),
        ),
      ).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: expect.any(String),
        jobId: expect.any(Number),
        jobStatus: 'resolved',
        nextStep: '/api/channel-accounts/1/session',
        resolvedAt: expect.any(String),
        resolution: {
          status: 'resolved',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'expired',
            validatedAt: null,
            storageStatePath: savedStorageStatePath,
          },
        },
        savedStorageStatePath,
      });

      const reloginResponse = await requestApp('POST', '/api/channel-accounts/1/session/request', {
        action: 'relogin',
      });
      expect(reloginResponse.status).toBe(200);

      const reloginBody = JSON.parse(reloginResponse.body) as {
        sessionAction: {
          artifactPath: string;
        };
      };

      const refreshedStorageStatePath = 'artifacts/browser-sessions/x-promobot-refreshed.json';
      writeStorageStateFile(rootDir, refreshedStorageStatePath);

      const refreshSessionResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: refreshedStorageStatePath,
        status: 'active',
      });

      expect(refreshSessionResponse.status).toBe(200);
      expect(
        JSON.parse(readFileSync(path.join(rootDir, reloginBody.sessionAction.artifactPath), 'utf8')),
      ).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'relogin',
        requestedAt: expect.any(String),
        jobId: expect.any(Number),
        jobStatus: 'resolved',
        nextStep: '/api/channel-accounts/1/session',
        resolvedAt: expect.any(String),
        resolution: {
          status: 'resolved',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: null,
            storageStatePath: refreshedStorageStatePath,
          },
        },
        savedStorageStatePath: refreshedStorageStatePath,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('closes the browser-lane artifact loop from request-session to saved session', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const requestSessionResponse = await requestApp(
        'POST',
        '/api/channel-accounts/1/session/request',
      );
      expect(requestSessionResponse.status).toBe(200);

      const requestSessionBody = JSON.parse(requestSessionResponse.body) as {
        job: {
          id: number;
          status: string;
          runAt: string;
          payload: {
            accountId: number;
            platform: string;
            accountKey: string;
            action: 'request_session';
          };
        };
        sessionAction: {
          artifactPath: string;
        };
      };

      const storageStatePath = 'artifacts/browser-sessions/x-promobot-resolved.json';
      writeStorageStateFile(rootDir, storageStatePath);

      expect(
        JSON.parse(
          readFileSync(path.join(rootDir, requestSessionBody.sessionAction.artifactPath), 'utf8'),
        ),
      ).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: requestSessionBody.job.runAt,
        jobId: requestSessionBody.job.id,
        jobStatus: requestSessionBody.job.status,
        nextStep: '/api/channel-accounts/1/session',
      });

      const saveSessionResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath,
        status: 'active',
        validatedAt: '2026-04-21T08:00:00.000Z',
        notes: 'browser lane completed',
      });

      expect(saveSessionResponse.status).toBe(200);
      expect(JSON.parse(saveSessionResponse.body)).toEqual({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:-promobot',
          status: 'active',
          validatedAt: '2026-04-21T08:00:00.000Z',
          storageStatePath,
          notes: 'browser lane completed',
        },
        channelAccount: expect.objectContaining({
          id: 1,
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: '2026-04-21T08:00:00.000Z',
            storageStatePath,
            notes: 'browser lane completed',
          },
        }),
      });

      expect(
        JSON.parse(
          readFileSync(path.join(rootDir, requestSessionBody.sessionAction.artifactPath), 'utf8'),
        ),
      ).toEqual({
        type: 'browser_lane_request',
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: requestSessionBody.job.runAt,
        jobId: requestSessionBody.job.id,
        jobStatus: 'resolved',
        nextStep: '/api/channel-accounts/1/session',
        resolvedAt: expect.any(String),
        resolution: {
          status: 'resolved',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: '2026-04-21T08:00:00.000Z',
            storageStatePath,
            notes: 'browser lane completed',
          },
        },
        savedStorageStatePath: storageStatePath,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns the latest browser-lane artifact summary in request, save, and list responses', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });

      const requestSessionResponse = await requestApp(
        'POST',
        '/api/channel-accounts/1/session/request',
      );
      expect(requestSessionResponse.status).toBe(200);

      const requestSessionBody = JSON.parse(requestSessionResponse.body) as {
        job: {
          runAt: string;
        };
        sessionAction: {
          artifactPath: string;
        };
        channelAccount: {
          latestBrowserLaneArtifact: {
            action: string;
            jobStatus: string;
            requestedAt: string;
            artifactPath: string;
            resolvedAt: string | null;
          } | null;
        };
      };

      expect(requestSessionBody.channelAccount.latestBrowserLaneArtifact).toEqual(
        expect.objectContaining({
          channelAccountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          jobStatus: 'pending',
          requestedAt: requestSessionBody.job.runAt,
          artifactPath: requestSessionBody.sessionAction.artifactPath,
          resolvedAt: null,
        }),
      );

      const initialStorageStatePath = 'artifacts/browser-sessions/x-promobot.json';
      writeStorageStateFile(rootDir, initialStorageStatePath);

      const saveResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: initialStorageStatePath,
        status: 'active',
      });
      expect(saveResponse.status).toBe(200);

      const saveBody = JSON.parse(saveResponse.body) as {
        channelAccount: {
          latestBrowserLaneArtifact: {
            action: string;
            jobStatus: string;
            requestedAt: string;
            artifactPath: string;
            resolvedAt: string | null;
          } | null;
        };
      };

      expect(saveBody.channelAccount.latestBrowserLaneArtifact).toEqual(
        expect.objectContaining({
          channelAccountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          jobStatus: 'resolved',
          requestedAt: requestSessionBody.job.runAt,
          artifactPath: requestSessionBody.sessionAction.artifactPath,
          resolvedAt: expect.any(String),
          resolution: {
            status: 'resolved',
            session: expect.objectContaining({
              hasSession: true,
              id: 'x:-promobot',
              status: 'active',
              storageStatePath: initialStorageStatePath,
            }),
          },
        }),
      );

      const reloginResponse = await requestApp('POST', '/api/channel-accounts/1/session/request', {
        action: 'relogin',
      });
      expect(reloginResponse.status).toBe(200);

      const reloginBody = JSON.parse(reloginResponse.body) as {
        job: {
          runAt: string;
        };
        sessionAction: {
          artifactPath: string;
        };
        channelAccount: {
          latestBrowserLaneArtifact: {
            action: string;
            jobStatus: string;
            requestedAt: string;
            artifactPath: string;
            resolvedAt: string | null;
          } | null;
        };
      };

      expect(reloginBody.channelAccount.latestBrowserLaneArtifact).toEqual(
        expect.objectContaining({
          channelAccountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'relogin',
          jobStatus: 'pending',
          requestedAt: reloginBody.job.runAt,
          artifactPath: reloginBody.sessionAction.artifactPath,
          resolvedAt: null,
        }),
      );

      const listedResponse = await requestApp('GET', '/api/channel-accounts');
      expect(listedResponse.status).toBe(200);
      expect(JSON.parse(listedResponse.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            latestBrowserLaneArtifact: expect.objectContaining({
              channelAccountId: 1,
              platform: 'x',
              accountKey: '@promobot',
              action: 'relogin',
              jobStatus: 'pending',
              requestedAt: reloginBody.job.runAt,
              artifactPath: reloginBody.sessionAction.artifactPath,
              resolvedAt: null,
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns the latest browser-handoff artifact summary in channel account list responses', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
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
        path.join(handoffDir, 'facebookGroup-draft-21.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '21',
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
        path.join(handoffDir, 'facebookGroup-draft-22.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'obsolete',
          platform: 'facebookGroup',
          draftId: '22',
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

      const listedResponse = await requestApp('GET', '/api/channel-accounts');
      expect(listedResponse.status).toBe(200);
      expect(JSON.parse(listedResponse.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            latestBrowserHandoffArtifact: {
              ownership: 'direct',
              channelAccountId: 1,
              accountDisplayName: 'PromoBot FB Group',
              platform: 'facebookGroup',
              draftId: '22',
              title: 'Stale handoff',
              accountKey: 'launch-campaign',
              status: 'obsolete',
              artifactPath:
                'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-22.json',
              createdAt: '2026-04-21T09:10:00.000Z',
              updatedAt: '2026-04-21T09:20:00.000Z',
              resolvedAt: '2026-04-21T09:20:00.000Z',
              resolution: {
                status: 'obsolete',
                reason: 'relogin',
              },
            },
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('normalizes facebook-group channel accounts when resolving latest browser-handoff artifacts', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebook-group',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
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
        path.join(handoffDir, 'facebookGroup-draft-23.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '23',
          title: 'Alias handoff',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T10:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T10:00:00.000Z',
          updatedAt: '2026-04-21T10:00:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const listedResponse = await requestApp('GET', '/api/channel-accounts');
      expect(listedResponse.status).toBe(200);
      expect(JSON.parse(listedResponse.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            platform: 'facebook-group',
            latestBrowserHandoffArtifact: expect.objectContaining({
              platform: 'facebookGroup',
              draftId: '23',
              artifactPath:
                'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-23.json',
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('shares the same browser session namespace for facebook-group and facebookGroup aliases', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebook-group',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'healthy',
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/facebook-group.json');

      const saveResponse = await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        status: 'active',
        validatedAt: '2026-04-21T11:00:00.000Z',
      });
      expect(saveResponse.status).toBe(200);

      const listedResponse = await requestApp('GET', '/api/channel-accounts');
      expect(listedResponse.status).toBe(200);
      expect(JSON.parse(listedResponse.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            platform: 'facebook-group',
            session: {
              hasSession: true,
              id: 'facebookGroup:launch-campaign',
              status: 'active',
              validatedAt: '2026-04-21T11:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
            },
            publishReadiness: expect.objectContaining({
              platform: 'facebookGroup',
              ready: true,
              status: 'ready',
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('prefers channelAccountId when multiple channel accounts share the same handoff key', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group 11',
        authType: 'browser',
        status: 'healthy',
      });
      await requestApp('POST', '/api/channel-accounts', {
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group 22',
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
        path.join(handoffDir, 'facebookGroup-draft-24.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          channelAccountId: 2,
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '24',
          title: 'Scoped handoff',
          content: 'Need handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T10:30:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T10:30:00.000Z',
          updatedAt: '2026-04-21T10:30:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const listedResponse = await requestApp('GET', '/api/channel-accounts');
      expect(listedResponse.status).toBe(200);
      expect(JSON.parse(listedResponse.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            latestBrowserHandoffArtifact: null,
          }),
          expect.objectContaining({
            id: 2,
            latestBrowserHandoffArtifact: expect.objectContaining({
              ownership: 'direct',
              channelAccountId: 2,
              draftId: '24',
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('infers browser handoff ownership from draft projectId when channelAccountId is missing', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        projectId: 11,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group 11',
        authType: 'browser',
        status: 'healthy',
      });
      await requestApp('POST', '/api/channel-accounts', {
        projectId: 22,
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group 22',
        authType: 'browser',
        status: 'healthy',
      });
      const draftStore = createSQLiteDraftStore();
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
            validatedAt: '2026-04-21T10:30:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T10:30:00.000Z',
          updatedAt: '2026-04-21T10:30:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const listedResponse = await requestApp('GET', '/api/channel-accounts');
      expect(listedResponse.status).toBe(200);
      expect(JSON.parse(listedResponse.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            id: 1,
            latestBrowserHandoffArtifact: null,
          }),
          expect.objectContaining({
            id: 2,
            latestBrowserHandoffArtifact: expect.objectContaining({
              ownership: 'draft_project',
              channelAccountId: 2,
              draftId: '1',
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('adds facebookGroup publish readiness based on browser session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'facebookGroup',
        accountKey: 'launch-campaign',
        displayName: 'PromoBot FB Group',
        authType: 'browser',
        status: 'healthy',
      });

      const listedBeforeSession = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listedBeforeSession.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            publishReadiness: expect.objectContaining({
              platform: 'facebookGroup',
              ready: false,
              status: 'needs_session',
              action: 'request_session',
            }),
          }),
        ],
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/facebook-group.json');

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        status: 'active',
      });

      const listedAfterSession = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listedAfterSession.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            publishReadiness: expect.objectContaining({
              platform: 'facebookGroup',
              ready: true,
              status: 'ready',
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('adds xiaohongshu and weibo publish readiness based on browser session state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'xiaohongshu',
        accountKey: 'xhs-main',
        displayName: 'PromoBot XHS',
        authType: 'browser',
        status: 'healthy',
      });
      await requestApp('POST', '/api/channel-accounts', {
        platform: 'weibo',
        accountKey: 'weibo-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });

      const listedBeforeSession = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listedBeforeSession.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            publishReadiness: expect.objectContaining({
              platform: 'xiaohongshu',
              ready: false,
              status: 'needs_session',
              action: 'request_session',
            }),
          }),
          expect.objectContaining({
            publishReadiness: expect.objectContaining({
              platform: 'weibo',
              ready: false,
              status: 'needs_session',
              action: 'request_session',
            }),
          }),
        ],
      });

      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/xiaohongshu.json');
      writeStorageStateFile(rootDir, 'artifacts/browser-sessions/weibo.json');

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
        status: 'active',
      });
      await requestApp('POST', '/api/channel-accounts/2/session', {
        storageStatePath: 'artifacts/browser-sessions/weibo.json',
        status: 'expired',
      });

      const listedAfterSession = await requestApp('GET', '/api/channel-accounts');
      expect(JSON.parse(listedAfterSession.body)).toEqual({
        channelAccounts: [
          expect.objectContaining({
            publishReadiness: expect.objectContaining({
              platform: 'xiaohongshu',
              ready: true,
              status: 'ready',
            }),
          }),
          expect.objectContaining({
            publishReadiness: expect.objectContaining({
              platform: 'weibo',
              ready: false,
              status: 'needs_relogin',
              action: 'relogin',
            }),
          }),
        ],
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
