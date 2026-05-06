import type { BrowserSessionAction } from './channelAccountSession';
import type { BrowserHandoffRecord } from './systemHandoffs';

export interface BrowserHandoffContract {
  platform: string | null;
  accountKey: string | null;
  channelAccountId?: number;
  handoffAttempt?: number;
  readiness: string | null;
  sessionAction: BrowserSessionAction | null;
  artifactPath: string | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readBrowserSessionAction(value: unknown): BrowserSessionAction | null {
  const normalizedValue = readString(value);
  return normalizedValue === 'request_session' || normalizedValue === 'relogin' ? normalizedValue : null;
}

export function readBrowserHandoffContract(details: Record<string, unknown> | null): BrowserHandoffContract | null {
  const browserHandoff = asRecord(details?.browserHandoff);
  if (!browserHandoff) {
    return null;
  }

  const artifact = browserHandoff.artifact;
  const artifactRecord = asRecord(artifact);
  const sessionActionRecord = asRecord(browserHandoff.sessionAction);
  const sessionAction =
    readBrowserSessionAction(browserHandoff.sessionAction) ??
    readBrowserSessionAction(sessionActionRecord?.action) ??
    readBrowserSessionAction(sessionActionRecord?.type);
  const artifactPath =
    readString(browserHandoff.artifactPath) ??
    readString(artifact) ??
    readString(artifactRecord?.artifactPath) ??
    readString(artifactRecord?.path) ??
    readString(artifactRecord?.relativePath) ??
    readString(sessionActionRecord?.artifactPath) ??
    readString(sessionActionRecord?.path);
  const platform = readString(browserHandoff.platform);
  const accountKey = readString(browserHandoff.accountKey);
  const channelAccountId = readPositiveInteger(browserHandoff.channelAccountId);
  const handoffAttempt = readPositiveInteger(browserHandoff.handoffAttempt);
  const readiness = readString(browserHandoff.readiness);

  if (!platform && !accountKey && !channelAccountId && !handoffAttempt && !readiness && !sessionAction && !artifactPath) {
    return null;
  }

  return {
    platform,
    accountKey,
    channelAccountId,
    handoffAttempt,
    readiness,
    sessionAction,
    artifactPath,
  };
}

export function findPendingBrowserHandoff(handoffs: BrowserHandoffRecord[], draftId: number) {
  return handoffs.find((handoff) => handoff.status === 'pending' && readBrowserHandoffDraftId(handoff) === draftId) ?? null;
}

export function isReadyBrowserHandoff(handoff: BrowserHandoffRecord) {
  return handoff.status === 'pending' && (handoff.readiness ?? 'ready') === 'ready';
}

export function getBrowserHandoffBlockedMessage(handoff: BrowserHandoffRecord) {
  return handoff.sessionAction === 'relogin'
    ? '等待刷新 Session 后继续发布接管。'
    : '等待补充 Session 后继续发布接管。';
}

export function toBrowserHandoffContract(handoff: BrowserHandoffRecord): BrowserHandoffContract {
  return {
    platform: handoff.platform,
    accountKey: handoff.accountKey,
    channelAccountId: handoff.channelAccountId,
    handoffAttempt: handoff.handoffAttempt,
    readiness: handoff.readiness ?? 'ready',
    sessionAction: readBrowserSessionAction(handoff.sessionAction),
    artifactPath: handoff.artifactPath,
  };
}

export function readSessionActionArtifactPath(result: { sessionAction?: unknown } | undefined) {
  const sessionAction = asRecord(result?.sessionAction);

  return readString(sessionAction?.artifactPath) ?? readString(sessionAction?.path);
}

export function getBrowserHandoffIdentity(handoff: BrowserHandoffContract | null) {
  if (!handoff) {
    return null;
  }

  if (handoff.artifactPath) {
    return `${handoff.artifactPath}#${handoff.handoffAttempt ?? 0}`;
  }

  return [
    handoff.platform ?? '',
    handoff.accountKey ?? '',
    String(handoff.channelAccountId ?? ''),
    handoff.sessionAction ?? '',
    String(handoff.handoffAttempt ?? ''),
  ].join('|');
}

export function formatSessionActionLabel(action: BrowserSessionAction) {
  return action === 'relogin' ? '重新登录' : '请求登录';
}

export function formatSessionActionPendingLabel(action: BrowserSessionAction) {
  return action === 'relogin' ? '正在提交重新登录...' : '正在提交登录请求...';
}

function readBrowserHandoffDraftId(handoff: BrowserHandoffRecord) {
  return typeof handoff.draftId === 'number'
    ? readPositiveInteger(handoff.draftId)
    : readPositiveInteger(Number(handoff.draftId));
}
