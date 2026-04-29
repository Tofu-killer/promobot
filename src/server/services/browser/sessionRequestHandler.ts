import type { JobHandler, JobRecord } from '../../lib/jobs.js';
import { createChannelAccountStore, type ChannelAccountStore } from '../../store/channelAccounts.js';
import { createJobQueueStore, type JobQueueStore } from '../../store/jobQueue.js';
import {
  getSessionRequestArtifact,
  getSessionRequestResultArtifact,
} from './sessionRequestArtifacts.js';
import { importSessionRequestResultArtifact } from './sessionResultImporter.js';
import type { BrowserSessionAction } from './sessionStore.js';

export const channelAccountSessionRequestJobType = 'channel_account_session_request';
export const channelAccountSessionRequestPollJobType = 'channel_account_session_request_poll';

const defaultSessionRequestPollDelayMs = 60_000;
const defaultSessionRequestPollMaxAttempts = 60;
const sessionRequestPollQueueScanLimit = 200;

export interface ChannelAccountSessionRequestJobPayload {
  accountId?: unknown;
  platform?: unknown;
  accountKey?: unknown;
  action?: unknown;
}

export interface ChannelAccountSessionRequestPollJobPayload
  extends ChannelAccountSessionRequestJobPayload {
  requestJobId?: unknown;
  attempt?: unknown;
  maxAttempts?: unknown;
  pollDelayMs?: unknown;
}

interface NormalizedChannelAccountSessionRequestJobPayload {
  accountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
}

interface NormalizedChannelAccountSessionRequestPollJobPayload
  extends NormalizedChannelAccountSessionRequestJobPayload {
  requestJobId: number;
  attempt: number;
  maxAttempts: number;
  pollDelayMs: number;
}

export interface ChannelAccountSessionRequestJobHandlerDependencies {
  channelAccountStore?: Pick<ChannelAccountStore, 'getById'>;
  jobQueueStore?: Pick<JobQueueStore, 'enqueue' | 'list'>;
  now?: () => Date;
  importSessionRequestResultArtifact?: typeof importSessionRequestResultArtifact;
}

export function createChannelAccountSessionRequestJobHandler(
  dependencies: ChannelAccountSessionRequestJobHandlerDependencies = {},
): JobHandler {
  const channelAccountStore = dependencies.channelAccountStore ?? createChannelAccountStore();
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const now = dependencies.now ?? (() => new Date());
  const importSessionResultArtifact =
    dependencies.importSessionRequestResultArtifact ?? importSessionRequestResultArtifact;

  return async (payload, job) => {
    const normalizedPayload = normalizeSessionRequestPayload(payload);
    validateChannelAccount(channelAccountStore, normalizedPayload);

    const requestArtifact = getSessionRequestArtifact({
      platform: normalizedPayload.platform,
      accountKey: normalizedPayload.accountKey,
      action: normalizedPayload.action,
      jobId: job.id,
    });
    if (!requestArtifact) {
      throw new Error(
        `browser lane request artifact not found for ${channelAccountSessionRequestJobType} job ${job.id}`,
      );
    }

    if (requestArtifact.resolvedAt !== null) {
      return;
    }

    const resultArtifact = getSessionRequestResultArtifact({
      platform: normalizedPayload.platform,
      accountKey: normalizedPayload.accountKey,
      action: normalizedPayload.action,
      requestJobId: job.id,
    });

    if (resultArtifact?.consumedAt === null) {
      await importSessionResultArtifact(resultArtifact.artifactPath);
      return;
    }

    if (
      hasOutstandingSessionRequestPollJob(jobQueueStore, {
        ...normalizedPayload,
        requestJobId: job.id,
        currentJobId: undefined,
      })
    ) {
      return;
    }

    const pollDelayMs = defaultSessionRequestPollDelayMs;
    jobQueueStore.enqueue({
      type: channelAccountSessionRequestPollJobType,
      payload: {
        ...normalizedPayload,
        requestJobId: job.id,
        attempt: 0,
        maxAttempts: defaultSessionRequestPollMaxAttempts,
        pollDelayMs,
      },
      runAt: new Date(now().getTime() + pollDelayMs).toISOString(),
    });
  };
}

export function createChannelAccountSessionRequestPollJobHandler(
  dependencies: ChannelAccountSessionRequestJobHandlerDependencies = {},
): JobHandler {
  const channelAccountStore = dependencies.channelAccountStore ?? createChannelAccountStore();
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const now = dependencies.now ?? (() => new Date());
  const importSessionResultArtifact =
    dependencies.importSessionRequestResultArtifact ?? importSessionRequestResultArtifact;

  return async (payload, job) => {
    const normalizedPayload = normalizeSessionRequestPollPayload(payload);
    validateChannelAccount(channelAccountStore, normalizedPayload);

    const requestArtifact = getSessionRequestArtifact({
      platform: normalizedPayload.platform,
      accountKey: normalizedPayload.accountKey,
      action: normalizedPayload.action,
      jobId: normalizedPayload.requestJobId,
    });
    if (!requestArtifact) {
      throw new Error(
        `browser lane request artifact not found for ${channelAccountSessionRequestPollJobType} job ${job.id}`,
      );
    }

    if (requestArtifact.resolvedAt !== null) {
      return;
    }

    const resultArtifact = getSessionRequestResultArtifact({
      platform: normalizedPayload.platform,
      accountKey: normalizedPayload.accountKey,
      action: normalizedPayload.action,
      requestJobId: normalizedPayload.requestJobId,
    });

    if (resultArtifact?.consumedAt === null) {
      await importSessionResultArtifact(resultArtifact.artifactPath);
      return;
    }

    if (normalizedPayload.attempt + 1 >= normalizedPayload.maxAttempts) {
      return;
    }

    if (
      hasOutstandingSessionRequestPollJob(jobQueueStore, {
        ...normalizedPayload,
        currentJobId: job.id,
      })
    ) {
      return;
    }

    jobQueueStore.enqueue({
      type: channelAccountSessionRequestPollJobType,
      payload: {
        accountId: normalizedPayload.accountId,
        platform: normalizedPayload.platform,
        accountKey: normalizedPayload.accountKey,
        action: normalizedPayload.action,
        requestJobId: normalizedPayload.requestJobId,
        attempt: normalizedPayload.attempt + 1,
        maxAttempts: normalizedPayload.maxAttempts,
        pollDelayMs: normalizedPayload.pollDelayMs,
      },
      runAt: new Date(now().getTime() + normalizedPayload.pollDelayMs).toISOString(),
    });
  };
}

function validateChannelAccount(
  channelAccountStore: Pick<ChannelAccountStore, 'getById'>,
  payload: NormalizedChannelAccountSessionRequestJobPayload,
) {
  const channelAccount = channelAccountStore.getById(payload.accountId);
  if (!channelAccount) {
    throw new Error(
      `channel account ${payload.accountId} not found for ${channelAccountSessionRequestJobType}`,
    );
  }

  if (
    channelAccount.platform !== payload.platform ||
    channelAccount.accountKey !== payload.accountKey
  ) {
    throw new Error(
      `channel account ${payload.accountId} payload mismatch for ${channelAccountSessionRequestJobType}`,
    );
  }
}

function normalizeSessionRequestPayload(
  payload: unknown,
): NormalizedChannelAccountSessionRequestJobPayload {
  const normalizedPayload = isPlainObject(payload) ? payload : {};
  const accountId = Number(normalizedPayload.accountId);
  const platform =
    typeof normalizedPayload.platform === 'string' ? normalizedPayload.platform.trim() : '';
  const accountKey =
    typeof normalizedPayload.accountKey === 'string' ? normalizedPayload.accountKey.trim() : '';
  const action = parseBrowserSessionAction(normalizedPayload.action);

  if (
    !Number.isInteger(accountId) ||
    accountId <= 0 ||
    platform.length === 0 ||
    accountKey.length === 0 ||
    action === undefined
  ) {
    throw new Error('invalid channel_account_session_request job payload');
  }

  return {
    accountId,
    platform,
    accountKey,
    action,
  };
}

function normalizeSessionRequestPollPayload(
  payload: unknown,
): NormalizedChannelAccountSessionRequestPollJobPayload {
  const normalizedPayload = isPlainObject(payload) ? payload : {};
  const basePayload = normalizeSessionRequestPayload(normalizedPayload);
  const requestJobId = Number(normalizedPayload.requestJobId);

  if (!Number.isInteger(requestJobId) || requestJobId <= 0) {
    throw new Error('invalid channel_account_session_request_poll job payload');
  }

  return {
    ...basePayload,
    requestJobId,
    attempt: normalizeNonNegativeInteger(
      normalizedPayload.attempt,
      0,
      'invalid channel_account_session_request_poll job payload',
    ),
    maxAttempts: normalizePositiveInteger(
      normalizedPayload.maxAttempts,
      defaultSessionRequestPollMaxAttempts,
      'invalid channel_account_session_request_poll job payload',
    ),
    pollDelayMs: normalizePositiveInteger(
      normalizedPayload.pollDelayMs,
      defaultSessionRequestPollDelayMs,
      'invalid channel_account_session_request_poll job payload',
    ),
  };
}

function hasOutstandingSessionRequestPollJob(
  jobQueueStore: Pick<JobQueueStore, 'list'>,
  input: {
    accountId: number;
    platform: string;
    accountKey: string;
    action: BrowserSessionAction;
    requestJobId: number;
    currentJobId: number | undefined;
  },
) {
  const queuedJobs = jobQueueStore.list({
    limit: sessionRequestPollQueueScanLimit,
    statuses: ['pending', 'running'],
  });

  return queuedJobs.some((queuedJob) => {
    if (
      queuedJob.type !== channelAccountSessionRequestPollJobType ||
      queuedJob.id === input.currentJobId
    ) {
      return false;
    }

    const queuedPayload = parseQueuedPollPayload(queuedJob.payload);
    if (!queuedPayload) {
      return false;
    }

    return (
      queuedPayload.requestJobId === input.requestJobId &&
      queuedPayload.accountId === input.accountId &&
      queuedPayload.platform === input.platform &&
      queuedPayload.accountKey === input.accountKey &&
      queuedPayload.action === input.action
    );
  });
}

function parseQueuedPollPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as ChannelAccountSessionRequestPollJobPayload;
    return normalizeSessionRequestPollPayload(parsed);
  } catch {
    return null;
  }
}

function normalizePositiveInteger(
  value: unknown,
  defaultValue: number,
  errorMessage: string,
) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalizedValue = Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function normalizeNonNegativeInteger(
  value: unknown,
  defaultValue: number,
  errorMessage: string,
) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalizedValue = Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBrowserSessionAction(value: unknown): BrowserSessionAction | undefined {
  if (value === 'request_session' || value === 'relogin') {
    return value;
  }

  return undefined;
}
