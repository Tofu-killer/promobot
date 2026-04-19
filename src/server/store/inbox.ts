import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface InboxItemRecord {
  id: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
  createdAt: string;
}

export interface CreateInboxItemInput {
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
}

export interface InboxStore {
  create(input: CreateInboxItemInput): InboxItemRecord;
  list(): InboxItemRecord[];
}

export function createInboxStore(): InboxStore {
  return {
    create(input) {
      return withDatabase((database) => insertInboxItem(database, input));
    },
    list() {
      return withDatabase((database) => listInboxItems(database));
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
        INSERT INTO inbox_items (source, status, author, title, excerpt)
        VALUES (@source, @status, @author, @title, @excerpt)
      `,
    )
    .run({
      source: input.source,
      status: input.status,
      author: input.author ?? null,
      title: input.title,
      excerpt: input.excerpt,
    });

  const row = database
    .prepare(
      `
        SELECT id, source, status, author, title, excerpt, created_at AS createdAt
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

function listInboxItems(database: DatabaseConnection): InboxItemRecord[] {
  return database
    .prepare(
      `
        SELECT id, source, status, author, title, excerpt, created_at AS createdAt
        FROM inbox_items
        ORDER BY id ASC
      `,
    )
    .all()
    .map((row) => normalizeInboxItem(row as Record<string, unknown>));
}

function normalizeInboxItem(row: Record<string, unknown>): InboxItemRecord {
  return {
    id: Number(row.id),
    source: String(row.source),
    status: String(row.status),
    author: typeof row.author === 'string' ? row.author : undefined,
    title: String(row.title),
    excerpt: String(row.excerpt),
    createdAt: String(row.createdAt),
  };
}
