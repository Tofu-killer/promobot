import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export type PublishLogStatus = 'published' | 'queued' | 'manual_required' | 'failed';

export interface CreatePublishLogInput {
  draftId: number;
  projectId?: number | null;
  status: PublishLogStatus;
  publishUrl?: string | null;
  message: string;
}

export interface PublishLogRecord {
  id: number;
  draftId: number;
  projectId?: number;
  status: PublishLogStatus;
  publishUrl?: string;
  message: string;
  createdAt: string;
}

export interface PublishLogStore {
  create(input: CreatePublishLogInput): PublishLogRecord;
  listByDraftId(draftId: number): PublishLogRecord[];
}

export function createSQLitePublishLogStore(): PublishLogStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return insertPublishLog(database, input);
      });
    },
    listByDraftId(draftId) {
      return withDatabase((database) => {
        ensureProjectIdColumn(database);
        return listPublishLogsByDraftId(database, draftId);
      });
    },
  };
}

function insertPublishLog(
  database: DatabaseConnection,
  input: CreatePublishLogInput,
): PublishLogRecord {
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `
        INSERT INTO publish_logs (draft_id, project_id, status, publish_url, message, created_at)
        VALUES (@draft_id, @project_id, @status, @publish_url, @message, @created_at)
      `,
    )
    .run({
      draft_id: input.draftId,
      project_id: input.projectId ?? null,
      status: input.status,
      publish_url: input.publishUrl ?? null,
      message: input.message,
      created_at: now,
    });

  const row = database
    .prepare(
      `
        SELECT id, draft_id AS draftId, project_id AS projectId, status, publish_url AS publishUrl,
               message, created_at AS createdAt
        FROM publish_logs
        WHERE id = ?
      `,
    )
    .get([Number(result.lastInsertRowid)]);

  if (!row) {
    throw new Error('publish log insert failed');
  }

  return normalizePublishLogRow(row);
}

function listPublishLogsByDraftId(
  database: DatabaseConnection,
  draftId: number,
): PublishLogRecord[] {
  const rows = database
    .prepare(
      `
        SELECT id, draft_id AS draftId, project_id AS projectId, status, publish_url AS publishUrl,
               message, created_at AS createdAt
        FROM publish_logs
        WHERE draft_id = ?
        ORDER BY id ASC
      `,
    )
    .all([draftId]);

  return rows.map(normalizePublishLogRow);
}

function normalizePublishLogRow(row: Record<string, unknown>): PublishLogRecord {
  return {
    id: Number(row.id),
    draftId: Number(row.draftId),
    projectId: parseOptionalInteger(row.projectId),
    status: String(row.status) as PublishLogStatus,
    publishUrl: typeof row.publishUrl === 'string' ? row.publishUrl : undefined,
    message: String(row.message),
    createdAt: String(row.createdAt),
  };
}

function ensureProjectIdColumn(database: DatabaseConnection) {
  const columns = database
    .prepare('PRAGMA table_info(publish_logs)')
    .all() as Array<{ name?: unknown }>;

  if (columns.some((column) => column.name === 'project_id')) {
    return;
  }

  database.exec('ALTER TABLE publish_logs ADD COLUMN project_id INTEGER');
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
