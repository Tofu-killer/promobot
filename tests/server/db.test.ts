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
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'drafts', 'channel_accounts', 'settings') ORDER BY name",
        )
        .all() as Array<{ name: string }>;

      expect(rows.map((row) => row.name)).toEqual([
        'channel_accounts',
        'drafts',
        'projects',
        'settings',
      ]);
    } finally {
      db.close();
    }
  });
});
