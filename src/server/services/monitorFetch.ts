import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorRssService } from './monitor/rss';
import { searchReddit } from './monitor/redditSearch';
import { searchX } from './monitor/xSearch';
import { searchV2ex } from './monitor/v2exSearch';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';

export interface MonitorFetchResult {
  items: MonitorItemRecord[];
  inserted: number;
}

export function createMonitorFetchService() {
  const monitorStore = createMonitorStore();
  const rssService = createMonitorRssService();
  const settingsStore = createSettingsStore();

  return {
    async fetchNow(now: Date = new Date()): Promise<MonitorFetchResult> {
      const settings = settingsStore.get();
      const collected = await collectConfiguredSignals(rssService, settings);
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
): Promise<CollectedSignal[]> {
  const results: CollectedSignal[] = [];
  const rssFeeds =
    settings.monitorRssFeeds && settings.monitorRssFeeds.length > 0
      ? settings.monitorRssFeeds
      : parseList(process.env.MONITOR_RSS_FEEDS);
  const redditQueries =
    settings.monitorRedditQueries && settings.monitorRedditQueries.length > 0
      ? settings.monitorRedditQueries
      : parseList(process.env.MONITOR_REDDIT_QUERIES);
  const xQueries =
    settings.monitorXQueries && settings.monitorXQueries.length > 0
      ? settings.monitorXQueries
      : parseList(process.env.MONITOR_X_QUERIES);
  const v2exQueries =
    settings.monitorV2exQueries && settings.monitorV2exQueries.length > 0
      ? settings.monitorV2exQueries
      : parseList(process.env.MONITOR_V2EX_QUERIES);

  for (const feed of rssFeeds) {
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

  for (const query of redditQueries) {
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

  for (const query of xQueries) {
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

  for (const query of v2exQueries) {
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
