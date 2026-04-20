import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const originalEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

let activeTestDbRoot: string | undefined;

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

    const response = await requestApp('POST', '/api/content/generate', {
      topic: 'Claude support launched',
      platforms: ['x', 'reddit'],
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
          platform: 'reddit',
          content: 'reddit-draft-content',
          hashtags: [],
        },
      ],
    });
  });

  it('saves drafts durably when saveAsDraft is true', async () => {
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

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = Object.assign(Object.create(secondApp.request), {
        app: secondApp,
        method: 'GET',
        url: '/api/drafts',
        originalUrl: '/api/drafts',
        headers: { 'x-admin-password': 'secret' },
        socket: { remoteAddress: '127.0.0.1' },
        connection: { remoteAddress: '127.0.0.1' },
      });

      let responseBody = '';
      const res = Object.create(secondApp.response);
      Object.assign(res, {
        app: secondApp,
        req,
        locals: {},
        statusCode: 200,
        setHeader() {},
        getHeader() {
          return undefined;
        },
        removeHeader() {},
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

      secondApp.handle(req, res, (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ status: 404, body: responseBody });
      });
    });

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
});
