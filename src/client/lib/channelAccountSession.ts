export type BrowserSessionAction = 'request_session' | 'relogin';

export interface SessionActionArtifactSummaryLike {
  action: BrowserSessionAction;
  jobStatus: string;
  requestedAt: string;
  artifactPath: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface SessionActionAccountLike {
  authType: string;
  metadata?: Record<string, unknown> | null;
  session?: {
    hasSession?: boolean;
  } | null;
  latestBrowserLaneArtifact?: SessionActionArtifactSummaryLike;
  activeSessionActionArtifacts?: Partial<Record<BrowserSessionAction, SessionActionArtifactSummaryLike>>;
  readiness?: Record<string, unknown>;
  publishReadiness?: Record<string, unknown>;
}

export interface SessionActionFeedbackLike {
  action: BrowserSessionAction;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeReadinessRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

export function resolvePublishReadiness(account: SessionActionAccountLike): Record<string, unknown> | undefined {
  const metadata = isPlainObject(account.metadata) ? account.metadata : {};

  return (
    normalizeReadinessRecord(account.publishReadiness) ??
    normalizeReadinessRecord(account.readiness) ??
    normalizeReadinessRecord(metadata.publishReadiness) ??
    normalizeReadinessRecord(metadata.readiness)
  );
}

export function supportsBrowserSessionMetadata(account: SessionActionAccountLike) {
  const readinessMode = resolvePublishReadiness(account)?.mode;
  if (readinessMode === 'browser') {
    return true;
  }
  if (readinessMode === 'api' || readinessMode === 'oauth') {
    return false;
  }
  return account.authType === 'browser';
}

export function getSupportedSessionAction(account: SessionActionAccountLike): BrowserSessionAction | null {
  if (!supportsBrowserSessionMetadata(account)) {
    return null;
  }

  return account.session?.hasSession === true ? 'relogin' : 'request_session';
}

export function getRequestedSessionAction(account: SessionActionAccountLike): BrowserSessionAction | null {
  const readiness = resolvePublishReadiness(account);
  return readiness?.action === 'request_session' || readiness?.action === 'relogin' ? readiness.action : null;
}

export function getSessionActionArtifactForAction(
  account: SessionActionAccountLike,
  action: BrowserSessionAction,
): SessionActionArtifactSummaryLike | undefined {
  return (
    account.activeSessionActionArtifacts?.[action] ??
    (account.latestBrowserLaneArtifact?.action === action ? account.latestBrowserLaneArtifact : undefined)
  );
}

export function getUnresolvedRequestedSessionArtifact(
  account: SessionActionAccountLike,
): SessionActionArtifactSummaryLike | undefined {
  const requestedAction = getRequestedSessionAction(account);
  if (!requestedAction) {
    return undefined;
  }

  const artifact = getSessionActionArtifactForAction(account, requestedAction);
  return artifact?.resolvedAt === null ? artifact : undefined;
}

export function resolveCurrentSessionAction(
  localFeedback: SessionActionFeedbackLike | null | undefined,
  account: SessionActionAccountLike | null | undefined,
): BrowserSessionAction | null {
  if (localFeedback?.action) {
    return localFeedback.action;
  }
  if (!account) {
    return null;
  }

  const requestedArtifact = getUnresolvedRequestedSessionArtifact(account);
  if (requestedArtifact) {
    return requestedArtifact.action;
  }

  if (account.latestBrowserLaneArtifact?.resolvedAt === null) {
    return account.latestBrowserLaneArtifact.action;
  }

  return getRequestedSessionAction(account);
}
