import type { JobHandler } from '../lib/jobs.js';
import type { DraftStatus } from '../routes/drafts.js';
import {
  createDraftPublishAdapter,
  type PublishableDraft,
} from '../routes/publish.js';
import type { PublishStatus } from './publishers/types.js';
import { createSQLiteDraftStore } from '../store/drafts.js';
import { createSQLitePublishLogStore } from '../store/publishLogs.js';

export interface PublishJobPayload {
  draftId?: unknown;
}

export function createPublishJobHandler(): JobHandler {
  const draftStore = createSQLiteDraftStore();
  const publishLogStore = createSQLitePublishLogStore();
  const publishDraft = createDraftPublishAdapter();

  return async (payload: unknown) => {
    const normalizedPayload = isPublishJobPayload(payload) ? payload : {};
    const draftId = Number(normalizedPayload.draftId);
    if (!Number.isInteger(draftId) || draftId <= 0) {
      throw new Error('invalid publish job payload');
    }

    const draft = draftStore.getById(draftId);
    if (!draft) {
      throw new Error(`draft ${draftId} not found`);
    }

    let result;
    try {
      result = await publishDraft(toPublishableDraft(draft));
    } catch (error) {
      draftStore.update(draftId, {
        status: 'failed',
        scheduledAt: null,
        publishedAt: null,
      });

      publishLogStore.create({
        draftId,
        projectId: draft.projectId,
        status: 'failed',
        message: error instanceof Error && error.message.trim() ? error.message : String(error),
      });

      throw error;
    }

    const publishedAt =
      result.status === 'published'
        ? result.publishedAt && result.publishedAt.trim()
          ? result.publishedAt
          : new Date().toISOString()
        : null;

    publishLogStore.create({
      draftId,
      projectId: draft.projectId,
      status: result.status,
      publishUrl: result.publishUrl,
      message: result.message,
    });

    draftStore.update(draftId, {
      status: getDraftStatusForPublishStatus(result.status),
      scheduledAt: null,
      publishedAt,
    });

    if (result.status === 'failed') {
      throw new PublishJobResultError(result.message);
    }
  };
}

class PublishJobResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishJobResultError';
  }
}

function isPublishJobPayload(value: unknown): value is PublishJobPayload {
  return typeof value === 'object' && value !== null;
}

function toPublishableDraft(draft: {
  id: number;
  projectId: number | null;
  platform: string;
  title?: string;
  content: string;
  target?: string;
  metadata?: Record<string, unknown>;
}): PublishableDraft {
  return {
    id: draft.id,
    projectId: draft.projectId,
    platform: draft.platform,
    title: draft.title,
    content: draft.content,
    target: draft.target,
    metadata: draft.metadata,
  };
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
