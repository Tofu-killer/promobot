import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export interface ReputationItemRecord {
  id: number;
  projectId?: number;
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
  projectId?: number;
  source: string;
  sentiment: string;
  status: string;
  title: string;
  detail: string;
}

export interface ReputationStore {
  create(input: CreateReputationItemInput): ReputationItemRecord;
  updateStatus(id: number, status: string): ReputationItemRecord | undefined;
  getStats(projectId?: number): ReputationStats;
}

export function createReputationStore(): ReputationStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        const existing = findExistingReputationItem(database, input);
        if (existing) {
          return existing;
        }
        return insertReputationItem(database, input);
      });
    },
    updateStatus(id, status) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return updateReputationItemStatus(database, id, status);
      });
    },
    getStats(projectId) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return readReputationStats(database, projectId);
      });
    },
  };
}

function findExistingReputationItem(
  database: DatabaseConnection,
  input: CreateReputationItemInput,
): ReputationItemRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, sentiment, status, title, detail, created_at AS createdAt
        FROM reputation_items
        WHERE (
          (project_id = @project_id)
          OR (project_id IS NULL AND @project_id IS NULL)
        )
          AND source = @source
          AND sentiment = @sentiment
          AND status = @status
          AND title = @title
          AND detail = @detail
        ORDER BY id ASC
        LIMIT 1
      `,
    )
    .get({
      project_id: input.projectId ?? null,
      source: input.source,
      sentiment: input.sentiment,
      status: input.status,
      title: input.title,
      detail: input.detail,
    });

  return row ? normalizeReputationItem(row as Record<string, unknown>) : undefined;
}

function insertReputationItem(
  database: DatabaseConnection,
  input: CreateReputationItemInput,
): ReputationItemRecord {
  const result = database
    .prepare(
      `
        INSERT INTO reputation_items (project_id, source, sentiment, status, title, detail)
        VALUES (@project_id, @source, @sentiment, @status, @title, @detail)
      `,
    )
    .run({
      project_id: input.projectId ?? null,
      source: input.source,
      sentiment: input.sentiment,
      status: input.status,
      title: input.title,
      detail: input.detail,
    });

  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, sentiment, status, title, detail, created_at AS createdAt
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

function readReputationStats(database: DatabaseConnection, projectId?: number): ReputationStats {
  const rows =
    projectId !== undefined
      ? database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, sentiment, status, title, detail, created_at AS createdAt
              FROM reputation_items
              WHERE project_id = ?
              ORDER BY id ASC
            `,
          )
          .all([projectId])
          .map((row) => normalizeReputationItem(row as Record<string, unknown>))
      : database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, sentiment, status, title, detail, created_at AS createdAt
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

function updateReputationItemStatus(
  database: DatabaseConnection,
  id: number,
  status: string,
): ReputationItemRecord | undefined {
  const current = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, sentiment, status, title, detail, created_at AS createdAt
        FROM reputation_items
        WHERE id = ?
      `,
    )
    .get([id]);

  if (!current) {
    return undefined;
  }

  database
    .prepare(
      `
        UPDATE reputation_items
        SET status = @status
        WHERE id = @id
      `,
    )
    .run({
      id,
      status,
    });

  return normalizeReputationItem({
    ...(current as Record<string, unknown>),
    status,
  });
}

function normalizeReputationItem(row: Record<string, unknown>): ReputationItemRecord {
  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    source: String(row.source),
    sentiment: String(row.sentiment),
    status: String(row.status),
    title: String(row.title),
    detail: String(row.detail),
    createdAt: String(row.createdAt),
  };
}

function ensureProjectIdColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(reputation_items)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'project_id')) {
    return;
  }

  database.exec('ALTER TABLE reputation_items ADD COLUMN project_id INTEGER');
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
