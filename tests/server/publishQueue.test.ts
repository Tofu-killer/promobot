import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublishJobHandler } from '../../src/server/services/publishQueue';
import * as publishRouteModule from '../../src/server/routes/publish';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
import * as publishLogStoreModule from '../../src/server/store/publishLogs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

describe('publish queue handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks queued x drafts as failed when x credentials are missing and persists the failure log', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const draft = draftStore.create({
        projectId: 88,
        platform: 'x',
        title: 'Launch update',
        content: 'PromoBot launch',
        status: 'scheduled',
      });

      await expect(createPublishJobHandler()({ draftId: draft.id })).rejects.toThrow(
        'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
      );

      expect(draftStore.getById(draft.id)).toEqual(
        expect.objectContaining({
          id: draft.id,
          status: 'failed',
          scheduledAt: undefined,
          publishedAt: undefined,
        }),
      );
      expect(publishLogStore.listByDraftId(draft.id)).toEqual([
        expect.objectContaining({
          draftId: draft.id,
          projectId: 88,
          status: 'failed',
          publishUrl: undefined,
          message: 'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('keeps manual-review platforms in review status without fabricating publish timestamps', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const draft = draftStore.create({
        platform: 'facebook-group',
        title: 'Community handoff',
        content: 'Needs browser review',
        status: 'scheduled',
      });

      await createPublishJobHandler()({ draftId: draft.id });

      expect(draftStore.getById(draft.id)).toEqual(
        expect.objectContaining({
          id: draft.id,
          status: 'review',
          scheduledAt: undefined,
          publishedAt: undefined,
        }),
      );
      expect(publishLogStore.listByDraftId(draft.id)).toEqual([
        expect.objectContaining({
          draftId: draft.id,
          projectId: undefined,
          status: 'manual_required',
          publishUrl: undefined,
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('does not rewrite the draft to failed when local persistence throws after a successful publish result', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const persistedPublishLogStore = createSQLitePublishLogStore();
      const createdLogs: Array<{ status: string; message: string }> = [];
      const mockedPublishLogStore = {
        create: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('local log write exploded');
          })
          .mockImplementation((input: { status: string; message: string }) => {
            createdLogs.push(input);
            return {
              id: createdLogs.length,
              draftId: draft.id,
              status: input.status,
              message: input.message,
              createdAt: '2026-04-21T00:00:00.000Z',
            };
          }),
        listByDraftId: persistedPublishLogStore.listByDraftId.bind(persistedPublishLogStore),
      };
      const draft = draftStore.create({
        projectId: 88,
        platform: 'x',
        title: 'Already published',
        content: 'External publish completed before local logging failed',
        status: 'scheduled',
      });

      vi.spyOn(publishRouteModule, 'createDraftPublishAdapter').mockReturnValue(
        vi.fn().mockResolvedValue({
          platform: 'x',
          mode: 'api',
          status: 'published',
          success: true,
          publishUrl: 'https://x.com/i/web/status/2999999999999',
          externalId: '2999999999999',
          message: 'publisher already succeeded',
          publishedAt: '2026-04-21T02:34:56.000Z',
        }),
      );
      vi.spyOn(publishLogStoreModule, 'createSQLitePublishLogStore').mockReturnValue(
        mockedPublishLogStore,
      );

      await expect(createPublishJobHandler()({ draftId: draft.id })).rejects.toThrow(
        'local log write exploded',
      );

      expect(draftStore.getById(draft.id)).toEqual(
        expect.objectContaining({
          id: draft.id,
          status: 'scheduled',
          publishedAt: undefined,
        }),
      );
      expect(createdLogs).toEqual([]);
      expect(persistedPublishLogStore.listByDraftId(draft.id)).toEqual([]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('queues a browser handoff poll job for ready manual browser publishes', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T08:00:00.000Z'));
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const jobQueueStore = createJobQueueStore();
      const draft = draftStore.create({
        projectId: 77,
        platform: 'instagram',
        title: 'Launch reel',
        content: 'Queued for browser lane',
        status: 'scheduled',
      });

      vi.spyOn(publishRouteModule, 'createDraftPublishAdapter').mockReturnValue(
        vi.fn().mockResolvedValue({
          platform: 'instagram',
          mode: 'browser',
          status: 'manual_required',
          success: false,
          publishUrl: null,
          externalId: null,
          message: 'browser handoff is ready',
          publishedAt: null,
          details: {
            accountKey: 'launch-campaign',
            browserHandoff: {
              channelAccountId: 9,
              readiness: 'ready',
              handoffAttempt: 1,
              session: {
                hasSession: true,
                id: 'instagram:launch-campaign',
                status: 'active',
                validatedAt: '2026-04-29T07:55:00.000Z',
                storageStatePath: 'browser-sessions/managed/instagram/launch-campaign.json',
              },
              artifactPath:
                'artifacts/browser-handoffs/instagram/launch-campaign/instagram-draft-1.json',
            },
          },
        }),
      );

      await createPublishJobHandler()({ draftId: draft.id });

      expect(draftStore.getById(draft.id)).toEqual(
        expect.objectContaining({
          id: draft.id,
          status: 'review',
          scheduledAt: undefined,
          publishedAt: undefined,
        }),
      );
      expect(publishLogStore.listByDraftId(draft.id)).toEqual([
        expect.objectContaining({
          draftId: draft.id,
          projectId: 77,
          status: 'manual_required',
          publishUrl: undefined,
          message: 'browser handoff is ready',
        }),
      ]);
      expect(jobQueueStore.list({ limit: 10 })).toEqual([
        expect.objectContaining({
          type: 'browser_handoff_poll',
          status: 'pending',
          attempts: 0,
          runAt: '2026-04-29T08:01:00.000Z',
        }),
      ]);
      expect(JSON.parse(jobQueueStore.list({ limit: 10 })[0]?.payload ?? '{}')).toEqual({
        artifactPath:
          'artifacts/browser-handoffs/instagram/launch-campaign/instagram-draft-1.json',
        handoffAttempt: 1,
        attempt: 0,
        maxAttempts: 60,
        pollDelayMs: 60_000,
      });
    } finally {
      vi.useRealTimers();
      cleanupTestDatabasePath(rootDir);
    }
  });
});
