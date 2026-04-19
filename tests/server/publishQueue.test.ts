import { describe, expect, it } from 'vitest';
import { createPublishJobHandler } from '../../src/server/services/publishQueue';
import { createSQLiteDraftStore } from '../../src/server/store/drafts';
import { createSQLitePublishLogStore } from '../../src/server/store/publishLogs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

describe('publish queue handler', () => {
  it('publishes queued x drafts and persists both draft and log state', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const draftStore = createSQLiteDraftStore();
      const publishLogStore = createSQLitePublishLogStore();
      const draft = draftStore.create({
        platform: 'x',
        title: 'Launch update',
        content: 'PromoBot launch',
        status: 'scheduled',
      });

      await createPublishJobHandler()({ draftId: draft.id });

      expect(draftStore.getById(draft.id)).toEqual(
        expect.objectContaining({
          id: draft.id,
          status: 'published',
          publishedAt: expect.any(String),
        }),
      );
      expect(publishLogStore.listByDraftId(draft.id)).toEqual([
        expect.objectContaining({
          draftId: draft.id,
          status: 'published',
          publishUrl: `https://x.com/promobot/status/${draft.id}`,
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
          publishedAt: undefined,
        }),
      );
      expect(publishLogStore.listByDraftId(draft.id)).toEqual([
        expect.objectContaining({
          draftId: draft.id,
          status: 'manual_required',
          publishUrl: undefined,
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
