import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

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

  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = Object.assign(Object.create(app.request), {
      app,
      method: options.method ?? 'GET',
      url: options.url ?? '/api/system/health',
      originalUrl: options.url ?? '/api/system/health',
      headers: {},
      socket: { remoteAddress: options.remoteAddress },
      connection: { remoteAddress: options.remoteAddress },
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
      write(chunk: string) {
        body += chunk;
        return true;
      },
      end(chunk?: string) {
        if (chunk) body += chunk;
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

    res.end = (chunk?: string) => {
      if (chunk) body += chunk;
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
            duePending: 1,
          },
          recentJobs: [],
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
            duePending: 0,
          },
          recentJobs: [],
        };
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
});
