import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resumeBlockedInboxReplyHandoffsForChannelAccount } from '../../src/server/services/browser/resumeBlockedInboxReplyHandoffs';
import { writeInboxReplyHandoffArtifact } from '../../src/server/services/inbox/replyHandoffArtifacts';
import { createInboxReplyHandoffResultArtifact } from '../../src/server/services/inbox/replyHandoffResultArtifacts';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { createInboxStore } from '../../src/server/store/inbox';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
});

describe('resumeBlockedInboxReplyHandoffsForChannelAccount', () => {
  it('promotes blocked handoffs to ready, queues a poll job, and dispatches the browser lane', () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 55,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: 1,
          accountKey: 'weibo-browser-main',
        },
      });
      const artifact = writeInboxReplyHandoffArtifact({
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        sourceUrl: 'https://weibo.test/post/1',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'expired',
          validatedAt: '2026-04-21T07:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main.json',
        },
        sessionAction: 'relogin',
      });
      const jobQueueStore = createJobQueueStore();
      const browserLaneDispatch = vi.fn();

      const resumedJobs = resumeBlockedInboxReplyHandoffsForChannelAccount(
        {
          id: 1,
          projectId: 55,
          platform: 'weibo',
          accountKey: 'weibo-browser-main',
        },
        {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-21T08:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main-fresh.json',
        },
        {
          jobQueueStore,
          browserLaneDispatch,
          now: () => new Date('2026-04-29T09:00:00.000Z'),
        },
      );

      expect(resumedJobs).toHaveLength(1);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'inbox_reply_handoff_poll',
          status: 'pending',
          runAt: '2026-04-29T09:01:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath: artifact.artifactPath,
        handoffAttempt: artifact.handoffAttempt,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
      expect(browserLaneDispatch).toHaveBeenCalledTimes(1);
      expect(browserLaneDispatch).toHaveBeenCalledWith({
        kind: 'inbox_reply_handoff',
        artifactPath: artifact.artifactPath,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        channelAccountId: 1,
        itemId: String(item.id),
        handoffAttempt: artifact.handoffAttempt,
      });
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifact.artifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          status: 'pending',
          readiness: 'ready',
          sessionAction: null,
          session: expect.objectContaining({
            hasSession: true,
            status: 'active',
            validatedAt: '2026-04-21T08:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/weibo-browser-main-fresh.json',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('redispatches resumed handoffs without duplicating an existing poll job', () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 55,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: 1,
          accountKey: 'weibo-browser-main',
        },
      });
      const artifact = writeInboxReplyHandoffArtifact({
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        sourceUrl: 'https://weibo.test/post/1',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'expired',
          validatedAt: '2026-04-21T07:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main.json',
        },
        sessionAction: 'relogin',
      });
      const jobQueueStore = createJobQueueStore();
      jobQueueStore.enqueue({
        type: 'inbox_reply_handoff_poll',
        payload: {
          artifactPath: artifact.artifactPath,
          handoffAttempt: artifact.handoffAttempt,
          attempt: 0,
          maxAttempts: 60,
          pollDelayMs: 60_000,
        },
        runAt: '2026-04-29T09:01:00.000Z',
      });
      const browserLaneDispatch = vi.fn();

      const resumedJobs = resumeBlockedInboxReplyHandoffsForChannelAccount(
        {
          id: 1,
          projectId: 55,
          platform: 'weibo',
          accountKey: 'weibo-browser-main',
        },
        {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-21T08:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main-fresh.json',
        },
        {
          jobQueueStore,
          browserLaneDispatch,
          now: () => new Date('2026-04-29T09:00:00.000Z'),
        },
      );

      expect(resumedJobs).toEqual([]);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'inbox_reply_handoff_poll',
          status: 'pending',
          runAt: '2026-04-29T09:01:00.000Z',
        }),
      ]);
      expect(browserLaneDispatch).toHaveBeenCalledTimes(1);
      expect(browserLaneDispatch).toHaveBeenCalledWith({
        kind: 'inbox_reply_handoff',
        artifactPath: artifact.artifactPath,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        channelAccountId: 1,
        itemId: String(item.id),
        handoffAttempt: artifact.handoffAttempt,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('queues a poll job without redispatching when a blocked handoff already has a result artifact', () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 55,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: 1,
          accountKey: 'weibo-browser-main',
        },
      });
      const artifact = writeInboxReplyHandoffArtifact({
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        sourceUrl: 'https://weibo.test/post/1',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'expired',
          validatedAt: '2026-04-21T07:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main.json',
        },
        sessionAction: 'relogin',
      });
      createInboxReplyHandoffResultArtifact({
        handoffArtifactPath: artifact.artifactPath,
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        itemId: String(item.id),
        completedAt: '2026-04-29T09:00:30.000Z',
        replyStatus: 'sent',
        message: 'browser lane sent the reply',
        deliveryUrl: 'https://weibo.test/post/1#reply',
        externalId: 'reply-1',
        deliveredAt: '2026-04-29T09:00:15.000Z',
      });
      const jobQueueStore = createJobQueueStore();
      const browserLaneDispatch = vi.fn();

      const resumedJobs = resumeBlockedInboxReplyHandoffsForChannelAccount(
        {
          id: 1,
          projectId: 55,
          platform: 'weibo',
          accountKey: 'weibo-browser-main',
        },
        {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-21T08:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main-fresh.json',
        },
        {
          jobQueueStore,
          browserLaneDispatch,
          now: () => new Date('2026-04-29T09:00:00.000Z'),
        },
      );

      expect(resumedJobs).toHaveLength(1);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'inbox_reply_handoff_poll',
          status: 'pending',
          runAt: '2026-04-29T09:01:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath: artifact.artifactPath,
        handoffAttempt: artifact.handoffAttempt,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
      expect(browserLaneDispatch).not.toHaveBeenCalled();
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifact.artifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          status: 'pending',
          readiness: 'blocked',
          sessionAction: 'relogin',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('ignores stale result artifacts from an older reply handoff attempt when a newer blocked handoff is pending', () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        projectId: 55,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          channelAccountId: 1,
          accountKey: 'weibo-browser-main',
        },
      });
      const firstArtifact = writeInboxReplyHandoffArtifact({
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        sourceUrl: 'https://weibo.test/post/1',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'expired',
          validatedAt: '2026-04-21T07:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main.json',
        },
        sessionAction: 'relogin',
      });
      createInboxReplyHandoffResultArtifact({
        handoffArtifactPath: firstArtifact.artifactPath,
        handoffAttempt: 1,
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        itemId: String(item.id),
        completedAt: '2026-04-29T09:00:30.000Z',
        replyStatus: 'sent',
        message: 'browser lane sent the reply',
        deliveryUrl: 'https://weibo.test/post/1#reply',
        externalId: 'reply-1',
        deliveredAt: '2026-04-29T09:00:15.000Z',
      });
      const secondArtifact = writeInboxReplyHandoffArtifact({
        channelAccountId: 1,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out. We can share current APAC latency benchmarks.',
        sourceUrl: 'https://weibo.test/post/1',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'expired',
          validatedAt: '2026-04-21T07:45:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main-fresh.json',
        },
        sessionAction: 'relogin',
      });
      const jobQueueStore = createJobQueueStore();
      const browserLaneDispatch = vi.fn(() => true);

      const resumedJobs = resumeBlockedInboxReplyHandoffsForChannelAccount(
        {
          id: 1,
          projectId: 55,
          platform: 'weibo',
          accountKey: 'weibo-browser-main',
        },
        {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-21T08:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/weibo-browser-main-fresh.json',
        },
        {
          jobQueueStore,
          browserLaneDispatch,
          now: () => new Date('2026-04-29T09:10:00.000Z'),
        },
      );

      expect(secondArtifact.artifactPath).toBe(firstArtifact.artifactPath);
      expect(resumedJobs).toHaveLength(1);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'inbox_reply_handoff_poll',
          status: 'pending',
          runAt: '2026-04-29T09:11:00.000Z',
        }),
      ]);
      expect(browserLaneDispatch).toHaveBeenCalledTimes(1);
      expect(browserLaneDispatch).toHaveBeenCalledWith({
        kind: 'inbox_reply_handoff',
        artifactPath: secondArtifact.artifactPath,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        channelAccountId: 1,
        itemId: String(item.id),
        handoffAttempt: secondArtifact.handoffAttempt,
      });
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, secondArtifact.artifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          status: 'pending',
          readiness: 'ready',
          sessionAction: null,
          session: expect.objectContaining({
            hasSession: true,
            status: 'active',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
