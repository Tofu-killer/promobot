import type { InboxItemRecord } from '../store/inbox.js';
import { createInboxStore } from '../store/inbox.js';
import { createMonitorStore } from '../store/monitor.js';
import { createSettingsStore } from '../store/settings.js';
import { createSourceConfigStore, type SourceConfigRecord } from '../store/sourceConfigs.js';
import { collectWeiboInboxSignals } from './inbox/fetchers/weibo.js';
import { collectXiaohongshuInboxSignals } from './inbox/fetchers/xiaohongshu.js';
import { searchReddit } from './monitor/redditSearch.js';
import { searchV2ex } from './monitor/v2exSearch.js';
import { searchX } from './monitor/xSearch.js';
import { selectInboxStatus } from './inbox/fetchers/types.js';

export interface InboxFetchResult {
  items: InboxItemRecord[];
  inserted: number;
}

interface InboxSearchRecord {
  projectId?: number;
  source: string;
  author?: string;
  title: string;
  detail: string;
  content: string;
  summary: string;
  url: string;
}

interface ScopedQuery {
  projectId?: number;
  value: string;
}

export function createInboxFetchService() {
  const inboxStore = createInboxStore();
  const monitorStore = createMonitorStore();
  const settingsStore = createSettingsStore();
  const sourceConfigStore = createSourceConfigStore();

  return {
    async fetchNow(projectId?: number): Promise<InboxFetchResult> {
      const monitorItems = monitorStore.list(projectId);
      const settings = projectId === undefined ? settingsStore.get() : emptyInboxSettings();
      const sourceConfigs = filterSourceConfigsByProject(
        sourceConfigStore.listEnabled(),
        projectId,
      );
      const queries = resolveInboxQueries(settings, sourceConfigs);
      const monitorSignals = collectBrowserPlatformInboxSignals(monitorItems);
      const hasConfiguredQueries =
        queries.xQueries.length > 0 ||
        queries.redditQueries.length > 0 ||
        queries.v2exQueries.length > 0;
      const hasMonitorSignals = monitorSignals.length > 0;

      if (hasConfiguredQueries || hasMonitorSignals) {
        const totalBeforeInsert = countInboxItems(inboxStore, projectId);
        const liveSignals = hasConfiguredQueries ? await collectLiveInboxSignals(queries) : [];
        const signals = [...liveSignals, ...monitorSignals];
        const items = signals.map((signal) => inboxStore.create(signal));

        return {
          items,
          inserted: countInboxItems(inboxStore, projectId) - totalBeforeInsert,
        };
      }

      if (projectId !== undefined || shouldDisableSeedDataInProduction()) {
        return {
          items: [],
          inserted: 0,
        };
      }

      const totalBeforeInsert = countInboxItems(inboxStore, projectId);
      const items = buildSeedSignals().map((signal) => inboxStore.create(signal));
      return {
        items,
        inserted: countInboxItems(inboxStore, projectId) - totalBeforeInsert,
      };
    },
  };
}

function countInboxItems(inboxStore: ReturnType<typeof createInboxStore>, projectId?: number) {
  return inboxStore.list(projectId).length;
}

function collectBrowserPlatformInboxSignals(
  monitorItems: ReturnType<typeof createMonitorStore>['list'] extends (...args: never[]) => infer TResult
    ? TResult
    : never,
) {
  const context = {
    monitorItems,
    settings: emptyInboxSettings(),
  };

  return [
    ...collectXiaohongshuInboxSignals(context),
    ...collectWeiboInboxSignals(context),
  ];
}

function filterSourceConfigsByProject(sourceConfigs: SourceConfigRecord[], projectId?: number) {
  if (projectId === undefined) {
    return sourceConfigs;
  }

  return sourceConfigs.filter((sourceConfig) => sourceConfig.projectId === projectId);
}

function resolveInboxQueries(
  settings: {
    monitorXQueries?: string[];
    monitorRedditQueries?: string[];
    monitorV2exQueries?: string[];
  },
  sourceConfigs: SourceConfigRecord[],
) {
  const sourceConfigQueries = resolveInboxSourceConfigQueries(sourceConfigs);

  return {
    xQueries: resolveScopedQueries(
      settings.monitorXQueries,
      sourceConfigQueries.xQueries,
      process.env.MONITOR_X_QUERIES,
    ),
    redditQueries: resolveScopedQueries(
      settings.monitorRedditQueries,
      sourceConfigQueries.redditQueries,
      process.env.MONITOR_REDDIT_QUERIES,
    ),
    v2exQueries: resolveScopedQueries(
      settings.monitorV2exQueries,
      sourceConfigQueries.v2exQueries,
      process.env.MONITOR_V2EX_QUERIES,
    ),
  };
}

function resolveScopedQueries(
  settingQueries: string[] | undefined,
  sourceConfigQueries: ScopedQuery[],
  envValue: string | undefined,
) {
  if (settingQueries && settingQueries.length > 0) {
    return dedupeScopedQueries([
      ...settingQueries.map((value) => ({ value })),
      ...sourceConfigQueries,
    ]);
  }

  if (sourceConfigQueries.length > 0) {
    return dedupeScopedQueries(sourceConfigQueries);
  }

  return dedupeScopedQueries(parseList(envValue).map((value) => ({ value })));
}

async function collectLiveInboxSignals(queries: {
  xQueries: ScopedQuery[];
  redditQueries: ScopedQuery[];
  v2exQueries: ScopedQuery[];
}) {
  const signals: Array<{
    projectId?: number;
    source: string;
    status: string;
    author?: string;
    title: string;
    excerpt: string;
  }> = [];

  for (const query of queries.xQueries) {
    try {
      const items = await searchX(query.value);
      signals.push(
        ...items.map((item) =>
          createInboxSignalFromSearchRecord(
            {
              ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
              source: item.source,
              author: item.author,
              title: item.title,
              detail: item.detail,
              content: item.content,
              summary: item.summary,
              url: item.url,
            },
          ),
        ),
      );
    } catch {
      continue;
    }
  }

  for (const query of queries.redditQueries) {
    try {
      const items = await searchReddit(query.value);
      signals.push(
        ...items.map((item) =>
          createInboxSignalFromSearchRecord(
            {
              ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
              source: item.source,
              author: item.author,
              title: item.title,
              detail: item.detail,
              content: item.content,
              summary: item.summary,
              url: item.url,
            },
          ),
        ),
      );
    } catch {
      continue;
    }
  }

  for (const query of queries.v2exQueries) {
    try {
      const items = await searchV2ex(query.value);
      signals.push(
        ...items.map((item) =>
          createInboxSignalFromSearchRecord(
            {
              ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
              source: item.source,
              author: item.author,
              title: item.title,
              detail: item.detail,
              content: item.content,
              summary: item.summary,
              url: item.url,
            },
          ),
        ),
      );
    } catch {
      continue;
    }
  }

  return signals;
}

function createInboxSignalFromSearchRecord(record: InboxSearchRecord) {
  const excerpt = buildExcerpt(record);

  return {
    ...(record.projectId !== undefined ? { projectId: record.projectId } : {}),
    source: record.source,
    status: selectInboxStatus(record.source),
    ...(record.author ? { author: record.author } : {}),
    title: record.title,
    excerpt,
  };
}

function buildExcerpt(record: Pick<InboxSearchRecord, 'detail' | 'content' | 'summary' | 'url'>) {
  const sections = [record.detail, record.content || record.summary, record.url]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const dedupedSections: string[] = [];
  for (const section of sections) {
    if (!dedupedSections.includes(section)) {
      dedupedSections.push(section);
    }
  }

  return dedupedSections.join('\n\n');
}

function shouldDisableSeedDataInProduction() {
  return process.env.NODE_ENV === 'production';
}

function emptyInboxSettings() {
  return {
    monitorXQueries: [],
    monitorRedditQueries: [],
    monitorV2exQueries: [],
  };
}

function buildSeedSignals() {
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

function resolveInboxSourceConfigQueries(sourceConfigs: SourceConfigRecord[]) {
  const redditQueries: ScopedQuery[] = [];
  const xQueries: ScopedQuery[] = [];
  const v2exQueries: ScopedQuery[] = [];

  for (const sourceConfig of sourceConfigs) {
    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+reddit') &&
      sourceConfig.platform === 'reddit'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        redditQueries.push({
          projectId: sourceConfig.projectId,
          value: query,
        });
      }
    }

    if (
      (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+x') &&
      sourceConfig.platform === 'x'
    ) {
      for (const query of readQueryList(sourceConfig.configJson)) {
        xQueries.push({
          projectId: sourceConfig.projectId,
          value: query,
        });
      }
    }

    if (sourceConfig.sourceType === 'v2ex_search') {
      for (const query of readQueryList(sourceConfig.configJson)) {
        v2exQueries.push({
          projectId: sourceConfig.projectId,
          value: query,
        });
      }
    }
  }

  return {
    redditQueries: dedupeScopedQueries(redditQueries),
    xQueries: dedupeScopedQueries(xQueries),
    v2exQueries: dedupeScopedQueries(v2exQueries),
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

function dedupeScopedQueries(values: ScopedQuery[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = `${value.projectId ?? 'global'}:${value.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
