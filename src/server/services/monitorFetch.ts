import type { CreateMonitorItemInput, MonitorItemRecord, MonitorStore } from '../store/monitor.js';
import { fetchInstagramProfileSignal } from './monitor/instagramProfile.js';
import { createMonitorRssService } from './monitor/rss.js';
import { searchReddit } from './monitor/redditSearch.js';
import { fetchTiktokProfileSignal } from './monitor/tiktokProfile.js';
import { searchX } from './monitor/xSearch.js';
import { searchV2ex } from './monitor/v2exSearch.js';
import { createMonitorStore } from '../store/monitor.js';
import { createSettingsStore } from '../store/settings.js';
import { createSourceConfigStore, type SourceConfigRecord } from '../store/sourceConfigs.js';
import { readSourceConfigChannelAccountMetadata } from './sourceConfigMetadata.js';

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
    async fetchNow(projectId?: number, now: Date = new Date()): Promise<MonitorFetchResult> {
      const settings = projectId === undefined ? settingsStore.get() : emptyMonitorSettings();
      const sourceConfigs = filterSourceConfigsByProject(sourceConfigStore.listEnabled(), projectId);
      const collected = await collectConfiguredSignals(
        rssService,
        settings,
        sourceConfigs,
      );
      if (collected.length > 0) {
        return persistMonitorItems(
          monitorStore,
          projectId,
          collected.map((item) => ({
            ...(item.projectId !== undefined ? { projectId: item.projectId } : {}),
            source: item.source,
            title: item.title,
            detail: item.detail,
            status: 'new',
            ...(item.metadata ? { metadata: item.metadata } : {}),
          })),
        );
      }

      if (projectId !== undefined) {
        return {
          items: [],
          inserted: 0,
        };
      }

      if (shouldDisableSeedDataInProduction()) {
        return {
          items: [],
          inserted: 0,
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

      return persistMonitorItems(
        monitorStore,
        projectId,
        seeds.map((seed) => ({
          ...seed,
          status: 'new',
        })),
      );
    },
  };
}

function persistMonitorItems(
  monitorStore: MonitorStore,
  projectId: number | undefined,
  itemsToCreate: CreateMonitorItemInput[],
): MonitorFetchResult {
  const totalBefore = monitorStore.list(projectId).length;
  const items = itemsToCreate.map((item) => monitorStore.create(item));
  const totalAfter = monitorStore.list(projectId).length;

  return {
    items,
    inserted: totalAfter - totalBefore,
  };
}

function shouldDisableSeedDataInProduction() {
  return process.env.NODE_ENV === 'production';
}

function filterSourceConfigsByProject(sourceConfigs: SourceConfigRecord[], projectId?: number) {
  if (projectId === undefined) {
    return sourceConfigs;
  }

  return sourceConfigs.filter((sourceConfig) => sourceConfig.projectId === projectId);
}

function emptyMonitorSettings() {
  return {
    monitorRssFeeds: [],
    monitorRedditQueries: [],
    monitorXQueries: [],
    monitorV2exQueries: [],
  };
}

export interface CollectedSignal {
  projectId?: number;
  source: string;
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

interface ScopedStringValue {
  projectId?: number;
  value: string;
}

interface ScopedProfileValue {
  projectId?: number;
  handle?: string;
  profileUrl: string;
  metadata?: Record<string, unknown>;
}

const INSTAGRAM_PROFILE_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const TIKTOK_PROFILE_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const INSTAGRAM_RESERVED_PROFILE_SEGMENTS = new Set([
  'accounts',
  'api',
  'challenge',
  'checkpoint',
  'developer',
  'direct',
  'explore',
  'legal',
  'press',
  'reel',
  'reels',
  'shop',
  'stories',
  'tv',
  'web',
]);

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
  const rssFeeds: ScopedStringValue[] =
    settings.monitorRssFeeds && settings.monitorRssFeeds.length > 0
      ? [...settings.monitorRssFeeds.map((value) => ({ value })), ...sourceConfigInputs.rssFeeds]
      : sourceConfigInputs.rssFeeds.length > 0
        ? sourceConfigInputs.rssFeeds
      : parseList(process.env.MONITOR_RSS_FEEDS).map((value) => ({ value }));
  const redditQueries: ScopedStringValue[] =
    settings.monitorRedditQueries && settings.monitorRedditQueries.length > 0
      ? [...settings.monitorRedditQueries.map((value) => ({ value })), ...sourceConfigInputs.redditQueries]
      : sourceConfigInputs.redditQueries.length > 0
        ? sourceConfigInputs.redditQueries
      : parseList(process.env.MONITOR_REDDIT_QUERIES).map((value) => ({ value }));
  const xQueries: ScopedStringValue[] =
    settings.monitorXQueries && settings.monitorXQueries.length > 0
      ? [...settings.monitorXQueries.map((value) => ({ value })), ...sourceConfigInputs.xQueries]
      : sourceConfigInputs.xQueries.length > 0
        ? sourceConfigInputs.xQueries
      : parseList(process.env.MONITOR_X_QUERIES).map((value) => ({ value }));
  const v2exQueries: ScopedStringValue[] =
    settings.monitorV2exQueries && settings.monitorV2exQueries.length > 0
      ? [...settings.monitorV2exQueries.map((value) => ({ value })), ...sourceConfigInputs.v2exQueries]
      : sourceConfigInputs.v2exQueries.length > 0
        ? sourceConfigInputs.v2exQueries
      : parseList(process.env.MONITOR_V2EX_QUERIES).map((value) => ({ value }));
  const instagramProfiles = sourceConfigInputs.instagramProfiles;
  const tiktokProfiles = sourceConfigInputs.tiktokProfiles;

  for (const feed of rssFeeds) {
    const result = await rssService.fetchFeeds([feed.value]);
    for (const failure of result.failures) {
      results.push({
        ...(feed.projectId !== undefined ? { projectId: feed.projectId } : {}),
        source: 'rss',
        title: `RSS fetch failed: ${failure.feedUrl}`,
        detail: failure.message,
      });
    }

    for (const item of result.items) {
      results.push({
        ...(feed.projectId !== undefined ? { projectId: feed.projectId } : {}),
        source: item.source,
        title: item.title,
        detail: item.metadata.link ? `${item.detail}\n\n${item.metadata.link}` : item.detail,
      });
    }
  }

  for (const query of redditQueries) {
    try {
      const items = await searchReddit(query.value);
      for (const item of items) {
        results.push({
          ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
          source: item.source,
          title: item.title,
          detail: item.url ? `${item.detail}\n\n${item.url}` : item.detail,
        });
      }
    } catch (error) {
      results.push({
        ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
        source: 'reddit',
        title: `Reddit fetch failed: ${query.value}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const query of xQueries) {
    try {
      const items = await searchX(query.value);
      for (const item of items) {
        results.push({
          ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
          source: item.source,
          title: item.title,
          detail: item.url ? `${item.detail}\n\n${item.url}` : item.detail,
        });
      }
    } catch (error) {
      results.push({
        ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
        source: 'x',
        title: `X fetch failed: ${query.value}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const query of v2exQueries) {
    try {
      const items = await searchV2ex(query.value);
      for (const item of items) {
        results.push({
          ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
          source: item.source,
          title: item.title,
          detail: `${item.detail}\n\n${item.url}`,
        });
      }
    } catch (error) {
      results.push({
        ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
        source: 'v2ex',
        title: `V2EX fetch failed: ${query.value}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const profile of instagramProfiles) {
    try {
      const signal = await fetchInstagramProfileSignal(profile);
      const metadata = buildProfileMonitorMetadata(profile);
      results.push({
        ...(profile.projectId !== undefined ? { projectId: profile.projectId } : {}),
        source: signal.source,
        title: signal.title,
        detail: signal.detail,
        ...(metadata ? { metadata } : {}),
      });
    } catch (error) {
      results.push({
        ...(profile.projectId !== undefined ? { projectId: profile.projectId } : {}),
        source: 'instagram',
        title: `Instagram fetch failed: ${profile.handle ?? profile.profileUrl}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const profile of tiktokProfiles) {
    try {
      const signal = await fetchTiktokProfileSignal(profile);
      const metadata = buildProfileMonitorMetadata(profile);
      results.push({
        ...(profile.projectId !== undefined ? { projectId: profile.projectId } : {}),
        source: signal.source,
        title: signal.title,
        detail: signal.detail,
        ...(metadata ? { metadata } : {}),
      });
    } catch (error) {
      results.push({
        ...(profile.projectId !== undefined ? { projectId: profile.projectId } : {}),
        source: 'tiktok',
        title: `TikTok fetch failed: ${profile.handle ?? profile.profileUrl}`,
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

export function resolveSourceConfigInputs(sourceConfigs: SourceConfigRecord[]) {
  const rssFeeds: ScopedStringValue[] = [];
  const redditQueries: ScopedStringValue[] = [];
  const xQueries: ScopedStringValue[] = [];
  const v2exQueries: ScopedStringValue[] = [];
  const instagramProfiles: ScopedProfileValue[] = [];
  const tiktokProfiles: ScopedProfileValue[] = [];

  for (const sourceConfig of sourceConfigs) {
    if (sourceConfig.sourceType === 'rss') {
      const feedUrl = readString(sourceConfig.configJson.feedUrl) ?? readString(sourceConfig.configJson.url);
      if (feedUrl) {
        rssFeeds.push({ projectId: sourceConfig.projectId, value: feedUrl });
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
        redditQueries.push(
          ...queries.map((query) => ({ projectId: sourceConfig.projectId, value: query })),
        );
      } else if (sourceConfig.platform === 'x') {
        xQueries.push(
          ...queries.map((query) => ({ projectId: sourceConfig.projectId, value: query })),
        );
      }
      continue;
    }

    if (sourceConfig.sourceType === 'v2ex_search') {
      for (const query of readQueryList(sourceConfig.configJson)) {
        v2exQueries.push({ projectId: sourceConfig.projectId, value: query });
      }
      continue;
    }

    if (
      sourceConfig.sourceType === 'profile+instagram' ||
      (sourceConfig.sourceType === 'profile' && sourceConfig.platform === 'instagram')
    ) {
      const profileInput = readInstagramProfileInput(sourceConfig.configJson);
      if (profileInput) {
        const metadata = readSourceConfigChannelAccountMetadata(sourceConfig.configJson);
        instagramProfiles.push({
          projectId: sourceConfig.projectId,
          ...profileInput,
          ...(metadata ? { metadata } : {}),
        });
      }
      continue;
    }

    if (
      sourceConfig.sourceType === 'profile+tiktok' ||
      (sourceConfig.sourceType === 'profile' && sourceConfig.platform === 'tiktok')
    ) {
      const profileInput = readTiktokProfileInput(sourceConfig.configJson);
      if (profileInput) {
        const metadata = readSourceConfigChannelAccountMetadata(sourceConfig.configJson);
        tiktokProfiles.push({
          projectId: sourceConfig.projectId,
          ...profileInput,
          ...(metadata ? { metadata } : {}),
        });
      }
    }
  }

  return {
    rssFeeds: dedupeScopedValues(rssFeeds),
    redditQueries: dedupeScopedValues(redditQueries),
    xQueries: dedupeScopedValues(xQueries),
    v2exQueries: dedupeScopedValues(v2exQueries),
    instagramProfiles: dedupeScopedProfiles(instagramProfiles),
    tiktokProfiles: dedupeScopedProfiles(tiktokProfiles),
  };
}

function buildProfileMonitorMetadata(profile: ScopedProfileValue) {
  const metadata: Record<string, unknown> = {
    ...(profile.metadata ?? {}),
    sourceUrl: profile.profileUrl,
    profileUrl: profile.profileUrl,
  };

  if (profile.handle) {
    metadata.profileHandle = profile.handle;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
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

function readInstagramProfileInput(configJson: Record<string, unknown>) {
  const configuredHandle = normalizeProfileHandle(
    readString(configJson.handle) ?? readString(configJson.username),
  );
  const rawProfileUrl = readString(configJson.profileUrl) ?? readString(configJson.url);
  const handleFromUrl = rawProfileUrl ? readInstagramHandleFromProfileUrl(rawProfileUrl) : null;
  const handle = handleFromUrl ?? configuredHandle;
  const profileUrl = normalizeInstagramProfileUrl(rawProfileUrl, handle);

  if (!profileUrl) {
    return null;
  }

  return {
    ...(handle ? { handle: `@${handle}` } : {}),
    profileUrl,
  };
}

function readTiktokProfileInput(configJson: Record<string, unknown>) {
  const configuredHandle = normalizeProfileHandle(
    readString(configJson.handle) ?? readString(configJson.username),
  );
  const rawProfileUrl = readString(configJson.profileUrl) ?? readString(configJson.url);
  const handleFromUrl = rawProfileUrl ? readTiktokHandleFromProfileUrl(rawProfileUrl) : null;
  const handle = handleFromUrl ?? configuredHandle;
  const profileUrl = normalizeTiktokProfileUrl(rawProfileUrl, handle);

  if (!profileUrl) {
    return null;
  }

  return {
    ...(handle ? { handle: `@${handle}` } : {}),
    profileUrl,
  };
}

function normalizeProfileHandle(value: string | null) {
  const normalized = value?.replace(/^@+/, '').replace(/\/+$/, '').trim().toLowerCase();
  return normalized || null;
}

function normalizeInstagramProfileUrl(rawUrl: string | null, handle: string | null) {
  if (rawUrl) {
    const normalizedHandle = readInstagramHandleFromProfileUrl(rawUrl);
    if (normalizedHandle) {
      return `https://www.instagram.com/${normalizedHandle}/`;
    }
  }

  if (!handle || isReservedInstagramProfileHandle(handle)) {
    return null;
  }

  return `https://www.instagram.com/${handle}/`;
}

function normalizeTiktokProfileUrl(rawUrl: string | null, handle: string | null) {
  if (rawUrl) {
    const normalizedHandle = readTiktokHandleFromProfileUrl(rawUrl);
    if (normalizedHandle) {
      return `https://www.tiktok.com/@${normalizedHandle}`;
    }
  }

  return handle ? `https://www.tiktok.com/@${handle}` : null;
}

function readInstagramHandleFromProfileUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!INSTAGRAM_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) {
      return null;
    }

    const handle = normalizeProfileHandle(segments[0]);
    if (!handle || isReservedInstagramProfileHandle(handle)) {
      return null;
    }

    return handle;
  } catch {
    return null;
  }
}

function isReservedInstagramProfileHandle(handle: string) {
  return INSTAGRAM_RESERVED_PROFILE_SEGMENTS.has(handle.toLowerCase());
}

function readTiktokHandleFromProfileUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!TIKTOK_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1 || !segments[0]?.startsWith('@')) {
      return null;
    }

    return normalizeProfileHandle(segments[0]);
  } catch {
    return null;
  }
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function dedupeScopedValues(values: ScopedStringValue[]) {
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

function dedupeScopedProfiles(values: ScopedProfileValue[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.projectId ?? 'global'}:${value.profileUrl}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
