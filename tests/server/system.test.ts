import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createSchedulerRuntime } from '../../src/server/runtime/schedulerRuntime';
import {
  createSessionRequestArtifact,
  getSessionRequestResultArtifact,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const defaultStorageState = {
  cookies: [],
  origins: [],
};

async function requestExistingApp(
  app: ReturnType<typeof createApp>,
  options: {
    headers?: Record<string, string>;
    remoteAddress?: string;
    method?: string;
    url: string;
    body?: unknown;
  },
) {
  const appendChunk = (body: string, chunk?: string | Uint8Array) => {
    if (chunk === undefined) {
      return body;
    }

    return body + (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  };

  return await new Promise<{ status: number; body: string; headers: Record<string, string> }>((resolve, reject) => {
    const req = Object.assign(Object.create(app.request), {
      app,
      method: options.method ?? 'GET',
      url: options.url,
      originalUrl: options.url,
      headers: options.headers ?? { 'x-admin-password': 'secret' },
      socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
      connection: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    });

    let body = '';
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
      write(chunk: string | Uint8Array) {
        body = appendChunk(body, chunk);
        return true;
      },
      end(chunk?: string | Uint8Array) {
        body = appendChunk(body, chunk);
        resolve({
          status: this.statusCode,
          body,
          headers: Object.fromEntries(responseHeaders),
        });
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

    if (options.body !== undefined) {
      req.body = options.body;
    }

    let settled = false;
    const finish = (result: { status: number; body: string; headers: Record<string, string> }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    res.end = (chunk?: string | Uint8Array) => {
      body = appendChunk(body, chunk);
      finish({
        status: res.statusCode,
        body,
        headers: Object.fromEntries(responseHeaders),
      });
      return res;
    };

    app.handle(req, res, (error?: unknown) => {
      if (settled) return;
      if (error) {
        settled = true;
        reject(error);
        return;
      }
      finish({ status: 404, body, headers: Object.fromEntries(responseHeaders) });
    });
  });
}

async function requestApp(options: {
  headers?: Record<string, string>;
  remoteAddress: string;
  method?: string;
  url?: string;
  body?: unknown;
  dependencies?: Parameters<typeof createApp>[1];
}) {
  const app = createApp({
    allowedIps: ['127.0.0.1'],
    adminPassword: 'secret',
  }, options.dependencies);

  return await requestExistingApp(app, {
    headers: options.headers,
    remoteAddress: options.remoteAddress,
    method: options.method,
    url: options.url ?? '/api/system/health',
    body: options.body,
  });
}

function readSessionCookie(response: { headers: Record<string, string> }) {
  const setCookieHeader = response.headers['set-cookie'] ?? '';
  const match = setCookieHeader.match(/promobot_admin_session=([^;]+)/);
  return match ? `promobot_admin_session=${match[1]}` : null;
}

function createClientBuildFixture() {
  const clientDistPath = fs.mkdtempSync(path.join(os.tmpdir(), 'promobot-client-dist-'));
  const indexHtml = '<!doctype html><html><body><div id="app">PromoBot SPA</div></body></html>';
  const assetPath = path.join(clientDistPath, 'assets');

  fs.mkdirSync(assetPath, { recursive: true });
  fs.writeFileSync(path.join(clientDistPath, 'index.html'), indexHtml, 'utf8');
  fs.writeFileSync(path.join(assetPath, 'app.js'), 'console.log("promobot-client");\n', 'utf8');

  return {
    clientDistPath,
    indexHtml,
    cleanup() {
      fs.rmSync(clientDistPath, { recursive: true, force: true });
    },
  };
}

const activeClientBuildFixtures = new Set<{ cleanup: () => void }>();

afterEach(() => {
  for (const fixture of activeClientBuildFixtures) {
    fixture.cleanup();
  }
  activeClientBuildFixtures.clear();
});

describe('bootstrap', () => {
  it('loads the app entry module', async () => {
    const mod = await import('../../src/server/app');
    expect(mod.createApp).toBeTypeOf('function');
  });

  it('keeps server and client build outputs separate', () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.resolve('tsconfig.json'), 'utf8')) as {
      compilerOptions?: { outDir?: string; rootDir?: string };
      include?: string[];
    };
    const viteConfig = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8');

    expect(tsconfig.compilerOptions?.outDir).toBe('dist/server');
    expect(tsconfig.compilerOptions?.rootDir).toBe('src/server');
    expect(tsconfig.include).toEqual(['src/server/**/*.ts']);
    expect(viteConfig).toContain("outDir: 'dist/client'");
  });

  it('starts without pm2', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: { start?: string };
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts?.start).toBe('node dist/server/index.js');
    expect(packageJson.devDependencies?.pm2).toBeUndefined();
  });
});

describe('security middleware', () => {
  it('serves the health endpoint to allowed LAN IPs', async () => {
    const response = await requestApp({ remoteAddress: '127.0.0.1' });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      service: 'promobot',
      timestamp: expect.any(String),
      uptimeSeconds: expect.any(Number),
      scheduler: {
        available: false,
        started: false,
      },
    });
  });

  it('rejects requests from disallowed IPs', async () => {
    const response = await requestApp({ remoteAddress: '10.10.10.10' });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'forbidden' });
  });

  it('applies allowlist changes from settings to the running middleware immediately', async () => {
    const { rootDir } = createTestDatabasePath();
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    try {
      const updated = await requestExistingApp(app, {
        method: 'PATCH',
        url: '/api/settings',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
        body: {
          allowlist: ['10.0.0.0/24'],
        },
      });

      expect(updated.status).toBe(200);

      const blockedAfterSave = await requestExistingApp(app, {
        remoteAddress: '127.0.0.1',
        url: '/api/system/health',
      });

      expect(blockedAfterSave.status).toBe(403);
      expect(JSON.parse(blockedAfterSave.body)).toEqual({ error: 'forbidden' });

      const allowedInSubnet = await requestExistingApp(app, {
        remoteAddress: '10.0.0.88',
        url: '/api/system/health',
      });

      expect(allowedInSubnet.status).toBe(200);
      expect(JSON.parse(allowedInSubnet.body)).toEqual({
        ok: true,
        service: 'promobot',
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
        scheduler: {
          available: false,
          started: false,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('applies persisted allowlist changes across app instances that share the same SQLite settings', async () => {
    const { rootDir } = createTestDatabasePath();
    const firstApp = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });
    const secondApp = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    try {
      const updated = await requestExistingApp(firstApp, {
        method: 'PATCH',
        url: '/api/settings',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
        body: {
          allowlist: ['10.1.0.0/24'],
        },
      });

      expect(updated.status).toBe(200);

      const blockedOnSecondApp = await requestExistingApp(secondApp, {
        remoteAddress: '127.0.0.1',
        url: '/api/system/health',
      });
      expect(blockedOnSecondApp.status).toBe(403);
      expect(JSON.parse(blockedOnSecondApp.body)).toEqual({ error: 'forbidden' });

      const allowedOnSecondApp = await requestExistingApp(secondApp, {
        remoteAddress: '10.1.0.55',
        url: '/api/system/health',
      });
      expect(allowedOnSecondApp.status).toBe(200);
      expect(JSON.parse(allowedOnSecondApp.body)).toEqual({
        ok: true,
        service: 'promobot',
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
        scheduler: {
          available: false,
          started: false,
        },
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects protected api routes when the admin password header is missing', async () => {
    const response = await requestApp({
      headers: {},
      remoteAddress: '127.0.0.1',
      url: '/api/settings',
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'unauthorized' });
  });

  it('treats malformed admin session cookies as unauthorized instead of crashing', async () => {
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    const response = await requestExistingApp(app, {
      headers: {
        cookie: 'promobot_admin_session=%',
      },
      remoteAddress: '127.0.0.1',
      url: '/api/settings',
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'unauthorized' });
  });

  it('rejects the auth probe when the admin password header is missing', async () => {
    const response = await requestApp({
      headers: {},
      remoteAddress: '127.0.0.1',
      url: '/api/auth/probe',
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'unauthorized' });
  });

  it('allows protected api routes when the admin password header matches', async () => {
    const response = await requestApp({
      headers: {
        'x-admin-password': 'secret',
      },
      remoteAddress: '127.0.0.1',
      url: '/api/settings',
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      settings: expect.objectContaining({
        allowlist: ['127.0.0.1'],
      }),
      platforms: expect.any(Array),
    });
  });

  it('allows the auth probe when the admin password header matches', async () => {
    const response = await requestApp({
      headers: {
        'x-admin-password': 'secret',
      },
      remoteAddress: '127.0.0.1',
      url: '/api/auth/probe',
      method: 'GET',
    });

    expect(response.status).toBe(204);
    expect(response.body).toBe('');
  });

  it('creates an admin session cookie on login and accepts subsequent cookie-authenticated requests', async () => {
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    const loginResponse = await requestExistingApp(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
      },
      remoteAddress: '127.0.0.1',
      body: {
        password: 'secret',
        remember: true,
      },
    });

    expect(loginResponse.status).toBe(204);
    expect(loginResponse.headers['set-cookie']).toContain('promobot_admin_session=');
    expect(loginResponse.headers['set-cookie']).toContain('HttpOnly');
    expect(loginResponse.headers['set-cookie']).toContain('SameSite=Lax');
    expect(loginResponse.headers['set-cookie']).toContain('Max-Age=');

    const sessionCookie = readSessionCookie(loginResponse);
    expect(sessionCookie).not.toBeNull();

    const probeResponse = await requestExistingApp(app, {
      method: 'GET',
      url: '/api/auth/probe',
      headers: {
        cookie: sessionCookie ?? '',
      },
      remoteAddress: '127.0.0.1',
    });
    expect(probeResponse.status).toBe(204);

    const protectedResponse = await requestExistingApp(app, {
      method: 'GET',
      url: '/api/settings',
      headers: {
        cookie: sessionCookie ?? '',
      },
      remoteAddress: '127.0.0.1',
    });
    expect(protectedResponse.status).toBe(200);
    expect(JSON.parse(protectedResponse.body)).toEqual({
      settings: expect.objectContaining({
        allowlist: ['127.0.0.1'],
      }),
      platforms: expect.any(Array),
    });
  });

  it('persists admin sessions across app instances and revokes them globally on logout', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const firstApp = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const loginResponse = await requestExistingApp(firstApp, {
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
        },
        remoteAddress: '127.0.0.1',
        body: {
          password: 'secret',
          remember: true,
        },
      });

      expect(loginResponse.status).toBe(204);
      const sessionCookie = readSessionCookie(loginResponse);
      expect(sessionCookie).not.toBeNull();

      const secondApp = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const probeOnSecondApp = await requestExistingApp(secondApp, {
        method: 'GET',
        url: '/api/auth/probe',
        headers: {
          cookie: sessionCookie ?? '',
        },
        remoteAddress: '127.0.0.1',
      });
      expect(probeOnSecondApp.status).toBe(204);

      const settingsOnSecondApp = await requestExistingApp(secondApp, {
        method: 'GET',
        url: '/api/settings',
        headers: {
          cookie: sessionCookie ?? '',
        },
        remoteAddress: '127.0.0.1',
      });
      expect(settingsOnSecondApp.status).toBe(200);

      const logoutOnSecondApp = await requestExistingApp(secondApp, {
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: sessionCookie ?? '',
        },
        remoteAddress: '127.0.0.1',
      });
      expect(logoutOnSecondApp.status).toBe(204);

      const thirdApp = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const probeOnThirdApp = await requestExistingApp(thirdApp, {
        method: 'GET',
        url: '/api/auth/probe',
        headers: {
          cookie: sessionCookie ?? '',
        },
        remoteAddress: '127.0.0.1',
      });
      expect(probeOnThirdApp.status).toBe(401);
      expect(JSON.parse(probeOnThirdApp.body)).toEqual({ error: 'unauthorized' });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('invalidates persisted admin sessions when ADMIN_PASSWORD changes', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const firstApp = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const loginResponse = await requestExistingApp(firstApp, {
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
        },
        remoteAddress: '127.0.0.1',
        body: {
          password: 'secret',
          remember: true,
        },
      });

      expect(loginResponse.status).toBe(204);
      const sessionCookie = readSessionCookie(loginResponse);
      expect(sessionCookie).not.toBeNull();

      const secondApp = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'new-secret',
      });

      const probeResponse = await requestExistingApp(secondApp, {
        method: 'GET',
        url: '/api/auth/probe',
        headers: {
          cookie: sessionCookie ?? '',
        },
        remoteAddress: '127.0.0.1',
      });

      expect(probeResponse.status).toBe(401);
      expect(JSON.parse(probeResponse.body)).toEqual({ error: 'unauthorized' });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects login when the password is invalid', async () => {
    const app = createApp({
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    });

    const response = await requestExistingApp(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
      },
      remoteAddress: '127.0.0.1',
      body: {
        password: 'wrong-secret',
        remember: false,
      },
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'unauthorized' });
  });
});

describe('system runtime api', () => {
  it('includes scheduler health details in the health endpoint when a scheduler runtime is wired in', async () => {
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          queue: {
            pending: 2,
            running: 1,
            failed: 0,
            duePending: 1,
          },
        };
      },
      listJobs() {
        return {
          jobs: [],
          queue: {
            pending: 2,
            running: 1,
            failed: 0,
            duePending: 1,
          },
          recentJobs: [],
        };
      },
      getJob() {
        return undefined;
      },
      reload() {
        return this.getStatus();
      },
      async tickNow() {
        return [];
      },
      enqueueJob() {
        throw new Error('not implemented');
      },
      stop() {},
    };

    const response = await requestApp({
      remoteAddress: '127.0.0.1',
      url: '/api/system/health',
      dependencies: { schedulerRuntime },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      service: 'promobot',
      timestamp: expect.any(String),
      uptimeSeconds: expect.any(Number),
      scheduler: {
        available: true,
        started: true,
        queue: {
          pending: 2,
          running: 1,
          failed: 0,
          duePending: 1,
        },
      },
    });
  });

  it('returns a runtime snapshot when a scheduler runtime is wired in', async () => {
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: '2026-04-19T12:00:00.000Z',
          lastTickAt: '2026-04-19T12:05:00.000Z',
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: ['publish'],
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 1,
          },
          recentJobs: [],
        };
      },
      listJobs(limit?: number) {
        return {
          jobs: [
            {
              id: 9,
              type: 'publish',
              payload: '{"draftId":42}',
              status: 'pending',
              runAt: '2026-04-19T12:06:00.000Z',
              attempts: 0,
              createdAt: '2026-04-19T12:06:00.000Z',
              updatedAt: '2026-04-19T12:06:00.000Z',
              canRetry: false,
              canCancel: true,
            },
          ].slice(0, limit ?? 50),
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 1,
          },
          recentJobs: [],
        };
      },
      getJob(jobId: number) {
        if (jobId !== 9) return undefined;
        return {
          id: 9,
          type: 'publish',
          payload: '{"draftId":42}',
          status: 'pending',
          runAt: '2026-04-19T12:06:00.000Z',
          attempts: 0,
          createdAt: '2026-04-19T12:06:00.000Z',
          updatedAt: '2026-04-19T12:06:00.000Z',
          canRetry: false,
          canCancel: true,
        };
      },
      reload() {
        return this.getStatus();
      },
      async tickNow() {
        return [{ jobId: 7, type: 'publish', outcome: 'completed' as const }];
      },
      enqueueJob() {
        return {
          id: 9,
          type: 'publish',
          payload: '{"draftId":42}',
          status: 'pending',
          runAt: '2026-04-19T12:06:00.000Z',
          attempts: 0,
          createdAt: '2026-04-19T12:06:00.000Z',
          updatedAt: '2026-04-19T12:06:00.000Z',
        };
      },
      stop() {},
    };

    const response = await requestApp({
      remoteAddress: '127.0.0.1',
      url: '/api/system/runtime',
      dependencies: { schedulerRuntime },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      runtime: expect.objectContaining({
        available: true,
        started: true,
        schedulerIntervalMinutes: 15,
        handlers: ['publish'],
        queue: expect.objectContaining({
          pending: 1,
          duePending: 1,
        }),
      }),
    });
  });

  it('reloads the scheduler runtime through /api/system/runtime/reload', async () => {
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: '2026-04-19T12:00:00.000Z',
          lastTickAt: '2026-04-19T12:05:00.000Z',
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: ['publish'],
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 1,
          },
          recentJobs: [],
        };
      },
      listJobs() {
        return {
          jobs: [],
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 1,
          },
          recentJobs: [],
        };
      },
      getJob() {
        return undefined;
      },
      reload() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 30,
          pollMs: 1800000,
          bootedAt: '2026-04-19T12:10:00.000Z',
          lastTickAt: '2026-04-19T12:15:00.000Z',
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: ['publish', 'monitor_fetch'],
          queue: {
            pending: 2,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 2,
          },
          recentJobs: [],
        };
      },
      async tickNow() {
        return [];
      },
      enqueueJob() {
        throw new Error('not implemented');
      },
      stop() {},
    };

    const response = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/runtime/reload',
      dependencies: { schedulerRuntime },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      runtime: expect.objectContaining({
        available: true,
        started: true,
        schedulerIntervalMinutes: 30,
        handlers: ['publish', 'monitor_fetch'],
        queue: expect.objectContaining({
          pending: 2,
          duePending: 2,
        }),
      }),
    });
  });

  it('returns 503 for /api/system/runtime/reload when the scheduler runtime is unavailable', async () => {
    const response = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/runtime/reload',
    });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      error: 'scheduler runtime unavailable',
    });
  });

  it('enqueues jobs through the scheduler runtime contract', async () => {
    const seen: Array<{ type: string; payload?: Record<string, unknown>; runAt: string }> = [];
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: null,
          lastTickAt: null,
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: [],
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      listJobs() {
        return {
          jobs: [],
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      getJob() {
        return undefined;
      },
      reload() {
        return this.getStatus();
      },
      async tickNow() {
        return [];
      },
      enqueueJob(input: { type: string; payload?: Record<string, unknown>; runAt: string }) {
        seen.push(input);
        return {
          id: 4,
          type: input.type,
          payload: JSON.stringify(input.payload ?? {}),
          status: 'pending',
          runAt: input.runAt,
          attempts: 0,
          createdAt: '2026-04-19T12:10:00.000Z',
          updatedAt: '2026-04-19T12:10:00.000Z',
        };
      },
      stop() {},
    };

    const response = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2026-04-19T12:10:00.000Z',
      },
      dependencies: { schedulerRuntime },
    });

    expect(response.status).toBe(201);
    expect(seen).toEqual([
      {
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2026-04-19T12:10:00.000Z',
      },
    ]);
    expect(JSON.parse(response.body)).toEqual({
      job: expect.objectContaining({
        id: 4,
        type: 'monitor_fetch',
        status: 'pending',
      }),
      runtime: expect.objectContaining({
        available: true,
      }),
    });
  });

  it('rejects system job creation when payload is not an object or runAt is invalid', async () => {
    const seen: Array<{ type: string; payload?: Record<string, unknown>; runAt: string }> = [];
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: null,
          lastTickAt: null,
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      listJobs() {
        return {
          jobs: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      getJob() {
        return undefined;
      },
      reload() {
        return this.getStatus();
      },
      async tickNow() {
        return [];
      },
      enqueueJob(input: { type: string; payload?: Record<string, unknown>; runAt: string }) {
        seen.push(input);
        return {
          id: 4,
          type: input.type,
          payload: JSON.stringify(input.payload ?? {}),
          status: 'pending',
          runAt: input.runAt,
          attempts: 0,
          createdAt: '2026-04-19T12:10:00.000Z',
          updatedAt: '2026-04-19T12:10:00.000Z',
        };
      },
      stop() {},
    };

    const invalidPayloadResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        payload: 'rss',
      },
      dependencies: { schedulerRuntime },
    });

    expect(invalidPayloadResponse.status).toBe(400);
    expect(JSON.parse(invalidPayloadResponse.body)).toEqual({
      error: 'invalid job payload',
    });

    const inheritedBody = Object.create({ type: 'monitor_fetch' });
    const nonPlainBodyResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: inheritedBody,
      dependencies: { schedulerRuntime },
    });

    expect(nonPlainBodyResponse.status).toBe(400);
    expect(JSON.parse(nonPlainBodyResponse.body)).toEqual({
      error: 'invalid job payload',
    });

    const invalidRunAtResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        runAt: 'not-a-date',
      },
      dependencies: { schedulerRuntime },
    });

    expect(invalidRunAtResponse.status).toBe(400);
    expect(JSON.parse(invalidRunAtResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    const nonStringRunAtResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        runAt: 123,
      },
      dependencies: { schedulerRuntime },
    });

    expect(nonStringRunAtResponse.status).toBe(400);
    expect(JSON.parse(nonStringRunAtResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    const calendarInvalidRunAtResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        runAt: '2026-02-31T09:00:00.000Z',
      },
      dependencies: { schedulerRuntime },
    });

    expect(calendarInvalidRunAtResponse.status).toBe(400);
    expect(JSON.parse(calendarInvalidRunAtResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    const calendarInvalidDateOnlyResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        runAt: '2026-02-31',
      },
      dependencies: { schedulerRuntime },
    });

    expect(calendarInvalidDateOnlyResponse.status).toBe(400);
    expect(JSON.parse(calendarInvalidDateOnlyResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    const calendarInvalidLocalDateTimeResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        runAt: '2026-02-31T09:00',
      },
      dependencies: { schedulerRuntime },
    });

    expect(calendarInvalidLocalDateTimeResponse.status).toBe(400);
    expect(JSON.parse(calendarInvalidLocalDateTimeResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    const calendarInvalidSpacedDateTimeResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs',
      body: {
        type: 'monitor_fetch',
        runAt: '2026-02-31 09:00',
      },
      dependencies: { schedulerRuntime },
    });

    expect(calendarInvalidSpacedDateTimeResponse.status).toBe(400);
    expect(JSON.parse(calendarInvalidSpacedDateTimeResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    expect(seen).toEqual([]);
  });

  it('lists, retries, and cancels jobs through the system api', async () => {
    const actions: string[] = [];
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: null,
          lastTickAt: null,
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: [],
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 1,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      listJobs(limit?: number) {
        actions.push(`list:${limit ?? 'default'}`);
        return {
          jobs: [
            {
              id: 11,
              type: 'publish',
              payload: '{"draftId":11}',
              status: 'failed',
              runAt: '2026-04-19T12:15:00.000Z',
              attempts: 1,
              lastError: 'boom',
              createdAt: '2026-04-19T12:14:00.000Z',
              updatedAt: '2026-04-19T12:15:00.000Z',
              canRetry: true,
              canCancel: false,
            },
          ].slice(0, limit ?? 50),
          queue: {
            pending: 1,
            running: 0,
            done: 0,
            failed: 1,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      getJob(jobId: number) {
        actions.push(`get:${jobId}`);
        if (jobId !== 11) return undefined;
        return {
          id: 11,
          type: 'publish',
          payload: '{"draftId":11}',
          status: 'failed',
          runAt: '2026-04-19T12:15:00.000Z',
          attempts: 1,
          lastError: 'boom',
          createdAt: '2026-04-19T12:14:00.000Z',
          updatedAt: '2026-04-19T12:15:00.000Z',
          canRetry: true,
          canCancel: false,
        };
      },
      reload() {
        return this.getStatus();
      },
      async tickNow() {
        return [];
      },
      enqueueJob() {
        throw new Error('not implemented');
      },
      retryJob(jobId: number, runAt?: string) {
        actions.push(`retry:${jobId}:${runAt ?? ''}`);
        if (jobId !== 11) return undefined;
        return {
          id: 11,
          type: 'publish',
          payload: '{"draftId":11}',
          status: 'pending',
          runAt: runAt ?? '2026-04-19T12:20:00.000Z',
          attempts: 1,
          createdAt: '2026-04-19T12:14:00.000Z',
          updatedAt: '2026-04-19T12:20:00.000Z',
          canRetry: false,
          canCancel: true,
        };
      },
      cancelJob(jobId: number) {
        actions.push(`cancel:${jobId}`);
        if (jobId !== 11) return undefined;
        return {
          id: 11,
          type: 'publish',
          payload: '{"draftId":11}',
          status: 'canceled',
          runAt: '2026-04-19T12:15:00.000Z',
          attempts: 1,
          finishedAt: '2026-04-19T12:21:00.000Z',
          createdAt: '2026-04-19T12:14:00.000Z',
          updatedAt: '2026-04-19T12:21:00.000Z',
          canRetry: true,
          canCancel: false,
        };
      },
      stop() {},
    };

    const listResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      url: '/api/system/jobs?limit=1',
      dependencies: { schedulerRuntime },
    });
    expect(listResponse.status).toBe(200);
    expect(JSON.parse(listResponse.body)).toEqual({
      jobs: [
        expect.objectContaining({
          id: 11,
          canRetry: true,
          canCancel: false,
        }),
      ],
      queue: expect.objectContaining({ failed: 1 }),
      recentJobs: [],
    });

    const detailResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      url: '/api/system/jobs/11',
      dependencies: { schedulerRuntime },
    });
    expect(detailResponse.status).toBe(200);
    expect(JSON.parse(detailResponse.body)).toEqual({
      job: expect.objectContaining({ id: 11, status: 'failed' }),
    });

    const retryResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs/11/retry',
      body: { runAt: '2026-04-19T12:20:00.000Z' },
      dependencies: { schedulerRuntime },
    });
    expect(retryResponse.status).toBe(200);
    expect(JSON.parse(retryResponse.body)).toEqual({
      job: expect.objectContaining({ id: 11, status: 'pending' }),
      runtime: expect.objectContaining({ available: true }),
    });

    const cancelResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs/11/cancel',
      dependencies: { schedulerRuntime },
    });
    expect(cancelResponse.status).toBe(200);
    expect(JSON.parse(cancelResponse.body)).toEqual({
      job: expect.objectContaining({ id: 11, status: 'canceled' }),
      runtime: expect.objectContaining({ available: true }),
    });

    expect(actions).toEqual(['list:1', 'get:11', 'retry:11:2026-04-19T12:20:00.000Z', 'cancel:11']);
  });

  it('rejects retry requests when runAt is invalid', async () => {
    const actions: string[] = [];
    const schedulerRuntime = {
      getStatus() {
        return {
          available: true,
          started: true,
          schedulerIntervalMinutes: 15,
          pollMs: 900000,
          bootedAt: null,
          lastTickAt: null,
          lastTickResults: [],
          lastError: null,
          recoveredRunningJobs: 0,
          handlers: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 1,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      listJobs() {
        return {
          jobs: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 1,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        };
      },
      getJob() {
        return undefined;
      },
      reload() {
        return this.getStatus();
      },
      async tickNow() {
        return [];
      },
      enqueueJob() {
        throw new Error('not implemented');
      },
      retryJob(jobId: number, runAt?: string) {
        actions.push(`retry:${jobId}:${runAt ?? ''}`);
        return {
          id: jobId,
          type: 'publish',
          payload: '{"draftId":11}',
          status: 'pending',
          runAt: runAt ?? '2026-04-19T12:20:00.000Z',
          attempts: 1,
          createdAt: '2026-04-19T12:14:00.000Z',
          updatedAt: '2026-04-19T12:20:00.000Z',
          canRetry: false,
          canCancel: true,
        };
      },
      cancelJob() {
        return undefined;
      },
      stop() {},
    };

    const inheritedBody = Object.create({ runAt: '2026-04-19T12:20:00.000Z' });
    const nonPlainBodyResponse = await requestApp({
      remoteAddress: '127.0.0.1',
      method: 'POST',
      url: '/api/system/jobs/11/retry',
      body: inheritedBody,
      dependencies: { schedulerRuntime },
    });

    expect(nonPlainBodyResponse.status).toBe(400);
    expect(JSON.parse(nonPlainBodyResponse.body)).toEqual({
      error: 'invalid job runAt',
    });

    for (const runAt of [
      'not-a-date',
      123,
      '2026-02-31T09:00:00.000Z',
      '2026-02-31',
      '2026-02-31T09:00',
      '2026-02-31 09:00',
    ]) {
      const response = await requestApp({
        remoteAddress: '127.0.0.1',
        method: 'POST',
        url: '/api/system/jobs/11/retry',
        body: { runAt },
        dependencies: { schedulerRuntime },
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'invalid job runAt',
      });
    }

    expect(actions).toEqual([]);
  });

  it('lists browser-lane request artifacts through the system api', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const created = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/channel-accounts',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
        body: {
          platform: 'x',
          accountKey: '@promobot',
          displayName: 'PromoBot X',
          authType: 'browser',
          status: 'healthy',
        },
      });
      expect(created.status).toBe(201);

      const requestResponse = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/channel-accounts/1/session/request',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
      });
      expect(requestResponse.status).toBe(200);

      const response = await requestExistingApp(app, {
        method: 'GET',
        url: '/api/system/browser-lane-requests?limit=10',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        requests: [
          expect.objectContaining({
            channelAccountId: 1,
            platform: 'x',
            accountKey: '@promobot',
            action: 'request_session',
            jobStatus: 'pending',
            artifactPath:
              'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.json',
            resolvedAt: null,
          }),
        ],
        total: 1,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports browser-lane result artifacts through the system api', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const created = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/channel-accounts',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
        body: {
          platform: 'x',
          accountKey: '@promobot',
          displayName: 'PromoBot X',
          authType: 'browser',
          status: 'healthy',
        },
      });
      expect(created.status).toBe(201);

      const requestResponse = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/channel-accounts/1/session/request',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
      });
      expect(requestResponse.status).toBe(200);

      const requestBody = JSON.parse(requestResponse.body) as {
        job: {
          id: number;
        };
        sessionAction: {
          artifactPath: string;
        };
      };
      const siblingRequestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'relogin',
        requestedAt: '2026-04-23T13:10:00.000Z',
        jobId: requestBody.job.id + 1,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });

      const importResponse = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/system/browser-lane-requests/import',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
        body: {
          requestArtifactPath: requestBody.sessionAction.artifactPath,
          storageState: defaultStorageState,
          sessionStatus: 'active',
          validatedAt: '2026-04-23T13:21:00.000Z',
          notes: 'browser lane imported',
          completedAt: '2026-04-23T13:20:00.000Z',
        },
      });

      const resultArtifactPath =
        'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.result.json';
      expect(importResponse.status).toBe(200);
      expect(JSON.parse(importResponse.body)).toEqual({
        ok: true,
        imported: true,
        artifactPath: resultArtifactPath,
        session: {
          hasSession: true,
          id: 'x:-promobot',
          status: 'active',
          validatedAt: '2026-04-23T13:21:00.000Z',
          storageStatePath: 'browser-sessions/managed/x/-promobot.json',
          notes: 'browser lane imported',
        },
        channelAccount: expect.objectContaining({
          id: 1,
          metadata: expect.objectContaining({
            session: {
              hasSession: true,
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-23T13:21:00.000Z',
              storageStatePath: 'browser-sessions/managed/x/-promobot.json',
              notes: 'browser lane imported',
            },
          }),
        }),
      });

      const managedStorageStatePath = 'browser-sessions/managed/x/-promobot.json';
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, managedStorageStatePath), 'utf8')),
      ).toEqual(defaultStorageState);

      expect(
        JSON.parse(
          fs.readFileSync(path.join(rootDir, requestBody.sessionAction.artifactPath), 'utf8'),
        ),
      ).toEqual(
        expect.objectContaining({
          jobStatus: 'resolved',
          resolvedAt: expect.any(String),
          resolution: expect.objectContaining({
            status: 'resolved',
            source: 'browser_lane_result',
            completedAt: '2026-04-23T13:20:00.000Z',
            session: expect.objectContaining({
              hasSession: true,
              status: 'active',
              notes: 'browser lane imported',
              validatedAt: '2026-04-23T13:21:00.000Z',
              storageStatePath: managedStorageStatePath,
            }),
          }),
          savedStorageStatePath: managedStorageStatePath,
        }),
      );
      expect(
        getSessionRequestResultArtifact({
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          requestJobId: requestBody.job.id,
        }),
      ).toEqual(
        expect.objectContaining({
          artifactPath: resultArtifactPath,
          consumedAt: expect.any(String),
          savedStorageStatePath: managedStorageStatePath,
          resolution: expect.objectContaining({
            status: 'resolved',
            source: 'browser_lane_result',
          }),
        }),
      );
      const siblingRequestArtifact = JSON.parse(
        fs.readFileSync(path.join(rootDir, siblingRequestArtifactPath), 'utf8'),
      ) as Record<string, unknown>;
      expect(siblingRequestArtifact).toEqual(
        expect.objectContaining({
          action: 'relogin',
          jobStatus: 'pending',
        }),
      );
      expect(siblingRequestArtifact).not.toHaveProperty('resolvedAt');
      expect(siblingRequestArtifact).not.toHaveProperty('resolution');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('lists browser-handoff artifacts through the system api', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const created = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/channel-accounts',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
        body: {
          platform: 'facebookGroup',
          accountKey: 'launch-campaign',
          displayName: 'FB Group Manual',
          authType: 'browser',
          status: 'healthy',
        },
      });
      expect(created.status).toBe(201);

      const artifactDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactDir, 'facebookGroup-draft-12.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: '12',
          title: 'Community update',
          content: 'Need manual browser handoff',
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
      fs.writeFileSync(
        path.join(artifactDir, 'facebookGroup-draft-13.json'),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'resolved',
          platform: 'facebookGroup',
          draftId: '13',
          title: 'Published update',
          content: 'Completed browser publish',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-21T09:05:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-21T09:10:00.000Z',
          updatedAt: '2026-04-21T09:20:00.000Z',
          resolvedAt: '2026-04-21T09:20:00.000Z',
          resolution: {
            status: 'resolved',
            publishStatus: 'published',
          },
        }),
      );
      fs.writeFileSync(
        path.join(artifactDir, 'garbage.json'),
        JSON.stringify({
          type: 'not_browser_manual_handoff',
          status: 'resolved',
          platform: 'facebookGroup',
          draftId: '999',
        }),
      );

      const response = await requestExistingApp(app, {
        method: 'GET',
        url: '/api/system/browser-handoffs?limit=10',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
        },
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        handoffs: [
          expect.objectContaining({
            channelAccountId: 1,
            accountDisplayName: 'FB Group Manual',
            platform: 'facebookGroup',
            draftId: '13',
            accountKey: 'launch-campaign',
            ownership: 'direct',
            status: 'resolved',
            artifactPath:
              'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
            resolvedAt: '2026-04-21T09:20:00.000Z',
          }),
          expect.objectContaining({
            channelAccountId: 1,
            accountDisplayName: 'FB Group Manual',
            platform: 'facebookGroup',
            draftId: '12',
            accountKey: 'launch-campaign',
            ownership: 'direct',
            status: 'pending',
            artifactPath:
              'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-12.json',
            resolvedAt: null,
          }),
        ],
        total: 2,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports browser-handoff completion through the system api and marks the draft published', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const draft = draftStore.create({
        platform: 'facebook-group',
        title: 'Community update',
        content: 'Need manual browser handoff',
        target: 'group-123',
        metadata: {
          accountKey: 'launch-campaign',
        },
      });

      const artifactDir = path.join(
        rootDir,
        'artifacts',
        'browser-handoffs',
        'facebookGroup',
        'launch-campaign',
      );
      fs.mkdirSync(artifactDir, { recursive: true });
      const artifactPath =
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-1.json';
      fs.writeFileSync(
        path.join(rootDir, artifactPath),
        JSON.stringify({
          type: 'browser_manual_handoff',
          status: 'pending',
          platform: 'facebookGroup',
          draftId: String(draft.id),
          title: 'Community update',
          content: 'Need manual browser handoff',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-23T10:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-23T10:05:00.000Z',
          updatedAt: '2026-04-23T10:05:00.000Z',
          resolvedAt: null,
          resolution: null,
        }),
      );

      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });

      const response = await requestExistingApp(app, {
        method: 'POST',
        url: '/api/system/browser-handoffs/import',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-admin-password': 'secret',
          'content-type': 'application/json',
        },
        body: {
          artifactPath,
          publishStatus: 'published',
          message: 'browser lane completed publish',
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
          externalId: 'fb-post-42',
          publishedAt: '2026-04-23T10:10:00.000Z',
        },
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        imported: true,
        artifactPath,
        draftId: draft.id,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        externalId: 'fb-post-42',
        message: 'browser lane completed publish',
        publishedAt: '2026-04-23T10:10:00.000Z',
      });

      expect(draftStore.getById(draft.id)).toEqual(
        expect.objectContaining({
          id: draft.id,
          status: 'published',
          publishedAt: '2026-04-23T10:10:00.000Z',
        }),
      );
      expect(publishLogStore.listByDraftId(draft.id)).toEqual([
        expect.objectContaining({
          draftId: draft.id,
          status: 'published',
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
          message: 'browser lane completed publish',
        }),
      ]);
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath), 'utf8'))).toEqual(
        expect.objectContaining({
          status: 'resolved',
          resolution: {
            status: 'resolved',
            publishStatus: 'published',
            draftStatus: 'published',
            publishUrl: 'https://facebook.com/groups/group-123/posts/42',
            externalId: 'fb-post-42',
            message: 'browser lane completed publish',
            publishedAt: '2026-04-23T10:10:00.000Z',
          },
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

});

describe('static client hosting', () => {
  it('serves built client files when a client dist is available', async () => {
    const clientBuild = createClientBuildFixture();
    activeClientBuildFixtures.add(clientBuild);
    const app = createApp(
      {
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      },
      { clientDistPath: clientBuild.clientDistPath } as Parameters<typeof createApp>[1],
    );

    const indexResponse = await requestExistingApp(app, { url: '/' });
    const assetResponse = await requestExistingApp(app, { url: '/assets/app.js' });

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.body).toContain('PromoBot SPA');
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.body).toContain('promobot-client');
  });

  it('falls back to index.html for unknown non-api routes when a client dist is available', async () => {
    const clientBuild = createClientBuildFixture();
    activeClientBuildFixtures.add(clientBuild);
    const app = createApp(
      {
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      },
      { clientDistPath: clientBuild.clientDistPath } as Parameters<typeof createApp>[1],
    );

    const response = await requestExistingApp(app, {
      url: '/workspace/review-queue',
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe(clientBuild.indexHtml);
  });

  it('keeps api routing ahead of the client fallback', async () => {
    const clientBuild = createClientBuildFixture();
    activeClientBuildFixtures.add(clientBuild);
    const app = createApp(
      {
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      },
      { clientDistPath: clientBuild.clientDistPath } as Parameters<typeof createApp>[1],
    );

    const healthResponse = await requestExistingApp(app, {
      url: '/api/system/health',
    });
    const missingApiResponse = await requestExistingApp(app, {
      url: '/api/does-not-exist',
    });

    expect(healthResponse.status).toBe(200);
    expect(JSON.parse(healthResponse.body)).toEqual({
      ok: true,
      service: 'promobot',
      timestamp: expect.any(String),
      uptimeSeconds: expect.any(Number),
      scheduler: {
        available: false,
        started: false,
      },
    });
    expect(missingApiResponse.status).toBe(404);
    expect(missingApiResponse.body).not.toContain('PromoBot SPA');
  });
});
