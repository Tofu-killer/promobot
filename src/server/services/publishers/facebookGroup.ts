import {
  buildBrowserSessionResolution,
  createSessionStore,
} from '../browser/sessionStore.js';
import { createStubPublisher } from './stub.js';
import type { PublishRequest, PublishResult, Publisher } from './types.js';

const fallbackPublisher = createStubPublisher({
  platform: 'facebookGroup',
  mode: 'browser',
  status: 'manual_required',
});

export const publishToFacebookGroup: Publisher = async (
  request: PublishRequest,
): Promise<PublishResult> => {
  const accountKey = resolveAccountKey(request.metadata);

  if (!accountKey) {
    return fallbackPublisher(request);
  }

  const sessionStore = createSessionStore();
  const resolution = buildBrowserSessionResolution(
    sessionStore.getSession('facebookGroup', accountKey),
  );
  const draftId = String(request.draftId);

  return {
    platform: 'facebookGroup',
    mode: 'browser',
    status: 'manual_required',
    success: false,
    publishUrl: null,
    externalId: null,
    message: buildMessage(draftId, resolution.sessionAction),
    publishedAt: null,
    details: {
      ...(request.target ? { target: request.target } : {}),
      accountKey,
      browserHandoff: {
        readiness: resolution.sessionAction ? 'blocked' : 'ready',
        session: resolution.session,
        sessionAction: resolution.sessionAction,
      },
    },
  };
};

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

function buildMessage(draftId: string, sessionAction: 'request_session' | 'relogin' | null) {
  if (sessionAction === 'request_session') {
    return `facebookGroup draft ${draftId} requires a saved browser session before manual handoff.`;
  }

  if (sessionAction === 'relogin') {
    return `facebookGroup draft ${draftId} requires the browser session to be refreshed before manual handoff.`;
  }

  return `facebookGroup draft ${draftId} is ready for manual browser handoff with the saved session.`;
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
