import { Router } from 'express';
import type { JobQueueEntry, JobQueueStore } from '../store/jobQueue.js';
import { createJobQueueStore } from '../store/jobQueue.js';
import { createSQLiteDraftStore } from '../store/drafts.js';

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
  target?: string;
  metadata: Record<string, unknown>;
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
  target?: string;
  metadata?: Record<string, unknown>;
  hashtags?: string[];
  status?: DraftStatus;
}

export interface UpdateDraftInput {
  projectId?: number;
  title?: string;
  content?: string;
  target?: string;
  metadata?: Record<string, unknown>;
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
    const body =
      request.body && isPlainObject(request.body)
        ? (request.body as Record<string, unknown>)
        : undefined;

    if (!currentDraft) {
      response.status(404).json({ error: 'draft not found' });
      return;
    }

    if (request.body !== undefined && !body) {
      response.status(400).json({ error: 'invalid draft payload' });
      return;
    }

    if (
      hasInvalidOptionalString(body, 'title') ||
      hasInvalidOptionalString(body, 'content') ||
      hasInvalidOptionalString(body, 'target') ||
      hasInvalidOptionalString(body, 'status') ||
      hasInvalidOptionalPlainObject(body, 'metadata') ||
      hasInvalidOptionalNullableString(body, 'scheduledAt') ||
      hasInvalidOptionalStringArray(body, 'hashtags')
    ) {
      response.status(400).json({ error: 'invalid draft payload' });
      return;
    }

    const projectId = parseProjectIdBodyValue(body?.projectId);

    if (body?.projectId !== undefined && projectId === undefined) {
      response.status(400).json({ error: 'invalid project id' });
      return;
    }

    if (hasOwnProperty(body, 'title')) {
      patch.title = body.title as string;
    }
    if (hasOwnProperty(body, 'content')) {
      patch.content = body.content as string;
    }
    if (hasOwnProperty(body, 'target')) {
      patch.target = body.target as string;
    }
    if (hasOwnProperty(body, 'metadata')) {
      patch.metadata = body.metadata as Record<string, unknown>;
    }
    if (projectId !== undefined) {
      patch.projectId = projectId;
    }
    if (hasOwnProperty(body, 'hashtags')) {
      patch.hashtags = body.hashtags as string[];
    }
    if (hasOwnProperty(body, 'status')) {
      const status = body.status as string;
      if (!isDraftStatus(status)) {
        response.status(400).json({ error: 'invalid draft status' });
        return;
      }
      patch.status = status;
    }
    if (hasOwnProperty(body, 'scheduledAt')) {
      patch.scheduledAt = body.scheduledAt as string | null;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnProperty(
  value: Record<string, unknown> | undefined,
  key: string,
): value is Record<string, unknown> {
  return Boolean(value && Object.hasOwn(value, key));
}

function hasInvalidOptionalString(value: Record<string, unknown> | undefined, key: string) {
  return hasOwnProperty(value, key) && typeof value[key] !== 'string';
}

function hasInvalidOptionalNullableString(value: Record<string, unknown> | undefined, key: string) {
  return hasOwnProperty(value, key) && value[key] !== null && typeof value[key] !== 'string';
}

function hasInvalidOptionalPlainObject(value: Record<string, unknown> | undefined, key: string) {
  return hasOwnProperty(value, key) && !isPlainObject(value[key]);
}

function hasInvalidOptionalStringArray(value: Record<string, unknown> | undefined, key: string) {
  return (
    hasOwnProperty(value, key) &&
    (!Array.isArray(value[key]) || value[key].some((entry: unknown) => typeof entry !== 'string'))
  );
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

function parseProjectIdBodyValue(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
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
