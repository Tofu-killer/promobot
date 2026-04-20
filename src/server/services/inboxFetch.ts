import type { InboxItemRecord } from '../store/inbox';
import { createInboxStore } from '../store/inbox';
import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';
import { collectRedditInboxSignals } from './inbox/fetchers/reddit';
import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './inbox/fetchers/types';
import { collectV2exInboxSignals } from './inbox/fetchers/v2ex';

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
  const context: InboxFetcherContext = {
    monitorItems,
    settings,
  };

  const collectedSignals = [
    ...collectRedditInboxSignals(context),
    ...collectV2exInboxSignals(context),
    ...collectUnhandledMonitorSignals(monitorItems),
  ];

  if (collectedSignals.length > 0) {
    return collectedSignals;
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

function collectUnhandledMonitorSignals(monitorItems: MonitorItemRecord[]): InboxSignal[] {
  return monitorItems
    .filter((item) => item.source !== 'rss' && item.source !== 'reddit' && item.source !== 'v2ex')
    .map((item) => createInboxSignalFromMonitorItem(item));
}
