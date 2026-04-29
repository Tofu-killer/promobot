import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import {
  getInboxReplyHandoffArtifactByPath,
} from '../../src/server/services/inbox/replyHandoffArtifacts';
import {
  getInboxReplyHandoffResultArtifactByPath,
} from '../../src/server/services/inbox/replyHandoffResultArtifacts';
import {
  getInboxReplyHandoffCompleteHelpText,
  parseInboxReplyHandoffCompleteArgs,
} from '../../src/server/cli/inboxReplyHandoffComplete';
import {
  InboxReplyHandoffCompletionSubmitError,
  submitInboxReplyHandoffCompletion,
} from '../../src/server/services/inbox/replyHandoffCompletionSubmitter';
import * as inboxStoreModule from '../../src/server/store/inbox';
import { createInboxStore } from '../../src/server/store/inbox';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

let restoreCwd: (() => void) | null = null;

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
        body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        return true;
      },
      end(chunk?: string | Uint8Array) {
        if (chunk) {
          body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        }
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

    app.handle(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ status: 404, body });
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

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }) as typeof fetch;

  return { calls, fetchImpl };
}

function writePendingInboxReplyHandoffArtifact(
  rootDir: string,
  itemId: number,
  overrides: Record<string, unknown> = {},
) {
  const artifactPath =
    `artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-${itemId}.json`;
  const absolutePath = path.join(rootDir, artifactPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_inbox_reply_handoff',
        status: 'pending',
        platform: 'weibo',
        itemId: String(itemId),
        source: 'weibo',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        reply: 'Thanks for reaching out.',
        author: 'ops-user',
        sourceUrl: 'https://weibo.test/post/12',
        accountKey: 'weibo-browser-main',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
        createdAt: '2026-04-25T10:01:00.000Z',
        updatedAt: '2026-04-25T10:01:00.000Z',
        resolvedAt: null,
        resolution: null,
        ...overrides,
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

describe('inbox reply handoff completion submitter', () => {
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreCwd?.();
    restoreCwd = null;
  });

  it('imports an inbox reply handoff completion locally', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });
      const artifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);

      const result = await submitInboxReplyHandoffCompletion({
        artifactPath,
        replyStatus: 'sent',
        deliveryUrl: 'https://weibo.test/post/12#reply-42',
        message: 'browser lane completed reply',
        deliveredAt: '2026-04-25T10:10:00.000Z',
      });

      expect(result).toEqual({
        ok: true,
        imported: true,
        artifactPath,
        itemId: item.id,
        itemStatus: 'handled',
        platform: 'weibo',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://weibo.test/post/12#reply-42',
        externalId: null,
        message: 'browser lane completed reply',
        deliveredAt: '2026-04-25T10:10:00.000Z',
      });
      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: item.id,
          status: 'handled',
        }),
      ]);
      expect(getInboxReplyHandoffArtifactByPath(artifactPath)).toEqual(
        expect.objectContaining({
          status: 'resolved',
          resolution: expect.objectContaining({
            replyStatus: 'sent',
            itemStatus: 'handled',
            deliveryUrl: 'https://weibo.test/post/12#reply-42',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('keeps sent handoff imports successful when the local inbox status update fails', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });
      const artifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);

      vi.spyOn(inboxStoreModule, 'createInboxStore').mockReturnValue({
        create: inboxStore.create,
        list: inboxStore.list,
        updateStatus: () => undefined,
      });

      const result = await submitInboxReplyHandoffCompletion({
        artifactPath,
        replyStatus: 'sent',
        deliveryUrl: 'https://weibo.test/post/12#reply-77',
        message: 'browser lane completed reply',
        deliveredAt: '2026-04-25T10:12:00.000Z',
      });

      expect(result).toEqual({
        ok: true,
        imported: true,
        artifactPath,
        itemId: item.id,
        itemStatus: 'needs_reply',
        platform: 'weibo',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://weibo.test/post/12#reply-77',
        externalId: null,
        message: 'browser lane completed reply',
        deliveredAt: '2026-04-25T10:12:00.000Z',
      });
      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: item.id,
          status: 'needs_reply',
        }),
      ]);
      expect(getInboxReplyHandoffArtifactByPath(artifactPath)).toEqual(
        expect.objectContaining({
          status: 'resolved',
          resolution: expect.objectContaining({
            replyStatus: 'sent',
            itemStatus: 'needs_reply',
            deliveryUrl: 'https://weibo.test/post/12#reply-77',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports an inbox reply handoff completion through the system api when baseUrl is provided', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });
      const artifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);
      const app = createApp({
        allowedIps: ['127.0.0.1'],
        adminPassword: 'secret',
      });
      const { calls, fetchImpl } = createAppFetch(app);

      const result = await submitInboxReplyHandoffCompletion(
        {
          artifactPath,
          replyStatus: 'failed',
          message: 'manual browser reply failed',
          importBaseUrl: 'http://local.test',
          adminPassword: 'secret',
        },
        { fetchImpl },
      );

      expect(calls).toEqual([
        {
          url: 'http://local.test/api/system/inbox-reply-handoffs/import',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-admin-password': 'secret',
          },
          body: {
            artifactPath,
            replyStatus: 'failed',
            message: 'manual browser reply failed',
          },
        },
      ]);
      expect(result).toEqual({
        ok: true,
        imported: true,
        artifactPath,
        itemId: item.id,
        itemStatus: 'needs_reply',
        platform: 'weibo',
        mode: 'browser',
        status: 'failed',
        success: false,
        deliveryUrl: null,
        externalId: null,
        message: 'manual browser reply failed',
        deliveredAt: null,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails when the inbox reply handoff artifact has already been resolved', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });
      const artifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);
      const absolutePath = path.join(rootDir, artifactPath);
      fs.writeFileSync(
        absolutePath,
        JSON.stringify(
          {
            ...JSON.parse(fs.readFileSync(absolutePath, 'utf8')),
            status: 'resolved',
            resolvedAt: '2026-04-25T10:10:00.000Z',
            resolution: { status: 'resolved' },
          },
          null,
          2,
        ),
      );

      await expect(
        submitInboxReplyHandoffCompletion({
          artifactPath,
          replyStatus: 'sent',
        }),
      ).rejects.toMatchObject<Partial<InboxReplyHandoffCompletionSubmitError>>({
        message: 'inbox reply handoff artifact already resolved',
        statusCode: 409,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('writes an inbox reply handoff result artifact locally when queueResult is enabled', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });
      const artifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);

      const result = await submitInboxReplyHandoffCompletion(
        {
          artifactPath,
          replyStatus: 'sent',
          deliveryUrl: 'https://weibo.test/post/12#reply-42',
          message: 'browser lane completed reply',
          deliveredAt: '2026-04-25T10:10:00.000Z',
          queueResult: true,
        },
        {
          now: () => new Date('2026-04-25T10:11:00.000Z'),
        },
      );

      expect(result).toEqual({
        ok: true,
        imported: false,
        artifactPath,
        resultArtifactPath:
          'artifacts/inbox-reply-handoff-results/weibo/weibo-browser-main/weibo-inbox-item-1.json',
      });
      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: item.id,
          status: 'needs_reply',
        }),
      ]);
      expect(getInboxReplyHandoffArtifactByPath(artifactPath)).toEqual(
        expect.objectContaining({
          status: 'pending',
          resolvedAt: null,
        }),
      );
      expect(
        getInboxReplyHandoffResultArtifactByPath(
          'artifacts/inbox-reply-handoff-results/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        ),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff_result',
          handoffArtifactPath: artifactPath,
          itemId: '1',
          replyStatus: 'sent',
          message: 'browser lane completed reply',
          deliveryUrl: 'https://weibo.test/post/12#reply-42',
          deliveredAt: '2026-04-25T10:10:00.000Z',
          consumedAt: null,
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('parses inbox reply handoff completion cli arguments', () => {
    expect(
      parseInboxReplyHandoffCompleteArgs([
        '--artifact-path',
        'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
        '--status',
        'failed',
        '--message',
        'manual browser reply failed',
        '--delivery-url',
        'https://weibo.test/post/12#reply-42',
        '--external-id',
        'wb-reply-42',
        '--delivered-at',
        '2026-04-25T10:10:00.000Z',
        '--queue-result',
        '--base-url',
        'http://127.0.0.1:3001',
        '--admin-password',
        'secret',
      ]),
    ).toEqual({
      artifactPath:
        'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-1.json',
      replyStatus: 'failed',
      message: 'manual browser reply failed',
      deliveryUrl: 'https://weibo.test/post/12#reply-42',
      externalId: 'wb-reply-42',
      deliveredAt: '2026-04-25T10:10:00.000Z',
      queueResult: true,
      importBaseUrl: 'http://127.0.0.1:3001',
      adminPassword: 'secret',
    });
    expect(getInboxReplyHandoffCompleteHelpText()).toContain('--artifact-path <path>');
    expect(getInboxReplyHandoffCompleteHelpText()).toContain('--queue-result');
    expect(getInboxReplyHandoffCompleteHelpText()).toContain(
      'pnpm inbox:reply:handoff:complete -- --artifact-path <path> [options]',
    );
    expect(getInboxReplyHandoffCompleteHelpText()).toContain(
      'node dist/server/cli/inboxReplyHandoffComplete.js --artifact-path <path> [options]',
    );
    expect(getInboxReplyHandoffCompleteHelpText()).not.toContain(
      'tsx src/server/cli/inboxReplyHandoffComplete.ts',
    );
  });
});
