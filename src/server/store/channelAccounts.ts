import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface ChannelAccountRecord {
  id: number;
  projectId: number | null;
  platform: string;
  accountKey: string;
  displayName: string;
  authType: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelAccountInput {
  projectId?: number;
  platform: string;
  accountKey: string;
  displayName: string;
  authType: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateChannelAccountInput {
  projectId?: number;
  platform?: string;
  accountKey?: string;
  displayName?: string;
  authType?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAccountStore {
  create(input: CreateChannelAccountInput): ChannelAccountRecord;
  getById(id: number): ChannelAccountRecord | undefined;
  list(): ChannelAccountRecord[];
  update(id: number, input: UpdateChannelAccountInput): ChannelAccountRecord | undefined;
  test(
    id: number,
    input: { status?: 'healthy' | 'failed' },
  ): ChannelAccountRecord | undefined;
}

export function createChannelAccountStore(): ChannelAccountStore {
  return {
    create(input) {
      return withDatabase((database) => {
        ensureChannelAccountsProjectIdColumn(database);
        return insertChannelAccount(database, input);
      });
    },
    getById(id) {
      return withDatabase((database) => {
        ensureChannelAccountsProjectIdColumn(database);
        return getChannelAccountById(database, id);
      });
    },
    list() {
      return withDatabase((database) => {
        ensureChannelAccountsProjectIdColumn(database);
        return listChannelAccounts(database);
      });
    },
    update(id, input) {
      return withDatabase((database) => {
        ensureChannelAccountsProjectIdColumn(database);
        return updateChannelAccount(database, id, input);
      });
    },
    test(id, input) {
      return withDatabase((database) => {
        ensureChannelAccountsProjectIdColumn(database);
        return testChannelAccount(database, id, input);
      });
    },
  };
}

function insertChannelAccount(
  database: DatabaseConnection,
  input: CreateChannelAccountInput,
): ChannelAccountRecord {
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `
        INSERT INTO channel_accounts (project_id, platform, account_key, display_name, auth_type, status, metadata, created_at, updated_at)
        VALUES (@project_id, @platform, @account_key, @display_name, @auth_type, @status, @metadata, @created_at, @updated_at)
      `,
    )
    .run({
      project_id: input.projectId ?? null,
      platform: input.platform,
      account_key: input.accountKey,
      display_name: input.displayName,
      auth_type: input.authType,
      status: input.status,
      metadata: JSON.stringify(input.metadata ?? {}),
      created_at: now,
      updated_at: now,
    });

  const row = getChannelAccountById(database, Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('channel account insert failed');
  }

  return row;
}

function listChannelAccounts(database: DatabaseConnection): ChannelAccountRecord[] {
  return database
    .prepare(
      `
        SELECT id, project_id AS projectId, platform, account_key AS accountKey, display_name AS displayName,
               auth_type AS authType, status, metadata,
               created_at AS createdAt, updated_at AS updatedAt
        FROM channel_accounts
        ORDER BY id ASC
      `,
    )
    .all()
    .map(normalizeChannelAccountRow);
}

function updateChannelAccount(
  database: DatabaseConnection,
  id: number,
  input: UpdateChannelAccountInput,
): ChannelAccountRecord | undefined {
  const current = getChannelAccountById(database, id);
  if (!current) {
    return undefined;
  }

  const nextRecord: ChannelAccountRecord = {
    ...current,
    projectId: input.projectId ?? current.projectId,
    platform: input.platform ?? current.platform,
    accountKey: input.accountKey ?? current.accountKey,
    displayName: input.displayName ?? current.displayName,
    authType: input.authType ?? current.authType,
    status: input.status ?? current.status,
    metadata: input.metadata ?? current.metadata,
    updatedAt: new Date().toISOString(),
  };

  database
    .prepare(
      `
        UPDATE channel_accounts
        SET project_id = @project_id,
            platform = @platform,
            account_key = @account_key,
            display_name = @display_name,
            auth_type = @auth_type,
            status = @status,
            metadata = @metadata,
            updated_at = @updated_at
        WHERE id = @id
      `,
    )
    .run({
      id,
      project_id: nextRecord.projectId,
      platform: nextRecord.platform,
      account_key: nextRecord.accountKey,
      display_name: nextRecord.displayName,
      auth_type: nextRecord.authType,
      status: nextRecord.status,
      metadata: JSON.stringify(nextRecord.metadata),
      updated_at: nextRecord.updatedAt,
    });

  return nextRecord;
}

function testChannelAccount(
  database: DatabaseConnection,
  id: number,
  input: { status?: 'healthy' | 'failed' },
): ChannelAccountRecord | undefined {
  const nextStatus = input.status;
  if (nextStatus === undefined) {
    return getChannelAccountById(database, id);
  }

  return updateChannelAccount(database, id, { status: nextStatus });
}

function getChannelAccountById(
  database: DatabaseConnection,
  id: number,
): ChannelAccountRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, platform, account_key AS accountKey, display_name AS displayName,
               auth_type AS authType, status, metadata,
               created_at AS createdAt, updated_at AS updatedAt
        FROM channel_accounts
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeChannelAccountRow(row as Record<string, unknown>) : undefined;
}

function normalizeChannelAccountRow(row: Record<string, unknown>): ChannelAccountRecord {
  const metadata = parseJsonObject(row.metadata);
  return {
    id: Number(row.id),
    projectId: parseOptionalInteger(row.projectId),
    platform: String(row.platform),
    accountKey: String(row.accountKey),
    displayName: String(row.displayName),
    authType: String(row.authType),
    status: String(row.status),
    metadata: typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : {},
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function ensureChannelAccountsProjectIdColumn(database: DatabaseConnection) {
  const columns = database
    .prepare('PRAGMA table_info(channel_accounts)')
    .all() as Array<{ name?: unknown }>;

  if (columns.some((column) => column.name === 'project_id')) {
    return;
  }

  database.exec('ALTER TABLE channel_accounts ADD COLUMN project_id INTEGER');
}

function parseOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
