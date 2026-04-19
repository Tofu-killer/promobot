import { Router } from 'express';
import { createChannelAccountStore } from '../store/channelAccounts';
import { getChannelAccountPublishReadiness } from '../services/platformReadiness';
import {
  buildSessionSummary,
  createSessionStore,
  type BrowserSessionAction,
  type SessionStatus,
  type SessionSummary,
} from '../services/browser/sessionStore';

const channelAccountStore = createChannelAccountStore();

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

  response.json({
    ok: true,
    sessionAction: {
      action,
      accountId: channelAccount.id,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      message:
        action === 'relogin'
          ? 'Browser relogin is not wired yet. Refresh the login manually and attach updated session metadata.'
          : 'Browser session capture is not wired yet. Complete login manually and attach session metadata.',
      nextStep: `/api/channel-accounts/${channelAccount.id}/session`,
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
  const test = buildChannelAccountTestResult(channelAccount);

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

function buildChannelAccountTestResult(account: {
  id: number;
  platform: string;
  authType: string;
  publishReadiness?: {
    ready: boolean;
    mode: 'api' | 'browser' | 'manual';
    status: 'ready' | 'needs_config' | 'needs_session' | 'needs_relogin';
    message: string;
    action?: BrowserSessionAction | 'configure_credentials';
    details?: Record<string, unknown>;
  };
}): {
  checkedAt: string;
  status: string;
  summary: string;
  message: string;
  action?: BrowserSessionAction | 'configure_credentials';
  nextStep?: string;
  details: Record<string, unknown>;
} {
  const readiness =
    account.publishReadiness ??
    getChannelAccountPublishReadiness({
      platform: account.platform,
      accountKey: '',
      authType: account.authType,
    });

  return {
    checkedAt: new Date().toISOString(),
    status: readiness.status,
    summary: formatReadinessSummary(readiness.status),
    message: formatTestMessage({
      platform: account.platform,
      authType: account.authType,
      readiness,
    }),
    ...(readiness.action ? { action: readiness.action } : {}),
    ...(buildTestNextStep(account.id, readiness.action)
      ? { nextStep: buildTestNextStep(account.id, readiness.action) }
      : {}),
    details: {
      ready: readiness.ready,
      mode: readiness.mode,
      authType: account.authType,
      ...(readiness.details ?? {}),
    },
  };
}

function formatReadinessSummary(
  status: 'ready' | 'needs_config' | 'needs_session' | 'needs_relogin',
): string {
  if (status === 'ready') {
    return '可用';
  }

  if (status === 'needs_relogin') {
    return '需要重新登录';
  }

  if (status === 'needs_session') {
    return '缺少会话';
  }

  return '缺少配置';
}

function formatTestMessage(input: {
  platform: string;
  authType: string;
  readiness: {
    status: 'ready' | 'needs_config' | 'needs_session' | 'needs_relogin';
    mode: 'api' | 'browser' | 'manual';
    message: string;
  };
}): string {
  const platformLabel = getPlatformLabel(input.platform);

  if (input.readiness.mode === 'api') {
    if (input.readiness.status === 'ready') {
      return `${platformLabel} API 账号已检测到可用凭证。`;
    }

    if (input.platform === 'x') {
      return 'X API 账号缺少可用凭证，请配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。';
    }

    if (input.platform === 'reddit') {
      return 'Reddit API 账号缺少完整 OAuth 凭证，请配置 client id/secret 和 username/password。';
    }
  }

  if (input.readiness.mode === 'browser') {
    if (input.readiness.status === 'ready') {
      return `${platformLabel} 浏览器 session 可用，可以继续发布流程。`;
    }

    if (input.readiness.status === 'needs_relogin') {
      return `${platformLabel} 浏览器 session 已过期，需要重新登录并重新保存 session 元数据。`;
    }

    if (input.readiness.status === 'needs_session') {
      return `${platformLabel} 浏览器 session 缺失，请先登录并保存 session 元数据。`;
    }
  }

  return input.readiness.message;
}

function buildTestNextStep(
  accountId: number,
  action: BrowserSessionAction | 'configure_credentials' | undefined,
): string | undefined {
  if (!action) {
    return undefined;
  }

  if (action === 'configure_credentials') {
    return `/api/channel-accounts/${accountId}`;
  }

  return `/api/channel-accounts/${accountId}/session`;
}

function getPlatformLabel(platform: string): string {
  if (platform === 'x') {
    return 'X';
  }

  if (platform === 'facebookGroup' || platform === 'facebook-group') {
    return 'Facebook Group';
  }

  if (platform === 'reddit') {
    return 'Reddit';
  }

  return platform;
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
