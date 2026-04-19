import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';
import type {
  CreateDraftInput,
  DraftRecord,
  DraftStatus,
  DraftStore,
  UpdateDraftInput,
} from '../routes/drafts';

export function createSQLiteDraftStore(): DraftStore {
  return {
    create(input) {
      return withDatabase((database) => insertDraft(database, input));
    },
    getById(id) {
      return withDatabase((database) => getDraftById(database, id));
    },
    list(status) {
      return withDatabase((database) => listDrafts(database, status));
    },
    update(id, input) {
      return withDatabase((database) => updateDraft(database, id, input));
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

function listDrafts(database: DatabaseConnection, status?: string): DraftRecord[] {
  const rows = status
    ? database
        .prepare(
          `
            SELECT id, platform, title, content, hashtags, status,
                   scheduled_at AS scheduledAt, published_at AS publishedAt,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM drafts
            WHERE status = ?
            ORDER BY id ASC
          `,
        )
        .all([status])
    : database
        .prepare(
          `
            SELECT id, platform, title, content, hashtags, status,
                   scheduled_at AS scheduledAt, published_at AS publishedAt,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM drafts
            ORDER BY id ASC
          `,
        )
        .all();

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
        SET title = @title,
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
        SELECT id, platform, title, content, hashtags, status,
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
