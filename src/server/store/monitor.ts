import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface MonitorItemRecord {
  id: number;
  source: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
}

export interface CreateMonitorItemInput {
  source: string;
  title: string;
  detail: string;
  status?: string;
}

export interface MonitorStore {
  create(input: CreateMonitorItemInput): MonitorItemRecord;
  getById(id: number): MonitorItemRecord | undefined;
  list(): MonitorItemRecord[];
}

export function createMonitorStore(): MonitorStore {
  return {
    create(input) {
      return withDatabase((database) => insertMonitorItem(database, input));
    },
    getById(id) {
      return withDatabase((database) => getMonitorItemById(database, id));
    },
    list() {
      return withDatabase((database) => listMonitorItems(database));
    },
  };
}

function insertMonitorItem(
  database: DatabaseConnection,
  input: CreateMonitorItemInput,
): MonitorItemRecord {
  const result = database
    .prepare(
      `
        INSERT INTO monitor_items (source, title, detail, status)
        VALUES (@source, @title, @detail, @status)
      `,
    )
    .run({
      source: input.source,
      title: input.title,
      detail: input.detail,
      status: input.status ?? 'new',
    });

  const row = database
    .prepare(
      `
        SELECT id, source, title, detail, status, created_at AS createdAt
        FROM monitor_items
        WHERE id = ?
      `,
    )
    .get([result.lastInsertRowid]);

  if (!row) {
    throw new Error('monitor item insert failed');
  }

  return normalizeMonitorItem(row as Record<string, unknown>);
}

function getMonitorItemById(database: DatabaseConnection, id: number): MonitorItemRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, source, title, detail, status, created_at AS createdAt
        FROM monitor_items
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeMonitorItem(row as Record<string, unknown>) : undefined;
}

function listMonitorItems(database: DatabaseConnection): MonitorItemRecord[] {
  return database
    .prepare(
      `
        SELECT id, source, title, detail, status, created_at AS createdAt
        FROM monitor_items
        ORDER BY id ASC
      `,
    )
    .all()
    .map((row) => normalizeMonitorItem(row as Record<string, unknown>));
}

function normalizeMonitorItem(row: Record<string, unknown>): MonitorItemRecord {
  return {
    id: Number(row.id),
    source: String(row.source),
    title: String(row.title),
    detail: String(row.detail),
    status: String(row.status),
    createdAt: String(row.createdAt),
  };
}
