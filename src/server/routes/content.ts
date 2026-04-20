import { Router } from 'express';
import { generateBlogDraft } from '../services/generators/blog.js';
import { generateFacebookGroupDraft } from '../services/generators/facebookGroup.js';
import { generateRedditDraft } from '../services/generators/reddit.js';
import type { GenerateDraftInput, GeneratedDraft } from '../services/generators/types.js';
import { generateWeiboDraft } from '../services/generators/weibo.js';
import { generateXDraft } from '../services/generators/x.js';
import { generateXiaohongshuDraft } from '../services/generators/xiaohongshu.js';
import type { DraftStore } from './drafts.js';
import { createDraftStore } from './drafts.js';

type SupportedPlatform =
  | 'blog'
  | 'facebook-group'
  | 'reddit'
  | 'weibo'
  | 'x'
  | 'xiaohongshu';

type PlatformGenerator = (input: GenerateDraftInput) => Promise<GeneratedDraft>;
type DraftCreateInput = Parameters<DraftStore['create']>[0] & { projectId?: number };

const platformGenerators: Record<SupportedPlatform, PlatformGenerator> = {
  blog: generateBlogDraft,
  'facebook-group': generateFacebookGroupDraft,
  reddit: generateRedditDraft,
  weibo: generateWeiboDraft,
  x: generateXDraft,
  xiaohongshu: generateXiaohongshuDraft,
};

function isSupportedPlatform(platform: string): platform is SupportedPlatform {
  return platform in platformGenerators;
}

function parseOptionalProjectId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function createContentRouter(draftStore: DraftStore) {
  const contentRouter = Router();

  contentRouter.post('/generate', async (request, response) => {
    const topic = typeof request.body?.topic === 'string' ? request.body.topic.trim() : '';
    const platforms = Array.isArray(request.body?.platforms)
      ? request.body.platforms.filter((platform: unknown): platform is string => typeof platform === 'string')
      : [];

    if (!topic || platforms.length === 0) {
      response.status(400).json({ error: 'topic and platforms are required' });
      return;
    }

    const unsupportedPlatforms = platforms.filter(
      (platform: string) => !isSupportedPlatform(platform),
    );
    if (unsupportedPlatforms.length > 0) {
      response.status(400).json({
        error: 'unsupported platforms requested',
        unsupportedPlatforms,
      });
      return;
    }

    const input: GenerateDraftInput = {
      topic,
      tone: request.body?.tone,
      siteContext: request.body?.siteContext,
    };
    const shouldSaveAsDraft = request.body?.saveAsDraft === true;
    const projectId = shouldSaveAsDraft ? parseOptionalProjectId(request.body?.projectId) : undefined;

    const results = await Promise.all(
      platforms.map(async (platform: SupportedPlatform) => {
        const generatedDraft = await platformGenerators[platform](input);

        if (!shouldSaveAsDraft) {
          return generatedDraft;
        }

        const draftInput: DraftCreateInput = {
          platform: generatedDraft.platform,
          title: generatedDraft.title,
          content: generatedDraft.content,
          hashtags: generatedDraft.hashtags,
          ...(projectId !== undefined ? { projectId } : {}),
        };

        const savedDraft = draftStore.create(draftInput);

        return {
          ...generatedDraft,
          draftId: savedDraft.id,
        };
      }),
    );

    response.json({ results });
  });

  return contentRouter;
}

export function createDefaultContentRouter() {
  return createContentRouter(createDraftStore());
}
