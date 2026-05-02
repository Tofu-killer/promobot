import type { JobHandler } from '../../lib/jobs.js';
import { createJobQueueStore, type JobQueueStore } from '../../store/jobQueue.js';
import { getInboxReplyHandoffArtifactByPath } from './replyHandoffArtifacts.js';
import { getInboxReplyHandoffResultArtifact } from './replyHandoffResultArtifacts.js';
import { importInboxReplyHandoffResultArtifact } from './replyHandoffResultImporter.js';

export const inboxReplyHandoffPollJobType = 'inbox_reply_handoff_poll';
export const defaultInboxReplyHandoffPollDelayMs = 60_000;
export const defaultInboxReplyHandoffPollMaxAttempts = 60;

const inboxReplyHandoffPollQueueScanLimit = 200;

export interface InboxReplyHandoffPollJobPayload {
  artifactPath?: unknown;
  handoffAttempt?: unknown;
  attempt?: unknown;
  maxAttempts?: unknown;
  pollDelayMs?: unknown;
}

interface NormalizedInboxReplyHandoffPollJobPayload {
  artifactPath: string;
  handoffAttempt?: number;
  attempt: number;
  maxAttempts: number;
  pollDelayMs: number;
}

export interface InboxReplyHandoffPollJobHandlerDependencies {
  jobQueueStore?: Pick<JobQueueStore, 'enqueue' | 'list'>;
  now?: () => Date;
  importInboxReplyHandoffResultArtifact?: typeof importInboxReplyHandoffResultArtifact;
}

export function createInboxReplyHandoffPollJobHandler(
  dependencies: InboxReplyHandoffPollJobHandlerDependencies = {},
): JobHandler {
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const now = dependencies.now ?? (() => new Date());
  const importResultArtifact =
    dependencies.importInboxReplyHandoffResultArtifact ?? importInboxReplyHandoffResultArtifact;

  return async (payload, job) => {
    const normalizedPayload = normalizeInboxReplyHandoffPollPayload(payload);
    const handoffArtifact = getInboxReplyHandoffArtifactByPath(normalizedPayload.artifactPath);
    if (!handoffArtifact) {
      throw new Error(`inbox reply handoff artifact not found for ${inboxReplyHandoffPollJobType} job ${job.id}`);
    }

    if (handoffArtifact.status !== 'pending') {
      return;
    }

    if (
      normalizedPayload.handoffAttempt !== undefined &&
      handoffArtifact.handoffAttempt !== normalizedPayload.handoffAttempt
    ) {
      return;
    }

    const resolvedHandoffAttempt =
      normalizedPayload.handoffAttempt ?? handoffArtifact.handoffAttempt;

    const resultArtifact = getInboxReplyHandoffResultArtifact({
      platform: handoffArtifact.platform,
      accountKey: handoffArtifact.accountKey,
      itemId: handoffArtifact.itemId,
      handoffAttempt: handoffArtifact.handoffAttempt,
    });

    if (resultArtifact?.consumedAt === null) {
      await importResultArtifact(resultArtifact.artifactPath);
      return;
    }

    if (handoffArtifact.readiness === 'blocked') {
      return;
    }

    if (normalizedPayload.attempt + 1 >= normalizedPayload.maxAttempts) {
      return;
    }

    if (
      hasOutstandingInboxReplyHandoffPollJob(jobQueueStore, {
        artifactPath: normalizedPayload.artifactPath,
        handoffAttempt: resolvedHandoffAttempt,
        currentJobId: job.id,
      })
    ) {
      return;
    }

    jobQueueStore.enqueue({
      type: inboxReplyHandoffPollJobType,
      payload: {
        artifactPath: normalizedPayload.artifactPath,
        handoffAttempt: resolvedHandoffAttempt,
        attempt: normalizedPayload.attempt + 1,
        maxAttempts: normalizedPayload.maxAttempts,
        pollDelayMs: normalizedPayload.pollDelayMs,
      },
      runAt: new Date(now().getTime() + normalizedPayload.pollDelayMs).toISOString(),
    });
  };
}

export function hasOutstandingInboxReplyHandoffPollJob(
  jobQueueStore: Pick<JobQueueStore, 'list'>,
  input: {
    artifactPath: string;
    handoffAttempt: number;
    currentJobId: number | undefined;
  },
) {
  const queuedJobs = jobQueueStore.list({
    limit: inboxReplyHandoffPollQueueScanLimit,
    statuses: ['pending', 'running'],
  });

  return queuedJobs.some((queuedJob) => {
    if (queuedJob.type !== inboxReplyHandoffPollJobType || queuedJob.id === input.currentJobId) {
      return false;
    }

    const queuedPayload = parseQueuedPollPayload(queuedJob.payload);
    if (!queuedPayload) {
      return false;
    }

    return (
      queuedPayload.artifactPath === input.artifactPath &&
      (queuedPayload.handoffAttempt ?? input.handoffAttempt) === input.handoffAttempt
    );
  });
}

function normalizeInboxReplyHandoffPollPayload(
  payload: unknown,
): NormalizedInboxReplyHandoffPollJobPayload {
  const normalizedPayload = isPlainObject(payload) ? payload : {};
  const artifactPath =
    typeof normalizedPayload.artifactPath === 'string'
      ? normalizedPayload.artifactPath.trim()
      : '';

  if (!artifactPath) {
    throw new Error('invalid inbox_reply_handoff_poll job payload');
  }

  return {
    artifactPath,
    handoffAttempt: normalizeOptionalPositiveInteger(
      normalizedPayload.handoffAttempt,
      'invalid inbox_reply_handoff_poll job payload',
    ),
    attempt: normalizeNonNegativeInteger(
      normalizedPayload.attempt,
      0,
      'invalid inbox_reply_handoff_poll job payload',
    ),
    maxAttempts: normalizePositiveInteger(
      normalizedPayload.maxAttempts,
      defaultInboxReplyHandoffPollMaxAttempts,
      'invalid inbox_reply_handoff_poll job payload',
    ),
    pollDelayMs: normalizePositiveInteger(
      normalizedPayload.pollDelayMs,
      defaultInboxReplyHandoffPollDelayMs,
      'invalid inbox_reply_handoff_poll job payload',
    ),
  };
}

function parseQueuedPollPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as InboxReplyHandoffPollJobPayload;
    return normalizeInboxReplyHandoffPollPayload(parsed);
  } catch {
    return null;
  }
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, errorMessage: string) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(errorMessage);
  }

  return parsed;
}

function normalizePositiveInteger(value: unknown, fallback: number, errorMessage: string) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(errorMessage);
  }

  return parsed;
}

function normalizeOptionalPositiveInteger(value: unknown, errorMessage: string) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(errorMessage);
  }

  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
