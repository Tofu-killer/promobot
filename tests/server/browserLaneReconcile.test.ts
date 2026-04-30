import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBrowserLaneReconcileHelpText,
  parseBrowserLaneReconcileArgs,
  runBrowserLaneReconcileCli,
} from '../../src/server/cli/browserLaneReconcile';
import {
  defaultSessionRequestPollDelayMs,
  defaultSessionRequestPollMaxAttempts,
  channelAccountSessionRequestPollJobType,
} from '../../src/server/services/browser/sessionRequestHandler';
import {
  createSessionRequestArtifact,
  createSessionRequestResultArtifact,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import {
  defaultInboxReplyHandoffPollDelayMs,
  defaultInboxReplyHandoffPollMaxAttempts,
  inboxReplyHandoffPollJobType,
} from '../../src/server/services/inbox/replyHandoffPollHandler';
import {
  markInboxReplyHandoffArtifactsObsoleteForAccount,
  writeInboxReplyHandoffArtifact,
} from '../../src/server/services/inbox/replyHandoffArtifacts';
import { createInboxReplyHandoffResultArtifact } from '../../src/server/services/inbox/replyHandoffResultArtifacts';
import {
  browserHandoffPollJobType,
  defaultBrowserHandoffPollDelayMs,
  defaultBrowserHandoffPollMaxAttempts,
} from '../../src/server/services/publishers/browserHandoffPollHandler';
import {
  markBrowserHandoffArtifactsObsoleteForAccount,
  resolveBrowserHandoffArtifact,
  writeBrowserHandoffArtifact,
} from '../../src/server/services/publishers/browserHandoffArtifacts';
import { createBrowserHandoffResultArtifact } from '../../src/server/services/publishers/browserHandoffResultArtifacts';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { createInboxStore } from '../../src/server/store/inbox';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import {
  cleanupTestDatabasePath,
  createTestDatabasePath,
  isolateProcessCwd,
} from './testDb';

let restoreCwd: (() => void) | null = null;

describe('browser lane reconcile cli', () => {
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
  });

  it('exposes a package script and parses apply/kind flags', () => {
    const packageJsonPath = path.resolve(import.meta.dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      'browser:lane:reconcile': 'tsx src/server/cli/browserLaneReconcile.ts',
    });
    expect(parseBrowserLaneReconcileArgs([])).toEqual({
      apply: false,
      kind: 'all',
      showHelp: false,
    });
    expect(parseBrowserLaneReconcileArgs(['--apply', '--kind', 'publish_handoff'])).toEqual({
      apply: true,
      kind: 'publish_handoff',
      showHelp: false,
    });
    expect(parseBrowserLaneReconcileArgs(['--kind=inbox_reply_handoff'])).toEqual({
      apply: false,
      kind: 'inbox_reply_handoff',
      showHelp: false,
    });
    expect(parseBrowserLaneReconcileArgs(['--help'])).toEqual({
      apply: false,
      kind: 'all',
      showHelp: true,
    });
    expect(parseBrowserLaneReconcileArgs(['--', '--help'])).toEqual({
      apply: false,
      kind: 'all',
      showHelp: true,
    });
  });

  it('defaults to dry-run and only plans unresolved session requests plus ready handoffs', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const {
        sessionRequestArtifactPath,
        readyPublishArtifactPath,
        readyReplyArtifactPath,
        resultReadySessionRequestArtifactPath,
        resultReadyPublishArtifactPath,
        resultReadyReplyArtifactPath,
      } =
        seedReconcileArtifacts();
      const dispatch = vi.fn(() => true);

      const result = await runBrowserLaneReconcileCli(
        {
          apply: false,
          kind: 'all',
          showHelp: false,
        },
        {
          browserLaneDispatch: dispatch,
        },
      );

      expect(dispatch).not.toHaveBeenCalled();
      expect(createJobQueueStore().list({ statuses: ['pending', 'running'] })).toEqual([]);
      expect(result).toMatchObject({
        dryRun: true,
        counts: {
          planned: 3,
          replayed: 0,
          skipped: 9,
          pollJobsEnqueued: 0,
          pollJobsExisting: 0,
        },
      });
      expect(result.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'session_request',
            artifactPath: sessionRequestArtifactPath,
            status: 'planned',
            reason: 'unresolved',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: readyPublishArtifactPath,
            status: 'planned',
            reason: 'ready',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath: readyReplyArtifactPath,
            status: 'planned',
            reason: 'ready',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: resultReadyPublishArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath: resultReadyReplyArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'session_request',
            artifactPath: resultReadySessionRequestArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            status: 'skipped',
            reason: 'blocked',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            status: 'skipped',
            reason: 'resolved',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            status: 'skipped',
            reason: 'blocked',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            status: 'skipped',
            reason: 'obsolete',
          }),
        ]),
      );
    } finally {
      process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('re-dispatches stranded ready artifacts on apply and only backfills missing poll jobs', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const {
        sessionRequestArtifactPath,
        readyPublishArtifactPath,
        readyReplyArtifactPath,
        resultReadySessionRequestArtifactPath,
        resultReadyPublishArtifactPath,
        resultReadyReplyArtifactPath,
      } = seedReconcileArtifacts();
      const jobQueueStore = createJobQueueStore();
      const dispatch = vi.fn(() => true);

      jobQueueStore.enqueue({
        type: channelAccountSessionRequestPollJobType,
        payload: {
          accountId: 1,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          requestJobId: 41,
          attempt: 0,
          maxAttempts: defaultSessionRequestPollMaxAttempts,
          pollDelayMs: defaultSessionRequestPollDelayMs,
        },
        runAt: '2026-04-30T12:01:00.000Z',
      });
      jobQueueStore.enqueue({
        type: inboxReplyHandoffPollJobType,
        payload: {
          artifactPath: readyReplyArtifactPath,
          attempt: 0,
          maxAttempts: defaultInboxReplyHandoffPollMaxAttempts,
          pollDelayMs: defaultInboxReplyHandoffPollDelayMs,
        },
        runAt: '2026-04-30T12:02:00.000Z',
      });

      const result = await runBrowserLaneReconcileCli(
        {
          apply: true,
          kind: 'all',
          showHelp: false,
        },
        {
          browserLaneDispatch: dispatch,
          now: () => new Date('2026-04-30T12:00:00.000Z'),
        },
      );

      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dispatch).toHaveBeenCalledWith({
        kind: 'session_request',
        artifactPath: sessionRequestArtifactPath,
        platform: 'x',
        accountKey: '@promobot',
        managedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        sessionAction: 'request_session',
        channelAccountId: 1,
        requestJobId: 41,
      });
      expect(dispatch).toHaveBeenCalledWith({
        kind: 'publish_handoff',
        artifactPath: readyPublishArtifactPath,
        platform: 'instagram',
        accountKey: 'ig-main',
        draftId: '11',
      });
      expect(dispatch).toHaveBeenCalledWith({
        kind: 'inbox_reply_handoff',
        artifactPath: readyReplyArtifactPath,
        platform: 'weibo',
        accountKey: 'weibo-main',
        itemId: '1',
      });

      const queuedJobs = createJobQueueStore().list({ statuses: ['pending', 'running'] });
      expect(queuedJobs).toHaveLength(8);
      expect(
        queuedJobs.filter((job) => job.type === channelAccountSessionRequestPollJobType),
      ).toHaveLength(2);
      expect(
        queuedJobs.filter((job) => job.type === inboxReplyHandoffPollJobType),
      ).toHaveLength(3);
      expect(
        queuedJobs.filter((job) => job.type === browserHandoffPollJobType),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: JSON.stringify({
              artifactPath: readyPublishArtifactPath,
              attempt: 0,
              maxAttempts: defaultBrowserHandoffPollMaxAttempts,
              pollDelayMs: defaultBrowserHandoffPollDelayMs,
            }),
            runAt: '2026-04-30T12:01:00.000Z',
          }),
          expect.objectContaining({
            payload: JSON.stringify({
              artifactPath: resultReadyPublishArtifactPath,
              attempt: 0,
              maxAttempts: defaultBrowserHandoffPollMaxAttempts,
              pollDelayMs: defaultBrowserHandoffPollDelayMs,
            }),
            runAt: '2026-04-30T12:01:00.000Z',
          }),
          expect.objectContaining({
            payload: JSON.stringify({
              artifactPath:
                'artifacts/browser-handoffs/instagram/ig-blocked-result-ready/instagram-draft-15.json',
              attempt: 0,
              maxAttempts: defaultBrowserHandoffPollMaxAttempts,
              pollDelayMs: defaultBrowserHandoffPollDelayMs,
            }),
            runAt: '2026-04-30T12:01:00.000Z',
          }),
        ]),
      );

      expect(result).toMatchObject({
        dryRun: false,
        counts: {
          planned: 0,
          replayed: 3,
          skipped: 9,
          pollJobsEnqueued: 6,
          pollJobsExisting: 2,
        },
      });
      expect(result.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'session_request',
            artifactPath: sessionRequestArtifactPath,
            status: 'replayed',
            pollJobStatus: 'existing',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: readyPublishArtifactPath,
            status: 'replayed',
            pollJobStatus: 'enqueued',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath: readyReplyArtifactPath,
            status: 'replayed',
            pollJobStatus: 'existing',
          }),
          expect.objectContaining({
            kind: 'session_request',
            artifactPath: resultReadySessionRequestArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: resultReadyPublishArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath: resultReadyReplyArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath:
              'artifacts/browser-handoffs/instagram/ig-blocked-result-ready/instagram-draft-15.json',
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath:
              'artifacts/inbox-reply-handoffs/weibo/weibo-blocked-result-ready/weibo-inbox-item-5.json',
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
        ]),
      );
    } finally {
      process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('skips apply when dispatch is unconfigured and still supports kind filtering', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const { readyPublishArtifactPath, resultReadyPublishArtifactPath } = seedReconcileArtifacts();

      const result = await runBrowserLaneReconcileCli(
        {
          apply: true,
          kind: 'publish_handoff',
          showHelp: false,
        },
        {
          browserLaneDispatch: () => false,
          now: () => new Date('2026-04-30T12:00:00.000Z'),
        },
      );

      const queuedPollJobs = createJobQueueStore().list({ statuses: ['pending', 'running'] });
      expect(queuedPollJobs).toHaveLength(2);
      expect(queuedPollJobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: browserHandoffPollJobType,
            payload: JSON.stringify({
              artifactPath: resultReadyPublishArtifactPath,
              attempt: 0,
              maxAttempts: defaultBrowserHandoffPollMaxAttempts,
              pollDelayMs: defaultBrowserHandoffPollDelayMs,
            }),
            runAt: '2026-04-30T12:01:00.000Z',
          }),
          expect.objectContaining({
            type: browserHandoffPollJobType,
            payload: JSON.stringify({
              artifactPath:
                'artifacts/browser-handoffs/instagram/ig-blocked-result-ready/instagram-draft-15.json',
              attempt: 0,
              maxAttempts: defaultBrowserHandoffPollMaxAttempts,
              pollDelayMs: defaultBrowserHandoffPollDelayMs,
            }),
            runAt: '2026-04-30T12:01:00.000Z',
          }),
        ]),
      );
      expect(result).toMatchObject({
        dryRun: false,
        counts: {
          planned: 0,
          replayed: 0,
          skipped: 5,
          pollJobsEnqueued: 2,
          pollJobsExisting: 0,
        },
      });
      expect(result.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: readyPublishArtifactPath,
            status: 'skipped',
            reason: 'dispatch_unconfigured',
          }),
          expect.objectContaining({
            kind: 'publish_handoff',
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
        ]),
      );
      expect(
        result.entries.every((entry) => entry.kind === 'publish_handoff'),
      ).toBe(true);
    } finally {
      process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('treats blocked handoffs with ready result artifacts as result-ready work during reconcile', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const {
        blockedResultReadyPublishArtifactPath,
        blockedResultReadyReplyArtifactPath,
      } = seedReconcileArtifacts();

      const dryRunResult = await runBrowserLaneReconcileCli(
        {
          apply: false,
          kind: 'all',
          showHelp: false,
        },
        {
          browserLaneDispatch: vi.fn(() => true),
        },
      );

      expect(dryRunResult.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: blockedResultReadyPublishArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'would_enqueue',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath: blockedResultReadyReplyArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'would_enqueue',
          }),
        ]),
      );

      const applyResult = await runBrowserLaneReconcileCli(
        {
          apply: true,
          kind: 'all',
          showHelp: false,
        },
        {
          browserLaneDispatch: vi.fn(() => false),
          now: () => new Date('2026-04-30T12:00:00.000Z'),
        },
      );

      expect(applyResult.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'publish_handoff',
            artifactPath: blockedResultReadyPublishArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
          expect.objectContaining({
            kind: 'inbox_reply_handoff',
            artifactPath: blockedResultReadyReplyArtifactPath,
            status: 'skipped',
            reason: 'result_ready',
            pollJobStatus: 'enqueued',
          }),
        ]),
      );
    } finally {
      process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('documents dry-run and kind selection in help text', () => {
    const helpText = getBrowserLaneReconcileHelpText();

    expect(helpText).toContain('pnpm browser:lane:reconcile');
    expect(helpText).toContain('--apply');
    expect(helpText).toContain('--kind');
    expect(helpText).toContain('session_request');
    expect(helpText).toContain('publish_handoff');
    expect(helpText).toContain('inbox_reply_handoff');
    expect(helpText).toContain('dry-run');
  });
});

function seedReconcileArtifacts() {
  const channelAccountStore = createChannelAccountStore();
  const inboxStore = createInboxStore();

  const sessionAccount = channelAccountStore.create({
    projectId: 1,
    platform: 'x',
    accountKey: '@promobot',
    displayName: 'Promobot X',
    authType: 'browser',
    status: 'healthy',
  });
  const publishAccount = channelAccountStore.create({
    projectId: 2,
    platform: 'instagram',
    accountKey: 'ig-main',
    displayName: 'PromoBot Instagram',
    authType: 'browser',
    status: 'healthy',
  });
  const blockedPublishAccount = channelAccountStore.create({
    projectId: 2,
    platform: 'instagram',
    accountKey: 'ig-blocked',
    displayName: 'PromoBot Instagram Blocked',
    authType: 'browser',
    status: 'healthy',
  });
  const resolvedPublishAccount = channelAccountStore.create({
    projectId: 2,
    platform: 'instagram',
    accountKey: 'ig-resolved',
    displayName: 'PromoBot Instagram Resolved',
    authType: 'browser',
    status: 'healthy',
  });
  const replyAccount = channelAccountStore.create({
    projectId: 3,
    platform: 'weibo',
    accountKey: 'weibo-main',
    displayName: 'PromoBot Weibo',
    authType: 'browser',
    status: 'healthy',
  });
  const blockedReplyAccount = channelAccountStore.create({
    projectId: 3,
    platform: 'weibo',
    accountKey: 'weibo-blocked',
    displayName: 'PromoBot Weibo Blocked',
    authType: 'browser',
    status: 'healthy',
  });
  const resultReadySessionAccount = channelAccountStore.create({
    projectId: 1,
    platform: 'x',
    accountKey: '@promobot-result',
    displayName: 'Promobot X Result Ready',
    authType: 'browser',
    status: 'healthy',
  });
  const resultReadyPublishAccount = channelAccountStore.create({
    projectId: 2,
    platform: 'instagram',
    accountKey: 'ig-result-ready',
    displayName: 'PromoBot Instagram Result Ready',
    authType: 'browser',
    status: 'healthy',
  });
  const resultReadyReplyAccount = channelAccountStore.create({
    projectId: 3,
    platform: 'weibo',
    accountKey: 'weibo-result-ready',
    displayName: 'PromoBot Weibo Result Ready',
    authType: 'browser',
    status: 'healthy',
  });
  const blockedResultReadyPublishAccount = channelAccountStore.create({
    projectId: 2,
    platform: 'instagram',
    accountKey: 'ig-blocked-result-ready',
    displayName: 'PromoBot Instagram Blocked Result Ready',
    authType: 'browser',
    status: 'healthy',
  });
  const blockedResultReadyReplyAccount = channelAccountStore.create({
    projectId: 3,
    platform: 'weibo',
    accountKey: 'weibo-blocked-result-ready',
    displayName: 'PromoBot Weibo Blocked Result Ready',
    authType: 'browser',
    status: 'healthy',
  });

  const readyReplyItem = inboxStore.create({
    projectId: 3,
    source: 'weibo',
    status: 'needs_reply',
    author: 'ops-user',
    title: 'Community question',
    excerpt: 'Can you share current response times?',
    metadata: {
      accountKey: 'weibo-main',
    },
  });
  const blockedReplyItem = inboxStore.create({
    projectId: 3,
    source: 'weibo',
    status: 'needs_reply',
    author: 'ops-user',
    title: 'Session is missing',
    excerpt: 'Please log back in.',
    metadata: {
      accountKey: 'weibo-blocked',
    },
  });
  const obsoleteReplyItem = inboxStore.create({
    projectId: 3,
    source: 'weibo',
    status: 'needs_reply',
    author: 'ops-user',
    title: 'Old ticket',
    excerpt: 'This should stay obsolete.',
    metadata: {
      accountKey: 'weibo-obsolete',
    },
  });

  const resultReadyReplyItem = inboxStore.create({
    projectId: 3,
    source: 'weibo',
    status: 'needs_reply',
    author: 'ops-user',
    title: 'Result already uploaded',
    excerpt: 'Bridge produced a reply artifact already.',
    metadata: {
      accountKey: 'weibo-result-ready',
    },
  });
  const blockedResultReadyReplyItem = inboxStore.create({
    projectId: 3,
    source: 'weibo',
    status: 'needs_reply',
    author: 'ops-user',
    title: 'Result uploaded before relogin finished',
    excerpt: 'The lane replied already, but the artifact stayed blocked.',
    metadata: {
      accountKey: 'weibo-blocked-result-ready',
    },
  });

  const sessionRequestArtifactPath = createSessionRequestArtifact({
    channelAccountId: sessionAccount.id,
    platform: 'x',
    accountKey: '@promobot',
    action: 'request_session',
    requestedAt: '2026-04-30T11:00:00.000Z',
    jobId: 41,
    jobStatus: 'pending',
    nextStep: '/api/channel-accounts/1/session',
  });
  const resultReadySessionRequestArtifactPath = createSessionRequestArtifact({
    channelAccountId: resultReadySessionAccount.id,
    platform: 'x',
    accountKey: '@promobot-result',
    action: 'request_session',
    requestedAt: '2026-04-30T11:05:00.000Z',
    jobId: 42,
    jobStatus: 'pending',
    nextStep: '/api/channel-accounts/7/session',
  });
  createSessionRequestResultArtifact({
    channelAccountId: resultReadySessionAccount.id,
    platform: 'x',
    accountKey: '@promobot-result',
    action: 'request_session',
    requestJobId: 42,
    completedAt: '2026-04-30T11:20:00.000Z',
    validatedAt: '2026-04-30T11:20:00.000Z',
    sessionStatus: 'active',
    storageState: {
      cookies: [],
      origins: [],
    },
  });

  const readyPublishArtifact = writeBrowserHandoffArtifact({
    channelAccountId: publishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-main',
    request: {
      draftId: 11,
      title: 'Launch update',
      content: 'Ship the feature update',
      target: '@promobot',
      metadata: {
        projectId: 2,
        accountKey: 'ig-main',
      },
    },
    session: {
      hasSession: true,
      id: 'instagram:ig-main',
      status: 'active',
      validatedAt: '2026-04-30T10:00:00.000Z',
      storageStatePath: 'browser-sessions/managed/instagram/ig-main.json',
    },
  });
  writeBrowserHandoffArtifact({
    channelAccountId: blockedPublishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-blocked',
    request: {
      draftId: 12,
      title: 'Blocked update',
      content: 'Need a new session',
      target: '@promobot',
      metadata: {
        projectId: 2,
        accountKey: 'ig-blocked',
      },
    },
    session: {
      hasSession: false,
      id: 'instagram:ig-blocked',
      status: 'missing',
      validatedAt: null,
      storageStatePath: null,
    },
    sessionAction: 'request_session',
  });
  const resolvedPublishArtifact = writeBrowserHandoffArtifact({
    channelAccountId: resolvedPublishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-resolved',
    request: {
      draftId: 13,
      title: 'Resolved update',
      content: 'Already finished',
      target: '@promobot',
      metadata: {
        projectId: 2,
        accountKey: 'ig-resolved',
      },
    },
    session: {
      hasSession: true,
      id: 'instagram:ig-resolved',
      status: 'active',
      validatedAt: '2026-04-30T10:05:00.000Z',
      storageStatePath: 'browser-sessions/managed/instagram/ig-resolved.json',
    },
  });
  resolveBrowserHandoffArtifact({
    platform: 'instagram',
    accountKey: 'ig-resolved',
    draftId: '13',
    publishStatus: 'published',
    draftStatus: 'published',
    publishUrl: 'https://instagram.test/p/13',
    externalId: 'ig-13',
    message: 'already published',
    publishedAt: '2026-04-30T11:10:00.000Z',
  });
  const resultReadyPublishArtifact = writeBrowserHandoffArtifact({
    channelAccountId: resultReadyPublishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-result-ready',
    request: {
      draftId: 14,
      title: 'Result-ready update',
      content: 'Already completed out of band',
      target: '@promobot',
      metadata: {
        projectId: 2,
        accountKey: 'ig-result-ready',
      },
    },
    session: {
      hasSession: true,
      id: 'instagram:ig-result-ready',
      status: 'active',
      validatedAt: '2026-04-30T10:12:00.000Z',
      storageStatePath: 'browser-sessions/managed/instagram/ig-result-ready.json',
    },
  });
  createBrowserHandoffResultArtifact({
    handoffArtifactPath: resultReadyPublishArtifact.artifactPath,
    channelAccountId: resultReadyPublishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-result-ready',
    draftId: '14',
    completedAt: '2026-04-30T11:30:00.000Z',
    publishStatus: 'published',
    message: 'published out of band',
    publishUrl: 'https://instagram.test/p/14',
    externalId: 'ig-14',
    publishedAt: '2026-04-30T11:29:00.000Z',
  });
  const blockedResultReadyPublishArtifact = writeBrowserHandoffArtifact({
    channelAccountId: blockedResultReadyPublishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-blocked-result-ready',
    request: {
      draftId: 15,
      title: 'Blocked result-ready update',
      content: 'The lane already published this post.',
      target: '@promobot',
      metadata: {
        projectId: 2,
        accountKey: 'ig-blocked-result-ready',
      },
    },
    session: {
      hasSession: false,
      id: 'instagram:ig-blocked-result-ready',
      status: 'missing',
      validatedAt: null,
      storageStatePath: null,
    },
    sessionAction: 'relogin',
  });
  createBrowserHandoffResultArtifact({
    handoffArtifactPath: blockedResultReadyPublishArtifact.artifactPath,
    channelAccountId: blockedResultReadyPublishAccount.id,
    platform: 'instagram',
    accountKey: 'ig-blocked-result-ready',
    draftId: '15',
    completedAt: '2026-04-30T11:32:00.000Z',
    publishStatus: 'published',
    message: 'published while the handoff stayed blocked',
    publishUrl: 'https://instagram.test/p/15',
    externalId: 'ig-15',
    publishedAt: '2026-04-30T11:31:00.000Z',
  });

  const readyReplyArtifact = writeInboxReplyHandoffArtifact({
    channelAccountId: replyAccount.id,
    platform: 'weibo',
    accountKey: 'weibo-main',
    item: readyReplyItem,
    reply: 'Thanks for reaching out.',
    sourceUrl: 'https://weibo.test/post/1',
    session: {
      hasSession: true,
      id: 'weibo:weibo-main',
      status: 'active',
      validatedAt: '2026-04-30T10:15:00.000Z',
      storageStatePath: 'browser-sessions/managed/weibo/weibo-main.json',
    },
  });
  const resultReadyReplyArtifact = writeInboxReplyHandoffArtifact({
    channelAccountId: resultReadyReplyAccount.id,
    platform: 'weibo',
    accountKey: 'weibo-result-ready',
    item: resultReadyReplyItem,
    reply: 'We already sent this reply.',
    sourceUrl: 'https://weibo.test/post/4',
    session: {
      hasSession: true,
      id: 'weibo:weibo-result-ready',
      status: 'active',
      validatedAt: '2026-04-30T10:25:00.000Z',
      storageStatePath: 'browser-sessions/managed/weibo/weibo-result-ready.json',
    },
  });
  createInboxReplyHandoffResultArtifact({
    handoffArtifactPath: resultReadyReplyArtifact.artifactPath,
    channelAccountId: resultReadyReplyAccount.id,
    platform: 'weibo',
    accountKey: 'weibo-result-ready',
    itemId: String(resultReadyReplyItem.id),
    completedAt: '2026-04-30T11:35:00.000Z',
    replyStatus: 'sent',
    message: 'sent out of band',
    deliveryUrl: 'https://weibo.test/post/4#reply',
    externalId: 'wb-4',
    deliveredAt: '2026-04-30T11:34:00.000Z',
  });
  const blockedResultReadyReplyArtifact = writeInboxReplyHandoffArtifact({
    channelAccountId: blockedResultReadyReplyAccount.id,
    platform: 'weibo',
    accountKey: 'weibo-blocked-result-ready',
    item: blockedResultReadyReplyItem,
    reply: 'We already answered this in the lane.',
    sourceUrl: 'https://weibo.test/post/5',
    session: {
      hasSession: false,
      id: 'weibo:weibo-blocked-result-ready',
      status: 'missing',
      validatedAt: null,
      storageStatePath: null,
    },
    sessionAction: 'request_session',
  });
  createInboxReplyHandoffResultArtifact({
    handoffArtifactPath: blockedResultReadyReplyArtifact.artifactPath,
    channelAccountId: blockedResultReadyReplyAccount.id,
    platform: 'weibo',
    accountKey: 'weibo-blocked-result-ready',
    itemId: String(blockedResultReadyReplyItem.id),
    completedAt: '2026-04-30T11:36:00.000Z',
    replyStatus: 'sent',
    message: 'reply sent while the handoff stayed blocked',
    deliveryUrl: 'https://weibo.test/post/5#reply',
    externalId: 'wb-5',
    deliveredAt: '2026-04-30T11:35:00.000Z',
  });
  writeInboxReplyHandoffArtifact({
    channelAccountId: blockedReplyAccount.id,
    platform: 'weibo',
    accountKey: 'weibo-blocked',
    item: blockedReplyItem,
    reply: 'We need to log back in first.',
    sourceUrl: 'https://weibo.test/post/2',
    session: {
      hasSession: false,
      id: 'weibo:weibo-blocked',
      status: 'missing',
      validatedAt: null,
      storageStatePath: null,
    },
    sessionAction: 'relogin',
  });
  writeInboxReplyHandoffArtifact({
    platform: 'weibo',
    accountKey: 'weibo-obsolete',
    item: obsoleteReplyItem,
    reply: 'Old reply',
    sourceUrl: 'https://weibo.test/post/3',
    session: {
      hasSession: true,
      id: 'weibo:weibo-obsolete',
      status: 'active',
      validatedAt: '2026-04-30T10:20:00.000Z',
      storageStatePath: 'browser-sessions/managed/weibo/weibo-obsolete.json',
    },
  });
  markInboxReplyHandoffArtifactsObsoleteForAccount({
    platform: 'weibo',
    accountKey: 'weibo-obsolete',
    reason: 'request_session',
  });

  return {
    sessionRequestArtifactPath,
    resultReadySessionRequestArtifactPath,
    readyPublishArtifactPath: readyPublishArtifact.artifactPath,
    resultReadyPublishArtifactPath: resultReadyPublishArtifact.artifactPath,
    blockedResultReadyPublishArtifactPath: blockedResultReadyPublishArtifact.artifactPath,
    readyReplyArtifactPath: readyReplyArtifact.artifactPath,
    resultReadyReplyArtifactPath: resultReadyReplyArtifact.artifactPath,
    blockedResultReadyReplyArtifactPath: blockedResultReadyReplyArtifact.artifactPath,
  };
}
