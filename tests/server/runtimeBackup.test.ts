import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { setDatabasePath } from '../../src/server/lib/persistence';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

type RuntimeBackupModule = {
  applyRuntimeBackupExitCode: (summary: { ok: boolean } | null) => void;
  getRuntimeBackupHelpText: () => string;
  parseRuntimeBackupArgs: (argv: string[]) => {
    outputDir?: string;
    showHelp?: boolean;
  };
  runRuntimeBackupCli: (
    argv: string[],
    dependencies?: {
      now?: () => Date;
      repoRootDir?: string;
      stdout?: Pick<NodeJS.WriteStream, 'write'>;
    },
  ) => Promise<unknown>;
};

async function loadRuntimeBackupModule(): Promise<RuntimeBackupModule | null> {
  try {
    const modulePath = '../../src/server/cli/runtimeBackup';
    return (await import(modulePath)) as RuntimeBackupModule;
  } catch {
    return null;
  }
}

function createStdoutBuffer() {
  let stdout = '';

  return {
    stdout: {
      write(chunk: string) {
        stdout += chunk;
        return true;
      },
    },
    read() {
      return stdout;
    },
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('runtime backup cli', () => {
  it('parses cli flags and exposes help text', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();

    expect(runtimeBackup).not.toBeNull();
    expect(runtimeBackup?.parseRuntimeBackupArgs([])).toEqual({});
    expect(runtimeBackup?.parseRuntimeBackupArgs(['--output-dir', '/tmp/runtime-backup'])).toEqual({
      outputDir: '/tmp/runtime-backup',
    });
    expect(runtimeBackup?.parseRuntimeBackupArgs(['--help'])).toEqual({
      showHelp: true,
    });
    expect(runtimeBackup?.parseRuntimeBackupArgs(['--', '--help'])).toEqual({
      showHelp: true,
    });
    expect(() => runtimeBackup?.parseRuntimeBackupArgs(['--output-dir'])).toThrow(
      '--output-dir requires a value',
    );
    expect(() =>
      runtimeBackup?.parseRuntimeBackupArgs(['--output-dir', '   ']),
    ).toThrow('--output-dir requires a value');
    await expect(
      runtimeBackup?.runRuntimeBackupCli(['--output-dir', '   ']),
    ).rejects.toThrow('--output-dir requires a value');
    expect(runtimeBackup?.getRuntimeBackupHelpText()).toContain(
      'Usage: tsx src/server/cli/runtimeBackup.ts [options]',
    );

    const stdout = createStdoutBuffer();
    const summary = await runtimeBackup?.runRuntimeBackupCli(['--help'], stdout);

    expect(summary).toBeNull();
    expect(stdout.read()).toContain('--output-dir <path>');
  });

  it('copies existing runtime files into the default timestamped backup directory', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'sqlite-data', 'utf8');

      const browserSessionsDir = path.join(testDatabase.rootDir, 'browser-sessions');
      fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
      fs.writeFileSync(
        path.join(browserSessionsDir, 'managed', 'session.json'),
        JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }] }, null, 2),
        'utf8',
      );

      fs.writeFileSync(path.join(testDatabase.rootDir, '.env'), 'ADMIN_PASSWORD=secret\n', 'utf8');

      const stdout = createStdoutBuffer();
      const summary = (await runtimeBackup?.runRuntimeBackupCli([], {
        now: () => new Date('2026-04-24T12:34:56.789Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        copied: Array<{
          destinationPath: string;
          kind: string;
          sourcePath: string;
          type: string;
        }>;
        createdAt: string;
        manifestPath: string;
        missing: unknown[];
        outputDir: string;
        repoRoot: string;
      };

      const outputDir = path.join(testDatabase.rootDir, 'backups', '2026-04-24T12-34-56.789Z');

      expect(summary).toEqual({
        ok: true,
        createdAt: '2026-04-24T12:34:56.789Z',
        repoRoot: testDatabase.rootDir,
        outputDir,
        manifestPath: path.join(outputDir, 'manifest.json'),
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: path.join(outputDir, 'database', 'promobot.sqlite'),
          },
          {
            kind: 'browserSessions',
            type: 'directory',
            sourcePath: browserSessionsDir,
            destinationPath: path.join(outputDir, 'browser-sessions'),
          },
          {
            kind: 'envFile',
            type: 'file',
            sourcePath: path.join(testDatabase.rootDir, '.env'),
            destinationPath: path.join(outputDir, '.env'),
          },
        ],
        missing: [],
      });

      expect(fs.readFileSync(path.join(outputDir, 'database', 'promobot.sqlite'), 'utf8')).toBe(
        'sqlite-data',
      );
      expect(
        fs.readFileSync(path.join(outputDir, 'browser-sessions', 'managed', 'session.json'), 'utf8'),
      ).toContain('"sid"');
      expect(fs.readFileSync(path.join(outputDir, '.env'), 'utf8')).toBe('ADMIN_PASSWORD=secret\n');

      expect(JSON.parse(fs.readFileSync(summary.manifestPath, 'utf8'))).toEqual(summary);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('backs up browser sessions from the SQLite file directory when the database lives under data/', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const databasePath = path.join(testDatabase.rootDir, 'data', 'promobot.sqlite');
      setDatabasePath(databasePath);

      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.writeFileSync(databasePath, 'sqlite-data', 'utf8');

      const browserSessionsDir = path.join(testDatabase.rootDir, 'data', 'browser-sessions');
      fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
      fs.writeFileSync(
        path.join(browserSessionsDir, 'managed', 'session.json'),
        JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }] }, null, 2),
        'utf8',
      );

      const stdout = createStdoutBuffer();
      const summary = (await runtimeBackup?.runRuntimeBackupCli([], {
        now: () => new Date('2026-04-24T16:00:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        copied: Array<{
          destinationPath: string;
          kind: string;
          sourcePath: string;
          type: string;
        }>;
      };

      expect(summary.copied).toContainEqual({
        kind: 'browserSessions',
        type: 'directory',
        sourcePath: browserSessionsDir,
        destinationPath: path.join(
          testDatabase.rootDir,
          'backups',
          '2026-04-24T16-00-00.000Z',
          'browser-sessions',
        ),
      });
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('backs up the real SQLite file for file-like PROMOBOT_DB_PATH and keeps the cwd browser-sessions fallback', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const databasePath = path.join(testDatabase.rootDir, 'sqlite', 'runtime-db.sqlite');
      setDatabasePath(pathToFileURL(databasePath).href);
      const previousCwd = process.cwd();
      process.chdir(testDatabase.rootDir);

      try {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        fs.writeFileSync(databasePath, 'sqlite-data', 'utf8');
        fs.writeFileSync(path.join(testDatabase.rootDir, '.env'), 'ADMIN_PASSWORD=secret\n', 'utf8');

        const browserSessionsDir = path.join(testDatabase.rootDir, 'data', 'browser-sessions');
        fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
        fs.writeFileSync(
          path.join(browserSessionsDir, 'managed', 'session.json'),
          JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }] }, null, 2),
          'utf8',
        );

        const stdout = createStdoutBuffer();
        const summary = (await runtimeBackup?.runRuntimeBackupCli([], {
          now: () => new Date('2026-04-24T17:00:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        })) as {
          copied: Array<{
            destinationPath: string;
            kind: string;
            sourcePath: string;
            type: string;
          }>;
          ok: boolean;
          missing: Array<{
            expectedPath: string;
            kind: string;
            type: string;
          }>;
        };

        expect(summary.ok).toBe(true);
        expect(summary.copied).toContainEqual({
          kind: 'database',
          type: 'file',
          sourcePath: databasePath,
          destinationPath: path.join(
            testDatabase.rootDir,
            'backups',
            '2026-04-24T17-00-00.000Z',
            'database',
            'runtime-db.sqlite',
          ),
        });
        expect(summary.copied).toContainEqual({
          kind: 'browserSessions',
          type: 'directory',
          sourcePath: fs.realpathSync(browserSessionsDir),
          destinationPath: path.join(
            testDatabase.rootDir,
            'backups',
            '2026-04-24T17-00-00.000Z',
            'browser-sessions',
          ),
        });
        expect(summary.copied).toContainEqual({
          kind: 'envFile',
          type: 'file',
          sourcePath: path.join(testDatabase.rootDir, '.env'),
          destinationPath: path.join(
            testDatabase.rootDir,
            'backups',
            '2026-04-24T17-00-00.000Z',
            '.env',
          ),
        });
        expect(summary.missing).toEqual([]);
        expect(JSON.parse(stdout.read())).toEqual(summary);
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('uses cwd/data/browser-sessions and marks the database missing when PROMOBOT_DB_PATH is :memory:', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      setDatabasePath(':memory:');
      const previousCwd = process.cwd();
      process.chdir(testDatabase.rootDir);

      try {
        const browserSessionsDir = path.join(testDatabase.rootDir, 'data', 'browser-sessions');
        fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
        fs.writeFileSync(
          path.join(browserSessionsDir, 'managed', 'session.json'),
          JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }] }, null, 2),
          'utf8',
        );

        const stdout = createStdoutBuffer();
        const summary = (await runtimeBackup?.runRuntimeBackupCli([], {
          now: () => new Date('2026-04-24T18:00:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        })) as {
          copied: Array<{
            destinationPath: string;
            kind: string;
            sourcePath: string;
            type: string;
          }>;
          ok: boolean;
        };

        expect(summary.ok).toBe(false);
        expect(summary.copied).toContainEqual({
          kind: 'browserSessions',
          type: 'directory',
          sourcePath: fs.realpathSync(browserSessionsDir),
          destinationPath: path.join(
            testDatabase.rootDir,
            'backups',
            '2026-04-24T18-00-00.000Z',
            'browser-sessions',
          ),
        });
        expect(summary.missing).toContainEqual({
          kind: 'database',
          type: 'file',
          expectedPath: ':memory:',
        });
        expect(JSON.parse(stdout.read())).toEqual(summary);
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('records missing runtime items and honors a custom output directory', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const outputDir = path.join(testDatabase.rootDir, 'snapshots', 'manual-backup');
      const stdout = createStdoutBuffer();
      const summary = (await runtimeBackup?.runRuntimeBackupCli(
        ['--output-dir', outputDir],
        {
          now: () => new Date('2026-04-24T15:00:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        },
      )) as {
        copied: unknown[];
        createdAt: string;
        manifestPath: string;
        missing: Array<{
          expectedPath: string;
          kind: string;
          type: string;
        }>;
        outputDir: string;
        repoRoot: string;
      };

      expect(summary).toEqual({
        ok: false,
        createdAt: '2026-04-24T15:00:00.000Z',
        repoRoot: testDatabase.rootDir,
        outputDir,
        manifestPath: path.join(outputDir, 'manifest.json'),
        copied: [],
        missing: [
          {
            kind: 'database',
            type: 'file',
            expectedPath: testDatabase.databasePath,
          },
          {
            kind: 'browserSessions',
            type: 'directory',
            expectedPath: path.join(testDatabase.rootDir, 'browser-sessions'),
          },
          {
            kind: 'envFile',
            type: 'file',
            expectedPath: path.join(testDatabase.rootDir, '.env'),
          },
        ],
      });

      expect(fs.existsSync(outputDir)).toBe(true);
      expect(JSON.parse(fs.readFileSync(summary.manifestPath, 'utf8'))).toEqual(summary);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('rejects a custom output directory when it already contains backup artifacts', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const outputDir = path.join(testDatabase.rootDir, 'snapshots', 'manual-backup');
      const staleManifestPath = path.join(outputDir, 'manifest.json');
      const staleBrowserSessionPath = path.join(
        outputDir,
        'browser-sessions',
        'managed',
        'stale.json',
      );
      fs.mkdirSync(path.dirname(staleBrowserSessionPath), { recursive: true });
      fs.writeFileSync(staleManifestPath, '{"ok":true}', 'utf8');
      fs.writeFileSync(staleBrowserSessionPath, '{"stale":true}', 'utf8');

      const stdout = createStdoutBuffer();

      await expect(
        runtimeBackup?.runRuntimeBackupCli(['--output-dir', outputDir], {
          now: () => new Date('2026-04-24T15:00:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        }),
      ).rejects.toThrow(`runtime backup output directory must be empty: ${outputDir}`);

      expect(stdout.read()).toBe('');
      expect(fs.readFileSync(staleManifestPath, 'utf8')).toBe('{"ok":true}');
      expect(fs.readFileSync(staleBrowserSessionPath, 'utf8')).toBe('{"stale":true}');
      expect(fs.existsSync(path.join(outputDir, 'database'))).toBe(false);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('allows reusing an existing empty custom output directory', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const outputDir = path.join(testDatabase.rootDir, 'snapshots', 'manual-backup');
      const databasePath = path.join(testDatabase.rootDir, 'data', 'promobot.sqlite');
      const browserSessionsDir = path.join(testDatabase.rootDir, 'data', 'browser-sessions');
      setDatabasePath(databasePath);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
      fs.writeFileSync(databasePath, 'sqlite-data', 'utf8');
      fs.writeFileSync(
        path.join(browserSessionsDir, 'managed', 'session.json'),
        JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }] }, null, 2),
        'utf8',
      );
      fs.writeFileSync(path.join(testDatabase.rootDir, '.env'), 'ADMIN_PASSWORD=secret\n', 'utf8');

      const stdout = createStdoutBuffer();
      const summary = (await runtimeBackup?.runRuntimeBackupCli(['--output-dir', outputDir], {
        now: () => new Date('2026-04-24T15:30:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        copied: Array<{
          destinationPath: string;
          kind: string;
          sourcePath: string;
          type: string;
        }>;
        manifestPath: string;
        missing: unknown[];
        ok: boolean;
      };

      expect(summary.ok).toBe(true);
      expect(summary.missing).toEqual([]);
      expect(summary.copied).toContainEqual({
        kind: 'database',
        type: 'file',
        sourcePath: databasePath,
        destinationPath: path.join(outputDir, 'database', 'promobot.sqlite'),
      });
      expect(summary.copied).toContainEqual({
        kind: 'browserSessions',
        type: 'directory',
        sourcePath: browserSessionsDir,
        destinationPath: path.join(outputDir, 'browser-sessions'),
      });
      expect(summary.copied).toContainEqual({
        kind: 'envFile',
        type: 'file',
        sourcePath: path.join(testDatabase.rootDir, '.env'),
        destinationPath: path.join(outputDir, '.env'),
      });
      expect(JSON.parse(fs.readFileSync(summary.manifestPath, 'utf8'))).toEqual(summary);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('rejects a custom output path when it already exists as a file', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const outputFilePath = path.join(testDatabase.rootDir, 'snapshots', 'manual-backup.json');
      fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
      fs.writeFileSync(outputFilePath, '{"existing":true}', 'utf8');

      const stdout = createStdoutBuffer();

      await expect(
        runtimeBackup?.runRuntimeBackupCli(['--output-dir', outputFilePath], {
          now: () => new Date('2026-04-24T15:45:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        }),
      ).rejects.toThrow(`runtime backup output path must be a directory: ${outputFilePath}`);

      expect(stdout.read()).toBe('');
      expect(fs.readFileSync(outputFilePath, 'utf8')).toBe('{"existing":true}');
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('sets a non-zero exit code for incomplete backups', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();

    expect(runtimeBackup).not.toBeNull();

    runtimeBackup?.applyRuntimeBackupExitCode({ ok: false });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    runtimeBackup?.applyRuntimeBackupExitCode({ ok: true });
    expect(process.exitCode).toBeUndefined();
  });

  it('resolves relative PROMOBOT_DB_PATH against the current working directory', async () => {
    const runtimeBackup = await loadRuntimeBackupModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeBackup).not.toBeNull();

    try {
      const runtimeDir = path.join(testDatabase.rootDir, 'runtime-cwd');
      fs.mkdirSync(runtimeDir, { recursive: true });

      setDatabasePath('./data/promobot.sqlite');
      const previousCwd = process.cwd();
      process.chdir(runtimeDir);

      try {
        const databasePath = path.join(runtimeDir, 'data', 'promobot.sqlite');
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        fs.writeFileSync(databasePath, 'sqlite-data', 'utf8');

        const browserSessionsDir = path.join(runtimeDir, 'data', 'browser-sessions');
        fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
        fs.writeFileSync(
          path.join(browserSessionsDir, 'managed', 'session.json'),
          JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }] }, null, 2),
          'utf8',
        );

        const stdout = createStdoutBuffer();
        const summary = (await runtimeBackup?.runRuntimeBackupCli([], {
          now: () => new Date('2026-04-24T19:00:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        })) as {
          copied: Array<{
            destinationPath: string;
            kind: string;
            sourcePath: string;
            type: string;
          }>;
        };

        expect(summary.copied).toContainEqual({
          kind: 'database',
          type: 'file',
          sourcePath: fs.realpathSync(databasePath),
          destinationPath: path.join(
            testDatabase.rootDir,
            'backups',
            '2026-04-24T19-00-00.000Z',
            'database',
            'promobot.sqlite',
          ),
        });
        expect(summary.copied).toContainEqual({
          kind: 'browserSessions',
          type: 'directory',
          sourcePath: fs.realpathSync(browserSessionsDir),
          destinationPath: path.join(
            testDatabase.rootDir,
            'backups',
            '2026-04-24T19-00-00.000Z',
            'browser-sessions',
          ),
        });
        expect(JSON.parse(stdout.read())).toEqual(summary);
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });
});
