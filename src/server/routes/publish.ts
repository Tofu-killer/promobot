import { Router, type Request } from 'express';
import { publishToBlog } from '../services/publishers/blog';
import { publishToFacebookGroup } from '../services/publishers/facebookGroup';
import { publishToReddit } from '../services/publishers/reddit';
import type { Publisher } from '../services/publishers/types';
import { publishToWeibo } from '../services/publishers/weibo';
import { publishToX } from '../services/publishers/x';
import { publishToXiaohongshu } from '../services/publishers/xiaohongshu';

export interface PublishableDraft {
  id: number;
  platform: string;
  title?: string;
  content: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishContract {
  success: boolean;
  publishUrl: string | null;
  message: string;
}

type MaybePromise<T> = Promise<T> | T;

export interface PublishRouteDependencies {
  lookupDraft: (id: number, request: Request) => MaybePromise<PublishableDraft | undefined>;
  publishDraft?: (draft: PublishableDraft, request: Request) => MaybePromise<PublishContract>;
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
  return async (draft: PublishableDraft): Promise<PublishContract> => {
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

    return {
      success: result.success,
      publishUrl: result.publishUrl,
      message: result.message,
    };
  };
}

export function createPublishRouter(dependencies: PublishRouteDependencies) {
  const publishDraft = dependencies.publishDraft ?? createDraftPublishAdapter();
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

      const result = await publishDraft(draft, request);
      response.json(result);
    } catch (error) {
      if (error instanceof UnsupportedDraftPlatformError) {
        response.status(400).json({ error: 'unsupported draft platform' });
        return;
      }

      next(error);
    }
  });

  return publishRouter;
}
