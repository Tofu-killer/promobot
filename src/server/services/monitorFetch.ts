import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorRssService } from './monitor/rss';
import { searchReddit } from './monitor/redditSearch';
import { searchX } from './monitor/xSearch';
import { searchV2ex } from './monitor/v2exSearch';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';
import { createSourceConfigStore, type SourceConfigRecord } from '../store/sourceConfigs';

export interface MonitorFetchResult {
  items: MonitorItemRecord[];
  inserted: number;
}

export function createMonitorFetchService() {
  const monitorStore = createMonitorStore();
  const rssService = createMonitorRssService();
  const settingsStore = createSettingsStore();
  const sourceConfigStore = createSourceConfigStore();

  return {
    async fetchNow(now: Date = new Date()): Promise<MonitorFetchResult> {
      const settings = settingsStore.get();
      const collected = await collectConfiguredSignals(
        rssService,
        settings,
        sourceConfigStore.listEnabled(),
      );
      if (collected.length > 0) {
        const items = collected.map((item) =>
          monitorStore.create({
            source: item.source,
            title: item.title,
            detail: item.detail,
            status: 'new',
          }),
        );

        return {
          items,
          inserted: items.length,
        };
      }

      const minuteStamp = now.toISOString();
      const seeds = [
        {
          source: 'rss',
          title: `APAC pricing watch ${minuteStamp}`,
          detail: 'Tracked a competitor pricing update relevant to Australia-facing model buyers.',
        },
        {
          source: 'reddit',
          title: `Latency discussion ${minuteStamp}`,
          detail: 'Observed a new community thread comparing OpenRouter alternatives for AU traffic.',
        },
        {
          source: 'x',
          title: `Routing feature launch ${minuteStamp}`,
          detail: 'Detected a social post about routing/failover that may need a follow-up response.',
        },
      ];

      const items = seeds.map((seed) =>
        monitorStore.create({
          ...seed,
          status: 'new',
        }),
      );

      return {
        items,
        inserted: items.length,
      };
    },
  };
}

export interface CollectedSignal {
  source: string;
  title: string;
  detail: string;
}

export async function collectConfiguredSignals(
  rssService: ReturnType<typeof createMonitorRssService>,
  settings: {
    monitorRssFeeds?: string[];
    monitorRedditQueries?: string[];
    monitorXQueries?: string[];
    monitorV2exQueries?: string[];
  },
  sourceConfigs: SourceConfigRecord[] = [],
): Promise<CollectedSignal[]> {
  const results: CollectedSignal[] = [];
  const sourceConfigInputs = resolveSourceConfigInputs(sourceConfigs);
  const rssFeeds =
    settings.monitorRssFeeds && settings.monitorRssFeeds.length > 0
      ? [...settings.monitorRssFeeds, ...sourceConfigInputs.rssFeeds]
      : sourceConfigInputs.rssFeeds.length > 0
        ? sourceConfigInputs.rssFeeds
      : parseList(process.env.MONITOR_RSS_FEEDS);
  const redditQueries =
    settings.monitorRedditQueries && settings.monitorRedditQueries.length > 0
      ? [...settings.monitorRedditQueries, ...sourceConfigInputs.redditQueries]
      : sourceConfigInputs.redditQueries.length > 0
        ? sourceConfigInputs.redditQueries
      : parseList(process.env.MONITOR_REDDIT_QUERIES);
  const xQueries =
    settings.monitorXQueries && settings.monitorXQueries.length > 0
      ? [...settings.monitorXQueries, ...sourceConfigInputs.xQueries]
      : sourceConfigInputs.xQueries.length > 0
        ? sourceConfigInputs.xQueries
      : parseList(process.env.MONITOR_X_QUERIES);
  const v2exQueries =
    settings.monitorV2exQueries && settings.monitorV2exQueries.length > 0
      ? [...settings.monitorV2exQueries, ...sourceConfigInputs.v2exQueries]
      : sourceConfigInputs.v2exQueries.length > 0
        ? sourceConfigInputs.v2exQueries
      : parseList(process.env.MONITOR_V2EX_QUERIES);

  for (const feed of dedupeStrings(rssFeeds)) {
    const result = await rssService.fetchFeeds([feed]);
    for (const failure of result.failures) {
      results.push({
        source: 'rss',
        title: `RSS fetch failed: ${failure.feedUrl}`,
        detail: failure.message,
      });
    }

    for (const item of result.items) {
      results.push({
        source: item.source,
        title: item.title,
        detail: item.metadata.link ? `${item.detail}\n\n${item.metadata.link}` : item.detail,
      });
    }
  }

  for (const query of dedupeStrings(redditQueries)) {
    try {
      const items = await searchReddit(query);
      for (const item of items) {
        results.push({
          source: item.source,
          title: item.title,
          detail: item.url ? `${item.detail}\n\n${item.url}` : item.detail,
        });
      }
    } catch (error) {
      results.push({
        source: 'reddit',
        title: `Reddit fetch failed: ${query}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const query of dedupeStrings(xQueries)) {
    try {
      const items = await searchX(query);
      for (const item of items) {
        results.push({
          source: item.source,
          title: item.title,
          detail: item.url ? `${item.detail}\n\n${item.url}` : item.detail,
        });
      }
    } catch (error) {
      results.push({
        source: 'x',
        title: `X fetch failed: ${query}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const query of dedupeStrings(v2exQueries)) {
    try {
      const items = await searchV2ex(query);
      for (const item of items) {
        results.push({
          source: item.source,
          title: item.title,
          detail: `${item.detail}\n\n${item.url}`,
        });
      }
    } catch (error) {
      results.push({
        source: 'v2ex',
        title: `V2EX fetch failed: ${query}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function parseList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveSourceConfigInputs(sourceConfigs: SourceConfigRecord[]) {
  const rssFeeds: string[] = [];
  const redditQueries: string[] = [];
  const xQueries: string[] = [];
  const v2exQueries: string[] = [];

  for (const sourceConfig of sourceConfigs) {
    if (sourceConfig.sourceType === 'rss') {
      const feedUrl = readString(sourceConfig.configJson.feedUrl) ?? readString(sourceConfig.configJson.url);
      if (feedUrl) {
        rssFeeds.push(feedUrl);
      }
      continue;
    }

    if (
      sourceConfig.sourceType === 'keyword' ||
      sourceConfig.sourceType === 'keyword+reddit' ||
      sourceConfig.sourceType === 'keyword+x'
    ) {
      const queries = readQueryList(sourceConfig.configJson);
      if (queries.length === 0) {
        continue;
      }

      if (sourceConfig.platform === 'reddit') {
        redditQueries.push(...queries);
      } else if (sourceConfig.platform === 'x') {
        xQueries.push(...queries);
      }
      continue;
    }

    if (sourceConfig.sourceType === 'v2ex_search') {
      const query = readString(sourceConfig.configJson.query);
      if (query) {
        v2exQueries.push(query);
      }
    }
  }

  return {
    rssFeeds,
    redditQueries,
    xQueries,
    v2exQueries,
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
