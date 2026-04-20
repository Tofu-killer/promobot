import type { ReputationItemRecord } from '../store/reputation';
import { createReputationStore } from '../store/reputation';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';
import { createSourceConfigStore, type SourceConfigRecord } from '../store/sourceConfigs';
import { createReputationCollectorService } from './reputation/collector';

export interface ReputationFetchResult {
  items: ReputationItemRecord[];
  inserted: number;
}

export function createReputationFetchService() {
  const reputationStore = createReputationStore();
  const monitorStore = createMonitorStore();
  const settingsStore = createSettingsStore();
  const sourceConfigStore = createSourceConfigStore();
  const collectorService = createReputationCollectorService();

  return {
    fetchNow(projectId?: number): ReputationFetchResult {
      const monitorItems = monitorStore.list(projectId);
      const sourceConfigs = filterSourceConfigsByProject(sourceConfigStore.listEnabled(), projectId);
      const globalSettings = projectId === undefined ? settingsStore.get() : emptyReputationSettings();
      const sourceConfigSignals = createSourceConfigFallbackSignals(sourceConfigs);
      const mergedSettings = mergeReputationSettings(globalSettings, sourceConfigs);
      const nonRssMonitorItemCount = monitorItems.filter((item) => item.source !== 'rss').length;

      if (projectId !== undefined && nonRssMonitorItemCount === 0 && sourceConfigSignals.length === 0) {
        return {
          items: [],
          inserted: 0,
        };
      }

      const signals =
        nonRssMonitorItemCount === 0 &&
        (globalSettings.monitorRedditQueries?.length ?? 0) === 0 &&
        (globalSettings.monitorV2exQueries?.length ?? 0) === 0 &&
        sourceConfigSignals.length > 0
          ? sourceConfigSignals
          : collectorService.collect({
              monitorItems,
              settings: mergedSettings,
            });
      const items = signals.map((signal) => reputationStore.create(signal));

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

function createSourceConfigFallbackSignals(sourceConfigs: SourceConfigRecord[]) {
  const signals = [];

  for (const sourceConfig of sourceConfigs) {
    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+reddit') &&
      sourceConfig.platform === 'reddit'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        signals.push({
          projectId: sourceConfig.projectId,
          source: 'reddit',
          sentiment: 'neutral' as const,
          status: 'new' as const,
          title: `Watching reputation query: ${query}`,
          detail: `Derived from source config "${sourceConfig.label}" before live mentions arrive.`,
        });
      }
    }

    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+x') &&
      sourceConfig.platform === 'x'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        signals.push({
          projectId: sourceConfig.projectId,
          source: 'x',
          sentiment: 'neutral' as const,
          status: 'new' as const,
          title: `Watching reputation query: ${query}`,
          detail: `Derived from source config "${sourceConfig.label}" before live mentions arrive.`,
        });
      }
    }

    if (sourceConfig.sourceType === 'v2ex_search') {
      for (const query of readQueryList(sourceConfig.configJson)) {
        signals.push({
          projectId: sourceConfig.projectId,
          source: 'v2ex',
          sentiment: 'neutral' as const,
          status: 'new' as const,
          title: `Watching reputation query: ${query}`,
          detail: `Derived from source config "${sourceConfig.label}" before live mentions arrive.`,
        });
      }
    }
  }

  return dedupeSignals(signals);
}

function mergeReputationSettings(
  settings: {
    monitorRedditQueries?: string[];
    monitorV2exQueries?: string[];
  },
  sourceConfigs: SourceConfigRecord[],
) {
  const redditQueries = [...(settings.monitorRedditQueries ?? [])];
  const v2exQueries = [...(settings.monitorV2exQueries ?? [])];

  for (const sourceConfig of sourceConfigs) {
    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+reddit') &&
      sourceConfig.platform === 'reddit'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        redditQueries.push(query);
      }
    }

    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+x') &&
      sourceConfig.platform === 'x'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        redditQueries.push(query);
      }
    }

    if (sourceConfig.sourceType === 'v2ex_search') {
      for (const query of readQueryList(sourceConfig.configJson)) {
        v2exQueries.push(query);
      }
    }
  }

  return {
    monitorRedditQueries: dedupeStrings(redditQueries),
    monitorV2exQueries: dedupeStrings(v2exQueries),
  };
}

function emptyReputationSettings() {
  return {
    monitorRedditQueries: [],
    monitorV2exQueries: [],
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

function dedupeSignals<T extends { source: string; title: string }>(signals: T[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.source}:${signal.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
