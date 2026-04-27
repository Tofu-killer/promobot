import {
  buildBrowserSessionResolution,
  createSessionStore,
} from '../browser/sessionStore.js';
import { createChannelAccountStore } from '../../store/channelAccounts.js';
import { createStubPublisher } from './stub.js';
import { markBrowserHandoffArtifactsObsoleteForAccount, writeBrowserHandoffArtifact } from './browserHandoffArtifacts.js';
import type { PublishRequest, PublishResult, Publisher, PublisherPlatform } from './types.js';

type BrowserHandoffPlatform = Extract<
  PublisherPlatform,
  'facebookGroup' | 'instagram' | 'tiktok' | 'xiaohongshu' | 'weibo'
>;

export function createBrowserHandoffPublisher(
  platform: BrowserHandoffPlatform,
): Publisher {
  const channelAccountStore = createChannelAccountStore();
  const fallbackPublisher = createStubPublisher({
    platform,
    mode: 'browser',
    status: 'manual_required',
  });

  return async (request: PublishRequest): Promise<PublishResult> => {
    const accountKey = resolveAccountKey(request.metadata);

    if (!accountKey) {
      return fallbackPublisher(request);
    }

    const resolution = buildBrowserSessionResolution(
      createSessionStore().getSession(platform, accountKey),
    );
    const draftId = String(request.draftId);
    const channelAccountId = resolveChannelAccountId(
      channelAccountStore.list(),
      platform,
      accountKey,
      request.metadata,
    );
    if (resolution.sessionAction) {
      markBrowserHandoffArtifactsObsoleteForAccount({
        platform,
        accountKey,
        reason: resolution.sessionAction,
      });
    }
    const readyArtifact =
      resolution.sessionAction === null
        ? writeBrowserHandoffArtifact({
            channelAccountId,
            platform,
            accountKey,
            request,
            session: resolution.session,
          })
        : null;

    return {
      platform,
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: buildMessage(platform, draftId, resolution.sessionAction),
      publishedAt: null,
      details: {
        ...(request.target ? { target: request.target } : {}),
        accountKey,
        browserHandoff: {
          ...(typeof channelAccountId === 'number' ? { channelAccountId } : {}),
          readiness: resolution.sessionAction ? 'blocked' : 'ready',
          session: resolution.session,
          sessionAction: resolution.sessionAction,
          ...(readyArtifact ? { artifactPath: readyArtifact.artifactPath } : {}),
        },
      },
    };
  };
}

function resolveAccountKey(metadata: PublishRequest['metadata']): string | null {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const candidate =
    readString(metadata.accountKey) ??
    readNestedString(metadata, ['channelAccount', 'accountKey']) ??
    readNestedString(metadata, ['browserSession', 'accountKey']);

  if (!candidate) {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveChannelAccountId(
  channelAccounts: Array<{ id: number; projectId: number | null; platform: string; accountKey: string }>,
  platform: BrowserHandoffPlatform,
  accountKey: string,
  metadata: PublishRequest['metadata'],
) {
  const projectId = readProjectId(metadata);
  const matches = channelAccounts.filter(
    (channelAccount) =>
      normalizeChannelAccountPlatform(channelAccount.platform) === platform &&
      channelAccount.accountKey === accountKey &&
      (projectId === undefined ? true : channelAccount.projectId === projectId),
  );

  if (matches.length === 1) {
    return matches[0]?.id;
  }

  if (projectId === undefined) {
    const globalMatches = channelAccounts.filter(
      (channelAccount) =>
        normalizeChannelAccountPlatform(channelAccount.platform) === platform &&
        channelAccount.accountKey === accountKey,
    );
    return globalMatches.length === 1 ? globalMatches[0]?.id : undefined;
  }

  return undefined;
}

function readProjectId(metadata: PublishRequest['metadata']) {
  if (!isPlainObject(metadata)) {
    return undefined;
  }

  const candidate = metadata.projectId;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0
    ? candidate
    : undefined;
}

function normalizeChannelAccountPlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function buildMessage(
  platform: BrowserHandoffPlatform,
  draftId: string,
  sessionAction: 'request_session' | 'relogin' | null,
) {
  if (sessionAction === 'request_session') {
    return `${platform} draft ${draftId} requires a saved browser session before manual handoff.`;
  }

  if (sessionAction === 'relogin') {
    return `${platform} draft ${draftId} requires the browser session to be refreshed before manual handoff.`;
  }

  return `${platform} draft ${draftId} is ready for manual browser handoff with the saved session.`;
}

function readNestedString(
  value: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = value;

  for (const segment of path) {
    if (!isPlainObject(current)) {
      return null;
    }

    current = current[segment];
  }

  return readString(current);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
