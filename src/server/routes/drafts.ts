import { Router } from 'express';

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
}

export interface DraftStore {
  create(input: CreateDraftInput): DraftRecord;
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
  const drafts: DraftRecord[] = [];
  let nextId = 1;

  return {
    create(input) {
      const timestamp = new Date().toISOString();
      const draft: DraftRecord = {
        id: nextId,
        platform: input.platform,
        title: input.title,
        content: input.content,
        hashtags: input.hashtags ?? [],
        status: input.status ?? 'draft',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      nextId += 1;
      drafts.push(draft);
      return { ...draft, hashtags: [...draft.hashtags] };
    },
    list(status) {
      return drafts
        .filter((draft) => !status || draft.status === status)
        .map((draft) => ({ ...draft, hashtags: [...draft.hashtags] }));
    },
    update(id, input) {
      const draft = drafts.find((entry) => entry.id === id);
      if (!draft) {
        return undefined;
      }

      if (input.title !== undefined) {
        draft.title = input.title;
      }
      if (input.content !== undefined) {
        draft.content = input.content;
      }
      if (input.hashtags !== undefined) {
        draft.hashtags = [...input.hashtags];
      }
      if (input.status !== undefined) {
        draft.status = input.status;
      }

      draft.updatedAt = new Date().toISOString();
      return { ...draft, hashtags: [...draft.hashtags] };
    },
  };
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

    const draft = draftStore.update(id, patch);
    if (!draft) {
      response.status(404).json({ error: 'draft not found' });
      return;
    }

    response.json({ draft });
  });

  return draftsRouter;
}
