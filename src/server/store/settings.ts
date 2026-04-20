import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface SettingsRecord {
  allowlist: string[];
  schedulerIntervalMinutes: number;
  rssDefaults: string[];
  monitorRssFeeds: string[];
  monitorXQueries: string[];
  monitorRedditQueries: string[];
  monitorV2exQueries: string[];
}

export interface UpdateSettingsInput {
  allowlist?: string[];
  schedulerIntervalMinutes?: number;
  rssDefaults?: string[];
  monitorRssFeeds?: string[];
  monitorXQueries?: string[];
  monitorRedditQueries?: string[];
  monitorV2exQueries?: string[];
}

const DEFAULT_SETTINGS: SettingsRecord = {
  allowlist: ['127.0.0.1', '::1'],
  schedulerIntervalMinutes: 15,
  rssDefaults: ['OpenAI blog', 'Anthropic news', 'Product Hunt', 'Reddit watchlist'],
  monitorRssFeeds: [],
  monitorXQueries: [],
  monitorRedditQueries: [],
  monitorV2exQueries: [],
};

export interface SettingsStore {
  get(): SettingsRecord;
  update(input: UpdateSettingsInput): SettingsRecord;
}

export function createSettingsStore(): SettingsStore {
  return {
    get() {
      return withDatabase((database) => readSettings(database));
    },
    update(input) {
      return withDatabase((database) => updateSettings(database, input));
    },
  };
}

function readSettings(database: DatabaseConnection): SettingsRecord {
  const rows = database
    .prepare('SELECT key, value FROM settings')
    .all() as Array<{ key: string; value: string }>;

  const settings: SettingsRecord = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key === 'allowlist') {
      settings.allowlist = parseStringArray(row.value, DEFAULT_SETTINGS.allowlist);
    } else if (row.key === 'schedulerIntervalMinutes') {
      settings.schedulerIntervalMinutes = parseInteger(row.value, DEFAULT_SETTINGS.schedulerIntervalMinutes);
    } else if (row.key === 'rssDefaults') {
      settings.rssDefaults = parseStringArray(row.value, DEFAULT_SETTINGS.rssDefaults);
    } else if (row.key === 'monitorRssFeeds') {
      settings.monitorRssFeeds = parseStringArray(row.value, DEFAULT_SETTINGS.monitorRssFeeds);
    } else if (row.key === 'monitorXQueries') {
      settings.monitorXQueries = parseStringArray(
        row.value,
        DEFAULT_SETTINGS.monitorXQueries,
      );
    } else if (row.key === 'monitorRedditQueries') {
      settings.monitorRedditQueries = parseStringArray(
        row.value,
        DEFAULT_SETTINGS.monitorRedditQueries,
      );
    } else if (row.key === 'monitorV2exQueries') {
      settings.monitorV2exQueries = parseStringArray(
        row.value,
        DEFAULT_SETTINGS.monitorV2exQueries,
      );
    }
  }

  return settings;
}

function updateSettings(database: DatabaseConnection, input: UpdateSettingsInput): SettingsRecord {
  if (input.allowlist !== undefined) {
    upsertSetting(database, 'allowlist', JSON.stringify(input.allowlist));
  }
  if (input.schedulerIntervalMinutes !== undefined) {
    upsertSetting(database, 'schedulerIntervalMinutes', String(input.schedulerIntervalMinutes));
  }
  if (input.rssDefaults !== undefined) {
    upsertSetting(database, 'rssDefaults', JSON.stringify(input.rssDefaults));
  }
  if (input.monitorRssFeeds !== undefined) {
    upsertSetting(database, 'monitorRssFeeds', JSON.stringify(input.monitorRssFeeds));
  }
  if (input.monitorXQueries !== undefined) {
    upsertSetting(database, 'monitorXQueries', JSON.stringify(input.monitorXQueries));
  }
  if (input.monitorRedditQueries !== undefined) {
    upsertSetting(database, 'monitorRedditQueries', JSON.stringify(input.monitorRedditQueries));
  }
  if (input.monitorV2exQueries !== undefined) {
    upsertSetting(database, 'monitorV2exQueries', JSON.stringify(input.monitorV2exQueries));
  }

  return readSettings(database);
}

function upsertSetting(database: DatabaseConnection, key: string, value: string) {
  database
    .prepare(
      `
        INSERT INTO settings (key, value, updated_at)
        VALUES (@key, @value, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run({ key, value });
}

function parseStringArray(value: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
