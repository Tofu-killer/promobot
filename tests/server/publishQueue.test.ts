import { describe, expect, it } from 'vitest';
import { createPublishJobHandler } from '../../src/server/services/publishQueue';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

describe('publish queue handler', () => {
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
});
