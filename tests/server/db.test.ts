import { describe, expect, it } from 'vitest';

import { initDb } from '../../src/server/db';

describe('database schema', () => {
  it('creates the projects table in an in-memory database', () => {
    const db = initDb(':memory:');
    try {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        .get() as { name: string } | undefined;

      expect(row).toBeTruthy();
      expect(row?.name).toBe('projects');
    } finally {
      db.close();
    }
  });

  it('creates the persistent tables needed by the server', () => {
    const db = initDb(':memory:');
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('admin_sessions', 'projects', 'drafts', 'publish_logs', 'channel_accounts', 'settings') ORDER BY name",
        )
        .all() as Array<{ name: string }>;

      expect(rows.map((row) => row.name)).toEqual([
        'admin_sessions',
        'channel_accounts',
        'drafts',
        'projects',
        'publish_logs',
        'settings',
      ]);
    } finally {
      db.close();
    }
  });

  it('creates the admin_sessions table with the expected columns', () => {
    const db = initDb(':memory:');
    try {
      const columns = db
        .prepare("PRAGMA table_info(admin_sessions)")
        .all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toEqual([
        'token_hash',
        'expires_at',
        'created_at',
      ]);
    } finally {
      db.close();
    }
  });

  it('adds scheduledAt and publishedAt columns to drafts', () => {
    const db = initDb(':memory:');
    try {
      const columns = db
        .prepare("PRAGMA table_info(drafts)")
        .all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['scheduled_at', 'published_at']),
      );
    } finally {
      db.close();
    }
  });

  it('adds archived and brand fields to projects', () => {
    const db = initDb(':memory:');
    try {
      const columns = db
        .prepare("PRAGMA table_info(projects)")
        .all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'brand_voice',
          'ctas',
          'banned_phrases',
          'default_language_policy',
          'risk_policy',
          'archived',
          'archived_at',
        ]),
      );
    } finally {
      db.close();
    }
  });

  it('creates projects with the runtime project fields and defaults', () => {
    const db = initDb(':memory:');
    try {
      const columns = db
        .prepare("PRAGMA table_info(projects)")
        .all() as Array<{ name: string }>;

      expect(columns.map((column) => column.name)).toEqual([
        'id',
        'name',
        'site_name',
        'site_url',
        'site_description',
        'selling_points',
        'created_at',
        'archived',
        'archived_at',
        'brand_voice',
        'ctas',
        'banned_phrases',
        'default_language_policy',
        'risk_policy',
      ]);

      db.prepare(
        `
          INSERT INTO projects (
            name,
            site_name,
            site_url,
            site_description,
            selling_points
          )
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run([
        'Fresh Schema Project',
        'PromoBot',
        'https://example.com',
        'Schema coverage',
        '["Fast setup"]',
      ]);

      const row = db
        .prepare(
          `
            SELECT brand_voice AS brandVoice,
                   ctas,
                   banned_phrases,
                   default_language_policy,
                   risk_policy AS riskPolicy,
                   archived,
                   archived_at AS archivedAt
            FROM projects
            WHERE id = 1
          `,
        )
        .get() as
        | {
            brandVoice: string;
            ctas: string;
            riskPolicy: string;
            archived: number;
            archivedAt: string | null;
          }
        | undefined;

      expect(row).toEqual({
        brandVoice: '',
        ctas: '[]',
        banned_phrases: '[]',
        default_language_policy: '',
        riskPolicy: 'requires_review',
        archived: 0,
        archivedAt: null,
      });
    } finally {
      db.close();
    }
  });
});
