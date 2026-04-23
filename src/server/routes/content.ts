import { Router } from 'express';
import { generateBlogDraft } from '../services/generators/blog.js';
import { generateFacebookGroupDraft } from '../services/generators/facebookGroup.js';
import { generateRedditDraft } from '../services/generators/reddit.js';
import type { GenerateDraftInput, GeneratedDraft, SiteContext } from '../services/generators/types.js';
import { generateWeiboDraft } from '../services/generators/weibo.js';
import { generateXDraft } from '../services/generators/x.js';
import { generateXiaohongshuDraft } from '../services/generators/xiaohongshu.js';
import { createProjectStore, type ProjectRecord, type ProjectStore } from '../store/projects.js';
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

function parseSiteContext(value: unknown): SiteContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;

  return {
    ...(typeof raw.siteName === 'string' ? { siteName: raw.siteName } : {}),
    ...(typeof raw.siteUrl === 'string' ? { siteUrl: raw.siteUrl } : {}),
    ...(typeof raw.siteDescription === 'string'
      ? { siteDescription: raw.siteDescription }
      : {}),
    ...(Array.isArray(raw.sellingPoints)
      ? {
          sellingPoints: raw.sellingPoints.filter(
            (value): value is string => typeof value === 'string',
          ),
        }
      : {}),
    ...(typeof raw.brandVoice === 'string' ? { brandVoice: raw.brandVoice } : {}),
    ...(Array.isArray(raw.ctas)
      ? {
          ctas: raw.ctas.filter((value): value is string => typeof value === 'string'),
        }
      : {}),
  };
}

function getProjectSiteContext(project: ProjectRecord | undefined): SiteContext | undefined {
  if (!project) {
    return undefined;
  }

  return {
    siteName: project.siteName,
    siteUrl: project.siteUrl,
    siteDescription: project.siteDescription,
    sellingPoints: project.sellingPoints,
    brandVoice: project.brandVoice,
    ctas: project.ctas,
  };
}

function mergeSiteContext(
  projectSiteContext?: SiteContext,
  requestSiteContext?: SiteContext,
): SiteContext | undefined {
  if (!projectSiteContext && !requestSiteContext) {
    return undefined;
  }

  return {
    ...(projectSiteContext ?? {}),
    ...(requestSiteContext ?? {}),
    ...(requestSiteContext?.sellingPoints !== undefined
      ? { sellingPoints: requestSiteContext.sellingPoints }
      : {}),
    ...(requestSiteContext?.ctas !== undefined ? { ctas: requestSiteContext.ctas } : {}),
  };
}

export function createContentRouter(
  draftStore: DraftStore,
  projectStore: ProjectStore = createProjectStore(),
) {
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

    const parsedProjectId = parseOptionalProjectId(request.body?.projectId);

    if (request.body?.projectId !== undefined && parsedProjectId === undefined) {
      response.status(400).json({ error: 'invalid project id' });
      return;
    }

    const scopedProject =
      parsedProjectId !== undefined ? projectStore.getById(parsedProjectId) : undefined;

    if (parsedProjectId !== undefined && (!scopedProject || scopedProject.archived)) {
      response.status(404).json({ error: 'project not found' });
      return;
    }

    const requestSiteContext = parseSiteContext(request.body?.siteContext);
    const projectSiteContext = getProjectSiteContext(scopedProject);
    const input: GenerateDraftInput = {
      topic,
      tone: request.body?.tone,
      siteContext: mergeSiteContext(projectSiteContext, requestSiteContext),
    };
    const shouldSaveAsDraft = request.body?.saveAsDraft === true;
    const projectId = shouldSaveAsDraft ? parsedProjectId : undefined;

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
