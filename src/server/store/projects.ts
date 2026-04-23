import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export interface ProjectRecord {
  id: number;
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
  archived: boolean;
  archivedAt?: string;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
}

export interface UpdateProjectInput {
  name?: string;
  siteName?: string;
  siteUrl?: string;
  siteDescription?: string;
  sellingPoints?: string[];
  archived?: boolean;
}

export interface ProjectStore {
  create(input: CreateProjectInput): ProjectRecord;
  list(): ProjectRecord[];
  update(id: number, input: UpdateProjectInput): ProjectRecord | undefined;
  archive(id: number): ProjectRecord | undefined;
}

export function createProjectStore(): ProjectStore {
  return {
    create(input) {
      return withDatabase((database) => insertProject(database, input));
    },
    list() {
      return withDatabase((database) => listProjects(database));
    },
    update(id, input) {
      return withDatabase((database) => updateProject(database, id, input));
    },
    archive(id) {
      return withDatabase((database) => archiveProject(database, id));
    },
  };
}

function insertProject(database: DatabaseConnection, input: CreateProjectInput): ProjectRecord {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  const result = database
    .prepare(
      `
        INSERT INTO projects (name, site_name, site_url, site_description, selling_points, archived)
        VALUES (@name, @site_name, @site_url, @site_description, @selling_points, 0)
      `,
    )
    .run({
      name: input.name,
      site_name: input.siteName,
      site_url: input.siteUrl,
      site_description: input.siteDescription,
      selling_points: JSON.stringify(input.sellingPoints),
    });

  const row = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE id = ?
      `,
    )
    .get([result.lastInsertRowid]) as ProjectRecord | undefined;

  if (!row) {
    throw new Error('project insert failed');
  }

  return normalizeProjectRow(row as unknown as Record<string, unknown>);
}

function listProjects(database: DatabaseConnection): ProjectRecord[] {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  return database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE archived = 0
          AND archived_at IS NULL
        ORDER BY id ASC
      `,
    )
    .all()
    .map((row) => normalizeProjectRow(row as Record<string, unknown>));
}

function updateProject(
  database: DatabaseConnection,
  id: number,
  input: UpdateProjectInput,
): ProjectRecord | undefined {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  const current = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE id = ?
      `,
    )
    .get([id]) as ProjectRecord | undefined;

  if (!current) {
    return undefined;
  }

  database
    .prepare(
      `
        UPDATE projects
        SET name = @name,
            site_name = @site_name,
            site_url = @site_url,
            site_description = @site_description,
            selling_points = @selling_points,
            archived = @archived
        WHERE id = @id
      `,
    )
    .run({
      id,
      name: input.name ?? current.name,
      site_name: input.siteName ?? current.siteName,
      site_url: input.siteUrl ?? current.siteUrl,
      site_description: input.siteDescription ?? current.siteDescription,
      selling_points: JSON.stringify(input.sellingPoints ?? current.sellingPoints),
    archived: input.archived ?? current.archived ? 1 : 0,
  });

  return normalizeProjectRow({
    ...current,
    name: input.name ?? current.name,
    siteName: input.siteName ?? current.siteName,
    siteUrl: input.siteUrl ?? current.siteUrl,
    siteDescription: input.siteDescription ?? current.siteDescription,
    sellingPoints: JSON.stringify(input.sellingPoints ?? current.sellingPoints),
    archived: input.archived ?? current.archived ? 1 : 0,
    archivedAt: current.archivedAt,
  });
}

function archiveProject(database: DatabaseConnection, id: number): ProjectRecord | undefined {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);

  const result = database
    .prepare(
      `
        UPDATE projects
        SET archived = 1,
            archived_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .run([id]);

  if (result.changes === 0) {
    return undefined;
  }

  const row = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeProjectRow(row as Record<string, unknown>) : undefined;
}

function normalizeProjectRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    siteName: String(row.siteName),
    siteUrl: String(row.siteUrl),
    siteDescription: String(row.siteDescription),
    sellingPoints: parseSellingPoints(row.sellingPoints),
    archived: Number(row.archived) === 1,
    archivedAt: typeof row.archivedAt === 'string' && row.archivedAt.length > 0 ? row.archivedAt : undefined,
    createdAt: String(row.createdAt),
  };
}

function ensureArchivedColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'archived')) {
    return;
  }

  database.exec('ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
}

function ensureArchivedAtColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'archived_at')) {
    return;
  }

  database.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');
}

function parseSellingPoints(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}
