import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface SourceConfigRecord {
  id: number;
  projectId: number;
  sourceType: string;
  platform: string;
  label: string;
  configJson: Record<string, unknown>;
  enabled: boolean;
  pollIntervalMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSourceConfigInput {
  projectId: number;
  sourceType: string;
  platform: string;
  label: string;
  configJson: Record<string, unknown>;
  enabled: boolean;
  pollIntervalMinutes: number;
}

export interface UpdateSourceConfigInput {
  sourceType?: string;
  platform?: string;
  label?: string;
  configJson?: Record<string, unknown>;
  enabled?: boolean;
  pollIntervalMinutes?: number;
}

export interface SourceConfigStore {
  create(input: CreateSourceConfigInput): SourceConfigRecord;
  listByProject(projectId: number): SourceConfigRecord[];
  update(projectId: number, id: number, input: UpdateSourceConfigInput): SourceConfigRecord | undefined;
}

export function createSourceConfigStore(): SourceConfigStore {
  return {
    create(input) {
      return withDatabase((database) => insertSourceConfig(database, input));
    },
    listByProject(projectId) {
      return withDatabase((database) => listSourceConfigsByProject(database, projectId));
    },
    update(projectId, id, input) {
      return withDatabase((database) => updateSourceConfig(database, projectId, id, input));
    },
  };
}

function insertSourceConfig(
  database: DatabaseConnection,
  input: CreateSourceConfigInput,
): SourceConfigRecord {
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `
        INSERT INTO source_configs (
          project_id,
          source_type,
          platform,
          label,
          config_json,
          enabled,
          poll_interval_minutes,
          created_at,
          updated_at
        )
        VALUES (
          @project_id,
          @source_type,
          @platform,
          @label,
          @config_json,
          @enabled,
          @poll_interval_minutes,
          @created_at,
          @updated_at
        )
      `,
    )
    .run({
      project_id: input.projectId,
      source_type: input.sourceType,
      platform: input.platform,
      label: input.label,
      config_json: JSON.stringify(input.configJson),
      enabled: input.enabled ? 1 : 0,
      poll_interval_minutes: input.pollIntervalMinutes,
      created_at: now,
      updated_at: now,
    });

  const row = getSourceConfigByProjectAndId(database, input.projectId, result.lastInsertRowid);
  if (!row) {
    throw new Error('source config insert failed');
  }

  return row;
}

function listSourceConfigsByProject(
  database: DatabaseConnection,
  projectId: number,
): SourceConfigRecord[] {
  return database
    .prepare(
      `
        SELECT id, project_id AS projectId, source_type AS sourceType, platform, label,
               config_json AS configJson, enabled, poll_interval_minutes AS pollIntervalMinutes,
               created_at AS createdAt, updated_at AS updatedAt
        FROM source_configs
        WHERE project_id = ?
        ORDER BY id ASC
      `,
    )
    .all([projectId])
    .map((row) => normalizeSourceConfigRow(row as Record<string, unknown>));
}

function updateSourceConfig(
  database: DatabaseConnection,
  projectId: number,
  id: number,
  input: UpdateSourceConfigInput,
): SourceConfigRecord | undefined {
  const current = getSourceConfigByProjectAndId(database, projectId, id);
  if (!current) {
    return undefined;
  }

  const nextRecord: SourceConfigRecord = {
    ...current,
    sourceType: input.sourceType ?? current.sourceType,
    platform: input.platform ?? current.platform,
    label: input.label ?? current.label,
    configJson: input.configJson ?? current.configJson,
    enabled: input.enabled ?? current.enabled,
    pollIntervalMinutes: input.pollIntervalMinutes ?? current.pollIntervalMinutes,
    updatedAt: new Date().toISOString(),
  };

  database
    .prepare(
      `
        UPDATE source_configs
        SET source_type = @source_type,
            platform = @platform,
            label = @label,
            config_json = @config_json,
            enabled = @enabled,
            poll_interval_minutes = @poll_interval_minutes,
            updated_at = @updated_at
        WHERE id = @id
          AND project_id = @project_id
      `,
    )
    .run({
      id,
      project_id: projectId,
      source_type: nextRecord.sourceType,
      platform: nextRecord.platform,
      label: nextRecord.label,
      config_json: JSON.stringify(nextRecord.configJson),
      enabled: nextRecord.enabled ? 1 : 0,
      poll_interval_minutes: nextRecord.pollIntervalMinutes,
      updated_at: nextRecord.updatedAt,
    });

  return nextRecord;
}

function getSourceConfigByProjectAndId(
  database: DatabaseConnection,
  projectId: number,
  id: number,
): SourceConfigRecord | undefined {
  const row = database
    .prepare(
      `
        SELECT id, project_id AS projectId, source_type AS sourceType, platform, label,
               config_json AS configJson, enabled, poll_interval_minutes AS pollIntervalMinutes,
               created_at AS createdAt, updated_at AS updatedAt
        FROM source_configs
        WHERE project_id = ?
          AND id = ?
      `,
    )
    .get([projectId, id]);

  return row ? normalizeSourceConfigRow(row as Record<string, unknown>) : undefined;
}

function normalizeSourceConfigRow(row: Record<string, unknown>): SourceConfigRecord {
  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    sourceType: String(row.sourceType),
    platform: String(row.platform),
    label: String(row.label),
    configJson: parseJsonObject(row.configJson),
    enabled: row.enabled === true || Number(row.enabled) === 1,
    pollIntervalMinutes: Number(row.pollIntervalMinutes),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
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
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}
