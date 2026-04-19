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
});
