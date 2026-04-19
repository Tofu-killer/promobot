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

describe('settings api', () => {
  it('persists allowlist and scheduler settings in SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const updated = await requestApp('PATCH', '/api/settings', {
        allowlist: ['127.0.0.1', '10.0.0.0/24'],
        schedulerIntervalMinutes: 30,
        rssDefaults: ['OpenAI blog', 'Anthropic news'],
      });

      expect(updated.status).toBe(200);

      const loaded = await requestApp('GET', '/api/settings');

      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body)).toEqual({
        settings: expect.objectContaining({
          allowlist: ['127.0.0.1', '10.0.0.0/24'],
          schedulerIntervalMinutes: 30,
          rssDefaults: ['OpenAI blog', 'Anthropic news'],
        }),
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
