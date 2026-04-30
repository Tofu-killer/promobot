import { Router, type Request } from 'express';
import { publishToBlog } from '../services/publishers/blog.js';
import { publishToFacebookGroup } from '../services/publishers/facebookGroup.js';
import { publishToInstagram } from '../services/publishers/instagram.js';
import { publishToReddit } from '../services/publishers/reddit.js';
import { publishToTiktok } from '../services/publishers/tiktok.js';
import type { PublishMode, PublishResult, PublishStatus, Publisher } from '../services/publishers/types.js';
import { publishToWeibo } from '../services/publishers/weibo.js';
import { publishToX } from '../services/publishers/x.js';
import { publishToXiaohongshu } from '../services/publishers/xiaohongshu.js';
import { resolveBrowserHandoffArtifact } from '../services/publishers/browserHandoffArtifacts.js';
import { maybeEnqueueBrowserHandoffPollJob } from '../services/publishers/browserHandoffQueue.js';
import type { DraftStatus } from './drafts.js';
import { createSQLiteDraftStore } from '../store/drafts.js';
import { createJobQueueStore } from '../store/jobQueue.js';
import { createSQLitePublishLogStore } from '../store/publishLogs.js';

export interface PublishableDraft {
  id: number;
  projectId?: number | null;
  platform: string;
  title?: string;
  content: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishContract {
  draftId: number;
  draftStatus: DraftStatus;
  platform: string;
  mode: PublishMode;
  status: PublishStatus;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
  details?: Record<string, unknown>;
}

interface LegacyPublishResult {
  success: boolean;
  publishUrl: string | null;
  message: string;
  platform?: string;
  mode?: PublishMode;
  status?: PublishStatus;
  externalId?: string | null;
  publishedAt?: string | null;
  details?: Record<string, unknown>;
}

type PublishAdapterResult = PublishResult | LegacyPublishResult;

type MaybePromise<T> = Promise<T> | T;

export interface PublishRouteDependencies {
  lookupDraft: (id: number, request: Request) => MaybePromise<PublishableDraft | undefined>;
  publishDraft?: (draft: PublishableDraft, request: Request) => MaybePromise<PublishAdapterResult>;
  persistPublishResult?: (
    draftId: number,
    result: PublishContract,
    request: Request,
    draft?: PublishableDraft,
  ) => MaybePromise<void>;
  recordPublishFailure?: (
    draftId: number,
    error: unknown,
    request: Request,
    draft?: PublishableDraft,
  ) => MaybePromise<void>;
}

const publishersByPlatform: Record<string, Publisher> = {
  blog: publishToBlog,
  'facebook-group': publishToFacebookGroup,
  facebookGroup: publishToFacebookGroup,
  instagram: publishToInstagram,
  reddit: publishToReddit,
  tiktok: publishToTiktok,
  weibo: publishToWeibo,
  x: publishToX,
  xiaohongshu: publishToXiaohongshu,
};

export class UnsupportedDraftPlatformError extends Error {
  constructor(platform: string) {
    super(`unsupported draft platform: ${platform}`);
  }
}

export function createDraftPublishAdapter() {
  return async (draft: PublishableDraft): Promise<PublishResult> => {
    const publisher = publishersByPlatform[draft.platform];
    if (!publisher) {
      throw new UnsupportedDraftPlatformError(draft.platform);
    }

    const metadata =
      draft.metadata && typeof draft.metadata === 'object'
        ? { ...draft.metadata }
        : {};

    if (typeof draft.projectId === 'number') {
      metadata.projectId = draft.projectId;
    }

    const result = await publisher({
      draftId: draft.id,
      content: draft.content,
      title: draft.title,
      target: draft.target,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    return result;
  };
}

function createPublishResultPersister() {
  const draftStore = createSQLiteDraftStore();
  const jobQueueStore = createJobQueueStore();
  const publishLogStore = createSQLitePublishLogStore();

  return async (
    draftId: number,
    result: PublishContract,
    _request: Request,
    draft?: PublishableDraft,
  ): Promise<void> => {
    publishLogStore.create({
      draftId,
      projectId: resolveDraftProjectId(draftStore, draftId, draft),
      status: result.status,
      publishUrl: result.publishUrl,
      message: result.message,
    });

    draftStore.update(draftId, {
      status: result.draftStatus,
      scheduledAt: null,
      publishedAt: result.publishedAt,
    });

    jobQueueStore.deletePendingPublishJobs(draftId);
    maybeEnqueueBrowserHandoffPollJob(result, jobQueueStore);
    maybeResolveBrowserHandoffArtifact(draftId, result, draft);
  };
}

function createPublishFailureRecorder() {
  const draftStore = createSQLiteDraftStore();
  const jobQueueStore = createJobQueueStore();
  const publishLogStore = createSQLitePublishLogStore();

  return async (
    draftId: number,
    error: unknown,
    _request: Request,
    draft?: PublishableDraft,
  ): Promise<void> => {
    draftStore.update(draftId, {
      status: 'failed',
      scheduledAt: null,
      publishedAt: null,
    });

    publishLogStore.create({
      draftId,
      projectId: resolveDraftProjectId(draftStore, draftId, draft),
      status: 'failed',
      message: getPublishErrorMessage(error),
    });

    jobQueueStore.deletePendingPublishJobs(draftId);
  };
}

function getPublishErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'publish failed';
}

function resolveDraftProjectId(
  draftStore: ReturnType<typeof createSQLiteDraftStore>,
  draftId: number,
  draft?: PublishableDraft,
): number | null {
  const directProjectId = normalizeProjectId(draft?.projectId);
  if (directProjectId !== null) {
    return directProjectId;
  }

  const storedDraft = draftStore.getById(draftId);
  return normalizeProjectId(storedDraft?.projectId);
}

function normalizeProjectId(projectId: unknown): number | null {
  const parsed = Number(projectId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createPublishContract(
  draft: PublishableDraft,
  rawResult: PublishAdapterResult,
): PublishContract {
  const status = normalizePublishStatus(rawResult);
  const publishedAt = normalizePublishedAt(status, rawResult);

  const contract: PublishContract = {
    draftId: draft.id,
    draftStatus: getDraftStatusForPublishStatus(status),
    platform: normalizePlatform(rawResult.platform, draft.platform),
    mode: normalizePublishMode(rawResult.mode, draft.platform),
    status,
    success: typeof rawResult.success === 'boolean' ? rawResult.success : status === 'published',
    publishUrl: typeof rawResult.publishUrl === 'string' ? rawResult.publishUrl : null,
    externalId: typeof rawResult.externalId === 'string' ? rawResult.externalId : null,
    message: rawResult.message,
    publishedAt,
  };

  if (rawResult.details && typeof rawResult.details === 'object') {
    contract.details = rawResult.details;
  }

  return contract;
}

function normalizePublishStatus(result: PublishAdapterResult): PublishStatus {
  if (result.status === 'published' || result.status === 'queued' || result.status === 'manual_required' || result.status === 'failed') {
    return result.status;
  }

  return result.success ? 'published' : 'failed';
}

function normalizePlatform(platform: string | undefined, draftPlatform: string): string {
  const source = platform ?? draftPlatform;

  if (source === 'facebook-group') {
    return 'facebookGroup';
  }

  return source;
}

function normalizePublishMode(mode: PublishMode | undefined, draftPlatform: string): PublishMode {
  if (mode === 'api' || mode === 'browser' || mode === 'manual') {
    return mode;
  }

  const platform = normalizePlatform(undefined, draftPlatform);

  if (platform === 'x' || platform === 'reddit') {
    return 'api';
  }

  if (
    platform === 'facebookGroup' ||
    platform === 'instagram' ||
    platform === 'tiktok' ||
    platform === 'xiaohongshu' ||
    platform === 'weibo'
  ) {
    return 'browser';
  }

  return 'manual';
}

function normalizePublishedAt(status: PublishStatus, result: PublishAdapterResult): string | null {
  if (status !== 'published') {
    return null;
  }

  return typeof result.publishedAt === 'string' && result.publishedAt.trim() ? result.publishedAt : new Date().toISOString();
}

function getDraftStatusForPublishStatus(status: PublishStatus): DraftStatus {
  switch (status) {
    case 'published':
      return 'published';
    case 'queued':
      return 'queued';
    case 'manual_required':
      return 'review';
    case 'failed':
      return 'failed';
  }
}

function maybeResolveBrowserHandoffArtifact(
  draftId: number,
  result: PublishContract,
  draft?: PublishableDraft,
) {
  if (!draft || result.status === 'manual_required') {
    return;
  }

  const platform = normalizePlatform(undefined, draft.platform);
  if (
    platform !== 'facebookGroup' &&
    platform !== 'instagram' &&
    platform !== 'tiktok' &&
    platform !== 'xiaohongshu' &&
    platform !== 'weibo'
  ) {
    return;
  }

  const accountKey = resolveBrowserHandoffAccountKey(draft.metadata);
  if (!accountKey) {
    return;
  }

  resolveBrowserHandoffArtifact({
    platform,
    accountKey,
    draftId: String(draftId),
    publishStatus: result.status,
    draftStatus: result.draftStatus,
    publishUrl: result.publishUrl,
    externalId: result.externalId,
    message: result.message,
    publishedAt: result.publishedAt,
  });
}

function resolveBrowserHandoffAccountKey(metadata: PublishableDraft['metadata']) {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const candidate =
    readString(metadata.accountKey) ??
    readNestedString(metadata, ['channelAccount', 'accountKey']) ??
    readNestedString(metadata, ['browserSession', 'accountKey']);

  if (!candidate) {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function readNestedString(
  value: Record<string, unknown>,
  segments: string[],
): string | null {
  let current: unknown = value;

  for (const segment of segments) {
    if (!isPlainObject(current)) {
      return null;
    }

    current = current[segment];
  }

  return readString(current);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createPublishRouter(dependencies: PublishRouteDependencies) {
  const publishDraft = dependencies.publishDraft ?? createDraftPublishAdapter();
  const usesDefaultPublishAdapter = dependencies.publishDraft === undefined;
  const persistPublishResult =
    dependencies.persistPublishResult ?? createPublishResultPersister();
  const recordPublishFailure =
    dependencies.recordPublishFailure ?? createPublishFailureRecorder();
  const draftStore = createSQLiteDraftStore();
  const publishRouter = Router();

  publishRouter.post('/:id/publish', async (request, response, next) => {
    const id = Number(request.params.id);
    let draft: PublishableDraft | undefined;
    let contract: PublishContract | undefined;

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'invalid draft id' });
      return;
    }

    try {
      const lookedUpDraft = await dependencies.lookupDraft(id, request);
      draft =
        lookedUpDraft?.projectId === undefined
          ? enrichPublishableDraft(lookedUpDraft, draftStore.getById(id))
          : lookedUpDraft;
    } catch (error) {
      next(error);
      return;
    }

    if (!draft) {
      response.status(404).json({ error: 'draft not found' });
      return;
    }

    if (usesDefaultPublishAdapter && !publishersByPlatform[draft.platform]) {
      response.status(400).json({ error: 'unsupported draft platform' });
      return;
    }

    try {
      const publishResult = await publishDraft(draft, request);
      contract = createPublishContract(draft, publishResult);
    } catch (error) {
      await recordPublishFailure(id, error, request, draft);
      next(error);
      return;
    }

    try {
      await persistPublishResult(id, contract, request, draft);
    } catch (error) {
      next(error);
      return;
    }

    response.json(contract);
  });

  return publishRouter;
}

function enrichPublishableDraft(
  draft: PublishableDraft | undefined,
  storedDraft: { projectId: number | null } | undefined,
): PublishableDraft | undefined {
  if (!draft) {
    return undefined;
  }

  if (draft.projectId !== undefined) {
    return draft;
  }

  return {
    ...draft,
    projectId: storedDraft?.projectId ?? undefined,
  };
}
