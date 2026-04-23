import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import {
  createSessionRequestArtifact,
  getSessionRequestArtifactByPath,
  getSessionRequestResultArtifact,
  getSessionRequestResultArtifactByPath,
  resolveSessionRequestArtifacts,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import {
  SessionRequestResultSubmitError,
  submitSessionRequestResult,
} from '../../src/server/services/browser/sessionResultSubmitter';
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

  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
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
      if (settled) {
        return;
      }

      if (error) {
        settled = true;
        reject(error);
        return;
      }

      finish({ status: 404, body });
    });
  });
}

function normalizeHeaders(headers?: HeadersInit) {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function createAppFetch(app: ReturnType<typeof createApp>) {
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  }> = [];

  const fetchImpl: typeof fetch = (async (input, init) => {
    const requestUrl =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url;
    const url = new URL(requestUrl, 'http://local.test');
    const headers = Object.fromEntries(
      Object.entries(normalizeHeaders(init?.headers)).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    const bodyText = typeof init?.body === 'string' ? init.body : undefined;
    const body = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;

    calls.push({
      url: requestUrl,
      method: init?.method ?? 'GET',
      headers,
      body,
    });

    const response = await requestExistingApp(app, {
      method: init?.method,
      url: `${url.pathname}${url.search}`,
      headers,
      remoteAddress: '127.0.0.1',
      body,
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }) as typeof fetch;

  return {
    calls,
    fetchImpl,
  };
}

function writeStorageStateFile(
  rootDir: string,
  storageStateFilePath: string,
  value: Record<string, unknown> = defaultStorageState,
) {
  const absolutePath = path.join(rootDir, storageStateFilePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(value, null, 2), 'utf8');
  return absolutePath;
}

async function createBrowserLaneRequest(app: ReturnType<typeof createApp>) {
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

  return JSON.parse(requestResponse.body) as {
    job: {
      id: number;
    };
    sessionAction: {
      artifactPath: string;
    };
  };
}

describe('browser lane submit service', () => {
  it('creates a result artifact from a request artifact and a storage state file', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-23T13:00:00.000Z',
        jobId: 17,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });
      const storageStateFilePath = writeStorageStateFile(
        rootDir,
        'fixtures/browser-lane-submit/storage-state.json',
      );

      const result = await submitSessionRequestResult({
        requestArtifactPath,
        storageStateFilePath,
        sessionStatus: 'expired',
        validatedAt: '2026-04-23T13:21:00.000Z',
        notes: 'browser lane completed',
        completedAt: '2026-04-23T13:20:00.000Z',
      });

      expect(result).toEqual({
        ok: true,
        imported: false,
        requestArtifactPath,
        resultArtifactPath:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-17.result.json',
      });
      expect(getSessionRequestResultArtifactByPath(result.resultArtifactPath)).toEqual({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestJobId: 17,
        completedAt: '2026-04-23T13:20:00.000Z',
        storageState: defaultStorageState,
        sessionStatus: 'expired',
        validatedAt: '2026-04-23T13:21:00.000Z',
        notes: 'browser lane completed',
        artifactPath: result.resultArtifactPath,
        consumedAt: null,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns importer api results after importing the generated result artifact', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });
      const requestBody = await createBrowserLaneRequest(app);
      const storageStateFilePath = writeStorageStateFile(
        rootDir,
        'fixtures/browser-lane-submit/importable-storage-state.json',
      );
      const { calls, fetchImpl } = createAppFetch(app);

      const result = await submitSessionRequestResult(
        {
          requestArtifactPath: requestBody.sessionAction.artifactPath,
          storageStateFilePath,
          importBaseUrl: 'http://local.test/',
          adminPassword: 'secret',
          notes: 'browser lane imported',
          validatedAt: '2026-04-23T13:21:00.000Z',
          completedAt: '2026-04-23T13:20:00.000Z',
        },
        { fetchImpl },
      );

      expect(calls).toEqual([
        {
          url: 'http://local.test/api/system/browser-lane-requests/import',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-admin-password': 'secret',
          },
          body: {
            artifactPath:
              'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.result.json',
          },
        },
      ]);
      expect(result).toEqual({
        ok: true,
        imported: true,
        requestArtifactPath: requestBody.sessionAction.artifactPath,
        resultArtifactPath:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.result.json',
        importResult: {
          ok: true,
          imported: true,
          artifactPath:
            'artifacts/browser-lane-requests/x/-promobot/request-session-job-1.result.json',
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
        },
      });
      expect(getSessionRequestArtifactByPath(requestBody.sessionAction.artifactPath)).toEqual(
        expect.objectContaining({
          resolvedAt: expect.any(String),
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
          artifactPath: result.resultArtifactPath,
          consumedAt: expect.any(String),
          savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails when the request artifact is already resolved', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-23T13:00:00.000Z',
        jobId: 17,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });
      const storageStateFilePath = writeStorageStateFile(
        rootDir,
        'fixtures/browser-lane-submit/resolved-storage-state.json',
      );

      resolveSessionRequestArtifacts({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        resolvedAt: '2026-04-23T13:19:00.000Z',
        resolution: {
          status: 'resolved',
        },
        savedStorageStatePath: 'artifacts/browser-sessions/x-promobot.json',
      });

      await expect(
        submitSessionRequestResult({
          requestArtifactPath,
          storageStateFilePath,
        }),
      ).rejects.toMatchObject({
        message: 'browser lane request artifact already resolved',
        statusCode: 409,
      } satisfies Partial<SessionRequestResultSubmitError>);
      expect(
        getSessionRequestResultArtifact({
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          requestJobId: 17,
        }),
      ).toBeNull();
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails when the submitted storage state cannot be imported', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });
      const requestBody = await createBrowserLaneRequest(app);
      const storageStateFilePath = writeStorageStateFile(
        rootDir,
        'fixtures/browser-lane-submit/invalid-storage-state.json',
        {
          cookies: {},
          origins: [],
        },
      );
      const { fetchImpl } = createAppFetch(app);

      await expect(
        submitSessionRequestResult(
          {
            requestArtifactPath: requestBody.sessionAction.artifactPath,
            storageStateFilePath,
            importBaseUrl: 'http://local.test',
            adminPassword: 'secret',
          },
          { fetchImpl },
        ),
      ).rejects.toMatchObject({
        message: 'storage state payload is invalid for platform x',
        statusCode: 400,
      } satisfies Partial<SessionRequestResultSubmitError>);
      expect(getSessionRequestArtifactByPath(requestBody.sessionAction.artifactPath)).toEqual(
        expect.objectContaining({
          resolvedAt: null,
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
          consumedAt: null,
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
