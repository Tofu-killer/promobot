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

const channelAccountStore = createChannelAccountStore();
const jobQueueStore = createJobQueueStore();
const channelAccountSessionRequestJobType = 'channel_account_session_request';

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
    typeof accountKey !== 'string' ||
    typeof displayName !== 'string' ||
    typeof authType !== 'string' ||
    typeof status !== 'string'
  ) {
    response.status(400).json({ error: 'invalid channel account payload' });
    return;
  }

  const channelAccount = channelAccountStore.create({
    projectId: parseOptionalProjectId(projectId),
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
      nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
      jobId: job.id,
      jobStatus: job.status,
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
  if (
    typeof input.storageStatePath !== 'string' ||
    (input.status !== undefined && !isSessionStatus(input.status)) ||
    (input.validatedAt !== undefined &&
      input.validatedAt !== null &&
      typeof input.validatedAt !== 'string') ||
    (input.notes !== undefined && typeof input.notes !== 'string')
  ) {
    response.status(400).json({ error: 'invalid channel account session payload' });
    return;
  }

  const sessionStore = createSessionStore();
  const sessionMetadata = sessionStore.saveSession({
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
    storageStatePath: input.storageStatePath,
    status: input.status ?? 'active',
    notes: input.notes,
    lastValidatedAt:
      input.validatedAt !== undefined ? (input.validatedAt as string | null) : undefined,
  });
  const session = buildSessionSummary(sessionMetadata);
  const updatedChannelAccount = channelAccountStore.update(id, {
    metadata: {
      ...channelAccount.metadata,
      session,
    },
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

  const input = request.body ?? {};
  const channelAccount = channelAccountStore.update(id, {
    projectId: parseOptionalProjectId(input.projectId),
    platform: typeof input.platform === 'string' ? input.platform : undefined,
    accountKey: typeof input.accountKey === 'string' ? input.accountKey : undefined,
    displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
    authType: typeof input.authType === 'string' ? input.authType : undefined,
    status: typeof input.status === 'string' ? input.status : undefined,
    metadata: isPlainObject(input.metadata) ? input.metadata : undefined,
  });

  if (!channelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  response.json({ channelAccount: attachSessionSummary(channelAccount, createSessionStore()) });
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

function parseOptionalProjectId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
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

  return {
    ...channelAccount,
    session: liveSession ? buildSessionSummary(liveSession) : metadataSession,
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
