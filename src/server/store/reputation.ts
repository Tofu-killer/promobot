import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface ReputationItemRecord {
  id: number;
  source: string;
  sentiment: string;
  status: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface ReputationStats {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  trend: Array<{ label: string; value: number }>;
  items: ReputationItemRecord[];
}

export interface CreateReputationItemInput {
  source: string;
  sentiment: string;
  status: string;
  title: string;
  detail: string;
}

export interface ReputationStore {
  create(input: CreateReputationItemInput): ReputationItemRecord;
  getStats(): ReputationStats;
}

export function createReputationStore(): ReputationStore {
  return {
    create(input) {
      return withDatabase((database) => insertReputationItem(database, input));
    },
    getStats() {
      return withDatabase((database) => readReputationStats(database));
    },
  };
}

function insertReputationItem(
  database: DatabaseConnection,
  input: CreateReputationItemInput,
): ReputationItemRecord {
  const result = database
    .prepare(
      `
        INSERT INTO reputation_items (source, sentiment, status, title, detail)
        VALUES (@source, @sentiment, @status, @title, @detail)
      `,
    )
    .run({
      source: input.source,
      sentiment: input.sentiment,
      status: input.status,
      title: input.title,
      detail: input.detail,
    });

  const row = database
    .prepare(
      `
        SELECT id, source, sentiment, status, title, detail, created_at AS createdAt
        FROM reputation_items
        WHERE id = ?
      `,
    )
    .get([result.lastInsertRowid]);

  if (!row) {
    throw new Error('reputation item insert failed');
  }

  return normalizeReputationItem(row as Record<string, unknown>);
}

function readReputationStats(database: DatabaseConnection): ReputationStats {
  const rows = database
    .prepare(
      `
        SELECT id, source, sentiment, status, title, detail, created_at AS createdAt
        FROM reputation_items
        ORDER BY id ASC
      `,
    )
    .all()
    .map((row) => normalizeReputationItem(row as Record<string, unknown>));

  const positive = rows.filter((row) => row.sentiment === 'positive').length;
  const neutral = rows.filter((row) => row.sentiment === 'neutral').length;
  const negative = rows.filter((row) => row.sentiment === 'negative').length;
  const total = rows.length;

  return {
    total,
    positive,
    neutral,
    negative,
    trend: [
      { label: '正向', value: positive },
      { label: '中性', value: neutral },
      { label: '负向', value: negative },
    ],
    items: rows,
  };
}

function normalizeReputationItem(row: Record<string, unknown>): ReputationItemRecord {
  return {
    id: Number(row.id),
    source: String(row.source),
    sentiment: String(row.sentiment),
    status: String(row.status),
    title: String(row.title),
    detail: String(row.detail),
    createdAt: String(row.createdAt),
  };
}
