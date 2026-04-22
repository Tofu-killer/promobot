import { Router } from 'express';
import { createChannelAccountStore } from '../store/channelAccounts.js';
import { createJobQueueStore } from '../store/jobQueue.js';
import {
  evaluateChannelAccountConnection,
  getChannelAccountPublishReadiness,
} from '../services/platformReadiness.js';
import {
  buildSessionSummary,
  createSessionStore,
  type BrowserSessionAction,
  type SessionStatus,
  type SessionSummary,
} from '../services/browser/sessionStore.js';
import {
  createSessionRequestArtifact,
  getLatestSessionRequestArtifact,
  resolveSessionRequestArtifacts,
} from '../services/browser/sessionRequestArtifacts.js';
import { getLatestBrowserHandoffArtifact } from '../services/publishers/browserHandoffArtifacts.js';

const channelAccountStore = createChannelAccountStore();
const jobQueueStore = createJobQueueStore();
const channelAccountSessionRequestJobType = 'channel_account_session_request';
const supportedChannelAccountPlatforms = new Set([
  'x',
  'reddit',
  'facebookGroup',
  'facebook-group',
  'xiaohongshu',
  'weibo',
  'blog',
]);

export const channelAccountsRouter = Router();

channelAccountsRouter.get('/', (_request, response) => {
  const sessionStore = createSessionStore();
  response.json({
    channelAccounts: channelAccountStore
      .list()
      .map((channelAccount) => attachSessionSummary(channelAccount, sessionStore)),
  });
});

channelAccountsRouter.post('/', (request, response) => {
  const {
    projectId,
    platform,
    accountKey,
    displayName,
    authType,
    status,
    metadata,
  } = request.body ?? {};

  if (
    typeof platform !== 'string' ||
    !supportedChannelAccountPlatforms.has(platform) ||
    typeof accountKey !== 'string' ||
    typeof displayName !== 'string' ||
    typeof authType !== 'string' ||
    typeof status !== 'string'
  ) {
    response.status(400).json({ error: 'invalid channel account payload' });
    return;
  }

  const parsedProjectId = parseProjectIdInput(projectId, { allowNull: true });
  if (!parsedProjectId.ok) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const channelAccount = channelAccountStore.create({
    projectId: parsedProjectId.value,
    platform,
    accountKey,
    displayName,
    authType,
    status,
    metadata: isPlainObject(metadata) ? metadata : undefined,
  });

  response.status(201).json({ channelAccount });
});

channelAccountsRouter.post('/:id/session/request', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid channel account id' });
    return;
  }

  const channelAccount = channelAccountStore.getById(id);
  if (!channelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  const input = request.body ?? {};
  if (
    input.action !== undefined &&
    input.action !== 'request_session' &&
    input.action !== 'relogin'
  ) {
    response.status(400).json({ error: 'invalid session action payload' });
    return;
  }

  const action = (input.action as BrowserSessionAction | undefined) ?? 'request_session';
  const payload = {
    accountId: channelAccount.id,
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
    action,
  };
  const requestedAt = new Date().toISOString();
  const job = jobQueueStore.enqueue({
    type: channelAccountSessionRequestJobType,
    payload,
    runAt: requestedAt,
  });
  const nextStep = `/api/channel-accounts/${channelAccount.id}/session`;
  const artifactPath = createSessionRequestArtifact({
    channelAccountId: channelAccount.id,
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
    action,
    requestedAt: job.runAt,
    jobId: job.id,
    jobStatus: job.status,
    nextStep,
  });

  response.json({
    ok: true,
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      runAt: job.runAt,
      payload,
    },
    sessionAction: {
      action,
      accountId: channelAccount.id,
      status: job.status,
      requestedAt: job.runAt,
      message: getSessionRequestMessage(action),
      nextStep,
      jobId: job.id,
      jobStatus: job.status,
      artifactPath,
    },
    channelAccount: attachSessionSummary(channelAccount, createSessionStore()),
  });
});

channelAccountsRouter.post('/:id/session', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid channel account id' });
    return;
  }

  const channelAccount = channelAccountStore.getById(id);
  if (!channelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  const input = request.body ?? {};
  const hasStorageStatePath = typeof input.storageStatePath === 'string';
  const hasManagedStorageState = isPlainObject(input.storageState);
  if (
    (!hasStorageStatePath && !hasManagedStorageState) ||
    (hasStorageStatePath && hasManagedStorageState) ||
    (input.storageStatePath !== undefined && !hasStorageStatePath) ||
    (input.storageState !== undefined && !hasManagedStorageState) ||
    (input.status !== undefined && !isSessionStatus(input.status)) ||
    (input.validatedAt !== undefined &&
      input.validatedAt !== null &&
      typeof input.validatedAt !== 'string') ||
    (input.notes !== undefined && typeof input.notes !== 'string')
  ) {
    response.status(400).json({
      error:
        hasStorageStatePath && hasManagedStorageState
          ? 'provide either storageStatePath or storageState, not both'
          : 'invalid channel account session payload',
    });
    return;
  }

  const sessionStore = createSessionStore();
  let sessionMetadata;
  try {
    sessionMetadata = sessionStore.saveSession({
      platform: channelAccount.platform,
      accountKey: channelAccount.accountKey,
      storageStatePath: hasStorageStatePath ? input.storageStatePath : undefined,
      storageState: hasManagedStorageState ? input.storageState : undefined,
      status: input.status ?? 'active',
      notes: input.notes,
      lastValidatedAt:
        input.validatedAt !== undefined ? (input.validatedAt as string | null) : undefined,
    });
  } catch (error) {
    response.status(400).json({
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'invalid channel account session payload',
    });
    return;
  }
  const session = buildSessionSummary(sessionMetadata);
  const updatedChannelAccount = channelAccountStore.update(id, {
    metadata: {
      ...channelAccount.metadata,
      session,
    },
  });
  resolveSessionRequestArtifacts({
    channelAccountId: channelAccount.id,
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
    resolvedAt: sessionMetadata.updatedAt,
    resolvedJobStatus: 'resolved',
    resolution: {
      status: 'resolved',
      session,
    },
    savedStorageStatePath: sessionMetadata.storageStatePath,
  });

  response.json({
    ok: true,
    session,
    channelAccount: attachSessionSummary(updatedChannelAccount ?? channelAccount, sessionStore),
  });
});

channelAccountsRouter.patch('/:id', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid channel account id' });
    return;
  }

  const currentChannelAccount = channelAccountStore.getById(id);
  if (!currentChannelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  const input = request.body ?? {};
  if (
    input.platform !== undefined &&
    (typeof input.platform !== 'string' || !supportedChannelAccountPlatforms.has(input.platform))
  ) {
    response.status(400).json({ error: 'invalid channel account payload' });
    return;
  }

  const nextPlatform = typeof input.platform === 'string' ? input.platform : undefined;
  const nextAccountKey = typeof input.accountKey === 'string' ? input.accountKey : undefined;
  const metadataInput = isPlainObject(input.metadata) ? input.metadata : undefined;
  const parsedProjectId = parseProjectIdInput(input.projectId, { allowNull: true });
  if (!parsedProjectId.ok) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }
  const identityChanged =
    (nextPlatform !== undefined && nextPlatform !== currentChannelAccount.platform) ||
    (nextAccountKey !== undefined && nextAccountKey !== currentChannelAccount.accountKey);

  const channelAccount = channelAccountStore.update(id, {
    projectId: parsedProjectId.value,
    platform: nextPlatform,
    accountKey: nextAccountKey,
    displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
    authType: typeof input.authType === 'string' ? input.authType : undefined,
    status: typeof input.status === 'string' ? input.status : undefined,
    metadata: identityChanged
      ? omitMetadataSession(metadataInput ?? currentChannelAccount.metadata)
      : metadataInput,
  });

  response.json({
    channelAccount: attachSessionSummary(channelAccount ?? currentChannelAccount, createSessionStore()),
  });
});

channelAccountsRouter.post('/:id/test', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid channel account id' });
    return;
  }

  const input = request.body ?? {};
  if (
    input.status !== undefined &&
    input.status !== 'healthy' &&
    input.status !== 'failed'
  ) {
    response.status(400).json({ error: 'invalid channel account test payload' });
    return;
  }

  const testedChannelAccount = channelAccountStore.test(id, {
    status: input.status,
  });

  if (!testedChannelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  const channelAccount = attachSessionSummary(testedChannelAccount, createSessionStore());
  const test = {
    checkedAt: new Date().toISOString(),
    ...evaluateChannelAccountConnection({
      id: channelAccount.id,
      platform: channelAccount.platform,
      accountKey: channelAccount.accountKey,
      authType: channelAccount.authType,
    }),
  };

  response.json({
    ok: true,
    test,
    channelAccount,
  });
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionStatus(value: string): value is SessionStatus {
  return value === 'active' || value === 'expired' || value === 'missing';
}

function parseProjectIdInput(
  value: unknown,
  options: { allowNull?: boolean } = {},
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    return options.allowNull ? { ok: true, value: null } : { ok: false };
  }

  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? { ok: true, value }
    : { ok: false };
}

function omitMetadataSession(metadata: Record<string, unknown>) {
  const { session: _session, ...rest } = metadata;
  return rest;
}

function getSessionRequestMessage(action: BrowserSessionAction) {
  if (action === 'relogin') {
    return 'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.';
  }

  return 'Browser session request queued. Complete login manually and attach session metadata after the browser lane picks up the job.';
}

function attachSessionSummary<
  T extends {
    id: number;
    platform: string;
    accountKey: string;
    metadata: Record<string, unknown>;
  },
>(channelAccount: T, sessionStore = createSessionStore()): T & { session: SessionSummary } {
  const liveSession = sessionStore.getSession(channelAccount.platform, channelAccount.accountKey);
  const metadataSession = parseSessionSummary(channelAccount.metadata.session);
  const latestBrowserLaneArtifact = getLatestSessionRequestArtifact({
    channelAccountId: channelAccount.id,
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
  });
  const latestBrowserHandoffArtifact = getLatestBrowserHandoffArtifact({
    channelAccountId: channelAccount.id,
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
  });

  return {
    ...channelAccount,
    session: liveSession ? buildSessionSummary(liveSession) : metadataSession,
    latestBrowserLaneArtifact,
    latestBrowserHandoffArtifact,
    publishReadiness: getChannelAccountPublishReadiness({
      platform: channelAccount.platform,
      accountKey: channelAccount.accountKey,
      authType:
        typeof (channelAccount as { authType?: unknown }).authType === 'string'
          ? ((channelAccount as { authType?: string }).authType)
          : undefined,
    }),
  };
}

function parseSessionSummary(value: unknown): SessionSummary {
  if (!isPlainObject(value)) {
    return buildSessionSummary(null);
  }

  const status = typeof value.status === 'string' && isSessionStatus(value.status)
    ? value.status
    : 'missing';

  return {
    hasSession: value.hasSession === true,
    id: typeof value.id === 'string' ? value.id : undefined,
    status,
    validatedAt:
      typeof value.validatedAt === 'string' || value.validatedAt === null
        ? (value.validatedAt as string | null)
        : null,
    storageStatePath:
      typeof value.storageStatePath === 'string' || value.storageStatePath === null
        ? (value.storageStatePath as string | null)
        : null,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}
