import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

type RuntimeRestoreModule = {
  applyRuntimeRestoreExitCode: (summary: { ok: boolean } | null) => void;
  getRuntimeRestoreHelpText: () => string;
  parseRuntimeRestoreArgs: (argv: string[]) => {
    inputDir?: string;
    showHelp?: boolean;
    skipEnv?: boolean;
  };
  runRuntimeRestoreCli: (
    argv: string[],
    dependencies?: {
      now?: () => Date;
      repoRootDir?: string;
      stdout?: Pick<NodeJS.WriteStream, 'write'>;
    },
  ) => Promise<unknown>;
};

type ManifestCopiedItem = {
  kind: 'database' | 'browserSessions' | 'envFile';
  type: 'file' | 'directory';
  sourcePath: string;
  destinationPath: string;
};

async function loadRuntimeRestoreModule(): Promise<RuntimeRestoreModule | null> {
  try {
    const modulePath = '../../src/server/cli/runtimeRestore';
    return (await import(modulePath)) as RuntimeRestoreModule;
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

function writeBackupManifest(options: {
  copied: ManifestCopiedItem[];
  inputDir: string;
  recordedOutputDir?: string;
  ok?: boolean;
  missing?: Array<{
    kind: 'database' | 'browserSessions' | 'envFile';
    type: 'file' | 'directory';
    expectedPath: string;
  }>;
}) {
  const manifest = {
    ok: options.ok ?? true,
    createdAt: '2026-04-24T12:34:56.789Z',
    repoRoot: path.dirname(options.copied[0]?.sourcePath ?? options.inputDir),
    outputDir: options.recordedOutputDir ?? options.inputDir,
    manifestPath: path.join(options.recordedOutputDir ?? options.inputDir, 'manifest.json'),
    copied: options.copied,
    missing: options.missing ?? [],
  };

  fs.mkdirSync(options.inputDir, { recursive: true });
  fs.writeFileSync(path.join(options.inputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return manifest;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('runtime restore cli', () => {
  it('parses cli flags and exposes help text', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();

    expect(runtimeRestore).not.toBeNull();
    expect(runtimeRestore?.parseRuntimeRestoreArgs([])).toEqual({});
    expect(runtimeRestore?.parseRuntimeRestoreArgs(['--input-dir', '/tmp/runtime-backup'])).toEqual({
      inputDir: '/tmp/runtime-backup',
    });
    expect(
      runtimeRestore?.parseRuntimeRestoreArgs(['--input-dir', '/tmp/runtime-backup', '--skip-env']),
    ).toEqual({
      inputDir: '/tmp/runtime-backup',
      skipEnv: true,
    });
    expect(runtimeRestore?.parseRuntimeRestoreArgs(['--help'])).toEqual({
      showHelp: true,
    });
    expect(runtimeRestore?.parseRuntimeRestoreArgs(['--', '--help'])).toEqual({
      showHelp: true,
    });
    expect(() => runtimeRestore?.parseRuntimeRestoreArgs(['--input-dir'])).toThrow(
      '--input-dir requires a value',
    );
    expect(runtimeRestore?.getRuntimeRestoreHelpText()).toContain(
      'Usage: tsx src/server/cli/runtimeRestore.ts [options]',
    );

    const stdout = createStdoutBuffer();
    const summary = await runtimeRestore?.runRuntimeRestoreCli(['--help'], {
      stdout: stdout.stdout,
    });

    expect(summary).toBeNull();
    expect(stdout.read()).toContain('--input-dir <path>');
    await expect(
      runtimeRestore?.runRuntimeRestoreCli([], {
        stdout: stdout.stdout,
      }),
    ).rejects.toThrow('--input-dir is required');
  });

  it('rejects invalid top-level manifest shapes', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const manifestPath = path.join(inputDir, 'manifest.json');
      const stdout = createStdoutBuffer();

      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(manifestPath, '[]', 'utf8');

      await expect(
        runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        }),
      ).rejects.toThrow(`invalid manifest: ${manifestPath}`);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('restores runtime files into their original source paths and creates pre-restore backups', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const recordedOutputDir = path.join(testDatabase.rootDir, 'backups', 'original-location');
      const browserSessionsDir = path.join(testDatabase.rootDir, 'browser-sessions');
      const envFilePath = path.join(testDatabase.rootDir, '.env');

      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'old-db', 'utf8');
      fs.mkdirSync(path.join(browserSessionsDir, 'managed'), { recursive: true });
      fs.writeFileSync(
        path.join(browserSessionsDir, 'managed', 'session.json'),
        JSON.stringify({ cookies: [{ name: 'sid', value: 'old' }] }, null, 2),
        'utf8',
      );
      fs.writeFileSync(envFilePath, 'ADMIN_PASSWORD=old\n', 'utf8');

      const databaseBackupPath = path.join(inputDir, 'database', 'promobot.sqlite');
      const browserSessionsBackupPath = path.join(inputDir, 'browser-sessions');
      const envBackupPath = path.join(inputDir, '.env');

      fs.mkdirSync(path.dirname(databaseBackupPath), { recursive: true });
      fs.writeFileSync(databaseBackupPath, 'new-db', 'utf8');
      fs.mkdirSync(path.join(browserSessionsBackupPath, 'managed'), { recursive: true });
      fs.writeFileSync(
        path.join(browserSessionsBackupPath, 'managed', 'session.json'),
        JSON.stringify({ cookies: [{ name: 'sid', value: 'new' }] }, null, 2),
        'utf8',
      );
      fs.writeFileSync(envBackupPath, 'ADMIN_PASSWORD=new\n', 'utf8');

      writeBackupManifest({
        inputDir,
        recordedOutputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: path.join(recordedOutputDir, 'database', 'promobot.sqlite'),
          },
          {
            kind: 'browserSessions',
            type: 'directory',
            sourcePath: browserSessionsDir,
            destinationPath: path.join(recordedOutputDir, 'browser-sessions'),
          },
          {
            kind: 'envFile',
            type: 'file',
            sourcePath: envFilePath,
            destinationPath: path.join(recordedOutputDir, '.env'),
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T20:00:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        backupsCreated: Array<{
          backupPath: string;
          kind: string;
          originalPath: string;
          type: string;
        }>;
        inputDir: string;
        manifestPath: string;
        missing: unknown[];
        repoRoot: string;
        restored: Array<{
          backupPath: string;
          kind: string;
          targetPath: string;
          type: string;
        }>;
        restoredAt: string;
        skipped: unknown[];
      };

      expect(summary).toEqual({
        ok: true,
        restoredAt: '2026-04-24T20:00:00.000Z',
        repoRoot: testDatabase.rootDir,
        inputDir,
        manifestPath: path.join(inputDir, 'manifest.json'),
        restored: [
          {
            kind: 'database',
            type: 'file',
            backupPath: databaseBackupPath,
            targetPath: testDatabase.databasePath,
          },
          {
            kind: 'browserSessions',
            type: 'directory',
            backupPath: browserSessionsBackupPath,
            targetPath: browserSessionsDir,
          },
          {
            kind: 'envFile',
            type: 'file',
            backupPath: envBackupPath,
            targetPath: envFilePath,
          },
        ],
        skipped: [],
        missing: [],
        backupsCreated: [
          {
            kind: 'database',
            type: 'file',
            originalPath: testDatabase.databasePath,
            backupPath: `${testDatabase.databasePath}.pre-restore-2026-04-24T20-00-00.000Z`,
          },
          {
            kind: 'browserSessions',
            type: 'directory',
            originalPath: browserSessionsDir,
            backupPath: `${browserSessionsDir}.pre-restore-2026-04-24T20-00-00.000Z`,
          },
          {
            kind: 'envFile',
            type: 'file',
            originalPath: envFilePath,
            backupPath: `${envFilePath}.pre-restore-2026-04-24T20-00-00.000Z`,
          },
        ],
      });

      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('new-db');
      expect(
        fs.readFileSync(path.join(browserSessionsDir, 'managed', 'session.json'), 'utf8'),
      ).toContain('"new"');
      expect(fs.readFileSync(envFilePath, 'utf8')).toBe('ADMIN_PASSWORD=new\n');

      expect(
        fs.readFileSync(`${testDatabase.databasePath}.pre-restore-2026-04-24T20-00-00.000Z`, 'utf8'),
      ).toBe('old-db');
      expect(
        fs.readFileSync(
          path.join(
            `${browserSessionsDir}.pre-restore-2026-04-24T20-00-00.000Z`,
            'managed',
            'session.json',
          ),
          'utf8',
        ),
      ).toContain('"old"');
      expect(
        fs.readFileSync(`${envFilePath}.pre-restore-2026-04-24T20-00-00.000Z`, 'utf8'),
      ).toBe('ADMIN_PASSWORD=old\n');

      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('supports --skip-env and creates parent directories for missing restore targets', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const databasePath = path.join(testDatabase.rootDir, 'runtime', 'data', 'promobot.sqlite');
      const envFilePath = path.join(testDatabase.rootDir, '.env');
      const databaseBackupPath = path.join(inputDir, 'database', 'promobot.sqlite');
      const envBackupPath = path.join(inputDir, '.env');

      fs.mkdirSync(path.dirname(databaseBackupPath), { recursive: true });
      fs.writeFileSync(databaseBackupPath, 'restored-db', 'utf8');
      fs.writeFileSync(envBackupPath, 'ADMIN_PASSWORD=new\n', 'utf8');
      fs.writeFileSync(envFilePath, 'ADMIN_PASSWORD=old\n', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: databasePath,
            destinationPath: databaseBackupPath,
          },
          {
            kind: 'envFile',
            type: 'file',
            sourcePath: envFilePath,
            destinationPath: envBackupPath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(
        ['--input-dir', inputDir, '--skip-env'],
        {
          now: () => new Date('2026-04-24T21:00:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        },
      )) as {
        backupsCreated: unknown[];
        missing: unknown[];
        restored: Array<{
          backupPath: string;
          kind: string;
          targetPath: string;
          type: string;
        }>;
        skipped: Array<{
          backupPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
      };

      expect(summary.ok).toBe(true);
      expect(summary.restored).toEqual([
        {
          kind: 'database',
          type: 'file',
          backupPath: databaseBackupPath,
          targetPath: databasePath,
        },
      ]);
      expect(summary.skipped).toEqual([
        {
          kind: 'envFile',
          type: 'file',
          backupPath: envBackupPath,
          targetPath: envFilePath,
          reason: 'skip-env',
        },
      ]);
      expect(summary.missing).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(fs.readFileSync(databasePath, 'utf8')).toBe('restored-db');
      expect(fs.readFileSync(envFilePath, 'utf8')).toBe('ADMIN_PASSWORD=old\n');
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('allows --skip-env to restore from a manifest that is incomplete only because .env is missing', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const envFilePath = path.join(testDatabase.rootDir, '.env');
      const databaseBackupPath = path.join(inputDir, 'database', 'promobot.sqlite');

      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');
      fs.writeFileSync(envFilePath, 'ADMIN_PASSWORD=old\n', 'utf8');
      fs.mkdirSync(path.dirname(databaseBackupPath), { recursive: true });
      fs.writeFileSync(databaseBackupPath, 'restored-db', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: databaseBackupPath,
          },
        ],
        ok: false,
        missing: [
          {
            kind: 'envFile',
            type: 'file',
            expectedPath: envFilePath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(
        ['--input-dir', inputDir, '--skip-env'],
        {
          now: () => new Date('2026-04-24T20:30:00.000Z'),
          repoRootDir: testDatabase.rootDir,
          stdout: stdout.stdout,
        },
      )) as {
        backupsCreated: Array<{
          backupPath: string;
          kind: string;
          originalPath: string;
          type: string;
        }>;
        inputDir: string;
        manifestPath: string;
        missing: unknown[];
        repoRoot: string;
        restored: Array<{
          backupPath: string;
          kind: string;
          targetPath: string;
          type: string;
        }>;
        restoredAt: string;
        skipped: unknown[];
      };

      expect(summary).toEqual({
        ok: true,
        restoredAt: '2026-04-24T20:30:00.000Z',
        repoRoot: testDatabase.rootDir,
        inputDir,
        manifestPath: path.join(inputDir, 'manifest.json'),
        restored: [
          {
            kind: 'database',
            type: 'file',
            backupPath: databaseBackupPath,
            targetPath: testDatabase.databasePath,
          },
        ],
        skipped: [],
        missing: [],
        backupsCreated: [
          {
            kind: 'database',
            type: 'file',
            originalPath: testDatabase.databasePath,
            backupPath: `${testDatabase.databasePath}.pre-restore-2026-04-24T20-30-00.000Z`,
          },
        ],
      });

      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('restored-db');
      expect(fs.readFileSync(envFilePath, 'utf8')).toBe('ADMIN_PASSWORD=old\n');
      expect(fs.existsSync(`${envFilePath}.pre-restore-2026-04-24T20-30-00.000Z`)).toBe(false);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('records missing backup items without touching existing restore targets', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const databaseBackupPath = path.join(inputDir, 'database', 'promobot.sqlite');

      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: databaseBackupPath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T22:00:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        backupsCreated: unknown[];
        missing: Array<{
          expectedPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
        restored: unknown[];
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([
        {
          kind: 'database',
          type: 'file',
          expectedPath: databaseBackupPath,
          targetPath: testDatabase.databasePath,
          reason: 'backup-missing',
        },
      ]);
      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('current-db');
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('treats backup payload type mismatches as missing and leaves restore targets untouched', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const databaseBackupPath = path.join(inputDir, 'database', 'promobot.sqlite');
      const preRestoreBackupPath = `${testDatabase.databasePath}.pre-restore-2026-04-24T22-15-00.000Z`;

      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');
      fs.mkdirSync(databaseBackupPath, { recursive: true });
      fs.writeFileSync(path.join(databaseBackupPath, 'nested.txt'), 'wrong-shape', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: databaseBackupPath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T22:15:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        backupsCreated: unknown[];
        missing: Array<{
          expectedPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
        restored: unknown[];
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([
        {
          kind: 'database',
          type: 'file',
          expectedPath: databaseBackupPath,
          targetPath: testDatabase.databasePath,
          reason: 'backup-missing',
        },
      ]);
      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('current-db');
      expect(fs.existsSync(preRestoreBackupPath)).toBe(false);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('refuses partial restores when a later backup entry is missing', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const envFilePath = path.join(testDatabase.rootDir, '.env');
      const databaseBackupPath = path.join(inputDir, 'database', 'promobot.sqlite');
      const missingEnvBackupPath = path.join(inputDir, '.env');

      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');
      fs.writeFileSync(envFilePath, 'ADMIN_PASSWORD=current\n', 'utf8');

      fs.mkdirSync(path.dirname(databaseBackupPath), { recursive: true });
      fs.writeFileSync(databaseBackupPath, 'restored-db', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: databaseBackupPath,
          },
          {
            kind: 'envFile',
            type: 'file',
            sourcePath: envFilePath,
            destinationPath: missingEnvBackupPath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T22:30:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        backupsCreated: unknown[];
        missing: Array<{
          expectedPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
        restored: unknown[];
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([
        {
          kind: 'envFile',
          type: 'file',
          expectedPath: missingEnvBackupPath,
          targetPath: envFilePath,
          reason: 'backup-missing',
        },
      ]);
      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('current-db');
      expect(fs.readFileSync(envFilePath, 'utf8')).toBe('ADMIN_PASSWORD=current\n');
      expect(fs.existsSync(`${testDatabase.databasePath}.pre-restore-2026-04-24T22-30-00.000Z`)).toBe(
        false,
      );
      expect(fs.existsSync(`${envFilePath}.pre-restore-2026-04-24T22-30-00.000Z`)).toBe(false);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('rejects restore targets that escape the repo root recorded for the backup', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();
    const outsideRootDir = path.dirname(testDatabase.rootDir);
    const escapeTargetPath = path.join(
      outsideRootDir,
      `${path.basename(testDatabase.rootDir)}-escape-target.txt`,
    );
    const preRestoreBackupPath = `${escapeTargetPath}.pre-restore-2026-04-24T22-45-00.000Z`;

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const backupPayloadPath = path.join(inputDir, 'database', 'promobot.sqlite');

      fs.writeFileSync(escapeTargetPath, 'outside-current', 'utf8');
      fs.mkdirSync(path.dirname(backupPayloadPath), { recursive: true });
      fs.writeFileSync(backupPayloadPath, 'outside-restored', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: escapeTargetPath,
            destinationPath: backupPayloadPath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T22:45:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        backupsCreated: unknown[];
        missing: Array<{
          expectedPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
        restored: unknown[];
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([
        {
          kind: 'database',
          type: 'file',
          expectedPath: escapeTargetPath,
          targetPath: escapeTargetPath,
          reason: 'backup-incomplete',
        },
      ]);
      expect(fs.readFileSync(escapeTargetPath, 'utf8')).toBe('outside-current');
      expect(fs.existsSync(preRestoreBackupPath)).toBe(false);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      fs.rmSync(escapeTargetPath, { force: true });
      fs.rmSync(preRestoreBackupPath, { force: true });
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('rejects restore payloads that escape the imported backup directory', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      const externalBackupPath = path.join(testDatabase.rootDir, 'external-backup.sqlite');

      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');
      fs.writeFileSync(externalBackupPath, 'outside-payload', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [
          {
            kind: 'database',
            type: 'file',
            sourcePath: testDatabase.databasePath,
            destinationPath: externalBackupPath,
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T22:50:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        backupsCreated: unknown[];
        missing: Array<{
          expectedPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
        restored: unknown[];
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([
        {
          kind: 'database',
          type: 'file',
          expectedPath: externalBackupPath,
          targetPath: testDatabase.databasePath,
          reason: 'backup-incomplete',
        },
      ]);
      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('current-db');
      expect(
        fs.existsSync(`${testDatabase.databasePath}.pre-restore-2026-04-24T22-50-00.000Z`),
      ).toBe(false);
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('refuses to restore from a manifest that is already marked incomplete', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [],
        ok: false,
        missing: [
          {
            kind: 'database',
            type: 'file',
            expectedPath: ':memory:',
          },
        ],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T23:00:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        ok: boolean;
        restored: unknown[];
        backupsCreated: unknown[];
        missing: Array<{
          expectedPath: string;
          kind: string;
          reason: string;
          targetPath: string;
          type: string;
        }>;
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([
        {
          kind: 'database',
          type: 'file',
          expectedPath: ':memory:',
          targetPath: ':memory:',
          reason: 'backup-incomplete',
        },
      ]);
      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('current-db');
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('refuses to restore when the manifest is marked incomplete without listing missing entries', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();
    const testDatabase = createTestDatabasePath();

    expect(runtimeRestore).not.toBeNull();

    try {
      const inputDir = path.join(testDatabase.rootDir, 'imports', 'runtime-backup');
      fs.mkdirSync(path.dirname(testDatabase.databasePath), { recursive: true });
      fs.writeFileSync(testDatabase.databasePath, 'current-db', 'utf8');

      writeBackupManifest({
        inputDir,
        copied: [],
        ok: false,
        missing: [],
      });

      const stdout = createStdoutBuffer();
      const summary = (await runtimeRestore?.runRuntimeRestoreCli(['--input-dir', inputDir], {
        now: () => new Date('2026-04-24T23:05:00.000Z'),
        repoRootDir: testDatabase.rootDir,
        stdout: stdout.stdout,
      })) as {
        ok: boolean;
        restored: unknown[];
        backupsCreated: unknown[];
        missing: unknown[];
      };

      expect(summary.ok).toBe(false);
      expect(summary.restored).toEqual([]);
      expect(summary.backupsCreated).toEqual([]);
      expect(summary.missing).toEqual([]);
      expect(fs.readFileSync(testDatabase.databasePath, 'utf8')).toBe('current-db');
      expect(JSON.parse(stdout.read())).toEqual(summary);
    } finally {
      cleanupTestDatabasePath(testDatabase.rootDir);
    }
  });

  it('sets a non-zero exit code for incomplete restores', async () => {
    const runtimeRestore = await loadRuntimeRestoreModule();

    expect(runtimeRestore).not.toBeNull();

    runtimeRestore?.applyRuntimeRestoreExitCode({ ok: false });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    runtimeRestore?.applyRuntimeRestoreExitCode({ ok: true });
    expect(process.exitCode).toBeUndefined();
  });
});
