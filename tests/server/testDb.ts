import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetDatabasePath, setDatabasePath } from '../../src/server/lib/persistence';

export function createTestDatabasePath() {
  resetDatabasePath();
  const rootDir = mkdtempSync(path.join(tmpdir(), 'promobot-db-'));
  const databasePath = path.join(rootDir, 'promobot.sqlite');

  setDatabasePath(databasePath);

  return {
    databasePath,
    rootDir,
  };
}

export function cleanupTestDatabasePath(rootDir: string) {
  resetDatabasePath();
  rmSync(rootDir, { force: true, recursive: true });
}
