import { apiRequest } from './api';
import { createProjectIdBody, withProjectIdQuery } from './projectId';

export interface InboxItem {
  id: string | number;
  source: string;
  status: string;
  author?: string;
  title?: string;
  excerpt?: string;
  createdAt?: string;
}

export interface InboxResponse {
  items: InboxItem[];
  total: number;
  unread: number;
  [key: string]: unknown;
}

export async function loadInboxRequest<TResponse = InboxResponse>(projectId?: number): Promise<TResponse> {
  return apiRequest<TResponse>(withProjectIdQuery('/api/inbox', projectId));
}

export interface MonitorFeedItem {
  id: string | number;
  source: string;
  title: string;
  detail: string;
  status?: string;
  createdAt?: string;
}

export interface MonitorFeedResponse {
  items: MonitorFeedItem[];
  total: number;
  [key: string]: unknown;
}

export async function loadMonitorFeedRequest<TResponse = MonitorFeedResponse>(projectId?: number): Promise<TResponse> {
  return apiRequest<TResponse>(withProjectIdQuery('/api/monitor/feed', projectId));
}

export interface ReputationTrendBar {
  label: string;
  value: number;
  color?: string;
}

export interface ReputationItem {
  id: string | number;
  source: string;
  sentiment: string;
  status: string;
  title?: string;
  detail?: string;
  createdAt?: string;
}

export interface ReputationStatsResponse {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  trend: ReputationTrendBar[];
  items?: ReputationItem[];
  [key: string]: unknown;
}

export async function loadReputationRequest<TResponse = ReputationStatsResponse>(projectId?: number): Promise<TResponse> {
  return apiRequest<TResponse>(withProjectIdQuery('/api/reputation/stats', projectId));
}

function createScopedFetchRequestInit(projectId?: number) {
  return {
    method: 'POST' as const,
    ...(projectId === undefined
      ? {}
      : {
          headers: {
            'Content-Type': 'application/json',
          },
          body: createProjectIdBody(projectId),
        }),
  };
}

export async function fetchInboxRequest<TResponse = InboxResponse>(projectId?: number): Promise<TResponse> {
  return apiRequest<TResponse>('/api/inbox/fetch', createScopedFetchRequestInit(projectId));
}

export async function fetchMonitorFeedRequest<TResponse = MonitorFeedResponse>(projectId?: number): Promise<TResponse> {
  return apiRequest<TResponse>('/api/monitor/fetch', createScopedFetchRequestInit(projectId));
}

export async function fetchReputationRequest<TResponse = ReputationStatsResponse>(projectId?: number): Promise<TResponse> {
  return apiRequest<TResponse>('/api/reputation/fetch', createScopedFetchRequestInit(projectId));
}

export function toBadgeTone(status: string): 'draft' | 'review' | 'approved' {
  const normalized = status.trim().toLowerCase();

  if (
    normalized === 'approved' ||
    normalized === 'handled' ||
    normalized === 'done' ||
    normalized === 'resolved' ||
    normalized === 'published' ||
    normalized === 'success' ||
    normalized === 'positive'
  ) {
    return 'approved';
  }

  if (
    normalized === 'review' ||
    normalized === 'needs_reply' ||
    normalized === 'new' ||
    normalized === 'escalate' ||
    normalized === 'follow_up' ||
    normalized === 'negative' ||
    normalized === 'pending'
  ) {
    return 'review';
  }

  return 'draft';
}
