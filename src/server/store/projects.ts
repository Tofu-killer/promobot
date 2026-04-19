import type { DatabaseConnection } from '../db';
import { withDatabase } from '../lib/persistence';

export interface ProjectRecord {
  id: number;
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
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
}

export interface ProjectStore {
  create(input: CreateProjectInput): ProjectRecord;
  list(): ProjectRecord[];
  update(id: number, input: UpdateProjectInput): ProjectRecord | undefined;
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
  };
}

function insertProject(database: DatabaseConnection, input: CreateProjectInput): ProjectRecord {
  const result = database
    .prepare(
      `
        INSERT INTO projects (name, site_name, site_url, site_description, selling_points)
        VALUES (@name, @site_name, @site_url, @site_description, @selling_points)
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
               created_at AS createdAt
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
  return database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               created_at AS createdAt
        FROM projects
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
  const current = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               created_at AS createdAt
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
            selling_points = @selling_points
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
    });

  return normalizeProjectRow({
    ...current,
    name: input.name ?? current.name,
    siteName: input.siteName ?? current.siteName,
    siteUrl: input.siteUrl ?? current.siteUrl,
    siteDescription: input.siteDescription ?? current.siteDescription,
    sellingPoints: JSON.stringify(input.sellingPoints ?? current.sellingPoints),
  });
}

function normalizeProjectRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    siteName: String(row.siteName),
    siteUrl: String(row.siteUrl),
    siteDescription: String(row.siteDescription),
    sellingPoints: parseSellingPoints(row.sellingPoints),
    createdAt: String(row.createdAt),
  };
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
