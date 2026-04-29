import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { JobHandler, JobRecord } from '../../lib/jobs.js';
import { getDatabasePath } from '../../lib/persistence.js';
import { createChannelAccountStore, type ChannelAccountStore } from '../../store/channelAccounts.js';
import { createJobQueueStore, type JobQueueStore } from '../../store/jobQueue.js';
import {
  getSessionRequestArtifact,
  getSessionRequestResultArtifact,
} from './sessionRequestArtifacts.js';
import {
  importInlineSessionRequestResult,
  importSessionRequestResultArtifact,
} from './sessionResultImporter.js';
import { createSessionStore } from './sessionStore.js';
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
  importInlineSessionRequestResult?: typeof importInlineSessionRequestResult;
  sessionStore?: Pick<ReturnType<typeof createSessionStore>, 'getSession'>;
}

export function createChannelAccountSessionRequestJobHandler(
  dependencies: ChannelAccountSessionRequestJobHandlerDependencies = {},
): JobHandler {
  const channelAccountStore = dependencies.channelAccountStore ?? createChannelAccountStore();
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const now = dependencies.now ?? (() => new Date());
  const importSessionResultArtifact =
    dependencies.importSessionRequestResultArtifact ?? importSessionRequestResultArtifact;
  const importInlineSessionResult =
    dependencies.importInlineSessionRequestResult ?? importInlineSessionRequestResult;
  const sessionStore = dependencies.sessionStore ?? createSessionStore();

  return async (payload, job) => {
    const normalizedPayload = normalizeSessionRequestPayload(payload);
    const channelAccount = validateChannelAccount(channelAccountStore, normalizedPayload);

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
      await tryImportExistingSession({
        channelAccount,
        requestArtifactPath: requestArtifact.artifactPath,
        requestedAt: requestArtifact.requestedAt,
        sessionStore,
        importInlineSessionResult,
      })
    ) {
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
  const importInlineSessionResult =
    dependencies.importInlineSessionRequestResult ?? importInlineSessionRequestResult;
  const sessionStore = dependencies.sessionStore ?? createSessionStore();

  return async (payload, job) => {
    const normalizedPayload = normalizeSessionRequestPollPayload(payload);
    const channelAccount = validateChannelAccount(channelAccountStore, normalizedPayload);

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

    if (
      await tryImportExistingSession({
        channelAccount,
        requestArtifactPath: requestArtifact.artifactPath,
        requestedAt: requestArtifact.requestedAt,
        sessionStore,
        importInlineSessionResult,
      })
    ) {
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

  return channelAccount;
}

async function tryImportExistingSession(input: {
  channelAccount: NonNullable<ReturnType<Pick<ChannelAccountStore, 'getById'>['getById']>>;
  requestArtifactPath: string;
  requestedAt: string;
  sessionStore: Pick<ReturnType<typeof createSessionStore>, 'getSession'>;
  importInlineSessionResult: typeof importInlineSessionRequestResult;
}) {
  const candidate = findExistingSessionImportCandidate({
    platform: input.channelAccount.platform,
    accountKey: input.channelAccount.accountKey,
    requestedAt: input.requestedAt,
    sessionStore: input.sessionStore,
  });
  if (!candidate) {
    return false;
  }

  await input.importInlineSessionResult({
    requestArtifactPath: input.requestArtifactPath,
    storageState: candidate.storageState,
    sessionStatus: candidate.sessionStatus,
    validatedAt: candidate.validatedAt,
    completedAt: candidate.completedAt,
    ...(candidate.notes !== undefined ? { notes: candidate.notes } : {}),
  });

  return true;
}

function findExistingSessionImportCandidate(input: {
  platform: string;
  accountKey: string;
  requestedAt: string;
  sessionStore: Pick<ReturnType<typeof createSessionStore>, 'getSession'>;
}) {
  const sessionMetadata = input.sessionStore.getSession(input.platform, input.accountKey);
  if (sessionMetadata?.status === 'active') {
    const storageState = loadStorageState(sessionMetadata.storageStatePath);
    const completedAt = resolveCandidateCompletedAt(sessionMetadata.updatedAt, input.requestedAt);
    if (storageState && completedAt) {
      return {
        storageState,
        sessionStatus: sessionMetadata.status,
        validatedAt: completedAt,
        completedAt,
        notes: sessionMetadata.notes,
      };
    }
  }

  const managedStorageStatePath = buildManagedStorageStatePath(input.platform, input.accountKey);
  const storageState = loadStorageState(managedStorageStatePath);
  const completedAt = readStorageStateModifiedAt(managedStorageStatePath, input.requestedAt);
  if (!storageState || !completedAt) {
    return null;
  }

  return {
    storageState,
    sessionStatus: 'active' as const,
    validatedAt: completedAt,
    completedAt,
    notes: undefined,
  };
}

function resolveCandidateCompletedAt(updatedAt: string | null, requestedAt: string) {
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const requestedAtMs = Date.parse(requestedAt);

  if (Number.isFinite(updatedAtMs) && Number.isFinite(requestedAtMs)) {
    if (updatedAtMs < requestedAtMs) {
      return null;
    }

    return new Date(updatedAtMs).toISOString();
  }

  if (!Number.isFinite(updatedAtMs)) {
    return null;
  }

  return new Date(updatedAtMs).toISOString();
}

function buildManagedStorageStatePath(platform: string, accountKey: string) {
  return toPortablePath(
    path.join('browser-sessions', 'managed', sanitizePlatformKey(platform), `${sanitizeAccountKey(accountKey)}.json`),
  );
}

function readStorageStateModifiedAt(storageStatePath: string, requestedAt: string) {
  try {
    const absolutePath = resolveStorageStateAbsolutePath(storageStatePath);
    if (!absolutePath || !existsSync(absolutePath)) {
      return null;
    }

    const modifiedAtMs = statSync(absolutePath).mtime.getTime();
    const requestedAtMs = Date.parse(requestedAt);
    if (Number.isFinite(requestedAtMs) && modifiedAtMs < requestedAtMs) {
      return null;
    }

    return new Date(modifiedAtMs).toISOString();
  } catch {
    return null;
  }
}

function loadStorageState(storageStatePath: string) {
  try {
    const absolutePath = resolveStorageStateAbsolutePath(storageStatePath);
    if (!absolutePath || !existsSync(absolutePath)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
    return isValidStorageStatePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveStorageStateAbsolutePath(storageStatePath: string) {
  const normalizedPath = storageStatePath.trim();
  if (!normalizedPath) {
    return null;
  }

  for (const allowedRoot of getAllowedStorageStateRoots()) {
    const candidate = path.isAbsolute(normalizedPath)
      ? path.resolve(normalizedPath)
      : path.resolve(allowedRoot, normalizedPath);
    if (!isPathWithinRoot(candidate, allowedRoot)) {
      continue;
    }

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getAllowedStorageStateRoots() {
  const databasePath = getDatabasePath();
  const sessionRoot =
    databasePath === ':memory:' || databasePath.startsWith('file:')
      ? path.resolve(process.cwd(), 'data/browser-sessions')
      : path.join(path.dirname(databasePath), 'browser-sessions');

  return Array.from(
    new Set([
      path.resolve(process.cwd()),
      path.resolve(sessionRoot),
      path.resolve(path.dirname(sessionRoot)),
    ]),
  );
}

function isPathWithinRoot(candidatePath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function sanitizeAccountKey(accountKey: string) {
  const sanitized = accountKey.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function sanitizePlatformKey(platform: string) {
  const sanitized = platform.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function toPortablePath(value: string) {
  return value.split(path.sep).join('/');
}

function isValidStorageStatePayload(value: Record<string, unknown>) {
  return (
    isPlainObject(value) &&
    Array.isArray(value.cookies) &&
    value.cookies.every(isPlainObject) &&
    Array.isArray(value.origins) &&
    value.origins.every(isPlainObject)
  );
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
