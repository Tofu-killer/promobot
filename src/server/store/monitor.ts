import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export interface MonitorItemRecord {
  id: number;
  projectId?: number;
  source: string;
  title: string;
  detail: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateMonitorItemInput {
  projectId?: number;
  source: string;
  title: string;
  detail: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface MonitorStore {
  create(input: CreateMonitorItemInput): MonitorItemRecord;
  getById(id: number): MonitorItemRecord | undefined;
  list(projectId?: number): MonitorItemRecord[];
  updateStatus(id: number, status: string): MonitorItemRecord | undefined;
}

export function createMonitorStore(): MonitorStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureMonitorItemColumns(database);
        return insertMonitorItem(database, input);
      });
    },
    getById(id) {
      return withDatabase((database) => {
        ensureMonitorItemColumns(database);
        return getMonitorItemById(database, id);
      });
    },
    list(projectId) {
      return withDatabase((database) => {
        ensureMonitorItemColumns(database);
        return listMonitorItems(database, projectId);
      });
    },
    updateStatus(id, status) {
      return withDatabase((database) => {
        ensureMonitorItemColumns(database);
        return updateMonitorItemStatus(database, id, status);
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
    metadata_json: stringifyMetadata(input.metadata),
  };
  const result = database
    .prepare(
      `
        INSERT INTO monitor_items (project_id, source, title, detail, status, metadata_json)
        SELECT @project_id, @source, @title, @detail, @status, @metadata_json
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

  if (input.metadata) {
    maybeBackfillMonitorItemMetadata(database, row, input.metadata);
    return getMonitorItemById(database, row.id) ?? row;
  }

  return row;
}

function getMonitorItemById(database: DatabaseConnection, id: number): MonitorItemRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, title, detail, status,
               metadata_json AS metadataJson, created_at AS createdAt
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
              SELECT id, project_id AS projectId, source, title, detail, status,
                     metadata_json AS metadataJson, created_at AS createdAt
              FROM monitor_items
              WHERE project_id = ?
              ORDER BY id ASC
            `,
          )
          .all([projectId])
      : database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, title, detail, status,
                     metadata_json AS metadataJson, created_at AS createdAt
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
        SELECT id, project_id AS projectId, source, title, detail, status,
               metadata_json AS metadataJson, created_at AS createdAt
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

function updateMonitorItemStatus(
  database: DatabaseConnection,
  id: number,
  status: string,
): MonitorItemRecord | undefined {
  const result = database
    .prepare(
      `
        UPDATE monitor_items
        SET status = ?
        WHERE id = ?
      `,
    )
    .run([status, id]);

  if (result.changes === 0) {
    return undefined;
  }

  return getMonitorItemById(database, id);
}

function normalizeMonitorItem(row: Record<string, unknown>): MonitorItemRecord {
  const metadata = parseMetadata(row.metadataJson);

  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    source: String(row.source),
    title: String(row.title),
    detail: String(row.detail),
    status: String(row.status),
    ...(hasMetadataValues(metadata) ? { metadata } : {}),
    createdAt: String(row.createdAt),
  };
}

function ensureMonitorItemColumns(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(monitor_items)').all() as Array<{ name?: unknown }>;

  if (!columns.some((column) => column.name === 'project_id')) {
    database.exec('ALTER TABLE monitor_items ADD COLUMN project_id INTEGER');
  }

  if (!columns.some((column) => column.name === 'metadata_json')) {
    database.exec("ALTER TABLE monitor_items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
  }
}

function maybeBackfillMonitorItemMetadata(
  database: DatabaseConnection,
  row: MonitorItemRecord,
  metadata: Record<string, unknown>,
) {
  const mergedMetadata = mergeMonitorMetadata(row.metadata, metadata);
  if (mergedMetadata === row.metadata) {
    return;
  }

  database
    .prepare(
      `
        UPDATE monitor_items
        SET metadata_json = ?
        WHERE id = ?
      `,
    )
    .run([stringifyMetadata(mergedMetadata), row.id]);
}

function mergeMonitorMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  incomingMetadata: Record<string, unknown> | undefined,
) {
  if (!hasMetadataValues(incomingMetadata)) {
    return existingMetadata;
  }

  const nextMetadata = incomingMetadata ?? {};
  const mergedMetadata = { ...(existingMetadata ?? {}) };
  let changed = !hasMetadataValues(existingMetadata);

  for (const [key, value] of Object.entries(nextMetadata)) {
    if (value === undefined) {
      continue;
    }

    if (!(key in mergedMetadata) || mergedMetadata[key] === undefined) {
      mergedMetadata[key] = value;
      changed = true;
    }
  }

  return changed ? mergedMetadata : existingMetadata;
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseMetadata(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringifyMetadata(value: Record<string, unknown> | undefined) {
  return JSON.stringify(value ?? {});
}

function hasMetadataValues(value: Record<string, unknown> | undefined) {
  return Boolean(value && Object.keys(value).length > 0);
}
