import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { loadServerEnvFromRoot } from '../../src/server/env';
import { resetBrowserArtifactHealthSummaryCache } from '../../src/server/services/browser/artifactHealth';
import {
  getDeploymentSmokeHelpText,
  parseDeploymentSmokeArgs,
  runDeploymentSmokeCheck,
} from '../../src/server/cli/deploymentSmoke';
import type { SchedulerRuntime } from '../../src/server/runtime/schedulerRuntime';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

afterEach(() => {
  delete process.env.PROMOBOT_ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
});

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
        body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        return true;
      },
      end(chunk?: string | Uint8Array) {
        if (chunk) {
          body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        }
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

    app.handle(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ status: 404, body, headers: Object.fromEntries(responseHeaders) });
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
      Object.entries(normalizeHeaders(init?.headers)).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

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

    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  }) as typeof fetch;

  return { calls, fetchImpl };
}

function createSchedulerRuntimeStub(
  overrides: Partial<SchedulerRuntime['getStatus'] extends () => infer Status ? Status : never> = {},
): SchedulerRuntime {
  return {
    getStatus() {
      return {
        available: true,
        started: true,
        schedulerIntervalMinutes: 15,
        pollMs: 900000,
        bootedAt: '2026-04-19T12:00:00.000Z',
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
        ...overrides,
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
    enqueueJob() {
      throw new Error('not implemented');
    },
    retryJob() {
      return undefined;
    },
    cancelJob() {
      return undefined;
    },
    stop() {},
  };
}

function createHealthySmokeApp() {
  return createApp(
    {
      allowedIps: ['127.0.0.1'],
      adminPassword: 'secret',
    },
    {
      schedulerRuntime: createSchedulerRuntimeStub(),
    },
  );
}

describe('deployment smoke cli', () => {
  it('runs the deployment smoke checks against the local app contract', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;
    resetBrowserArtifactHealthSummaryCache();

    try {
      const app = createHealthySmokeApp();
      const { calls, fetchImpl } = createAppFetch(app);

      const result = await runDeploymentSmokeCheck(
        {
          baseUrl: 'http://local.test',
          adminPassword: 'secret',
        },
        { fetchImpl },
      );

      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'GET http://local.test/api/system/health',
        'POST http://local.test/api/auth/login',
        'GET http://local.test/api/settings',
        'GET http://local.test/api/system/browser-lane-requests?limit=1',
        'GET http://local.test/api/system/browser-handoffs?limit=1',
        'GET http://local.test/api/system/inbox-reply-handoffs?limit=1',
        'POST http://local.test/api/auth/logout',
      ]);
      expect(result).toEqual({
        ok: true,
        baseUrl: 'http://local.test',
        checks: {
          health: expect.objectContaining({
            ok: true,
            service: 'promobot',
            scheduler: {
              available: true,
              started: true,
              queue: {
                pending: 0,
                running: 0,
                failed: 0,
                duePending: 0,
              },
            },
            browserArtifacts: {
              laneRequests: {
                total: 0,
                pending: 0,
                resolved: 0,
              },
              handoffs: {
                total: 0,
                pending: 0,
                resolved: 0,
                obsolete: 0,
                unmatched: 0,
              },
              inboxReplyHandoffs: {
                total: 0,
                pending: 0,
                resolved: 0,
                obsolete: 0,
              },
            },
          }),
          settings: expect.objectContaining({
            settings: expect.any(Object),
            platforms: expect.any(Array),
          }),
          browserLaneRequests: {
            requests: [],
            total: 0,
          },
          browserHandoffs: {
            handoffs: [],
            total: 0,
          },
          inboxReplyHandoffs: {
            handoffs: [],
            total: 0,
          },
        },
      });
    } finally {
      resetBrowserArtifactHealthSummaryCache();
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails when the health payload reports that the scheduler runtime has not started', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;
    resetBrowserArtifactHealthSummaryCache();

    try {
      const app = createApp(
        {
          allowedIps: ['127.0.0.1'],
          adminPassword: 'secret',
        },
        {
          schedulerRuntime: createSchedulerRuntimeStub({
            started: false,
            bootedAt: null,
          }),
        },
      );
      const { fetchImpl } = createAppFetch(app);

      await expect(
        runDeploymentSmokeCheck(
          {
            baseUrl: 'http://local.test',
            adminPassword: 'secret',
          },
          { fetchImpl },
        ),
      ).rejects.toThrow('scheduler runtime is not started');
    } finally {
      resetBrowserArtifactHealthSummaryCache();
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('parses deployment smoke cli arguments', () => {
    expect(
      parseDeploymentSmokeArgs([
        '--base-url',
        'http://127.0.0.1:3001',
        '--admin-password',
        'secret',
      ]),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:3001',
      adminPassword: 'secret',
    });
    expect(getDeploymentSmokeHelpText()).toContain('--base-url <origin>');
    expect(getDeploymentSmokeHelpText()).toContain('[--admin-password <secret>]');
    expect(getDeploymentSmokeHelpText()).toContain('/api/system/browser-handoffs?limit=1');
    expect(getDeploymentSmokeHelpText()).toContain('/api/system/inbox-reply-handoffs?limit=1');
  });

  it('treats a help flag after -- as a help request', () => {
    expect(parseDeploymentSmokeArgs(['--', '--help'])).toEqual({
      baseUrl: '',
      adminPassword: '',
      showHelp: true,
    });
  });

  it('rejects --base-url without a value', () => {
    expect(() => parseDeploymentSmokeArgs(['--base-url'])).toThrow(
      '--base-url requires a value',
    );
    expect(() =>
      parseDeploymentSmokeArgs(['--base-url', '--admin-password', 'secret']),
    ).toThrow('--base-url requires a value');
  });

  it('rejects --admin-password without a value', () => {
    expect(() => parseDeploymentSmokeArgs(['--admin-password'])).toThrow(
      '--admin-password requires a value',
    );
    expect(() =>
      parseDeploymentSmokeArgs([
        '--base-url',
        'http://127.0.0.1:3001',
        '--admin-password',
        '--help',
      ]),
    ).toThrow('--admin-password requires a value');
  });

  it('rejects unknown deployment smoke cli arguments', () => {
    expect(() => parseDeploymentSmokeArgs(['--wat'])).toThrow(
      'unknown argument: --wat',
    );
  });

  it('falls back to environment passwords when the cli argument is omitted', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;
    process.env.ADMIN_PASSWORD = 'secret';
    resetBrowserArtifactHealthSummaryCache();

    try {
      const app = createHealthySmokeApp();
      const { fetchImpl } = createAppFetch(app);

      const result = await runDeploymentSmokeCheck(
        {
          baseUrl: 'http://local.test',
          adminPassword: '',
        },
        { fetchImpl },
      );

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          baseUrl: 'http://local.test',
        }),
      );
    } finally {
      resetBrowserArtifactHealthSummaryCache();
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('accepts PROMOBOT_ADMIN_PASSWORD from the shell environment', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;
    process.env.PROMOBOT_ADMIN_PASSWORD = 'secret';
    resetBrowserArtifactHealthSummaryCache();

    try {
      const app = createHealthySmokeApp();
      const { fetchImpl } = createAppFetch(app);

      const result = await runDeploymentSmokeCheck(
        {
          baseUrl: 'http://local.test',
          adminPassword: '',
        },
        { fetchImpl },
      );

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          baseUrl: 'http://local.test',
        }),
      );
    } finally {
      resetBrowserArtifactHealthSummaryCache();
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('accepts PROMOBOT_ADMIN_PASSWORD loaded from the repo-root env file', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;
    resetBrowserArtifactHealthSummaryCache();

    try {
      fs.writeFileSync(
        `${rootDir}/.env`,
        'PROMOBOT_ADMIN_PASSWORD=secret\n',
        'utf8',
      );
      loadServerEnvFromRoot({ repoRootDir: rootDir });

      const app = createHealthySmokeApp();
      const { fetchImpl } = createAppFetch(app);

      const result = await runDeploymentSmokeCheck(
        {
          baseUrl: 'http://local.test',
          adminPassword: '',
        },
        { fetchImpl },
      );

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          baseUrl: 'http://local.test',
        }),
      );
    } finally {
      resetBrowserArtifactHealthSummaryCache();
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });
});
