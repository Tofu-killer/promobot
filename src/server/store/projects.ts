import type { DatabaseConnection } from '../db.js';
import { withDatabase } from '../lib/persistence.js';

export type ProjectRiskPolicy = 'requires_review' | 'auto_approve';

export interface ProjectRecord {
  id: number;
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
  brandVoice: string;
  ctas: string[];
  bannedPhrases: string[];
  defaultLanguagePolicy: string;
  riskPolicy: ProjectRiskPolicy;
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
  brandVoice: string;
  ctas: string[];
  bannedPhrases: string[];
  defaultLanguagePolicy: string;
  riskPolicy: ProjectRiskPolicy;
}

export interface UpdateProjectInput {
  name?: string;
  siteName?: string;
  siteUrl?: string;
  siteDescription?: string;
  sellingPoints?: string[];
  brandVoice?: string;
  ctas?: string[];
  bannedPhrases?: string[];
  defaultLanguagePolicy?: string;
  riskPolicy?: ProjectRiskPolicy;
}

export interface ProjectStore {
  create(input: CreateProjectInput): ProjectRecord;
  getById(id: number): ProjectRecord | undefined;
  list(): ProjectRecord[];
  update(id: number, input: UpdateProjectInput): ProjectRecord | undefined;
  archive(id: number): ProjectRecord | undefined;
}

export function createProjectStore(): ProjectStore {
  return {
    create(input) {
      return withDatabase((database) => insertProject(database, input));
    },
    getById(id) {
      return withDatabase((database) => getProjectById(database, id));
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

function defaultBannedPhrases(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function defaultLanguagePolicy(value: string | undefined): string {
  return typeof value === 'string' ? value : '';
}

function insertProject(database: DatabaseConnection, input: CreateProjectInput): ProjectRecord {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  ensureBrandVoiceColumn(database);
  ensureCtasColumn(database);
  ensureBannedPhrasesColumn(database);
  ensureDefaultLanguagePolicyColumn(database);
  ensureRiskPolicyColumn(database);
  const result = database
    .prepare(
      `
        INSERT INTO projects (
          name,
          site_name,
          site_url,
          site_description,
          selling_points,
          brand_voice,
          ctas,
          banned_phrases,
          default_language_policy,
          risk_policy,
          archived
        )
        VALUES (
          @name,
          @site_name,
          @site_url,
          @site_description,
          @selling_points,
          @brand_voice,
          @ctas,
          @banned_phrases,
          @default_language_policy,
          @risk_policy,
          0
        )
      `,
    )
    .run({
      name: input.name,
      site_name: input.siteName,
      site_url: input.siteUrl,
      site_description: input.siteDescription,
      selling_points: JSON.stringify(input.sellingPoints),
      brand_voice: input.brandVoice,
      ctas: JSON.stringify(input.ctas),
      banned_phrases: JSON.stringify(defaultBannedPhrases(input.bannedPhrases)),
      default_language_policy: defaultLanguagePolicy(input.defaultLanguagePolicy),
      risk_policy: input.riskPolicy,
    });

  const row = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               brand_voice AS brandVoice, ctas AS ctas,
               banned_phrases AS bannedPhrases,
               default_language_policy AS defaultLanguagePolicy,
               risk_policy AS riskPolicy,
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
  ensureBrandVoiceColumn(database);
  ensureCtasColumn(database);
  ensureBannedPhrasesColumn(database);
  ensureDefaultLanguagePolicyColumn(database);
  ensureRiskPolicyColumn(database);
  return database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               brand_voice AS brandVoice, ctas AS ctas,
               banned_phrases AS bannedPhrases,
               default_language_policy AS defaultLanguagePolicy,
               risk_policy AS riskPolicy,
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

function getProjectById(database: DatabaseConnection, id: number): ProjectRecord | undefined {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  ensureBrandVoiceColumn(database);
  ensureCtasColumn(database);
  ensureBannedPhrasesColumn(database);
  ensureDefaultLanguagePolicyColumn(database);
  ensureRiskPolicyColumn(database);

  const row = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               brand_voice AS brandVoice, ctas AS ctas,
               banned_phrases AS bannedPhrases,
               default_language_policy AS defaultLanguagePolicy,
               risk_policy AS riskPolicy,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeProjectRow(row as Record<string, unknown>) : undefined;
}

function updateProject(
  database: DatabaseConnection,
  id: number,
  input: UpdateProjectInput,
): ProjectRecord | undefined {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  ensureBrandVoiceColumn(database);
  ensureCtasColumn(database);
  ensureBannedPhrasesColumn(database);
  ensureDefaultLanguagePolicyColumn(database);
  ensureRiskPolicyColumn(database);
  const currentRow = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               brand_voice AS brandVoice, ctas AS ctas,
               banned_phrases AS bannedPhrases,
               default_language_policy AS defaultLanguagePolicy,
               risk_policy AS riskPolicy,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE id = ?
      `,
    )
    .get([id]);

  if (!currentRow) {
    return undefined;
  }

  const current = normalizeProjectRow(currentRow as Record<string, unknown>);

  database
    .prepare(
      `
        UPDATE projects
        SET name = @name,
            site_name = @site_name,
            site_url = @site_url,
            site_description = @site_description,
            selling_points = @selling_points,
            brand_voice = @brand_voice,
            ctas = @ctas,
            banned_phrases = @banned_phrases,
            default_language_policy = @default_language_policy,
            risk_policy = @risk_policy
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
      brand_voice: input.brandVoice ?? current.brandVoice,
      ctas: JSON.stringify(input.ctas ?? current.ctas),
      banned_phrases: JSON.stringify(input.bannedPhrases ?? current.bannedPhrases),
      default_language_policy: input.defaultLanguagePolicy ?? current.defaultLanguagePolicy,
      risk_policy: input.riskPolicy ?? current.riskPolicy,
    });

  const row = database
    .prepare(
      `
        SELECT id, name, site_name AS siteName, site_url AS siteUrl,
               site_description AS siteDescription, selling_points AS sellingPoints,
               brand_voice AS brandVoice, ctas AS ctas,
               banned_phrases AS bannedPhrases,
               default_language_policy AS defaultLanguagePolicy,
               risk_policy AS riskPolicy,
               archived AS archived, archived_at AS archivedAt, created_at AS createdAt
        FROM projects
        WHERE id = ?
      `,
    )
    .get([id]);

  return row ? normalizeProjectRow(row as Record<string, unknown>) : undefined;
}

function archiveProject(database: DatabaseConnection, id: number): ProjectRecord | undefined {
  ensureArchivedColumn(database);
  ensureArchivedAtColumn(database);
  ensureBrandVoiceColumn(database);
  ensureCtasColumn(database);
  ensureBannedPhrasesColumn(database);
  ensureDefaultLanguagePolicyColumn(database);
  ensureRiskPolicyColumn(database);

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
               brand_voice AS brandVoice, ctas AS ctas,
               banned_phrases AS bannedPhrases,
               default_language_policy AS defaultLanguagePolicy,
               risk_policy AS riskPolicy,
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
    brandVoice: typeof row.brandVoice === 'string' ? row.brandVoice : '',
    ctas: parseCtas(row.ctas),
    bannedPhrases: parseBannedPhrases(row.bannedPhrases),
    defaultLanguagePolicy:
      typeof row.defaultLanguagePolicy === 'string' ? row.defaultLanguagePolicy : '',
    riskPolicy: parseRiskPolicy(row.riskPolicy),
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

function ensureBrandVoiceColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'brand_voice')) {
    return;
  }

  database.exec("ALTER TABLE projects ADD COLUMN brand_voice TEXT NOT NULL DEFAULT ''");
}

function ensureCtasColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'ctas')) {
    return;
  }

  database.exec("ALTER TABLE projects ADD COLUMN ctas TEXT NOT NULL DEFAULT '[]'");
}

function ensureBannedPhrasesColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'banned_phrases')) {
    return;
  }

  database.exec("ALTER TABLE projects ADD COLUMN banned_phrases TEXT NOT NULL DEFAULT '[]'");
}

function ensureDefaultLanguagePolicyColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'default_language_policy')) {
    return;
  }

  database.exec("ALTER TABLE projects ADD COLUMN default_language_policy TEXT NOT NULL DEFAULT ''");
}

function ensureRiskPolicyColumn(database: DatabaseConnection) {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: unknown }>;
  if (columns.some((column) => column.name === 'risk_policy')) {
    return;
  }

  database.exec("ALTER TABLE projects ADD COLUMN risk_policy TEXT NOT NULL DEFAULT 'requires_review'");
}

function parseSellingPoints(value: unknown): string[] {
  return parseStringArray(value);
}

function parseCtas(value: unknown): string[] {
  return parseStringArray(value);
}

function parseBannedPhrases(value: unknown): string[] {
  return parseStringArray(value);
}

function parseRiskPolicy(value: unknown): ProjectRiskPolicy {
  return value === 'auto_approve' ? 'auto_approve' : 'requires_review';
}

function parseStringArray(value: unknown): string[] {
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
