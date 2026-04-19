import { Router } from 'express';
import { createSQLiteDraftStore } from '../store/drafts';

export type DraftStatus =
  | 'approved'
  | 'draft'
  | 'failed'
  | 'published'
  | 'queued'
  | 'review'
  | 'scheduled';

export interface DraftRecord {
  id: number;
  platform: string;
  title?: string;
  content: string;
  hashtags: string[];
  status: DraftStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDraftInput {
  platform: string;
  title?: string;
  content: string;
  hashtags?: string[];
  status?: DraftStatus;
}

export interface UpdateDraftInput {
  title?: string;
  content?: string;
  hashtags?: string[];
  status?: DraftStatus;
  scheduledAt?: string | null;
  publishedAt?: string | null;
}

export interface DraftStore {
  create(input: CreateDraftInput): DraftRecord;
  getById(id: number): DraftRecord | undefined;
  list(status?: string): DraftRecord[];
  update(id: number, input: UpdateDraftInput): DraftRecord | undefined;
}

const allowedStatuses = new Set<DraftStatus>([
  'approved',
  'draft',
  'failed',
  'published',
  'queued',
  'review',
  'scheduled',
]);

function isDraftStatus(value: string): value is DraftStatus {
  return allowedStatuses.has(value as DraftStatus);
}

export function createDraftStore(): DraftStore {
  return createSQLiteDraftStore();
}

export function createDraftsRouter(draftStore: DraftStore) {
  const draftsRouter = Router();

  draftsRouter.get('/', (request, response) => {
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;

    if (status && !isDraftStatus(status)) {
      response.status(400).json({ error: 'invalid draft status' });
      return;
    }

    response.json({ drafts: draftStore.list(status) });
  });

  draftsRouter.patch('/:id', (request, response) => {
    const id = Number(request.params.id);
    const patch: UpdateDraftInput = {};

    if (typeof request.body?.title === 'string') {
      patch.title = request.body.title;
    }
    if (typeof request.body?.content === 'string') {
      patch.content = request.body.content;
    }
    if (Array.isArray(request.body?.hashtags)) {
      patch.hashtags = request.body.hashtags.filter(
        (hashtag: unknown): hashtag is string => typeof hashtag === 'string',
      );
    }
    if (typeof request.body?.status === 'string') {
      if (!isDraftStatus(request.body.status)) {
        response.status(400).json({ error: 'invalid draft status' });
        return;
      }
      patch.status = request.body.status;
    }
    if (typeof request.body?.scheduledAt === 'string' || request.body?.scheduledAt === null) {
      patch.scheduledAt = request.body.scheduledAt;
    }

    const draft = draftStore.update(id, patch);
    if (!draft) {
      response.status(404).json({ error: 'draft not found' });
      return;
    }

    response.json({ draft });
  });

  return draftsRouter;
}
