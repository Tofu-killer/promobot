import { Router, type Request } from 'express';
import { publishToBlog } from '../services/publishers/blog';
import { publishToFacebookGroup } from '../services/publishers/facebookGroup';
import { publishToReddit } from '../services/publishers/reddit';
import type { PublishMode, PublishResult, PublishStatus, Publisher } from '../services/publishers/types';
import { publishToWeibo } from '../services/publishers/weibo';
import { publishToX } from '../services/publishers/x';
import { publishToXiaohongshu } from '../services/publishers/xiaohongshu';
import type { DraftStatus } from './drafts';
import { createSQLiteDraftStore } from '../store/drafts';
import { createJobQueueStore } from '../store/jobQueue';
import { createSQLitePublishLogStore } from '../store/publishLogs';

export interface PublishableDraft {
  id: number;
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
  ) => MaybePromise<void>;
  recordPublishFailure?: (
    draftId: number,
    error: unknown,
    request: Request,
  ) => MaybePromise<void>;
}

const publishersByPlatform: Record<string, Publisher> = {
  blog: publishToBlog,
  'facebook-group': publishToFacebookGroup,
  facebookGroup: publishToFacebookGroup,
  reddit: publishToReddit,
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

    const result = await publisher({
      draftId: draft.id,
      content: draft.content,
      title: draft.title,
      target: draft.target,
      metadata: draft.metadata,
    });

    return result;
  };
}

function createPublishResultPersister() {
  const draftStore = createSQLiteDraftStore();
  const jobQueueStore = createJobQueueStore();
  const publishLogStore = createSQLitePublishLogStore();

  return async (draftId: number, result: PublishContract): Promise<void> => {
    publishLogStore.create({
      draftId,
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
  };
}

function createPublishFailureRecorder() {
  const draftStore = createSQLiteDraftStore();
  const jobQueueStore = createJobQueueStore();
  const publishLogStore = createSQLitePublishLogStore();

  return async (draftId: number, error: unknown): Promise<void> => {
    draftStore.update(draftId, {
      status: 'failed',
      scheduledAt: null,
      publishedAt: null,
    });

    publishLogStore.create({
      draftId,
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

  if (platform === 'facebookGroup' || platform === 'xiaohongshu' || platform === 'weibo') {
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

export function createPublishRouter(dependencies: PublishRouteDependencies) {
  const publishDraft = dependencies.publishDraft ?? createDraftPublishAdapter();
  const persistPublishResult =
    dependencies.persistPublishResult ?? createPublishResultPersister();
  const recordPublishFailure =
    dependencies.recordPublishFailure ?? createPublishFailureRecorder();
  const publishRouter = Router();

  publishRouter.post('/:id/publish', async (request, response, next) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'invalid draft id' });
      return;
    }

    try {
      const draft = await dependencies.lookupDraft(id, request);
      if (!draft) {
        response.status(404).json({ error: 'draft not found' });
        return;
      }

      const publishResult = await publishDraft(draft, request);
      const contract = createPublishContract(draft, publishResult);
      await persistPublishResult(id, contract, request);
      response.json(contract);
    } catch (error) {
      await recordPublishFailure(id, error, request);

      if (error instanceof UnsupportedDraftPlatformError) {
        response.status(400).json({ error: 'unsupported draft platform' });
        return;
      }

      next(error);
    }
  });

  return publishRouter;
}
