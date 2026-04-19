import { apiRequest } from './api';

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

export async function loadInboxRequest(): Promise<InboxResponse> {
  return apiRequest<InboxResponse>('/api/inbox');
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

export async function loadMonitorFeedRequest(): Promise<MonitorFeedResponse> {
  return apiRequest<MonitorFeedResponse>('/api/monitor/feed');
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

export async function loadReputationRequest(): Promise<ReputationStatsResponse> {
  return apiRequest<ReputationStatsResponse>('/api/reputation/stats');
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
