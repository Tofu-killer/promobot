import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createInboxStore } from '../../src/server/store/inbox';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

async function requestApp(method: string, url: string) {
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

describe('inbox api', () => {
  it('returns inbox items with total and unread counts from SQLite', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const inboxStore = createInboxStore();
      inboxStore.create({
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
      });

      const response = await requestApp('GET', '/api/inbox');

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Need lower latency in APAC',
          }),
        ],
        total: 1,
        unread: 1,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
