import { describe, expect, it } from 'vitest';
import { createInboxFetchService } from '../../src/server/services/inboxFetch';
import { createMonitorStore } from '../../src/server/store/monitor';
import { createProjectStore } from '../../src/server/store/projects';
import { createSourceConfigStore } from '../../src/server/store/sourceConfigs';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

describe('inbox fetch service scoped recurring monitor items', () => {
  it('only promotes browser-platform monitor items whose metadata matches the requested source config ids', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectStore = createProjectStore();
      const sourceConfigStore = createSourceConfigStore();
      const monitorStore = createMonitorStore();
      const inboxFetchService = createInboxFetchService();

      projectStore.create({
        name: 'Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://signals.example.com',
        siteDescription: 'Signals workspace',
        sellingPoints: ['fast'],
        brandVoice: '',
        ctas: [],
      });

      const scopedSourceConfig = sourceConfigStore.create({
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Scoped recurring config',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      const otherSourceConfig = sourceConfigStore.create({
        projectId: 1,
        sourceType: 'keyword+x',
        platform: 'x',
        label: 'Other recurring config',
        configJson: {
          query: 'openai',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      monitorStore.create({
        projectId: 1,
        source: 'instagram',
        title: 'Scoped Instagram comment',
        detail: 'instagram comment · creator_ops\n需要人工确认评论语气。',
        status: 'new',
        metadata: {
          sourceConfigId: scopedSourceConfig.id,
          channelAccountId: 21,
          accountKey: 'instagram-main',
          sourceUrl: 'https://www.instagram.com/p/post-1/',
          profileUrl: 'https://www.instagram.com/creator_ops/',
          profileHandle: '@creator_ops',
        },
      });
      monitorStore.create({
        projectId: 1,
        source: 'instagram',
        title: 'Unscoped Instagram comment',
        detail: 'instagram comment · creator_ops\n这条不应该被带进 scoped recurring。',
        status: 'new',
        metadata: {
          sourceConfigId: otherSourceConfig.id,
          channelAccountId: 22,
          accountKey: 'instagram-other',
          sourceUrl: 'https://www.instagram.com/p/post-2/',
          profileUrl: 'https://www.instagram.com/creator_ops/',
          profileHandle: '@creator_ops',
        },
      });
      monitorStore.create({
        projectId: 1,
        source: 'facebook-group',
        title: 'Missing source config binding',
        detail: 'facebook group post · community_admin\n没有归属 metadata，不应进入 scoped recurring。',
        status: 'new',
        metadata: {
          channelAccountId: 23,
          accountKey: 'facebook-group-main',
          sourceUrl: 'https://www.facebook.com/groups/launch-campaign/posts/42',
          replyTargetId: 'fb-post-42',
          replyTargetType: 'facebook_group_post',
        },
      });

      const result = await inboxFetchService.fetchNow(1, {
        sourceConfigIds: [scopedSourceConfig.id],
      });

      expect(result.inserted).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          projectId: 1,
          source: 'instagram',
          title: 'Scoped Instagram comment',
          metadata: expect.objectContaining({
            sourceConfigId: scopedSourceConfig.id,
            channelAccountId: 21,
            accountKey: 'instagram-main',
          }),
        }),
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
