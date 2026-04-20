import type { InboxItemRecord } from '../store/inbox';
import { createInboxStore } from '../store/inbox';
import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';

export interface InboxFetchResult {
  items: InboxItemRecord[];
  inserted: number;
}

export function createInboxFetchService() {
  const inboxStore = createInboxStore();
  const monitorStore = createMonitorStore();
  const settingsStore = createSettingsStore();

  return {
    fetchNow(): InboxFetchResult {
      const signals = collectInboxSignals(monitorStore.list(), settingsStore.get());
      const items = signals.map((signal) => inboxStore.create(signal));

      return {
        items,
        inserted: items.length,
      };
    },
  };
}

function collectInboxSignals(
  monitorItems: MonitorItemRecord[],
  settings: {
    monitorRedditQueries?: string[];
    monitorV2exQueries?: string[];
  },
) {
  const monitorSignals = monitorItems
    .filter((item) => item.source !== 'rss')
    .map((item) => ({
      source: item.source,
      status: selectInboxStatus(item.source),
      ...(extractAuthor(item.detail) ? { author: extractAuthor(item.detail) } : {}),
      title: item.title,
      excerpt: item.detail,
    }));

  if (monitorSignals.length > 0) {
    return monitorSignals;
  }

  const configuredSignals = [
    ...(settings.monitorRedditQueries ?? []).map((query) => ({
      source: 'reddit',
      status: 'needs_reply',
      title: `Inbox follow-up for ${query}`,
      excerpt: 'Configured from monitorRedditQueries before live fetch results arrive.',
    })),
    ...(settings.monitorV2exQueries ?? []).map((query) => ({
      source: 'v2ex',
      status: 'needs_reply',
      title: `Inbox follow-up for ${query}`,
      excerpt: 'Configured from monitorV2exQueries before live fetch results arrive.',
    })),
  ];

  if (configuredSignals.length > 0) {
    return configuredSignals;
  }

  return [
    {
      source: 'reddit',
      status: 'needs_reply',
      author: 'apac-builder',
      title: 'Need OpenRouter alternative for AU users',
      excerpt: 'Looking for lower-latency multi-model routing with predictable pricing in Australia.',
    },
    {
      source: 'x',
      status: 'needs_review',
      author: 'latency_hunter',
      title: 'Any cheap Claude-compatible gateway?',
      excerpt: 'Asking for model routing plus retry behaviour without paying OpenRouter pricing.',
    },
  ];
}

function selectInboxStatus(source: string) {
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
