import type { InboxItemRecord } from '../store/inbox';
import { createInboxStore } from '../store/inbox';
import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';
import { createSourceConfigStore, type SourceConfigRecord } from '../store/sourceConfigs';
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
  const sourceConfigStore = createSourceConfigStore();

  return {
    fetchNow(projectId?: number): InboxFetchResult {
      const monitorItems = monitorStore.list(projectId);
      const sourceConfigs = filterSourceConfigsByProject(
        sourceConfigStore.listEnabled(),
        projectId,
      );
      const settings = projectId === undefined ? settingsStore.get() : emptyInboxSettings();
      const signals = collectInboxSignals(
        monitorItems,
        settings,
        sourceConfigs,
      );
      const items = signals.map((signal) => inboxStore.create(signal));

      return {
        items,
        inserted: items.length,
      };
    },
  };
}

function filterSourceConfigsByProject(sourceConfigs: SourceConfigRecord[], projectId?: number) {
  if (projectId === undefined) {
    return sourceConfigs;
  }

  return sourceConfigs.filter((sourceConfig) => sourceConfig.projectId === projectId);
}

function collectInboxSignals(
  monitorItems: MonitorItemRecord[],
  settings: {
    monitorRedditQueries?: string[];
    monitorV2exQueries?: string[];
  },
  sourceConfigs: SourceConfigRecord[] = [],
) {
  const sourceConfigQueries = resolveInboxSourceConfigQueries(sourceConfigs);
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

  const sourceConfigSignals = [
    ...sourceConfigQueries.redditSignals.map((signal) => ({
      projectId: signal.projectId,
      source: 'reddit',
      status: 'needs_reply',
      title: `Inbox follow-up for ${signal.query}`,
      excerpt: `Derived from source config "${signal.label}" before live fetch results arrive.`,
    })),
    ...sourceConfigQueries.xSignals.map((signal) => ({
      projectId: signal.projectId,
      source: 'x',
      status: 'needs_review',
      title: `Inbox follow-up for ${signal.query}`,
      excerpt: `Derived from source config "${signal.label}" before live fetch results arrive.`,
    })),
    ...sourceConfigQueries.v2exSignals.map((signal) => ({
      projectId: signal.projectId,
      source: 'v2ex',
      status: 'needs_reply',
      title: `Inbox follow-up for ${signal.query}`,
      excerpt: `Derived from source config "${signal.label}" before live fetch results arrive.`,
    })),
  ];

  if (sourceConfigSignals.length > 0) {
    return sourceConfigSignals;
  }

  if (sourceConfigs.length > 0) {
    return [];
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

function emptyInboxSettings() {
  return {
    monitorRedditQueries: [],
    monitorV2exQueries: [],
  };
}

function collectUnhandledMonitorSignals(monitorItems: MonitorItemRecord[]): InboxSignal[] {
  return monitorItems
    .filter((item) => item.source !== 'rss' && item.source !== 'reddit' && item.source !== 'v2ex')
    .map((item) => createInboxSignalFromMonitorItem(item));
}

function resolveInboxSourceConfigQueries(sourceConfigs: SourceConfigRecord[]) {
  const redditSignals: Array<{ projectId: number; label: string; query: string }> = [];
  const xSignals: Array<{ projectId: number; label: string; query: string }> = [];
  const v2exSignals: Array<{ projectId: number; label: string; query: string }> = [];

  for (const sourceConfig of sourceConfigs) {
    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+reddit') &&
      sourceConfig.platform === 'reddit'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        redditSignals.push({
          projectId: sourceConfig.projectId,
          label: sourceConfig.label,
          query,
        });
      }
    }

    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+x') &&
      sourceConfig.platform === 'x'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        xSignals.push({
          projectId: sourceConfig.projectId,
          label: sourceConfig.label,
          query,
        });
      }
    }

    if (sourceConfig.sourceType === 'v2ex_search') {
      for (const query of readQueryList(sourceConfig.configJson)) {
        v2exSignals.push({
          projectId: sourceConfig.projectId,
          label: sourceConfig.label,
          query,
        });
      }
    }
  }

  return {
    redditSignals: dedupeLabeledSignals(redditSignals),
    xSignals: dedupeLabeledSignals(xSignals),
    v2exSignals: dedupeLabeledSignals(v2exSignals),
  };
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readQueryList(configJson: Record<string, unknown>) {
  const queries = [];
  const directQuery = readString(configJson.query);
  if (directQuery) {
    queries.push(directQuery);
  }

  if (Array.isArray(configJson.keywords)) {
    for (const value of configJson.keywords) {
      const query = readString(value);
      if (query) {
        queries.push(query);
      }
    }
  }

  return dedupeStrings(queries);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function dedupeLabeledSignals(
  signals: Array<{ projectId: number; label: string; query: string }>,
) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.projectId}:${signal.label}:${signal.query}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
