import type { ReputationItemRecord } from '../store/reputation.js';
import { createReputationStore } from '../store/reputation.js';
import { createSettingsStore } from '../store/settings.js';
import { createSourceConfigStore, type SourceConfigRecord } from '../store/sourceConfigs.js';
import { createReputationSentimentService } from './reputation/sentiment.js';
import { searchReddit } from './monitor/redditSearch.js';
import { searchV2ex } from './monitor/v2exSearch.js';
import { searchX } from './monitor/xSearch.js';

export interface ReputationFetchResult {
  items: ReputationItemRecord[];
  inserted: number;
}

interface ScopedQuery {
  projectId?: number;
  value: string;
}

interface ReputationSearchRecord {
  projectId?: number;
  source: string;
  title: string;
  detail: string;
  content: string;
  summary: string;
  url: string;
}

export function createReputationFetchService() {
  const reputationStore = createReputationStore();
  const settingsStore = createSettingsStore();
  const sourceConfigStore = createSourceConfigStore();
  const sentimentService = createReputationSentimentService();

  return {
    async fetchNow(projectId?: number): Promise<ReputationFetchResult> {
      const existingItemIds = new Set(reputationStore.getStats(projectId).items.map((item) => item.id));
      const settings = projectId === undefined ? settingsStore.get() : emptyReputationSettings();
      const sourceConfigs = filterSourceConfigsByProject(sourceConfigStore.listEnabled(), projectId);
      const queries = resolveReputationQueries(settings, sourceConfigs);
      const hasConfiguredQueries =
        queries.xQueries.length > 0 ||
        queries.redditQueries.length > 0 ||
        queries.v2exQueries.length > 0;

      if (hasConfiguredQueries) {
        const signals = await collectLiveReputationSignals(queries);
        const items = signals.map((signal) => {
          const detail = buildDetail(signal);
          const analysisDetail = buildAnalysisDetail(signal);
          return reputationStore.create({
            ...(signal.projectId !== undefined ? { projectId: signal.projectId } : {}),
            source: signal.source,
            title: signal.title,
            detail,
            ...sentimentService.analyze({
              title: signal.title,
              detail: analysisDetail,
            }),
          });
        });

        return {
          items,
          inserted: countNewReputationItems(items, existingItemIds),
        };
      }

      if (projectId !== undefined || shouldDisableSeedDataInProduction()) {
        return {
          items: [],
          inserted: 0,
        };
      }

      const items = buildSeedSignals().map((signal) => reputationStore.create(signal));
      return {
        items,
        inserted: countNewReputationItems(items, existingItemIds),
      };
    },
  };
}

function countNewReputationItems(items: ReputationItemRecord[], existingItemIds: Set<number>) {
  const insertedItemIds = new Set<number>();

  for (const item of items) {
    if (!existingItemIds.has(item.id)) {
      insertedItemIds.add(item.id);
    }
  }

  return insertedItemIds.size;
}

function filterSourceConfigsByProject(sourceConfigs: SourceConfigRecord[], projectId?: number) {
  if (projectId === undefined) {
    return sourceConfigs;
  }

  return sourceConfigs.filter((sourceConfig) => sourceConfig.projectId === projectId);
}

function resolveReputationQueries(
  settings: {
    monitorXQueries?: string[];
    monitorRedditQueries?: string[];
    monitorV2exQueries?: string[];
  },
  sourceConfigs: SourceConfigRecord[],
) {
  const sourceConfigQueries = resolveSourceConfigQueries(sourceConfigs);

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

async function collectLiveReputationSignals(queries: {
  xQueries: ScopedQuery[];
  redditQueries: ScopedQuery[];
  v2exQueries: ScopedQuery[];
}) {
  const signals: ReputationSearchRecord[] = [];

  for (const query of queries.xQueries) {
    try {
      const items = await searchX(query.value);
      signals.push(
        ...items.map((item) => ({
          ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
          source: item.source,
          title: item.title,
          detail: item.detail,
          content: item.content,
          summary: item.summary,
          url: item.url,
        })),
      );
    } catch {
      continue;
    }
  }

  for (const query of queries.redditQueries) {
    try {
      const items = await searchReddit(query.value);
      signals.push(
        ...items.map((item) => ({
          ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
          source: item.source,
          title: item.title,
          detail: item.detail,
          content: item.content,
          summary: item.summary,
          url: item.url,
        })),
      );
    } catch {
      continue;
    }
  }

  for (const query of queries.v2exQueries) {
    try {
      const items = await searchV2ex(query.value);
      signals.push(
        ...items.map((item) => ({
          ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
          source: item.source,
          title: item.title,
          detail: item.detail,
          content: item.content,
          summary: item.summary,
          url: item.url,
        })),
      );
    } catch {
      continue;
    }
  }

  return signals;
}

function buildDetail(record: Pick<ReputationSearchRecord, 'detail' | 'content' | 'summary' | 'url'>) {
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

function buildAnalysisDetail(record: Pick<ReputationSearchRecord, 'content' | 'summary'>) {
  return [record.content, record.summary]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n\n');
}

function emptyReputationSettings() {
  return {
    monitorXQueries: [],
    monitorRedditQueries: [],
    monitorV2exQueries: [],
  };
}

function shouldDisableSeedDataInProduction() {
  return process.env.NODE_ENV === 'production';
}

function buildSeedSignals() {
  return [
    {
      source: 'reddit',
      sentiment: 'positive',
      status: 'new',
      title: 'Lower APAC latency praise',
      detail: 'A user praised lower Claude routing latency from Perth compared with larger aggregators.',
    },
    {
      source: 'facebook-group',
      sentiment: 'negative',
      status: 'escalate',
      title: 'Billing confusion mention',
      detail: 'A prospect asked whether usage caps and billing are transparent enough for agency workflows.',
    },
  ];
}

function resolveSourceConfigQueries(sourceConfigs: SourceConfigRecord[]) {
  const xQueries: ScopedQuery[] = [];
  const redditQueries: ScopedQuery[] = [];
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
    xQueries: dedupeScopedQueries(xQueries),
    redditQueries: dedupeScopedQueries(redditQueries),
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
