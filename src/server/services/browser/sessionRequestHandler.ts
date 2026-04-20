import type { JobHandler } from '../../lib/jobs';
import { createChannelAccountStore, type ChannelAccountStore } from '../../store/channelAccounts';
import type { BrowserSessionAction } from './sessionStore';

export const channelAccountSessionRequestJobType = 'channel_account_session_request';

export interface ChannelAccountSessionRequestJobPayload {
  accountId?: unknown;
  platform?: unknown;
  accountKey?: unknown;
  action?: unknown;
}

export interface ChannelAccountSessionRequestJobHandlerDependencies {
  channelAccountStore?: Pick<ChannelAccountStore, 'getById'>;
}

export function createChannelAccountSessionRequestJobHandler(
  dependencies: ChannelAccountSessionRequestJobHandlerDependencies = {},
): JobHandler {
  const channelAccountStore = dependencies.channelAccountStore ?? createChannelAccountStore();

  return async (payload) => {
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

    const channelAccount = channelAccountStore.getById(accountId);
    if (!channelAccount) {
      throw new Error(`channel account ${accountId} not found for ${channelAccountSessionRequestJobType}`);
    }

    if (channelAccount.platform !== platform || channelAccount.accountKey !== accountKey) {
      throw new Error(`channel account ${accountId} payload mismatch for ${channelAccountSessionRequestJobType}`);
    }

    throw new Error(buildBrowserLaneUnavailableMessage(accountId, action));
  };
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

function buildBrowserLaneUnavailableMessage(
  accountId: number,
  action: BrowserSessionAction,
): string {
  return `browser_lane_unavailable: channel account ${accountId} ${action} requires manual completion via /api/channel-accounts/${accountId}/session`;
}
