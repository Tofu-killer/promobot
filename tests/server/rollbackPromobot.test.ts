import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = path.resolve(repoRoot, 'ops/rollback-promobot.sh');
const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('rollback-promobot.sh', () => {
  it('shows help and documents skip-env', () => {
    const result = runRollbackScript(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: ops/rollback-promobot.sh --backup-dir <path> [options]');
    expect(result.stdout).toContain('--skip-env');
  });

  it('requires --backup-dir', () => {
    const result = runRollbackScript(['--skip-smoke']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--backup-dir is required');
  });

  it('rejects empty values for --backup-dir, --base-url, and --admin-password', () => {
    const emptyBackupDir = runRollbackScript(['--backup-dir=']);
    const emptyBaseUrl = runRollbackScript(['--backup-dir=/tmp/missing', '--base-url=']);
    const emptyAdminPassword = runRollbackScript(['--backup-dir=/tmp/missing', '--admin-password=']);

    expect(emptyBackupDir.status).toBe(1);
    expect(emptyBackupDir.stderr).toContain('--backup-dir requires a value');
    expect(emptyBaseUrl.status).toBe(1);
    expect(emptyBaseUrl.stderr).toContain('--base-url requires a value');
    expect(emptyAdminPassword.status).toBe(1);
    expect(emptyAdminPassword.stderr).toContain('--admin-password requires a value');
  });

  it('forwards --skip-env to runtime:restore and starts PM2 when smoke is skipped', () => {
    const fixture = createRollbackFixture();
    const result = runScript(
      fixture.scriptPath,
      ['--backup-dir', fixture.backupDir, '--skip-env', '--skip-smoke'],
      {
        cwd: fixture.rootDir,
        env: {
          ...process.env,
          PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Restoring runtime data from ${fixture.backupDir}`);
    expect(result.stdout).toContain('Starting PM2 app from pm2.config.js');
    expect(result.stdout).toContain('Skipping smoke check');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain(
      `runtime:restore -- --input-dir ${fixture.backupDir} --skip-env`,
    );
    expect(fs.readFileSync(fixture.pm2MarkerPath, 'utf8')).toContain(
      'start pm2.config.js --update-env',
    );
  });

  it('stops and restarts an existing PM2 app when smoke is skipped', () => {
    const fixture = createRollbackFixture({ existingPm2Process: true });
    const result = runScript(fixture.scriptPath, ['--backup-dir', fixture.backupDir, '--skip-smoke'], {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Stopping PM2 app before restore');
    expect(result.stdout).toContain('Restarting PM2 app from existing process definition');
    expect(result.stdout).toContain('Skipping smoke check');
    const pm2Invocations = fs.readFileSync(fixture.pm2MarkerPath, 'utf8');
    expect(pm2Invocations).toContain('stop promobot');
    expect(pm2Invocations).toContain('restart promobot --update-env');
  });

  it('fails before smoke when no admin password is configured', () => {
    const fixture = createRollbackFixture();
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;

    const result = runScript(fixture.scriptPath, ['--backup-dir', fixture.backupDir], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, shell/.env, or repo-root .env; use --skip-smoke to disable it',
    );
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain(
      `runtime:restore -- --input-dir ${fixture.backupDir}`,
    );
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).not.toContain('smoke:server');
    expect(result.stdout).not.toContain('Starting PM2 app from pm2.config.js');
  });
});

function runRollbackScript(args: string[], options: SpawnSyncOptions = {}) {
  return runScript(scriptPath, args, options);
}

function runScript(scriptPathToRun: string, args: string[], options: SpawnSyncOptions = {}) {
  return spawnSync('bash', [scriptPathToRun, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function createRollbackFixture(options: { existingPm2Process?: boolean } = {}) {
  const rootDir = createTempDir('promobot-rollback-script-');
  const binDir = path.join(rootDir, 'bin');
  const backupDir = path.join(rootDir, 'runtime-backup');
  const scriptCopyPath = path.join(rootDir, 'ops/rollback-promobot.sh');
  const pm2MarkerPath = path.join(rootDir, 'pm2-invocations.log');
  const pnpmMarkerPath = path.join(rootDir, 'pnpm-invocations.log');

  fs.mkdirSync(path.dirname(scriptCopyPath), { recursive: true });
  fs.copyFileSync(scriptPath, scriptCopyPath);

  writeFile(rootDir, 'package.json', '{}\n');
  writeFile(rootDir, 'pm2.config.js', 'export default {};\n');
  writeFile(backupDir, 'manifest.json', '{}\n');

  writeExecutable(
    binDir,
    'pnpm',
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${pnpmMarkerPath}"
exit 0
`,
  );

  writeExecutable(
    binDir,
    'pm2',
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${pm2MarkerPath}"
if [ "\${1:-}" = "jlist" ]; then
  if [ "${options.existingPm2Process ? '1' : '0'}" = "1" ]; then
    printf '[{"name":"promobot"}]\\n'
  else
    printf '[]\\n'
  fi
  exit 0
fi
exit 0
`,
  );

  return {
    backupDir,
    binDir,
    pm2MarkerPath,
    pnpmMarkerPath,
    rootDir,
    scriptPath: scriptCopyPath,
  };
}

function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function writeFile(rootDir: string, relativePath: string, content: string) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function writeExecutable(rootDir: string, relativePath: string, content: string) {
  writeFile(rootDir, relativePath, content);
  fs.chmodSync(path.join(rootDir, relativePath), 0o755);
}
