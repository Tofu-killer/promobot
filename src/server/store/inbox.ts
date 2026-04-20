import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface InboxItemRecord {
  id: number;
  projectId?: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
  createdAt: string;
}

export interface CreateInboxItemInput {
  projectId?: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
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
        ensureProjectIdColumn(database);
        return insertInboxItem(database, input);
      });
    },
    list(projectId) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return listInboxItems(database, projectId);
      });
    },
    updateStatus(id, status) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return updateInboxItemStatus(database, id, status);
      });
    },
  };
}

function insertInboxItem(
  database: DatabaseConnection,
  input: CreateInboxItemInput,
): InboxItemRecord {
  const result = database
    .prepare(
      `
        INSERT INTO inbox_items (project_id, source, status, author, title, excerpt)
        VALUES (@project_id, @source, @status, @author, @title, @excerpt)
      `,
    )
    .run({
      project_id: input.projectId ?? null,
      source: input.source,
      status: input.status,
      author: input.author ?? null,
      title: input.title,
      excerpt: input.excerpt,
    });

  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, status, author, title, excerpt, created_at AS createdAt
        FROM inbox_items
        WHERE id = ?
      `,
    )
    .get([result.lastInsertRowid]);

  if (!row) {
    throw new Error('inbox item insert failed');
  }

  return normalizeInboxItem(row as Record<string, unknown>);
}

function listInboxItems(database: DatabaseConnection, projectId?: number): InboxItemRecord[] {
  const rows =
    projectId !== undefined
      ? database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, status, author, title, excerpt, created_at AS createdAt
              FROM inbox_items
              WHERE project_id = ?
              ORDER BY id ASC
            `,
          )
          .all([projectId])
      : database
          .prepare(
            `
              SELECT id, project_id AS projectId, source, status, author, title, excerpt, created_at AS createdAt
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

  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source, status, author, title, excerpt, created_at AS createdAt
        FROM inbox_items
        WHERE id = ?
      `,
    )
    .get([id]);

  if (!row) {
    return undefined;
  }

  return normalizeInboxItem(row as Record<string, unknown>);
}

function normalizeInboxItem(row: Record<string, unknown>): InboxItemRecord {
  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    source: String(row.source),
    status: String(row.status),
    author: typeof row.author === 'string' ? row.author : undefined,
    title: String(row.title),
    excerpt: String(row.excerpt),
    createdAt: String(row.createdAt),
  };
}

function ensureProjectIdColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(inbox_items)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'project_id')) {
    return;
  }

  database.exec('ALTER TABLE inbox_items ADD COLUMN project_id INTEGER');
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
