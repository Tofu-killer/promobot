import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createJobRecord } from '../../src/server/lib/jobs';
import { createDefaultJobHandlers } from '../../src/server/runtime/defaultJobHandlers';
import {
  channelAccountSessionRequestJobType,
  createChannelAccountSessionRequestJobHandler,
} from '../../src/server/services/browser/sessionRequestHandler';
import {
  createSessionRequestArtifact,
  createSessionRequestResultArtifact,
  getSessionRequestResultArtifact,
  resolveSessionRequestArtifacts,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import { createSessionStore } from '../../src/server/services/browser/sessionStore';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { createInboxStore } from '../../src/server/store/inbox';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

const defaultStorageState = {
  cookies: [],
  origins: [],
};
const channelAccountSessionRequestPollJobType = 'channel_account_session_request_poll';
const browserHandoffPollJobType = 'browser_handoff_poll';
const inboxReplyHandoffPollJobType = 'inbox_reply_handoff_poll';
let restoreCwd: (() => void) | null = null;

function writeStorageStateFile(rootDir: string, storageStatePath: string, modifiedAt?: string) {
  const filePath = path.join(rootDir, storageStatePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultStorageState, null, 2));
  if (typeof modifiedAt === 'string' && modifiedAt.trim().length > 0) {
    const modifiedTime = new Date(modifiedAt);
    utimesSync(filePath, modifiedTime, modifiedTime);
  }

  return filePath;
}

function writePendingBrowserHandoffArtifact(rootDir: string) {
  const artifactPath =
    'artifacts/browser-handoffs/instagram/launch-campaign/instagram-draft-1.json';
  const absolutePath = path.join(rootDir, artifactPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_manual_handoff',
        channelAccountId: 3,
        status: 'pending',
        platform: 'instagram',
        draftId: '1',
        title: 'Launch reel',
        content: 'Needs browser lane publish',
        target: 'campaign-1',
        accountKey: 'launch-campaign',
        session: {
          hasSession: true,
          id: 'instagram:launch-campaign',
          status: 'active',
          validatedAt: '2026-04-29T07:55:00.000Z',
          storageStatePath: 'browser-sessions/managed/instagram/launch-campaign.json',
        },
        createdAt: '2026-04-29T07:56:00.000Z',
        updatedAt: '2026-04-29T07:56:00.000Z',
        resolvedAt: null,
        resolution: null,
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

function writeBrowserHandoffResultArtifact(rootDir: string, handoffArtifactPath: string) {
  const artifactPath =
    'artifacts/browser-handoff-results/instagram/launch-campaign/instagram-draft-1.json';
  const absolutePath = path.join(rootDir, artifactPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_manual_handoff_result',
        handoffArtifactPath,
        channelAccountId: 3,
        platform: 'instagram',
        accountKey: 'launch-campaign',
        draftId: '1',
        completedAt: '2026-04-29T08:02:00.000Z',
        publishStatus: 'published',
        message: 'browser lane published the reel',
        publishUrl: 'https://instagram.com/p/launch-reel',
        externalId: 'launch-reel',
        publishedAt: '2026-04-29T08:01:00.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

function writePendingInboxReplyHandoffArtifact(
  rootDir: string,
  itemId: number,
  overrides: Record<string, unknown> = {},
) {
  const artifactPath =
    `artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-${itemId}.json`;
  const absolutePath = path.join(rootDir, artifactPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_inbox_reply_handoff',
        channelAccountId: 9,
        ownership: 'direct',
        projectId: 1,
        status: 'pending',
        readiness: 'ready',
        sessionAction: null,
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
          validatedAt: '2026-04-29T07:55:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
        createdAt: '2026-04-29T07:56:00.000Z',
        updatedAt: '2026-04-29T07:56:00.000Z',
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

function writeInboxReplyHandoffResultArtifact(
  rootDir: string,
  handoffArtifactPath: string,
  itemId: number,
) {
  const artifactPath =
    `artifacts/inbox-reply-handoff-results/weibo/weibo-browser-main/weibo-inbox-item-${itemId}.json`;
  const absolutePath = path.join(rootDir, artifactPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_inbox_reply_handoff_result',
        handoffArtifactPath,
        channelAccountId: 9,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        itemId: String(itemId),
        completedAt: '2026-04-29T08:02:00.000Z',
        replyStatus: 'sent',
        message: 'browser lane replied from weibo',
        deliveryUrl: 'https://weibo.test/post/12#reply-42',
        externalId: 'wb-reply-42',
        deliveredAt: '2026-04-29T08:01:00.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

describe('default job handlers', () => {
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
  });

  it('passes projectId through to monitor, inbox, and reputation fetch handlers', async () => {
    const monitorFetchNow = vi.fn().mockResolvedValue({ items: [], inserted: 0 });
    const inboxFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });
    const reputationFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });

    const handlers = createDefaultJobHandlers({
      monitorFetchService: {
        fetchNow: monitorFetchNow,
      },
      inboxFetchService: {
        fetchNow: inboxFetchNow,
      },
      reputationFetchService: {
        fetchNow: reputationFetchNow,
      },
      channelAccountSessionRequestHandler: vi.fn(),
      publishJobHandler: vi.fn(),
    });

    await handlers.monitor_fetch({ projectId: 7 }, {} as never);
    await handlers.inbox_fetch({ projectId: 8 }, {} as never);
    await handlers.reputation_fetch({ projectId: 9 }, {} as never);

    expect(monitorFetchNow).toHaveBeenCalledWith(7);
    expect(inboxFetchNow).toHaveBeenCalledWith(8);
    expect(reputationFetchNow).toHaveBeenCalledWith(9);
  });

  it('falls back to global fetches when projectId is missing or invalid', async () => {
    const monitorFetchNow = vi.fn().mockResolvedValue({ items: [], inserted: 0 });
    const inboxFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });
    const reputationFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });

    const handlers = createDefaultJobHandlers({
      monitorFetchService: {
        fetchNow: monitorFetchNow,
      },
      inboxFetchService: {
        fetchNow: inboxFetchNow,
      },
      reputationFetchService: {
        fetchNow: reputationFetchNow,
      },
      channelAccountSessionRequestHandler: vi.fn(),
      publishJobHandler: vi.fn(),
    });

    await handlers.monitor_fetch({}, {} as never);
    await handlers.inbox_fetch({ projectId: 'bad' }, {} as never);
    await handlers.reputation_fetch({ projectId: 0 }, {} as never);

    expect(monitorFetchNow).toHaveBeenCalledWith(undefined);
    expect(inboxFetchNow).toHaveBeenCalledWith(undefined);
    expect(reputationFetchNow).toHaveBeenCalledWith(undefined);
  });

  it('keeps route-resolved browser-lane artifacts stable when the default session request handler runs', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      const nextStep = `/api/channel-accounts/${channelAccount.id}/session`;
      const artifactPath = createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep,
      });
      const storageStatePath = 'artifacts/browser-sessions/x-promobot-default-handler.json';
      writeStorageStateFile(rootDir, storageStatePath);

      const sessionMetadata = createSessionStore().saveSession({
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        storageStatePath,
        status: 'active',
        notes: 'saved before default handler tick',
        lastValidatedAt: '2026-04-21T09:16:00.000Z',
      });
      expect(
        resolveSessionRequestArtifacts({
          channelAccountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          resolvedAt: sessionMetadata.updatedAt,
          resolvedJobStatus: 'resolved',
          resolution: {
            status: 'resolved',
            session: {
              hasSession: true,
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-21T09:16:00.000Z',
              storageStatePath,
              notes: 'saved before default handler tick',
            },
          },
          savedStorageStatePath: sessionMetadata.storageStatePath,
        }),
      ).toEqual([artifactPath]);

      const expectedArtifact = {
        type: 'browser_lane_request',
        channelAccountId: channelAccount.id,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'resolved',
        nextStep,
        managedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        resolvedAt: sessionMetadata.updatedAt,
        resolution: {
          status: 'resolved',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: '2026-04-21T09:16:00.000Z',
            storageStatePath,
            notes: 'saved before default handler tick',
          },
        },
        savedStorageStatePath: storageStatePath,
      };

      expect(JSON.parse(readFileSync(path.join(rootDir, artifactPath), 'utf8'))).toEqual(
        expectedArtifact,
      );

      const handlers = createDefaultJobHandlers();
      await handlers.channel_account_session_request(
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        createJobRecord({
          id: 41,
          type: 'channel_account_session_request',
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
          },
          runAt: requestedAt,
        }),
      );

      expect(JSON.parse(readFileSync(path.join(rootDir, artifactPath), 'utf8'))).toEqual(
        expectedArtifact,
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not auto-import an old saved session when only metadata updatedAt is newer than the request', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      vi.useFakeTimers();
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });
      const storageStatePath = 'artifacts/browser-sessions/x-promobot-stale.json';
      writeStorageStateFile(rootDir, storageStatePath, '2026-04-21T09:14:00.000Z');

      vi.setSystemTime(new Date('2026-04-21T09:14:30.000Z'));
      const sessionStore = createSessionStore();
      sessionStore.saveSession({
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        storageStatePath,
        status: 'active',
        lastValidatedAt: '2026-04-21T09:14:00.000Z',
      });

      vi.setSystemTime(new Date('2026-04-21T09:16:30.000Z'));
      sessionStore.saveSession({
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        storageStatePath,
        status: 'active',
        notes: 'metadata resaved after the request',
      });

      const handlers = createDefaultJobHandlers();
      await handlers[channelAccountSessionRequestJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        createJobRecord({
          id: 41,
          type: channelAccountSessionRequestJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
          },
          runAt: requestedAt,
        }),
      );

      expect(
        JSON.parse(readFileSync(path.join(rootDir, requestArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          jobStatus: 'pending',
        }),
      );
      expect(
        JSON.parse(readFileSync(path.join(rootDir, requestArtifactPath), 'utf8')),
      ).not.toHaveProperty('resolvedAt');
      expect(
        JSON.parse(readFileSync(path.join(rootDir, requestArtifactPath), 'utf8')),
      ).not.toHaveProperty('resolution');
      expect(
        getSessionRequestResultArtifact({
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
          requestJobId: 41,
        }),
      ).toBeNull();
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: channelAccountSessionRequestPollJobType,
          status: 'pending',
          attempts: 0,
        }),
      ]);
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('queues a single follow-up poll job for unresolved browser-lane requests', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-21T09:16:00.000Z'));
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt: '2026-04-21T09:15:00.000Z',
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });

      const dispatchSpy = vi.fn();
      const handlers = createDefaultJobHandlers({
        channelAccountSessionRequestHandler: createChannelAccountSessionRequestJobHandler({
          browserLaneDispatch: dispatchSpy,
        }),
      });
      const job = createJobRecord({
        id: 41,
        type: channelAccountSessionRequestJobType,
        payload: {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        runAt: '2026-04-21T09:15:00.000Z',
      });

      await handlers[channelAccountSessionRequestJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        job,
      );
      await handlers[channelAccountSessionRequestJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        job,
      );

      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: channelAccountSessionRequestPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-21T09:17:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        accountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestJobId: 41,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith({
        kind: 'session_request',
        artifactPath: 'artifacts/browser-lane-requests/x/-promobot/request-session-job-41.json',
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        managedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        sessionAction: 'request_session',
        channelAccountId: channelAccount.id,
        requestJobId: 41,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('auto-imports a freshly written managed storage state when the session request handler runs', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });
      writeStorageStateFile(
        rootDir,
        'browser-sessions/managed/x/-promobot.json',
        '2026-04-21T09:16:30.000Z',
      );

      const dispatchSpy = vi.fn();
      const handlers = createDefaultJobHandlers({
        channelAccountSessionRequestHandler: createChannelAccountSessionRequestJobHandler({
          browserLaneDispatch: dispatchSpy,
        }),
      });
      await handlers[channelAccountSessionRequestJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        createJobRecord({
          id: 41,
          type: channelAccountSessionRequestJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
          },
          runAt: requestedAt,
        }),
      );

      expect(channelAccountStore.getById(channelAccount.id)?.metadata.session).toEqual({
        hasSession: true,
        id: 'x:-promobot',
        status: 'active',
        validatedAt: '2026-04-21T09:16:30.000Z',
        storageStatePath: 'browser-sessions/managed/x/-promobot.json',
      });
      expect(
        JSON.parse(readFileSync(path.join(rootDir, requestArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          jobStatus: 'resolved',
          resolvedAt: expect.any(String),
          resolution: expect.objectContaining({
            status: 'resolved',
            source: 'browser_lane_result',
            completedAt: '2026-04-21T09:16:30.000Z',
            session: expect.objectContaining({
              hasSession: true,
              status: 'active',
              validatedAt: '2026-04-21T09:16:30.000Z',
              storageStatePath: 'browser-sessions/managed/x/-promobot.json',
            }),
          }),
          savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        }),
      );
      expect(
        getSessionRequestResultArtifact({
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
          requestJobId: 41,
        }),
      ).toEqual(
        expect.objectContaining({
          consumedAt: expect.any(String),
          savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        }),
      );
      expect(jobQueueStore.list({ limit: 10 })).toEqual([]);
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('uses lastValidatedAt instead of metadata updatedAt when auto-importing an existing saved session', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      vi.useFakeTimers();
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });
      const storageStatePath = 'artifacts/browser-sessions/x-promobot-fresh.json';
      writeStorageStateFile(rootDir, storageStatePath, '2026-04-21T09:14:00.000Z');

      vi.setSystemTime(new Date('2026-04-21T09:14:30.000Z'));
      const sessionStore = createSessionStore();
      sessionStore.saveSession({
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        storageStatePath,
        status: 'active',
        lastValidatedAt: '2026-04-21T09:16:00.000Z',
      });

      vi.setSystemTime(new Date('2026-04-21T09:17:30.000Z'));
      sessionStore.saveSession({
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        storageStatePath,
        status: 'active',
        notes: 'metadata updated after validation',
      });

      const dispatchSpy = vi.fn();
      const handlers = createDefaultJobHandlers({
        channelAccountSessionRequestHandler: createChannelAccountSessionRequestJobHandler({
          browserLaneDispatch: dispatchSpy,
        }),
      });
      await handlers[channelAccountSessionRequestJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        createJobRecord({
          id: 41,
          type: channelAccountSessionRequestJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
          },
          runAt: requestedAt,
        }),
      );

      expect(channelAccountStore.getById(channelAccount.id)?.metadata.session).toEqual({
        hasSession: true,
        id: 'x:-promobot',
        status: 'active',
        validatedAt: '2026-04-21T09:16:00.000Z',
        storageStatePath: 'browser-sessions/managed/x/-promobot.json',
        notes: 'metadata updated after validation',
      });
      expect(
        JSON.parse(readFileSync(path.join(rootDir, requestArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          jobStatus: 'resolved',
          resolution: expect.objectContaining({
            status: 'resolved',
            source: 'browser_lane_result',
            completedAt: '2026-04-21T09:16:00.000Z',
            session: expect.objectContaining({
              validatedAt: '2026-04-21T09:16:00.000Z',
            }),
          }),
        }),
      );
      expect(dispatchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports matching browser-lane result artifacts when the poll handler runs', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        projectId: 55,
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      const blockedDraft = draftStore.create({
        projectId: 55,
        platform: 'x',
        title: 'Resume after session import',
        content: 'Needs a saved browser session first',
        status: 'review',
        metadata: {
          accountKey: '@promobot',
        },
      });
      publishLogStore.create({
        draftId: blockedDraft.id,
        projectId: 55,
        status: 'manual_required',
        message: `x draft ${blockedDraft.id} requires a saved browser session before manual handoff.`,
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      const completedAt = '2026-04-21T09:17:00.000Z';
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });
      const resultArtifactPath = createSessionRequestResultArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestJobId: 41,
        completedAt,
        storageState: defaultStorageState,
        sessionStatus: 'active',
        validatedAt: '2026-04-21T09:18:00.000Z',
        notes: 'imported by poll handler',
      });

      const handlers = createDefaultJobHandlers();
      await handlers[channelAccountSessionRequestPollJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
          requestJobId: 41,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 42,
          type: channelAccountSessionRequestPollJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
            requestJobId: 41,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: completedAt,
        }),
      );

      expect(channelAccountStore.getById(channelAccount.id)?.metadata.session).toEqual({
        hasSession: true,
        id: 'x:-promobot',
        status: 'active',
        validatedAt: '2026-04-21T09:18:00.000Z',
        storageStatePath: 'browser-sessions/managed/x/-promobot.json',
        notes: 'imported by poll handler',
      });
      expect(
        JSON.parse(readFileSync(path.join(rootDir, requestArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          jobStatus: 'resolved',
          resolvedAt: expect.any(String),
          resolution: expect.objectContaining({
            status: 'resolved',
            source: 'browser_lane_result',
            completedAt,
            session: expect.objectContaining({
              hasSession: true,
              status: 'active',
              validatedAt: '2026-04-21T09:18:00.000Z',
              storageStatePath: 'browser-sessions/managed/x/-promobot.json',
              notes: 'imported by poll handler',
            }),
          }),
          savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        }),
      );
      expect(
        getSessionRequestResultArtifact({
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
          requestJobId: 41,
        }),
      ).toEqual(
        expect.objectContaining({
          artifactPath: resultArtifactPath,
          consumedAt: expect.any(String),
          savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
          resolution: expect.objectContaining({
            status: 'resolved',
            source: 'browser_lane_result',
            completedAt,
          }),
        }),
      );
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'publish',
          status: 'pending',
          attempts: 0,
          payload: JSON.stringify({
            draftId: blockedDraft.id,
            projectId: 55,
          }),
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('requeues a follow-up poll job when the browser-lane result is still missing', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-21T09:16:00.000Z'));
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        platform: 'instagram',
        accountKey: '@promobot.official',
        displayName: 'PromoBot Instagram',
        authType: 'browser',
        status: 'healthy',
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'relogin',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });

      const handlers = createDefaultJobHandlers();
      await handlers[channelAccountSessionRequestPollJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'relogin',
          requestJobId: 41,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 42,
          type: channelAccountSessionRequestPollJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'relogin',
            requestJobId: 41,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-21T09:16:00.000Z',
        }),
      );

      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: channelAccountSessionRequestPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-21T09:17:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        accountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'relogin',
        requestJobId: 41,
        attempt: 1,
        maxAttempts: 3,
        pollDelayMs: 60_000,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('auto-imports a freshly written managed storage state when the session request poll handler runs', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        platform: 'instagram',
        accountKey: '@promobot.official',
        displayName: 'PromoBot Instagram',
        authType: 'browser',
        status: 'healthy',
      });
      createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'relogin',
        requestedAt: '2026-04-21T09:15:00.000Z',
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });
      writeStorageStateFile(
        rootDir,
        'browser-sessions/managed/instagram/-promobot.official.json',
        '2026-04-21T09:17:15.000Z',
      );

      const handlers = createDefaultJobHandlers();
      await handlers[channelAccountSessionRequestPollJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'relogin',
          requestJobId: 41,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 42,
          type: channelAccountSessionRequestPollJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'relogin',
            requestJobId: 41,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-21T09:17:15.000Z',
        }),
      );

      expect(channelAccountStore.getById(channelAccount.id)?.metadata.session).toEqual({
        hasSession: true,
        id: 'instagram:-promobot.official',
        status: 'active',
        validatedAt: '2026-04-21T09:17:15.000Z',
        storageStatePath: 'browser-sessions/managed/instagram/-promobot.official.json',
      });
      expect(jobQueueStore.list({ limit: 10 })).toEqual([]);
      expect(
        getSessionRequestResultArtifact({
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'relogin',
          requestJobId: 41,
        }),
      ).toEqual(
        expect.objectContaining({
          consumedAt: expect.any(String),
          savedStorageStatePath:
            'browser-sessions/managed/instagram/-promobot.official.json',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports matching inbox reply handoff result artifacts when the poll handler runs', async () => {
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
      const handoffArtifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);
      const resultArtifactPath = writeInboxReplyHandoffResultArtifact(
        rootDir,
        handoffArtifactPath,
        item.id,
      );

      const handlers = createDefaultJobHandlers();
      await handlers[inboxReplyHandoffPollJobType](
        {
          artifactPath: handoffArtifactPath,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 61,
          type: inboxReplyHandoffPollJobType,
          payload: {
            artifactPath: handoffArtifactPath,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-29T08:02:00.000Z',
        }),
      );

      expect(inboxStore.list()).toEqual([
        expect.objectContaining({
          id: item.id,
          status: 'handled',
        }),
      ]);
      expect(
        JSON.parse(readFileSync(path.join(rootDir, handoffArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          status: 'resolved',
          resolvedAt: expect.any(String),
          resolution: expect.objectContaining({
            replyStatus: 'sent',
            itemStatus: 'handled',
            deliveryUrl: 'https://weibo.test/post/12#reply-42',
            externalId: 'wb-reply-42',
            message: 'browser lane replied from weibo',
          }),
        }),
      );
      expect(
        JSON.parse(readFileSync(path.join(rootDir, resultArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          consumedAt: expect.any(String),
          resolution: expect.objectContaining({
            status: 'imported',
            handoffArtifactPath,
            itemId: item.id,
            itemStatus: 'handled',
            replyStatus: 'sent',
            deliveryUrl: 'https://weibo.test/post/12#reply-42',
            externalId: 'wb-reply-42',
            message: 'browser lane replied from weibo',
            deliveredAt: '2026-04-29T08:01:00.000Z',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('requeues a follow-up poll job when the inbox reply handoff result is still missing', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T08:16:00.000Z'));
      const inboxStore = createInboxStore();
      const jobQueueStore = createJobQueueStore();
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
      const handoffArtifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id);

      const handlers = createDefaultJobHandlers();
      await handlers[inboxReplyHandoffPollJobType](
        {
          artifactPath: handoffArtifactPath,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 62,
          type: inboxReplyHandoffPollJobType,
          payload: {
            artifactPath: handoffArtifactPath,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-29T08:16:00.000Z',
        }),
      );

      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:17:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath: handoffArtifactPath,
        attempt: 1,
        maxAttempts: 3,
        pollDelayMs: 60_000,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('promotes blocked inbox reply handoffs to ready and queues a follow-up poll job after session import', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const jobQueueStore = createJobQueueStore();
      const channelAccount = channelAccountStore.create({
        projectId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        projectId: 1,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: channelAccount.id,
          accountKey: 'weibo-browser-main',
        },
      });
      const handoffArtifactPath = writePendingInboxReplyHandoffArtifact(rootDir, item.id, {
        channelAccountId: channelAccount.id,
        readiness: 'blocked',
        sessionAction: 'request_session',
        session: {
          hasSession: false,
          id: 'weibo:weibo-browser-main',
          status: 'missing',
          validatedAt: null,
          storageStatePath: null,
        },
      });
      createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt: '2026-04-21T09:15:00.000Z',
        jobId: 41,
        jobStatus: 'pending',
        nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      });
      createSessionRequestResultArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestJobId: 41,
        completedAt: '2026-04-21T09:17:00.000Z',
        storageState: defaultStorageState,
        sessionStatus: 'active',
        validatedAt: '2026-04-21T09:18:00.000Z',
        notes: 'imported by poll handler',
      });

      const handlers = createDefaultJobHandlers();
      await handlers[channelAccountSessionRequestPollJobType](
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
          requestJobId: 41,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 42,
          type: channelAccountSessionRequestPollJobType,
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
            requestJobId: 41,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-21T09:17:00.000Z',
        }),
      );

      expect(
        JSON.parse(readFileSync(path.join(rootDir, handoffArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          status: 'pending',
          readiness: 'ready',
          sessionAction: null,
          session: expect.objectContaining({
            hasSession: true,
            status: 'active',
            validatedAt: '2026-04-21T09:18:00.000Z',
          }),
        }),
      );
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: inboxReplyHandoffPollJobType,
          status: 'pending',
          attempts: 0,
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath: handoffArtifactPath,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('imports matching browser handoff result artifacts when the poll handler runs', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      draftStore.create({
        projectId: 55,
        platform: 'instagram',
        title: 'Launch reel',
        content: 'Needs browser lane publish',
        target: 'campaign-1',
        status: 'review',
      });
      const handoffArtifactPath = writePendingBrowserHandoffArtifact(rootDir);
      const resultArtifactPath = writeBrowserHandoffResultArtifact(rootDir, handoffArtifactPath);

      const handlers = createDefaultJobHandlers();
      await handlers[browserHandoffPollJobType](
        {
          artifactPath: handoffArtifactPath,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 51,
          type: browserHandoffPollJobType,
          payload: {
            artifactPath: handoffArtifactPath,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-29T08:02:00.000Z',
        }),
      );

      expect(draftStore.getById(1)).toEqual(
        expect.objectContaining({
          status: 'published',
          publishedAt: '2026-04-29T08:01:00.000Z',
        }),
      );
      expect(publishLogStore.listByDraftId(1)).toEqual([
        expect.objectContaining({
          draftId: 1,
          projectId: 55,
          status: 'published',
          publishUrl: 'https://instagram.com/p/launch-reel',
          message: 'browser lane published the reel',
        }),
      ]);
      expect(
        JSON.parse(readFileSync(path.join(rootDir, handoffArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          status: 'resolved',
          resolvedAt: expect.any(String),
          resolution: expect.objectContaining({
            publishStatus: 'published',
            publishUrl: 'https://instagram.com/p/launch-reel',
            message: 'browser lane published the reel',
          }),
        }),
      );
      expect(
        JSON.parse(readFileSync(path.join(rootDir, resultArtifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          consumedAt: expect.any(String),
          resolution: expect.objectContaining({
            status: 'imported',
            draftStatus: 'published',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('requeues a follow-up poll job when the browser handoff result is still missing', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T08:00:00.000Z'));
      const jobQueueStore = createJobQueueStore();
      const handoffArtifactPath = writePendingBrowserHandoffArtifact(rootDir);

      const handlers = createDefaultJobHandlers();
      await handlers[browserHandoffPollJobType](
        {
          artifactPath: handoffArtifactPath,
          attempt: 0,
          maxAttempts: 3,
          pollDelayMs: 60_000,
        },
        createJobRecord({
          id: 61,
          type: browserHandoffPollJobType,
          payload: {
            artifactPath: handoffArtifactPath,
            attempt: 0,
            maxAttempts: 3,
            pollDelayMs: 60_000,
          },
          runAt: '2026-04-29T08:00:00.000Z',
        }),
      );

      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: browserHandoffPollJobType,
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:01:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath: handoffArtifactPath,
        attempt: 1,
        maxAttempts: 3,
        pollDelayMs: 60_000,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });
});
