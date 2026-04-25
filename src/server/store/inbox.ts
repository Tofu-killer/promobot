import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export interface InboxItemRecord {
  id: number;
  projectId?: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateInboxItemInput {
  projectId?: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
  metadata?: Record<string, unknown>;
}

export interface InboxStore {
  create(input: CreateInboxItemInput): InboxItemRecord;
  list(projectId?: number): InboxItemRecord[];
  updateStatus(id: number, status: string): InboxItemRecord | undefined;
}

export function createInboxStore(): InboxStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureInboxItemColumns(database);
        return insertInboxItem(database, input);
      });
    },
    list(projectId) {
      return withDatabase((database) => {
        ensureInboxItemColumns(database);
        return listInboxItems(database, projectId);
      });
    },
    updateStatus(id, status) {
      return withDatabase((database) => {
        ensureInboxItemColumns(database);
        return updateInboxItemStatus(database, id, status);
      });
    },
  };
}

function insertInboxItem(
  database: DatabaseConnection,
  input: CreateInboxItemInput,
): InboxItemRecord {
  const existingRow = findInboxItemByContent(database, input);
  if (existingRow) {
    if (input.metadata) {
      maybeBackfillInboxItemMetadata(database, existingRow, input.metadata);
    }

    const refreshedRow = selectInboxItemById(database, Number(existingRow.id));
    if (!refreshedRow) {
      throw new Error('inbox item refresh failed');
    }

    return normalizeInboxItem(refreshedRow);
  }

  const result = database
    .prepare(
      `
        INSERT INTO inbox_items (project_id, source, status, author, title, excerpt, metadata_json)
        VALUES (@project_id, @source, @status, @author, @title, @excerpt, @metadata_json)
      `,
    )
    .run({
      project_id: input.projectId ?? null,
      source: input.source,
      status: input.status,
      author: input.author ?? null,
      title: input.title,
      excerpt: input.excerpt,
      metadata_json: stringifyMetadata(input.metadata),
    });

  const row = selectInboxItemById(database, result.lastInsertRowid);

  if (!row) {
    throw new Error('inbox item insert failed');
  }

  return normalizeInboxItem(row as Record<string, unknown>);
}

function findInboxItemByContent(
  database: DatabaseConnection,
  input: CreateInboxItemInput,
): Record<string, unknown> | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, status, author, title, excerpt, metadata_json AS metadataJson, created_at AS createdAt
        FROM inbox_items
        WHERE ((project_id = @project_id) OR (project_id IS NULL AND @project_id IS NULL))
          AND source = @source
          AND status = @status
          AND ((author = @author) OR (author IS NULL AND @author IS NULL))
          AND title = @title
          AND excerpt = @excerpt
        ORDER BY id ASC
        LIMIT 1
      `,
    )
    .get({
      project_id: input.projectId ?? null,
      source: input.source,
      status: input.status,
      author: input.author ?? null,
      title: input.title,
      excerpt: input.excerpt,
    });

  return row as Record<string, unknown> | undefined;
}

function listInboxItems(database: DatabaseConnection, projectId?: number): InboxItemRecord[] {
  const rows =
    projectId !== undefined
      ? database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, status, author, title, excerpt, metadata_json AS metadataJson, created_at AS createdAt
              FROM inbox_items
              WHERE project_id = ?
              ORDER BY id ASC
            `,
          )
          .all([projectId])
      : database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, status, author, title, excerpt, metadata_json AS metadataJson, created_at AS createdAt
              FROM inbox_items
              ORDER BY id ASC
            `,
          )
          .all();

  return rows.map((row) => normalizeInboxItem(row as Record<string, unknown>));
}

function updateInboxItemStatus(
  database: DatabaseConnection,
  id: number,
  status: string,
): InboxItemRecord | undefined {
  const result = database
    .prepare(
      `
        UPDATE inbox_items
        SET status = ?
        WHERE id = ?
      `,
    )
    .run([status, id]);

  if (result.changes === 0) {
    return undefined;
  }

  const row = selectInboxItemById(database, id);

  if (!row) {
    return undefined;
  }

  return normalizeInboxItem(row as Record<string, unknown>);
}

function selectInboxItemById(
  database: DatabaseConnection,
  id: number | bigint,
): Record<string, unknown> | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, status, author, title, excerpt, metadata_json AS metadataJson, created_at AS createdAt
        FROM inbox_items
        WHERE id = ?
      `,
    )
    .get([id]);

  return row as Record<string, unknown> | undefined;
}

function normalizeInboxItem(row: Record<string, unknown>): InboxItemRecord {
  const metadata = parseMetadata(row.metadataJson);

  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    source: String(row.source),
    status: String(row.status),
    author: typeof row.author === 'string' ? row.author : undefined,
    title: String(row.title),
    excerpt: String(row.excerpt),
    ...(metadata ? { metadata } : {}),
    createdAt: String(row.createdAt),
  };
}

function ensureInboxItemColumns(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(inbox_items)').all() as Array<{ name?: unknown }>;

  if (!columns.some((column) => column.name === 'project_id')) {
    database.exec('ALTER TABLE inbox_items ADD COLUMN project_id INTEGER');
  }

  if (!columns.some((column) => column.name === 'metadata_json')) {
    database.exec("ALTER TABLE inbox_items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
  }
}

function maybeBackfillInboxItemMetadata(
  database: DatabaseConnection,
  row: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  const existingMetadata = parseMetadata(row.metadataJson);
  if (hasMetadataValues(existingMetadata)) {
    return;
  }

  database
    .prepare(
      `
        UPDATE inbox_items
        SET metadata_json = ?
        WHERE id = ?
      `,
    )
    .run([stringifyMetadata(metadata), Number(row.id)]);
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
