import { Router } from 'express';
import type { JobQueueEntry, JobQueueStore } from '../store/jobQueue';
import { createJobQueueStore } from '../store/jobQueue';
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
  projectId: number | null;
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
  projectId?: number;
  platform: string;
  title?: string;
  content: string;
  hashtags?: string[];
  status?: DraftStatus;
}

export interface UpdateDraftInput {
  projectId?: number;
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
  list(status?: string, projectId?: number): DraftRecord[];
  update(id: number, input: UpdateDraftInput): DraftRecord | undefined;
}

export interface DraftsRouterDependencies {
  jobQueueStore?: JobQueueStore;
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

export function createDraftsRouter(
  draftStore: DraftStore,
  dependencies: DraftsRouterDependencies = {},
) {
  const draftsRouter = Router();
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();

  draftsRouter.get('/', (request, response) => {
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;
    const projectId = parseProjectIdQuery(request.query.projectId);

    if (status && !isDraftStatus(status)) {
      response.status(400).json({ error: 'invalid draft status' });
      return;
    }

    if (request.query.projectId !== undefined && projectId === undefined) {
      response.status(400).json({ error: 'invalid project id' });
      return;
    }

    response.json({ drafts: draftStore.list(status, projectId) });
  });

  draftsRouter.patch('/:id', (request, response) => {
    const id = Number(request.params.id);
    const patch: UpdateDraftInput = {};
    const currentDraft = draftStore.getById(id);

    if (!currentDraft) {
      response.status(404).json({ error: 'draft not found' });
      return;
    }

    if (typeof request.body?.title === 'string') {
      patch.title = request.body.title;
    }
    if (typeof request.body?.content === 'string') {
      patch.content = request.body.content;
    }
    if (Number.isInteger(request.body?.projectId) && request.body.projectId > 0) {
      patch.projectId = request.body.projectId;
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

    const normalizedPatch = normalizeDraftPatch(currentDraft, patch);
    const draft = draftStore.update(id, normalizedPatch);
    const publishJob = draft ? syncDraftSchedule(jobQueueStore, currentDraft, draft) : undefined;

    response.json({
      draft,
      ...(publishJob ? { publishJob } : {}),
    });
  });

  return draftsRouter;
}

function normalizeDraftPatch(currentDraft: DraftRecord, patch: UpdateDraftInput): UpdateDraftInput {
  const nextPatch: UpdateDraftInput = { ...patch };

  if (patch.scheduledAt !== undefined) {
    if (typeof patch.scheduledAt === 'string' && patch.scheduledAt.trim().length > 0) {
      nextPatch.scheduledAt = patch.scheduledAt;
      if (nextPatch.status === undefined) {
        nextPatch.status = 'scheduled';
      }
    } else {
      nextPatch.scheduledAt = null;
      if (nextPatch.status === undefined && currentDraft.status === 'scheduled') {
        nextPatch.status = 'approved';
      }
    }
  }

  return nextPatch;
}

function parseProjectIdQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function syncDraftSchedule(
  jobQueueStore: JobQueueStore,
  currentDraft: DraftRecord,
  draft: DraftRecord,
): JobQueueEntry | undefined {
  const scheduledAt =
    typeof draft.scheduledAt === 'string' && draft.scheduledAt.trim().length > 0
      ? draft.scheduledAt
      : null;
  const shouldSchedule = draft.status === 'scheduled' && scheduledAt !== null;

  if (shouldSchedule) {
    return jobQueueStore.schedulePublishJob(draft.id, scheduledAt, draft.projectId);
  }

  if (currentDraft.status === 'scheduled' || currentDraft.scheduledAt) {
    jobQueueStore.deletePendingPublishJobs(draft.id);
  }

  return undefined;
}
