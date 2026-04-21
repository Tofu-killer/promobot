import type { DatabaseConnection } from '../db.js';
import {
  createJobRecord,
  type JobRecord,
  type JobStatus,
  type JobStore,
} from '../lib/jobs.js';
import { withDatabase } from '../lib/persistence.js';

export interface EnqueueJobInput {
  type: string;
  payload?: Record<string, unknown>;
  status?: JobStatus;
  runAt: string;
}

export interface JobQueueEntry extends JobRecord {
  draftId?: number;
  projectId?: number;
  lastError?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  canRetry?: boolean;
  canCancel?: boolean;
}

export interface JobQueueStats {
  pending: number;
  running: number;
  done: number;
  failed: number;
  canceled?: number;
  duePending: number;
}

export interface ListJobQueueOptions {
  limit?: number;
  statuses?: string[];
}

export interface JobQueueStore extends JobStore {
  enqueue(input: EnqueueJobInput): JobQueueEntry;
  list(options?: ListJobQueueOptions): JobQueueEntry[];
  get(jobId: number): JobQueueEntry | undefined;
  getStats(nowIso?: string, projectId?: number): JobQueueStats;
  requeueRunningJobs(nowIso?: string): number;
  retry(jobId: number, runAt?: string): JobQueueEntry | undefined;
  cancel(jobId: number, canceledAtIso?: string): JobQueueEntry | undefined;
  schedulePublishJob(draftId: number, runAt: string, projectId?: number | null): JobQueueEntry;
  deletePendingPublishJobs(draftId: number): number;
}

export function createJobQueueStore(): JobQueueStore {
  return {
    enqueue(input) {
      return withDatabase((database) => insertJob(database, input));
    },
    listDueJobs(nowIso) {
      return Promise.resolve(withDatabase((database) => listDueJobs(database, nowIso)));
    },
    markRunning(jobId, startedAtIso) {
      return Promise.resolve(withDatabase((database) => markRunning(database, jobId, startedAtIso)));
    },
    markDone(jobId, finishedAtIso) {
      return Promise.resolve(withDatabase((database) => markDone(database, jobId, finishedAtIso)));
    },
    markFailed(jobId, error, failedAtIso) {
      return Promise.resolve(withDatabase((database) => markFailed(database, jobId, error, failedAtIso)));
    },
    list(options) {
      return withDatabase((database) => listJobs(database, options));
    },
    get(jobId) {
      return withDatabase((database) => getJobById(database, jobId));
    },
    getStats(nowIso, projectId) {
      return withDatabase((database) =>
        getJobQueueStats(database, nowIso ?? new Date().toISOString(), projectId),
      );
    },
    requeueRunningJobs(nowIso) {
      return withDatabase((database) => requeueRunningJobs(database, nowIso ?? new Date().toISOString()));
    },
    retry(jobId, runAt) {
      return withDatabase((database) => retryJob(database, jobId, runAt ?? new Date().toISOString()));
    },
    cancel(jobId, canceledAtIso) {
      return withDatabase((database) => cancelJob(database, jobId, canceledAtIso ?? new Date().toISOString()));
    },
    schedulePublishJob(draftId, runAt, projectId) {
      return withDatabase((database) =>
        schedulePublishJob(database, draftId, runAt, projectId),
      );
    },
    deletePendingPublishJobs(draftId) {
      return withDatabase((database) => deletePendingPublishJobs(database, draftId));
    },
  };
}

function insertJob(database: DatabaseConnection, input: EnqueueJobInput): JobQueueEntry {
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `
        INSERT INTO job_queue (type, payload, status, run_at, attempts, created_at, updated_at)
        VALUES (@type, @payload, @status, @run_at, 0, @created_at, @updated_at)
      `,
    )
    .run({
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      status: input.status ?? 'pending',
      run_at: input.runAt,
      created_at: now,
      updated_at: now,
    });

  const entry = getJobById(database, Number(result.lastInsertRowid));
  if (!entry) {
    throw new Error('job queue insert failed');
  }

  return entry;
}

function listDueJobs(database: DatabaseConnection, nowIso: string): JobRecord[] {
  return database
    .prepare(
      `
        SELECT id, type, payload, status, run_at AS runAt, attempts
        FROM job_queue
        WHERE status = 'pending' AND run_at <= ?
        ORDER BY run_at ASC, id ASC
        LIMIT 50
      `,
    )
    .all([nowIso])
    .map((row) => normalizeJobRecord(row as Record<string, unknown>));
}

function markRunning(
  database: DatabaseConnection,
  jobId: number,
  startedAtIso: string,
): boolean {
  const result = database
    .prepare(
      `
        UPDATE job_queue
        SET status = 'running',
            attempts = attempts + 1,
            started_at = @started_at,
            updated_at = @updated_at
        WHERE id = @id AND status = 'pending'
      `,
    )
    .run({
      id: jobId,
      started_at: startedAtIso,
      updated_at: startedAtIso,
    });

  return result.changes > 0;
}

function markDone(database: DatabaseConnection, jobId: number, finishedAtIso: string): void {
  database
    .prepare(
      `
        UPDATE job_queue
        SET status = 'done',
            finished_at = @finished_at,
            last_error = NULL,
            updated_at = @updated_at
        WHERE id = @id AND status = 'running'
      `,
    )
    .run({
      id: jobId,
      finished_at: finishedAtIso,
      updated_at: finishedAtIso,
    });
}

function markFailed(
  database: DatabaseConnection,
  jobId: number,
  error: string,
  failedAtIso: string,
): void {
  database
    .prepare(
      `
        UPDATE job_queue
        SET status = 'failed',
            finished_at = @finished_at,
            last_error = @last_error,
            updated_at = @updated_at
        WHERE id = @id AND status = 'running'
      `,
    )
    .run({
      id: jobId,
      finished_at: failedAtIso,
      last_error: error,
      updated_at: failedAtIso,
    });
}

function listJobs(
  database: DatabaseConnection,
  options: ListJobQueueOptions = {},
): JobQueueEntry[] {
  const limit = normalizeLimit(options.limit);
  const statuses = Array.isArray(options.statuses)
    ? options.statuses.filter((status): status is string => typeof status === 'string' && status.trim().length > 0)
    : [];

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (statuses.length > 0) {
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }

  params.push(limit);

  const rows = database
    .prepare(
      `
        SELECT id, type, payload, status, run_at AS runAt, attempts,
               last_error AS lastError, started_at AS startedAt,
               finished_at AS finishedAt, created_at AS createdAt, updated_at AS updatedAt
        FROM job_queue
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY run_at ASC, id ASC
        LIMIT ?
      `,
    )
    .all(params);

  return rows.map((row) => normalizeJobQueueEntry(row as Record<string, unknown>));
}

function getJobQueueStats(
  database: DatabaseConnection,
  nowIso: string,
  projectId?: number,
): JobQueueStats {
  if (projectId === undefined) {
    return getGlobalJobQueueStats(database, nowIso);
  }

  const rows = database
    .prepare(
      `
        SELECT status, run_at AS runAt, payload
        FROM job_queue
      `,
    )
    .all() as Array<{ status: string; runAt: string; payload: string }>;

  const counts = createEmptyJobQueueStats();

  for (const row of rows) {
    const rowProjectId = normalizePositiveInteger(parsePayloadObject(row.payload)?.projectId);
    if (rowProjectId !== projectId) {
      continue;
    }

    incrementJobQueueStatusCount(counts, row.status);

    if (row.status === 'pending' && row.runAt <= nowIso) {
      counts.duePending += 1;
    }
  }

  return counts;
}

function getGlobalJobQueueStats(database: DatabaseConnection, nowIso: string): JobQueueStats {
  const rows = database
    .prepare(
      `
        SELECT status, COUNT(*) AS count
        FROM job_queue
        GROUP BY status
      `,
    )
    .all() as Array<{ status: string; count: number }>;

  const counts = createEmptyJobQueueStats();

  for (const row of rows) {
    setJobQueueStatusCount(counts, row.status, Number(row.count));
  }

  const dueRow = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM job_queue
        WHERE status = 'pending' AND run_at <= ?
      `,
    )
    .get([nowIso]) as { count?: number } | undefined;

  counts.duePending = Number(dueRow?.count ?? 0);

  return counts;
}

function createEmptyJobQueueStats(): JobQueueStats {
  return {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    canceled: 0,
    duePending: 0,
  };
}

function incrementJobQueueStatusCount(counts: JobQueueStats, status: string) {
  setJobQueueStatusCount(counts, status, getJobQueueStatusCount(counts, status) + 1);
}

function getJobQueueStatusCount(counts: JobQueueStats, status: string) {
  if (status === 'pending') {
    return counts.pending;
  }

  if (status === 'running') {
    return counts.running;
  }

  if (status === 'done') {
    return counts.done;
  }

  if (status === 'failed') {
    return counts.failed;
  }

  if (status === 'canceled') {
    return counts.canceled ?? 0;
  }

  return 0;
}

function setJobQueueStatusCount(counts: JobQueueStats, status: string, count: number) {
  if (status === 'pending') {
    counts.pending = count;
  } else if (status === 'running') {
    counts.running = count;
  } else if (status === 'done') {
    counts.done = count;
  } else if (status === 'failed') {
    counts.failed = count;
  } else if (status === 'canceled') {
    counts.canceled = count;
  }
}

function requeueRunningJobs(database: DatabaseConnection, nowIso: string): number {
  const result = database
    .prepare(
      `
        UPDATE job_queue
        SET status = 'pending',
            updated_at = @updated_at
        WHERE status = 'running'
      `,
    )
    .run({
      updated_at: nowIso,
    });

  return result.changes;
}

function retryJob(
  database: DatabaseConnection,
  jobId: number,
  runAtIso: string,
): JobQueueEntry | undefined {
  const updatedAt = new Date().toISOString();
  const result = database
    .prepare(
      `
        UPDATE job_queue
        SET status = 'pending',
            run_at = @run_at,
            last_error = NULL,
            started_at = NULL,
            finished_at = NULL,
            updated_at = @updated_at
        WHERE id = @id AND status IN ('failed', 'canceled')
      `,
    )
    .run({
      id: jobId,
      run_at: runAtIso,
      updated_at: updatedAt,
    });

  if (result.changes === 0) {
    return undefined;
  }

  return getJobById(database, jobId);
}

function cancelJob(
  database: DatabaseConnection,
  jobId: number,
  canceledAtIso: string,
): JobQueueEntry | undefined {
  const result = database
    .prepare(
      `
        UPDATE job_queue
        SET status = 'canceled',
            finished_at = @finished_at,
            last_error = NULL,
            updated_at = @updated_at
        WHERE id = @id AND status IN ('pending', 'running')
      `,
    )
    .run({
      id: jobId,
      finished_at: canceledAtIso,
      updated_at: canceledAtIso,
    });

  if (result.changes === 0) {
    return undefined;
  }

  return getJobById(database, jobId);
}

function schedulePublishJob(
  database: DatabaseConnection,
  draftId: number,
  runAt: string,
  projectId?: number | null,
): JobQueueEntry {
  const now = new Date().toISOString();
  const payload = createPublishPayload(draftId, projectId);
  const serializedPayload = JSON.stringify(payload);
  const existingId = findPendingOrFailedPublishJobIdsByDraftId(database, draftId)[0];

  if (existingId !== undefined) {
    database
      .prepare(
        `
          UPDATE job_queue
          SET status = 'pending',
              payload = @payload,
              run_at = @run_at,
              last_error = NULL,
              started_at = NULL,
              finished_at = NULL,
              updated_at = @updated_at
          WHERE id = @id
        `,
      )
      .run({
        id: existingId,
        payload: serializedPayload,
        run_at: runAt,
        updated_at: now,
      });

    const entry = getJobById(database, existingId);
    if (!entry) {
      throw new Error('publish job update failed');
    }

    return entry;
  }

  return insertJob(database, {
    type: 'publish',
    payload,
    runAt,
    status: 'pending',
  });
}

function deletePendingPublishJobs(database: DatabaseConnection, draftId: number): number {
  const matchingIds = findPendingOrFailedPublishJobIdsByDraftId(database, draftId);
  if (matchingIds.length === 0) {
    return 0;
  }

  const result = database
    .prepare(
      `
        DELETE FROM job_queue
        WHERE id IN (${matchingIds.map(() => '?').join(', ')})
      `,
    )
    .run(matchingIds);

  return result.changes;
}

function getJobById(database: DatabaseConnection, jobId: number): JobQueueEntry | undefined {
  const row = database
    .prepare(
      `
        SELECT id, type, payload, status, run_at AS runAt, attempts,
               last_error AS lastError, started_at AS startedAt,
               finished_at AS finishedAt, created_at AS createdAt, updated_at AS updatedAt
        FROM job_queue
        WHERE id = ?
      `,
    )
    .get([jobId]);

  return row ? normalizeJobQueueEntry(row as Record<string, unknown>) : undefined;
}

function createPublishPayload(draftId: number, projectId?: number | null) {
  const payload: Record<string, number> = { draftId };
  const normalizedProjectId = normalizePositiveInteger(projectId);

  if (normalizedProjectId !== undefined) {
    payload.projectId = normalizedProjectId;
  }

  return payload;
}

function findPendingOrFailedPublishJobIdsByDraftId(
  database: DatabaseConnection,
  draftId: number,
) {
  const rows = database
    .prepare(
      `
        SELECT id, payload
        FROM job_queue
        WHERE type = 'publish'
          AND status IN ('pending', 'failed')
        ORDER BY id ASC
      `,
    )
    .all() as Array<{ id: number; payload: string }>;

  return rows.flatMap((row) =>
    parsePublishJobPayload(row.payload).draftId === draftId ? [Number(row.id)] : [],
  );
}

function parsePublishJobPayload(value: unknown) {
  const payload = parsePayloadObject(value);

  return {
    draftId: normalizePositiveInteger(payload?.draftId),
    projectId: normalizePositiveInteger(payload?.projectId),
  };
}

function parsePayloadObject(value: unknown) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeJobRecord(row: Record<string, unknown>): JobRecord {
  return createJobRecord({
    id: Number(row.id),
    type: String(row.type),
    payload: typeof row.payload === 'string' ? row.payload : '{}',
    status: String(row.status) as JobStatus,
    runAt: String(row.runAt),
    attempts: Number(row.attempts ?? 0),
  });
}

function normalizeJobQueueEntry(row: Record<string, unknown>): JobQueueEntry {
  const status = String(row.status) as JobStatus;
  const publishPayload =
    String(row.type) === 'publish' ? parsePublishJobPayload(row.payload) : undefined;

  return {
    ...normalizeJobRecord(row),
    draftId: publishPayload?.draftId,
    projectId: publishPayload?.projectId,
    lastError: typeof row.lastError === 'string' ? row.lastError : undefined,
    startedAt: typeof row.startedAt === 'string' ? row.startedAt : undefined,
    finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : undefined,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    canRetry: status === 'failed' || status === 'canceled',
    canCancel: status === 'pending' || status === 'running',
  };
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return 20;
  }

  return Math.min(value, 100);
}
