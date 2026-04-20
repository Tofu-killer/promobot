import express from 'express';
import { describe, expect, it } from 'vitest';
import { channelAccountsRouter } from '../../src/server/routes/channelAccounts';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

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
          metadata: expect.objectContaining({
            session: expect.objectContaining({
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-19T12:34:56.000Z',
              storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
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

  it('returns a placeholder contract for request-session and relogin actions', async () => {
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
      expect(JSON.parse(requestSessionResponse.body)).toEqual({
        ok: true,
        sessionAction: {
          action: 'request_session',
          accountId: 1,
          status: 'pending',
          requestedAt: expect.any(String),
          message:
            'Browser session capture is not wired yet. Complete login manually and attach session metadata.',
          nextStep: '/api/channel-accounts/1/session',
        },
        channelAccount: expect.objectContaining({
          id: 1,
        }),
      });

      await requestApp('POST', '/api/channel-accounts/1/session', {
        storageStatePath: 'artifacts/browser-sessions/x-promobot.json',
        status: 'expired',
      });

      const reloginResponse = await requestApp('POST', '/api/channel-accounts/1/session/request', {
        action: 'relogin',
      });

      expect(reloginResponse.status).toBe(200);
      expect(JSON.parse(reloginResponse.body)).toEqual({
        ok: true,
        sessionAction: {
          action: 'relogin',
          accountId: 1,
          status: 'pending',
          requestedAt: expect.any(String),
          message:
            'Browser relogin is not wired yet. Refresh the login manually and attach updated session metadata.',
          nextStep: '/api/channel-accounts/1/session',
        },
        channelAccount: expect.objectContaining({
          id: 1,
        }),
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
});
