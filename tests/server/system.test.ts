import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

async function requestExistingApp(
  app: ReturnType<typeof createApp>,
  options: {
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

  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = Object.assign(Object.create(app.request), {
      app,
      method: options.method ?? 'GET',
      url: options.url,
      originalUrl: options.url,
      headers: {},
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
        resolve({ status: this.statusCode, body });
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
    const finish = (result: { status: number; body: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    res.end = (chunk?: string | Uint8Array) => {
      body = appendChunk(body, chunk);
      finish({ status: res.statusCode, body });
      return res;
    };

    app.handle(req, res, (error?: unknown) => {
      if (settled) return;
      if (error) {
        settled = true;
        reject(error);
        return;
      }
      finish({ status: 404, body });
    });
  });
}

async function requestApp(options: {
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
    remoteAddress: options.remoteAddress,
    method: options.method,
    url: options.url ?? '/api/system/health',
    body: options.body,
  });
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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it('rejects requests from disallowed IPs', async () => {
    const response = await requestApp({ remoteAddress: '10.10.10.10' });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'forbidden' });
  });
});

describe('system runtime api', () => {
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
    expect(JSON.parse(healthResponse.body)).toEqual({ ok: true });
    expect(missingApiResponse.status).toBe(404);
    expect(missingApiResponse.body).not.toContain('PromoBot SPA');
  });
});
