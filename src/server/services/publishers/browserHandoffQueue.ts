import type { JobQueueStore } from '../../store/jobQueue.js';
import type { PublishStatus } from './types.js';
import {
  browserHandoffPollJobType,
  defaultBrowserHandoffPollDelayMs,
  defaultBrowserHandoffPollMaxAttempts,
  hasOutstandingBrowserHandoffPollJob,
} from './browserHandoffPollHandler.js';

export function maybeEnqueueBrowserHandoffPollJob(
  result: {
    status: PublishStatus;
    details?: Record<string, unknown>;
  },
  jobQueueStore: Pick<JobQueueStore, 'enqueue' | 'list'>,
  now: () => Date = () => new Date(),
) {
  if (result.status !== 'manual_required') {
    return false;
  }

  const browserHandoff = readReadyBrowserHandoffDetails(result.details);
  if (!browserHandoff) {
    return false;
  }

  if (
    hasOutstandingBrowserHandoffPollJob(jobQueueStore, {
      artifactPath: browserHandoff.artifactPath,
      handoffAttempt: browserHandoff.handoffAttempt,
      currentJobId: undefined,
    })
  ) {
    return false;
  }

  jobQueueStore.enqueue({
    type: browserHandoffPollJobType,
    payload: {
      artifactPath: browserHandoff.artifactPath,
      handoffAttempt: browserHandoff.handoffAttempt,
      attempt: 0,
      maxAttempts: defaultBrowserHandoffPollMaxAttempts,
      pollDelayMs: defaultBrowserHandoffPollDelayMs,
    },
    runAt: new Date(now().getTime() + defaultBrowserHandoffPollDelayMs).toISOString(),
  });

  return true;
}

function readReadyBrowserHandoffDetails(details: Record<string, unknown> | undefined) {
  if (!isPlainObject(details) || !isPlainObject(details.browserHandoff)) {
    return null;
  }

  const artifactPath =
    typeof details.browserHandoff.artifactPath === 'string'
      ? details.browserHandoff.artifactPath.trim()
      : '';
  const handoffAttempt =
    typeof details.browserHandoff.handoffAttempt === 'number' &&
    Number.isInteger(details.browserHandoff.handoffAttempt) &&
    details.browserHandoff.handoffAttempt > 0
      ? details.browserHandoff.handoffAttempt
      : Number.NaN;

  return (
    details.browserHandoff.readiness === 'ready' &&
    artifactPath &&
    Number.isInteger(handoffAttempt) &&
    handoffAttempt > 0
  )
    ? {
        artifactPath,
        handoffAttempt,
      }
    : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
