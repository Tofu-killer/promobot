import { Router } from 'express';
import { generateBlogDraft } from '../services/generators/blog.js';
import { generateFacebookGroupDraft } from '../services/generators/facebookGroup.js';
import { generateInstagramDraft } from '../services/generators/instagram.js';
import { generateRedditDraft } from '../services/generators/reddit.js';
import { generateTiktokDraft } from '../services/generators/tiktok.js';
import type {
  DraftTone,
  GenerateDraftInput,
  GeneratedDraft,
  SiteContext,
} from '../services/generators/types.js';
import { generateWeiboDraft } from '../services/generators/weibo.js';
import { generateXDraft } from '../services/generators/x.js';
import { generateXiaohongshuDraft } from '../services/generators/xiaohongshu.js';
import { createProjectStore, type ProjectRecord, type ProjectStore } from '../store/projects.js';
import type { DraftStatus, DraftStore } from './drafts.js';
import { createDraftStore } from './drafts.js';

type SupportedPlatform =
  | 'blog'
  | 'facebook-group'
  | 'instagram'
  | 'reddit'
  | 'tiktok'
  | 'weibo'
  | 'x'
  | 'xiaohongshu';

type PlatformGenerator = (input: GenerateDraftInput) => Promise<GeneratedDraft>;
type DraftCreateInput = Parameters<DraftStore['create']>[0] & { projectId?: number };

const platformGenerators: Record<SupportedPlatform, PlatformGenerator> = {
  blog: generateBlogDraft,
  'facebook-group': generateFacebookGroupDraft,
  instagram: generateInstagramDraft,
  reddit: generateRedditDraft,
  tiktok: generateTiktokDraft,
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

function hasOwnProperty(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function hasInvalidOptionalStringField(
  target: Record<string, unknown>,
  key: string,
): boolean {
  return hasOwnProperty(target, key) && typeof target[key] !== 'string';
}

function hasInvalidOptionalStringArrayField(
  target: Record<string, unknown>,
  key: string,
): boolean {
  if (!hasOwnProperty(target, key)) {
    return false;
  }

  const value = target[key];
  return !Array.isArray(value) || value.some((entry: unknown) => typeof entry !== 'string');
}

function isValidDraftTone(value: unknown): value is DraftTone {
  return value === 'professional' || value === 'casual' || value === 'exciting';
}

function parseSiteContext(
  value: unknown,
): { ok: true; value: SiteContext | undefined } | { ok: false } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false };
  }

  const raw = value as Record<string, unknown>;

  if (
    hasInvalidOptionalStringField(raw, 'siteName') ||
    hasInvalidOptionalStringField(raw, 'siteUrl') ||
    hasInvalidOptionalStringField(raw, 'siteDescription') ||
    hasInvalidOptionalStringField(raw, 'brandVoice') ||
    hasInvalidOptionalStringField(raw, 'defaultLanguagePolicy') ||
    hasInvalidOptionalStringArrayField(raw, 'sellingPoints') ||
    hasInvalidOptionalStringArrayField(raw, 'ctas') ||
    hasInvalidOptionalStringArrayField(raw, 'bannedPhrases')
  ) {
    return { ok: false };
  }

  return { ok: true, value: {
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
    ...(Array.isArray(raw.bannedPhrases)
      ? {
          bannedPhrases: raw.bannedPhrases.filter((value): value is string => typeof value === 'string'),
        }
      : {}),
    ...(typeof raw.defaultLanguagePolicy === 'string'
      ? { defaultLanguagePolicy: raw.defaultLanguagePolicy }
      : {}),
  } };
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
    bannedPhrases: project.bannedPhrases,
    defaultLanguagePolicy: project.defaultLanguagePolicy,
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
    ...(requestSiteContext?.bannedPhrases !== undefined
      ? { bannedPhrases: requestSiteContext.bannedPhrases }
      : {}),
    ...(requestSiteContext?.defaultLanguagePolicy !== undefined
      ? { defaultLanguagePolicy: requestSiteContext.defaultLanguagePolicy }
      : {}),
  };
}

function getGeneratedDraftStatus(project: ProjectRecord | undefined): DraftStatus | undefined {
  if (!project) {
    return undefined;
  }

  return project.riskPolicy === 'auto_approve' ? 'approved' : 'review';
}

export function createContentRouter(
  draftStore: DraftStore,
  projectStore: ProjectStore = createProjectStore(),
) {
  const contentRouter = Router();

  contentRouter.post('/generate', async (request, response) => {
    const body =
      request.body !== null && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};

    if (
      (hasOwnProperty(body, 'topic') && typeof body.topic !== 'string') ||
      (hasOwnProperty(body, 'platforms') &&
        (!Array.isArray(body.platforms) ||
          body.platforms.some((platform: unknown) => typeof platform !== 'string'))) ||
      (hasOwnProperty(body, 'tone') && !isValidDraftTone(body.tone)) ||
      (hasOwnProperty(body, 'saveAsDraft') && body.saveAsDraft !== true && body.saveAsDraft !== false)
    ) {
      response.status(400).json({ error: 'invalid content payload' });
      return;
    }

    const parsedSiteContext = parseSiteContext(body.siteContext);
    if (!parsedSiteContext.ok) {
      response.status(400).json({ error: 'invalid content payload' });
      return;
    }

    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    const platforms = Array.isArray(body.platforms)
      ? body.platforms.filter((platform: unknown): platform is string => typeof platform === 'string')
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

    const supportedPlatforms = platforms.filter((platform): platform is SupportedPlatform =>
      isSupportedPlatform(platform),
    );

    const parsedProjectId = parseOptionalProjectId(body.projectId);

    if (body.projectId !== undefined && parsedProjectId === undefined) {
      response.status(400).json({ error: 'invalid project id' });
      return;
    }

    const scopedProject =
      parsedProjectId !== undefined ? projectStore.getById(parsedProjectId) : undefined;

    if (parsedProjectId !== undefined && (!scopedProject || scopedProject.archived)) {
      response.status(404).json({ error: 'project not found' });
      return;
    }

    const projectSiteContext = getProjectSiteContext(scopedProject);
    const input: GenerateDraftInput = {
      topic,
      tone: body.tone as DraftTone | undefined,
      siteContext: mergeSiteContext(projectSiteContext, parsedSiteContext.value),
    };
    const shouldSaveAsDraft = body.saveAsDraft === true;
    const projectId = shouldSaveAsDraft ? parsedProjectId : undefined;
    const generatedDraftStatus =
      shouldSaveAsDraft && projectId !== undefined
        ? getGeneratedDraftStatus(scopedProject)
        : undefined;

    const results = await Promise.all(
      supportedPlatforms.map(async (platform) => {
        const generatedDraft = await platformGenerators[platform](input);

        if (!shouldSaveAsDraft) {
          return generatedDraft;
        }

        const draftInput: DraftCreateInput = {
          platform: generatedDraft.platform,
          title: generatedDraft.title,
          content: generatedDraft.content,
          hashtags: generatedDraft.hashtags,
          ...(generatedDraftStatus !== undefined ? { status: generatedDraftStatus } : {}),
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
