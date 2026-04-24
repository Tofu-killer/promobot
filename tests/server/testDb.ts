import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

export function isolateProcessCwd() {
  const previousCwd = process.cwd();
  const cwdDir = mkdtempSync(path.join(tmpdir(), 'promobot-cwd-'));
  const schemaSourcePath = path.join(previousCwd, 'database', 'schema.sql');
  const schemaTargetPath = path.join(cwdDir, 'database', 'schema.sql');

  mkdirSync(path.dirname(schemaTargetPath), { recursive: true });
  copyFileSync(schemaSourcePath, schemaTargetPath);
  process.chdir(cwdDir);

  return () => {
    process.chdir(previousCwd);
    rmSync(cwdDir, { force: true, recursive: true });
  };
}
