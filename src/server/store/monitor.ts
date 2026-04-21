import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export interface MonitorItemRecord {
  id: number;
  projectId?: number;
  source: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
}

export interface CreateMonitorItemInput {
  projectId?: number;
  source: string;
  title: string;
  detail: string;
  status?: string;
}

export interface MonitorStore {
  create(input: CreateMonitorItemInput): MonitorItemRecord;
  getById(id: number): MonitorItemRecord | undefined;
  list(projectId?: number): MonitorItemRecord[];
}

export function createMonitorStore(): MonitorStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return insertMonitorItem(database, input);
      });
    },
    getById(id) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return getMonitorItemById(database, id);
      });
    },
    list(projectId) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return listMonitorItems(database, projectId);
      });
    },
  };
}

function insertMonitorItem(
  database: DatabaseConnection,
  input: CreateMonitorItemInput,
): MonitorItemRecord {
  const params = {
    project_id: input.projectId ?? null,
    source: input.source,
    title: input.title,
    detail: input.detail,
    status: input.status ?? 'new',
  };
  const result = database
    .prepare(
      `
        INSERT INTO monitor_items (project_id, source, title, detail, status)
        SELECT @project_id, @source, @title, @detail, @status
        WHERE NOT EXISTS (
          SELECT 1
          FROM monitor_items
          WHERE source = @source
            AND title = @title
            AND detail = @detail
            AND (
              project_id = @project_id
              OR (project_id IS NULL AND @project_id IS NULL)
            )
        )
      `,
    )
    .run(params);

  const row =
    result.changes > 0
      ? getMonitorItemById(database, result.lastInsertRowid)
      : getMonitorItemByNaturalKey(database, input);

  if (!row) {
    throw new Error('monitor item insert failed');
  }

  return row;
}

function getMonitorItemById(database: DatabaseConnection, id: number): MonitorItemRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, title, detail, status, created_at AS createdAt
        FROM monitor_items
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeMonitorItem(row as Record<string, unknown>) : undefined;
}

function listMonitorItems(database: DatabaseConnection, projectId?: number): MonitorItemRecord[] {
  const rows =
    projectId !== undefined
      ? database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, title, detail, status, created_at AS createdAt
              FROM monitor_items
              WHERE project_id = ?
              ORDER BY id ASC
            `,
          )
          .all([projectId])
      : database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, title, detail, status, created_at AS createdAt
              FROM monitor_items
              ORDER BY id ASC
            `,
          )
          .all();

  return rows.map((row) => normalizeMonitorItem(row as Record<string, unknown>));
}

function getMonitorItemByNaturalKey(
  database: DatabaseConnection,
  input: Pick<CreateMonitorItemInput, 'projectId' | 'source' | 'title' | 'detail'>,
): MonitorItemRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, title, detail, status, created_at AS createdAt
        FROM monitor_items
        WHERE source = @source
          AND title = @title
          AND detail = @detail
          AND (
            project_id = @project_id
            OR (project_id IS NULL AND @project_id IS NULL)
          )
        ORDER BY id ASC
        LIMIT 1
      `,
    )
    .get({
      project_id: input.projectId ?? null,
      source: input.source,
      title: input.title,
      detail: input.detail,
    });

  return row ? normalizeMonitorItem(row as Record<string, unknown>) : undefined;
}

function normalizeMonitorItem(row: Record<string, unknown>): MonitorItemRecord {
  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    source: String(row.source),
    title: String(row.title),
    detail: String(row.detail),
    status: String(row.status),
    createdAt: String(row.createdAt),
  };
}

function ensureProjectIdColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(monitor_items)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'project_id')) {
    return;
  }

  database.exec('ALTER TABLE monitor_items ADD COLUMN project_id INTEGER');
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
