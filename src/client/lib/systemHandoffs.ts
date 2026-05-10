import { apiRequest } from './api';
import { withProjectIdQuery } from './projectId';

export interface BrowserHandoffRecord {
  channelAccountId?: number;
  accountDisplayName?: string;
  ownership?: string;
  platform: string;
  draftId: string;
  handoffAttempt?: number;
  title: string | null;
  accountKey: string;
  status: string;
  readiness?: string;
  sessionAction?: string | null;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserHandoffsResponse {
  handoffs: BrowserHandoffRecord[];
  total: number;
}

export interface InboxReplyHandoffRecord {
  channelAccountId?: number;
  platform: string;
  itemId: string | number;
  handoffAttempt?: number | string | null;
  source: string;
  title: string | null;
  author: string | null;
  accountKey: string;
  status: string;
  readiness?: string;
  sessionAction?: string | null;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface InboxReplyHandoffsResponse {
  handoffs: InboxReplyHandoffRecord[];
  total: number;
}

export interface BrowserHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  draftId: number;
  draftStatus: string;
  platform: string;
  mode: string;
  status: string;
  publishStatus?: string;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
}

export interface InboxReplyHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  itemId: number;
  itemStatus: string;
  platform: string;
  mode: string;
  status: string;
  replyStatus?: string;
  success: boolean;
  deliveryUrl: string | null;
  externalId: string | null;
  message: string;
  deliveredAt: string | null;
}

export async function loadBrowserHandoffsRequest(limit = 20, projectId?: number): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(withProjectIdQuery(`/api/system/browser-handoffs?limit=${limit}`, projectId));
}

export async function loadInboxReplyHandoffsRequest(limit = 20, projectId?: number): Promise<InboxReplyHandoffsResponse> {
  return apiRequest<InboxReplyHandoffsResponse>(
    withProjectIdQuery(`/api/system/inbox-reply-handoffs?limit=${limit}`, projectId),
  );
}

export async function completeBrowserHandoffRequest(input: {
  artifactPath: string;
  handoffAttempt?: number;
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
}): Promise<BrowserHandoffCompletionResponse> {
  return apiRequest<BrowserHandoffCompletionResponse>('/api/system/browser-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      ...(input.handoffAttempt !== undefined ? { handoffAttempt: input.handoffAttempt } : {}),
      publishStatus: input.publishStatus,
      message:
        input.message ??
        (input.publishStatus === 'published'
          ? 'browser handoff marked published'
          : 'browser handoff marked failed'),
      ...(input.publishUrl !== undefined && input.publishUrl.trim().length > 0
        ? { publishUrl: input.publishUrl.trim() }
        : {}),
    }),
  });
}

export async function completeInboxReplyHandoffRequest(input: {
  artifactPath: string;
  handoffAttempt?: number;
  replyStatus: 'sent' | 'failed';
  message?: string;
  deliveryUrl?: string;
}): Promise<InboxReplyHandoffCompletionResponse> {
  return apiRequest<InboxReplyHandoffCompletionResponse>('/api/system/inbox-reply-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      ...(input.handoffAttempt !== undefined ? { handoffAttempt: input.handoffAttempt } : {}),
      replyStatus: input.replyStatus,
      message:
        input.message ??
        (input.replyStatus === 'sent'
          ? 'inbox reply handoff marked sent'
          : 'inbox reply handoff marked failed'),
      ...(input.deliveryUrl !== undefined && input.deliveryUrl.trim().length > 0
        ? { deliveryUrl: input.deliveryUrl.trim() }
        : {}),
    }),
  });
}
