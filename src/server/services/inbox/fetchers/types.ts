import type { MonitorItemRecord } from '../../../store/monitor';

export interface InboxSignal {
  projectId?: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
}

export interface InboxFetcherSettings {
  monitorXQueries?: string[];
  monitorRedditQueries?: string[];
  monitorV2exQueries?: string[];
}

export interface InboxFetcherContext {
  monitorItems: MonitorItemRecord[];
  settings: InboxFetcherSettings;
}

export function createInboxSignalFromMonitorItem(item: MonitorItemRecord): InboxSignal {
  return {
    ...(item.projectId !== undefined ? { projectId: item.projectId } : {}),
    source: item.source,
    status: selectInboxStatus(item.source),
    ...(extractAuthor(item.detail) ? { author: extractAuthor(item.detail) } : {}),
    title: item.title,
    excerpt: item.detail,
  };
}

export function selectInboxStatus(source: string) {
  return source === 'reddit' || source === 'v2ex' || source === 'facebook-group'
    ? 'needs_reply'
    : 'needs_review';
}

function extractAuthor(detail: string) {
  const firstLine = detail.split('\n')[0]?.trim();
  if (!firstLine) {
    return undefined;
  }

  const segments = firstLine
    .split('·')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.length >= 2 ? segments[1] : undefined;
}
