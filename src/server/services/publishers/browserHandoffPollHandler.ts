import type { JobHandler } from '../../lib/jobs.js';
import { createJobQueueStore, type JobQueueStore } from '../../store/jobQueue.js';
import { getBrowserHandoffArtifactByPath } from './browserHandoffArtifacts.js';
import { getBrowserHandoffResultArtifact } from './browserHandoffResultArtifacts.js';
import { importBrowserHandoffResultArtifact } from './browserHandoffResultImporter.js';

export const browserHandoffPollJobType = 'browser_handoff_poll';
export const defaultBrowserHandoffPollDelayMs = 60_000;
export const defaultBrowserHandoffPollMaxAttempts = 60;

const browserHandoffPollQueueScanLimit = 200;

export interface BrowserHandoffPollJobPayload {
  artifactPath?: unknown;
  handoffAttempt?: unknown;
  attempt?: unknown;
  maxAttempts?: unknown;
  pollDelayMs?: unknown;
}

interface NormalizedBrowserHandoffPollJobPayload {
  artifactPath: string;
  handoffAttempt?: number;
  attempt: number;
  maxAttempts: number;
  pollDelayMs: number;
}

export interface BrowserHandoffPollJobHandlerDependencies {
  jobQueueStore?: Pick<JobQueueStore, 'enqueue' | 'list'>;
  now?: () => Date;
  importBrowserHandoffResultArtifact?: typeof importBrowserHandoffResultArtifact;
}

export function createBrowserHandoffPollJobHandler(
  dependencies: BrowserHandoffPollJobHandlerDependencies = {},
): JobHandler {
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const now = dependencies.now ?? (() => new Date());
  const importResultArtifact =
    dependencies.importBrowserHandoffResultArtifact ?? importBrowserHandoffResultArtifact;

  return async (payload, job) => {
    const normalizedPayload = normalizeBrowserHandoffPollPayload(payload);
    const handoffArtifact = getBrowserHandoffArtifactByPath(normalizedPayload.artifactPath);
    if (!handoffArtifact) {
      throw new Error(`browser handoff artifact not found for ${browserHandoffPollJobType} job ${job.id}`);
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

    const resultArtifact = getBrowserHandoffResultArtifact({
      platform: handoffArtifact.platform,
      accountKey: handoffArtifact.accountKey,
      draftId: handoffArtifact.draftId,
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
      hasOutstandingBrowserHandoffPollJob(jobQueueStore, {
        artifactPath: normalizedPayload.artifactPath,
        handoffAttempt: resolvedHandoffAttempt,
        currentJobId: job.id,
      })
    ) {
      return;
    }

    jobQueueStore.enqueue({
      type: browserHandoffPollJobType,
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

export function hasOutstandingBrowserHandoffPollJob(
  jobQueueStore: Pick<JobQueueStore, 'list'>,
  input: {
    artifactPath: string;
    handoffAttempt: number;
    currentJobId: number | undefined;
  },
) {
  const queuedJobs = jobQueueStore.list({
    limit: browserHandoffPollQueueScanLimit,
    statuses: ['pending', 'running'],
  });

  return queuedJobs.some((queuedJob) => {
    if (queuedJob.type !== browserHandoffPollJobType || queuedJob.id === input.currentJobId) {
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

function normalizeBrowserHandoffPollPayload(
  payload: unknown,
): NormalizedBrowserHandoffPollJobPayload {
  const normalizedPayload = isPlainObject(payload) ? payload : {};
  const artifactPath =
    typeof normalizedPayload.artifactPath === 'string'
      ? normalizedPayload.artifactPath.trim()
      : '';

  if (!artifactPath) {
    throw new Error('invalid browser_handoff_poll job payload');
  }

  return {
    artifactPath,
    handoffAttempt: normalizeOptionalPositiveInteger(
      normalizedPayload.handoffAttempt,
      'invalid browser_handoff_poll job payload',
    ),
    attempt: normalizeNonNegativeInteger(
      normalizedPayload.attempt,
      0,
      'invalid browser_handoff_poll job payload',
    ),
    maxAttempts: normalizePositiveInteger(
      normalizedPayload.maxAttempts,
      defaultBrowserHandoffPollMaxAttempts,
      'invalid browser_handoff_poll job payload',
    ),
    pollDelayMs: normalizePositiveInteger(
      normalizedPayload.pollDelayMs,
      defaultBrowserHandoffPollDelayMs,
      'invalid browser_handoff_poll job payload',
    ),
  };
}

function parseQueuedPollPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as BrowserHandoffPollJobPayload;
    return normalizeBrowserHandoffPollPayload(parsed);
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
