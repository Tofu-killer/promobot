import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';
import type {
  CreateDraftInput,
  DraftRecord,
  DraftStatus,
  DraftStore,
  UpdateDraftInput,
} from '../routes/drafts.js';

export function createSQLiteDraftStore(): DraftStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureDraftsProjectIdColumn(database);
        return insertDraft(database, input);
      });
    },
    getById(id) {
      return withDatabase((database) => {
        ensureDraftsProjectIdColumn(database);
        return getDraftById(database, id);
      });
    },
    list(status, projectId) {
      return withDatabase((database) => {
        ensureDraftsProjectIdColumn(database);
        return listDrafts(database, status, projectId);
      });
    },
    update(id, input) {
      return withDatabase((database) => {
        ensureDraftsProjectIdColumn(database);
        return updateDraft(database, id, input);
      });
    },
  };
}

function insertDraft(database: DatabaseConnection, input: CreateDraftInput): DraftRecord {
  const now = new Date().toISOString();
  const hashtags = JSON.stringify(input.hashtags ?? []);
  const status = input.status ?? 'draft';

  const result = database
    .prepare(
      `
        INSERT INTO drafts (
          project_id,
          platform,
          title,
          content,
          hashtags,
          status,
          scheduled_at,
          published_at,
          created_at,
          updated_at
        )
        VALUES (
          @project_id,
          @platform,
          @title,
          @content,
          @hashtags,
          @status,
          @scheduled_at,
          @published_at,
          @created_at,
          @updated_at
        )
      `,
    )
    .run({
      project_id: input.projectId ?? null,
      platform: input.platform,
      title: input.title ?? null,
      content: input.content,
      hashtags,
      status,
      scheduled_at: null,
      published_at: null,
      created_at: now,
      updated_at: now,
    });

  const row = getDraftById(database, Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('draft insert failed');
  }

  return row;
}

function listDrafts(database: DatabaseConnection, status?: string, projectId?: number): DraftRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (projectId !== undefined) {
    conditions.push('project_id = ?');
    params.push(projectId);
  }

  const rows = database
    .prepare(
      `
        SELECT id, project_id AS projectId, platform, title, content, hashtags, status,
               scheduled_at AS scheduledAt, published_at AS publishedAt,
               created_at AS createdAt, updated_at AS updatedAt
        FROM drafts
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY id ASC
      `,
    )
    .all(params);

  return rows.map(normalizeDraftRow);
}

function updateDraft(
  database: DatabaseConnection,
  id: number,
  input: UpdateDraftInput,
): DraftRecord | undefined {
  const current = getDraftById(database, id);
  if (!current) {
    return undefined;
  }

  const nextDraft = {
    ...current,
    projectId: input.projectId ?? current.projectId,
    title: input.title !== undefined ? input.title : current.title,
    content: input.content !== undefined ? input.content : current.content,
    hashtags: input.hashtags !== undefined ? [...input.hashtags] : [...current.hashtags],
    status: input.status !== undefined ? input.status : current.status,
    scheduledAt:
      input.scheduledAt !== undefined ? input.scheduledAt ?? undefined : current.scheduledAt,
    publishedAt:
      input.publishedAt !== undefined ? input.publishedAt ?? undefined : current.publishedAt,
    updatedAt: new Date().toISOString(),
  };

  database
    .prepare(
      `
        UPDATE drafts
        SET project_id = @project_id,
            title = @title,
            content = @content,
            hashtags = @hashtags,
            status = @status,
            scheduled_at = @scheduled_at,
            published_at = @published_at,
            updated_at = @updated_at
        WHERE id = @id
      `,
    )
    .run({
      id,
      project_id: nextDraft.projectId,
      title: nextDraft.title ?? null,
      content: nextDraft.content,
      hashtags: JSON.stringify(nextDraft.hashtags),
      status: nextDraft.status,
      scheduled_at: nextDraft.scheduledAt ?? null,
      published_at: nextDraft.publishedAt ?? null,
      updated_at: nextDraft.updatedAt,
    });

  return nextDraft;
}

function getDraftById(database: DatabaseConnection, id: number): DraftRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, platform, title, content, hashtags, status,
               scheduled_at AS scheduledAt, published_at AS publishedAt,
               created_at AS createdAt, updated_at AS updatedAt
        FROM drafts
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeDraftRow(row) : undefined;
}

function normalizeDraftRow(row: Record<string, unknown>): DraftRecord {
  const hashtags = parseJsonArray(row.hashtags);
  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    platform: String(row.platform),
    title: typeof row.title === 'string' ? row.title : undefined,
    content: String(row.content),
    hashtags: Array.isArray(hashtags) ? hashtags.filter((item): item is string => typeof item === 'string') : [],
    status: String(row.status) as DraftStatus,
    scheduledAt: typeof row.scheduledAt === 'string' ? row.scheduledAt : undefined,
    publishedAt: typeof row.publishedAt === 'string' ? row.publishedAt : undefined,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function ensureDraftsProjectIdColumn(database: DatabaseConnection) {
  const columns = database
    .prepare('PRAGMA table_info(drafts)')
    .all() as Array<{ name?: unknown }>;

  if (columns.some((column) => column.name === 'project_id')) {
    return;
  }

  database.exec('ALTER TABLE drafts ADD COLUMN project_id INTEGER');
}

function parseOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
