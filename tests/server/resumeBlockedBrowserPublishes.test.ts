import { afterEach, describe, expect, it } from 'vitest';

import { resumeBlockedBrowserPublishesForChannelAccount } from '../../src/server/services/browser/resumeBlockedBrowserPublishes';
import { writeBrowserHandoffArtifact } from '../../src/server/services/publishers/browserHandoffArtifacts';
import { createBrowserHandoffResultArtifact } from '../../src/server/services/publishers/browserHandoffResultArtifacts';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

afterEach(() => {
  delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
});

describe('resumeBlockedBrowserPublishesForChannelAccount', () => {
  it('queues a poll job instead of rescheduling publish when a blocked handoff already has a result artifact', () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const jobQueueStore = createJobQueueStore();
      const draft = draftStore.create({
        projectId: 55,
        platform: 'instagram',
        title: 'Launch reel',
        content: 'Needs browser lane publish',
        target: '@brand-account',
        status: 'review',
        metadata: {
          accountKey: 'launch-campaign',
        },
      });
      const artifact = writeBrowserHandoffArtifact({
        channelAccountId: 1,
        platform: 'instagram',
        accountKey: 'launch-campaign',
        request: {
          draftId: draft.id,
          title: draft.title,
          content: draft.content,
          target: draft.target,
        },
        session: {
          hasSession: true,
          id: 'instagram:launch-campaign',
          status: 'expired',
          validatedAt: '2026-04-21T07:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/instagram-launch.json',
        },
        sessionAction: 'relogin',
      });
      createBrowserHandoffResultArtifact({
        handoffArtifactPath: artifact.artifactPath,
        channelAccountId: 1,
        platform: 'instagram',
        accountKey: 'launch-campaign',
        draftId: String(draft.id),
        completedAt: '2026-04-29T09:00:30.000Z',
        publishStatus: 'published',
        message: 'browser lane published the reel',
        publishUrl: 'https://instagram.test/p/launch-reel',
        externalId: 'launch-reel',
        publishedAt: '2026-04-29T09:00:15.000Z',
      });
      publishLogStore.create({
        draftId: draft.id,
        projectId: draft.projectId,
        status: 'manual_required',
        message: `instagram draft ${draft.id} requires the browser session to be refreshed before manual handoff.`,
      });

      const resumedJobs = resumeBlockedBrowserPublishesForChannelAccount(
        {
          projectId: 55,
          platform: 'instagram',
          accountKey: 'launch-campaign',
        },
        {
          hasSession: true,
          status: 'active',
        },
        {
          draftStore,
          publishLogStore,
          jobQueueStore,
          now: () => new Date('2026-04-29T09:00:00.000Z'),
        },
      );

      expect(resumedJobs).toHaveLength(1);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'browser_handoff_poll',
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
      expect(jobQueueStore.list({ limit: 10 }).some((job) => job.type === 'publish')).toBe(false);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('ignores stale result artifacts from an older handoff attempt when a newer blocked handoff is pending', () => {
    const { rootDir } = createTestDatabasePath();
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const jobQueueStore = createJobQueueStore();
      const draft = draftStore.create({
        projectId: 55,
        platform: 'instagram',
        title: 'Launch reel',
        content: 'Needs browser lane publish',
        target: '@brand-account',
        status: 'review',
        metadata: {
          accountKey: 'launch-campaign',
        },
      });
      const firstArtifact = writeBrowserHandoffArtifact({
        channelAccountId: 1,
        platform: 'instagram',
        accountKey: 'launch-campaign',
        request: {
          draftId: draft.id,
          title: draft.title,
          content: draft.content,
          target: draft.target,
        },
        session: {
          hasSession: true,
          id: 'instagram:launch-campaign',
          status: 'expired',
          validatedAt: '2026-04-21T07:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/instagram-launch.json',
        },
        sessionAction: 'relogin',
      });
      createBrowserHandoffResultArtifact({
        handoffArtifactPath: firstArtifact.artifactPath,
        handoffAttempt: 1,
        channelAccountId: 1,
        platform: 'instagram',
        accountKey: 'launch-campaign',
        draftId: String(draft.id),
        completedAt: '2026-04-29T09:00:30.000Z',
        publishStatus: 'published',
        message: 'browser lane published the reel',
        publishUrl: 'https://instagram.test/p/launch-reel',
        externalId: 'launch-reel',
        publishedAt: '2026-04-29T09:00:15.000Z',
      });
      const secondArtifact = writeBrowserHandoffArtifact({
        channelAccountId: 1,
        platform: 'instagram',
        accountKey: 'launch-campaign',
        request: {
          draftId: draft.id,
          title: draft.title,
          content: draft.content,
          target: draft.target,
        },
        session: {
          hasSession: true,
          id: 'instagram:launch-campaign',
          status: 'expired',
          validatedAt: '2026-04-29T09:05:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/instagram-launch-fresh.json',
        },
        sessionAction: 'relogin',
      });
      publishLogStore.create({
        draftId: draft.id,
        projectId: draft.projectId,
        status: 'manual_required',
        message: `instagram draft ${draft.id} requires the browser session to be refreshed before manual handoff.`,
      });

      const resumedJobs = resumeBlockedBrowserPublishesForChannelAccount(
        {
          projectId: 55,
          platform: 'instagram',
          accountKey: 'launch-campaign',
        },
        {
          hasSession: true,
          status: 'active',
        },
        {
          draftStore,
          publishLogStore,
          jobQueueStore,
          now: () => new Date('2026-04-29T09:10:00.000Z'),
        },
      );

      expect(secondArtifact.artifactPath).toBe(firstArtifact.artifactPath);
      expect(resumedJobs).toHaveLength(1);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'publish',
          status: 'pending',
        }),
      ]);
      expect(jobQueueStore.list({ limit: 10 }).some((job) => job.type === 'browser_handoff_poll')).toBe(false);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
