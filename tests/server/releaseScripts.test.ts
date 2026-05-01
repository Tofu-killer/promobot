import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('release shell wrappers', () => {
  it('shows release-promobot help for direct and leading dash-dash help paths', () => {
    for (const args of [['--help'], ['--', '--help']]) {
      const result = runRepoScript('ops/release-promobot.sh', args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: ops/release-promobot.sh [options]');
      expect(result.stdout).toContain('--output-dir <path>');
      expect(result.stdout).toContain('--skip-build');
    }
  });

  it('rejects missing and empty release-promobot output-dir values', () => {
    const missingValue = runRepoScript('ops/release-promobot.sh', ['--output-dir']);
    const emptyValue = runRepoScript('ops/release-promobot.sh', ['--output-dir=']);

    expect(missingValue.status).toBe(1);
    expect(missingValue.stderr).toContain('--output-dir requires a value');
    expect(emptyValue.status).toBe(1);
    expect(emptyValue.stderr).toContain('--output-dir requires a value');
  });

  it('shows verify-release help for direct and leading dash-dash help paths', () => {
    for (const args of [['--help'], ['--', '--help']]) {
      const result = runRepoScript('ops/verify-release.sh', args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: ops/verify-release.sh --input-dir <path> [options]');
      expect(result.stdout).not.toContain('[-- <release:verify args>]');
      expect(result.stdout).toContain('--input-dir <path>');
      expect(result.stdout).toContain('--smoke');
      expect(result.stdout).not.toContain('Everything after -- is passed through');
      expect(result.stdout).not.toContain('-- --json');
    }
  });

  it('fails when verify-release is missing the required input-dir', () => {
    const result = runRepoScript('ops/verify-release.sh', []);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--input-dir is required');
  });

  it('rejects missing and empty verify-release option values', () => {
    const cases: Array<{ args: string[]; error: string }> = [
      { args: ['--input-dir'], error: '--input-dir requires a value' },
      { args: ['--input-dir='], error: '--input-dir requires a value' },
      { args: ['--base-url'], error: '--base-url requires a value' },
      { args: ['--base-url='], error: '--base-url requires a value' },
      { args: ['--admin-password'], error: '--admin-password requires a value' },
      { args: ['--admin-password='], error: '--admin-password requires a value' },
    ];

    for (const testCase of cases) {
      const result = runRepoScript('ops/verify-release.sh', testCase.args);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.error);
    }
  });

  it('rejects legacy verify-release passthrough arguments', () => {
    const result = runRepoScript('ops/verify-release.sh', ['--input-dir', '/tmp/release', '--', '--json']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument: --');
  });

  it('shows deploy-release help for direct and leading dash-dash help paths', () => {
    for (const args of [['--help'], ['--', '--help']]) {
      const result = runRepoScript('ops/deploy-release.sh', args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: ops/deploy-release.sh [options]');
      expect(result.stdout).toContain('--skip-install');
      expect(result.stdout).toContain('--admin-password <secret>');
    }
  });

  it('rejects missing and empty deploy-release option values', () => {
    const cases: Array<{ args: string[]; error: string }> = [
      { args: ['--base-url'], error: '--base-url requires a value' },
      { args: ['--base-url='], error: '--base-url requires a value' },
      { args: ['--admin-password'], error: '--admin-password requires a value' },
      { args: ['--admin-password='], error: '--admin-password requires a value' },
    ];

    for (const testCase of cases) {
      const result = runRepoScript('ops/deploy-release.sh', testCase.args);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.error);
    }
  });

  it('fails deploy-release smoke validation when no admin password is configured', () => {
    const fixture = createDeployReleaseFixture();
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;

    const result = runScript(fixture.scriptPath, ['--skip-install'], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Verifying release bundle integrity');
    expect(result.stderr).toContain(
      'Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, or bundle-root .env',
    );
  });

  it('maps PROMOBOT_ADMIN_PASSWORD into ADMIN_PASSWORD before PM2 startup', () => {
    const fixture = createDeployReleaseFixture({ requireAdminPasswordForPm2: true });
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      PROMOBOT_ADMIN_PASSWORD: 'secret',
    };

    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;

    const result = runScript(fixture.scriptPath, ['--skip-install'], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Starting PM2 app from pm2.config.js');
    expect(result.stdout).toContain('Release deployment completed');
    expect(result.stderr).not.toContain('ADMIN_PASSWORD missing');
  });

  it('uses bundle-local pm2 when no global pm2 binary is available', () => {
    const fixture = createDeployReleaseFixture({ installLocalPm2: true });
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;

    const result = runScript(fixture.scriptPath, ['--skip-smoke'], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running pnpm install --frozen-lockfile');
    expect(result.stdout).toContain('Starting PM2 app from pm2.config.js');
    expect(result.stdout).toContain('Skipping smoke check');
    expect(fs.readFileSync(fixture.pm2MarkerPath, 'utf8')).toContain('start pm2.config.js --update-env');
    expect(result.stderr).not.toContain('Missing required command: pm2');
  });

  it('rebuilds better-sqlite3 before using bundle-local pm2', () => {
    const fixture = createDeployReleaseFixture({
      installLocalPm2: true,
      requireNativeRebuild: true,
    });
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    };

    const result = runScript(fixture.scriptPath, ['--skip-smoke'], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain('rebuild better-sqlite3');
    expect(result.stderr).not.toContain('native dependency not rebuilt');
  });

  it('fails deploy-release before startup when database schema is missing from the bundle', () => {
    const fixture = createDeployReleaseFixture();
    fs.rmSync(path.join(fixture.rootDir, 'database', 'schema.sql'));

    const result = runScript(fixture.scriptPath, ['--skip-install', '--skip-smoke'], {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`database/schema.sql not found in ${fixture.rootDir}`);
  });

  it('shows deploy-promobot help for direct and leading dash-dash help paths', () => {
    for (const args of [['--help'], ['--', '--help']]) {
      const result = runRepoScript('ops/deploy-promobot.sh', args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: ops/deploy-promobot.sh [options]');
      expect(result.stdout).toContain('--skip-install');
      expect(result.stdout).toContain('--skip-smoke');
      expect(result.stdout).toContain('--admin-password <secret>');
    }

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['deploy:local']).toBe('bash ops/deploy-promobot.sh');
  });

  it('rejects missing and empty deploy-promobot option values', () => {
    const cases: Array<{ args: string[]; error: string }> = [
      { args: ['--base-url'], error: '--base-url requires a value' },
      { args: ['--base-url='], error: '--base-url requires a value' },
      { args: ['--admin-password'], error: '--admin-password requires a value' },
      { args: ['--admin-password='], error: '--admin-password requires a value' },
    ];

    for (const testCase of cases) {
      const result = runRepoScript('ops/deploy-promobot.sh', testCase.args);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.error);
    }
  });

  it('fails deploy-promobot smoke validation when no admin password is configured', () => {
    const fixture = createDeployPromobotFixture();
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;
    delete env.PORT;

    const result = runScript(fixture.scriptPath, ['--skip-install'], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, or repo-root .env ADMIN_PASSWORD; use --skip-smoke to disable it',
    );
    expect(fs.existsSync(fixture.pnpmMarkerPath)).toBe(false);
    expect(fs.existsSync(fixture.pm2MarkerPath)).toBe(false);
  });

  it('uses repo-root .env defaults when deploy-promobot runs smoke checks', () => {
    const fixture = createDeployPromobotFixture({
      envFileContent: 'PORT=4312\nADMIN_PASSWORD=repo-root-secret\n',
    });
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;
    delete env.PORT;

    const result = runScript(fixture.scriptPath, ['--skip-install'], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Skipping pnpm install');
    expect(result.stdout).toContain('Running pnpm build');
    expect(result.stdout).toContain('Starting PM2 app from pm2.config.js');
    expect(result.stdout).toContain('Running smoke check against http://127.0.0.1:4312 (attempt 1/10)');
    expect(result.stdout).toContain('Deployment completed');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain('build');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain(
      'smoke:server -- --base-url http://127.0.0.1:4312',
    );
    expect(fs.readFileSync(fixture.smokeMarkerPath, 'utf8')).toContain(
      'PROMOBOT_ADMIN_PASSWORD=repo-root-secret',
    );
  });

  it('falls back to pm2 start when deploy-promobot reload fails', () => {
    const fixture = createDeployPromobotFixture({
      existingPm2Process: true,
      failReload: true,
    });
    const result = runScript(fixture.scriptPath, ['--skip-install', '--skip-smoke'], {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Reloading PM2 app from pm2.config.js');
    expect(result.stdout).toContain('PM2 reload failed, trying a fresh start');
    expect(result.stdout).toContain('Skipping smoke check');
    const pm2Invocations = fs.readFileSync(fixture.pm2MarkerPath, 'utf8');
    expect(pm2Invocations).toContain('reload pm2.config.js --update-env');
    expect(pm2Invocations).toContain('start pm2.config.js --update-env');
  });

  it('shows preflight-promobot help for direct and leading dash-dash help paths', () => {
    for (const args of [['--help'], ['--', '--help']]) {
      const result = runRepoScript('ops/preflight-promobot.sh', args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: ops/preflight-promobot.sh [options]');
      expect(result.stdout).toContain('--skip-smoke');
      expect(result.stdout).toContain('--admin-password <secret>');
    }

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['preflight:local']).toBe('bash ops/preflight-promobot.sh');
  });

  it('rejects missing and empty preflight-promobot option values', () => {
    const cases: Array<{ args: string[]; error: string }> = [
      { args: ['--base-url'], error: '--base-url requires a value' },
      { args: ['--base-url='], error: '--base-url requires a value' },
      { args: ['--admin-password'], error: '--admin-password requires a value' },
      { args: ['--admin-password='], error: '--admin-password requires a value' },
    ];

    for (const testCase of cases) {
      const result = runRepoScript('ops/preflight-promobot.sh', testCase.args);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.error);
    }
  });

  it('runs only preflight:prod when preflight-promobot skips smoke', () => {
    const fixture = createPreflightPromobotFixture();
    const result = runScript(fixture.scriptPath, ['--skip-smoke'], {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running pnpm preflight:prod');
    expect(result.stdout).toContain('Skipping smoke check');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain('preflight:prod');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).not.toContain('smoke:server');
    expect(fs.existsSync(fixture.smokeMarkerPath)).toBe(false);
  });

  it('prefers explicit preflight-promobot smoke args over environment defaults', () => {
    const fixture = createPreflightPromobotFixture({
      rootEnvFileContent: 'PORT=4988\nADMIN_PASSWORD=root-secret\n',
      shellEnvFileContent: 'PORT=5123\nPROMOBOT_ADMIN_PASSWORD=shell-secret\n',
    });
    const result = runScript(
      fixture.scriptPath,
      ['--base-url', 'http://127.0.0.1:6123', '--admin-password', 'cli-secret'],
      {
        cwd: fixture.rootDir,
        env: {
          ...process.env,
          PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          PROMOBOT_BASE_URL: 'http://127.0.0.1:7001',
          PROMOBOT_ADMIN_PASSWORD: 'env-secret',
          ADMIN_PASSWORD: 'admin-env-secret',
          PORT: '7002',
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running smoke check against http://127.0.0.1:6123');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain(
      'smoke:server -- --base-url http://127.0.0.1:6123',
    );
    expect(fs.readFileSync(fixture.smokeMarkerPath, 'utf8')).toContain(
      'PROMOBOT_ADMIN_PASSWORD=cli-secret',
    );
    expect(fs.readFileSync(fixture.smokeMarkerPath, 'utf8')).not.toContain(
      'PROMOBOT_ADMIN_PASSWORD=shell-secret',
    );
  });

  it('fails preflight-promobot smoke validation when no admin password is configured', () => {
    const fixture = createPreflightPromobotFixture();
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;
    delete env.PORT;

    const result = runScript(fixture.scriptPath, [], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, shell/.env, or repo-root .env; use --skip-smoke to disable it',
    );
    expect(fs.existsSync(fixture.pnpmMarkerPath)).toBe(false);
  });

  it('prefers shell env defaults when preflight-promobot runs smoke checks', () => {
    const fixture = createPreflightPromobotFixture({
      rootEnvFileContent: 'PORT=4988\nADMIN_PASSWORD=root-secret\n',
      shellEnvFileContent: 'PORT=5123\nPROMOBOT_ADMIN_PASSWORD=shell-secret\n',
    });
    const env = {
      ...process.env,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    delete env.PROMOBOT_ADMIN_PASSWORD;
    delete env.ADMIN_PASSWORD;
    delete env.PROMOBOT_BASE_URL;
    delete env.PORT;

    const result = runScript(fixture.scriptPath, [], {
      cwd: fixture.rootDir,
      env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running pnpm preflight:prod');
    expect(result.stdout).toContain('Running smoke check against http://127.0.0.1:5123');
    expect(result.stdout).toContain('Preflight completed');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain('preflight:prod');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain(
      'smoke:server -- --base-url http://127.0.0.1:5123',
    );
    expect(fs.readFileSync(fixture.smokeMarkerPath, 'utf8')).toContain(
      'PROMOBOT_ADMIN_PASSWORD=shell-secret',
    );
  });

  it('propagates preflight-promobot preflight failures without running smoke', () => {
    const fixture = createPreflightPromobotFixture({
      preflightExitCode: 7,
      preflightFailureMessage: 'preflight failed',
    });
    const result = runScript(
      fixture.scriptPath,
      ['--base-url', 'http://127.0.0.1:6123', '--admin-password', 'cli-secret'],
      {
        cwd: fixture.rootDir,
        env: {
          ...process.env,
          PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      },
    );

    expect(result.status).toBe(7);
    expect(result.stdout).toContain('Running pnpm preflight:prod');
    expect(result.stderr).toContain('preflight failed');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).toContain('preflight:prod');
    expect(fs.readFileSync(fixture.pnpmMarkerPath, 'utf8')).not.toContain('smoke:server');
    expect(fs.existsSync(fixture.smokeMarkerPath)).toBe(false);
  });

  it('shows verify-downloaded-release help for direct and leading dash-dash help paths', () => {
    for (const args of [['--help'], ['--', '--help']]) {
      const result = runRepoScript('ops/verify-downloaded-release.sh', args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: ops/verify-downloaded-release.sh --archive <path> [options]');
      expect(result.stdout).toContain('--archive <path>');
      expect(result.stdout).toContain('--archive-file <path>');
      expect(result.stdout).toContain('--extract-root <path>');
      expect(result.stdout).toContain('--keep-extracted');
    }

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['verify:downloaded-release']).toBe(
      'bash ops/verify-downloaded-release.sh',
    );
  });

  it('fails when verify-downloaded-release is missing required values', () => {
    const cases: Array<{ args: string[]; error: string }> = [
      { args: [], error: '--archive is required' },
      { args: ['--archive'], error: '--archive requires a value' },
      { args: ['--archive='], error: '--archive requires a value' },
      { args: ['--archive-file'], error: '--archive-file requires a value' },
      { args: ['--archive-file='], error: '--archive-file requires a value' },
      { args: ['--archive-file', '/tmp/archive.tar.gz', '--checksum-file'], error: '--checksum-file requires a value' },
      { args: ['--archive-file', '/tmp/archive.tar.gz', '--metadata-file='], error: '--metadata-file requires a value' },
      { args: ['--archive-file', '/tmp/archive.tar.gz', '--extract-root'], error: '--extract-root requires a value' },
      { args: ['--archive-file', '/tmp/archive.tar.gz', '--extract-to'], error: '--extract-to requires a value' },
    ];

    for (const testCase of cases) {
      const result = runRepoScript('ops/verify-downloaded-release.sh', testCase.args);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.error);
    }
  });

  it('fails verify-downloaded-release when expected sidecars are missing', () => {
    const fixture = createDownloadedReleaseFixture();
    fs.rmSync(fixture.metadataPath);

    const result = runScript(fixture.scriptPath, ['--archive-file', fixture.archivePath], {
      cwd: fixture.rootDir,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--metadata-file not found');
  });

  it('verifies and extracts a downloaded release archive', () => {
    const fixture = createDownloadedReleaseFixture();
    const extractRoot = path.join(fixture.rootDir, 'extract-target');

    const result = runScript(
      fixture.scriptPath,
      ['--archive-file', fixture.archivePath, '--extract-to', extractRoot],
      {
        cwd: fixture.rootDir,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Verifying archive checksum');
    expect(result.stdout).toContain('Running extracted bundle release verifier');
    expect(result.stdout).toContain('Verification succeeded; extracted bundle will be cleaned up');
    expect(fs.existsSync(path.join(extractRoot, 'promobot-release-bundle'))).toBe(false);
  });

  it('fails verify-downloaded-release when archive checksum verification fails', () => {
    const fixture = createDownloadedReleaseFixture();

    fs.writeFileSync(fixture.checksumPath, `0000000000000000000000000000000000000000000000000000000000000000  ${path.basename(fixture.archivePath)}\n`, 'utf8');

    const result = runScript(fixture.scriptPath, ['--archive-file', fixture.archivePath], {
      cwd: fixture.rootDir,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Archive checksum verification failed');
  });

  it('fails verify-downloaded-release when archive entries contain unsafe paths', () => {
    const fixture = createDownloadedReleaseFixture();
    const binDir = path.join(fixture.rootDir, 'bin');

    writeExecutable(
      binDir,
      'tar',
      `#!/usr/bin/env bash
if [ "\${1:-}" = "-tzf" ]; then
  printf 'promobot-release-bundle/../escape.txt\n'
  exit 0
fi
printf 'unexpected tar invocation: %s\n' "$*" >&2
exit 99
`,
    );

    const result = runScript(fixture.scriptPath, ['--archive-file', fixture.archivePath], {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Archive entry contains an unsafe path');
  });

  it('fails verify-downloaded-release when metadata bundle_dir_name does not match the archive root', () => {
    const fixture = createDownloadedReleaseFixture();
    const metadata = JSON.parse(fs.readFileSync(fixture.metadataPath, 'utf8')) as {
      bundle_dir_name: string;
    };
    metadata.bundle_dir_name = 'unexpected-release-root';
    fs.writeFileSync(fixture.metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');

    const result = runScript(fixture.scriptPath, ['--archive-file', fixture.archivePath], {
      cwd: fixture.rootDir,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Archive entry escaped metadata bundle_dir_name');
  });
});

function runRepoScript(relativePath: string, args: string[], options: SpawnSyncOptions = {}) {
  return runScript(path.resolve(repoRoot, relativePath), args, options);
}

function runScript(scriptPath: string, args: string[], options: SpawnSyncOptions = {}) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function createDeployReleaseFixture(
  options: {
    installLocalPm2?: boolean;
    requireAdminPasswordForPm2?: boolean;
    requireNativeRebuild?: boolean;
  } = {},
) {
  const rootDir = createTempDir('promobot-deploy-release-script-');
  const binDir = path.join(rootDir, 'bin');
  const pm2MarkerPath = path.join(rootDir, 'pm2-invocations.log');
  const pnpmMarkerPath = path.join(rootDir, 'pnpm-invocations.log');
  const nativeRebuildMarkerPath = path.join(rootDir, 'native-rebuild.done');
  const scriptPath = path.join(rootDir, 'ops/deploy-release.sh');

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(path.resolve(repoRoot, 'ops/deploy-release.sh'), scriptPath);

  writeFile(rootDir, 'package.json', '{}\n');
  writeFile(rootDir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeFile(rootDir, 'pm2.config.js', 'export default {};\n');
  writeFile(rootDir, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
  writeFile(rootDir, 'dist/server/index.js', 'console.log("server");\n');
  writeFile(rootDir, 'dist/client/index.html', '<!doctype html>\n');
  writeFile(rootDir, 'dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
  writeFile(rootDir, 'dist/server/cli/releaseVerify.js', 'console.log("verify");\n');

  const localPm2Script = options.requireAdminPasswordForPm2
    ? `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${pm2MarkerPath}"
case "\${1:-}" in
  jlist)
    printf '[]\\n'
    exit 0
    ;;
esac
if [ -z "\${ADMIN_PASSWORD:-}" ]; then
  printf 'ADMIN_PASSWORD missing\\n' >&2
  exit 1
fi
if [ ! -f "${nativeRebuildMarkerPath}" ] && [ "${options.requireNativeRebuild ? '1' : '0'}" = "1" ]; then
  printf 'native dependency not rebuilt\\n' >&2
  exit 1
fi
exit 0
`
    : `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${pm2MarkerPath}"
case "\${1:-}" in
  jlist)
    printf '[]\\n'
    ;;
esac
if [ ! -f "${nativeRebuildMarkerPath}" ] && [ "${options.requireNativeRebuild ? '1' : '0'}" = "1" ]; then
  printf 'native dependency not rebuilt\\n' >&2
  exit 1
fi
exit 0
`;
  const pnpmScript = options.installLocalPm2
    ? `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${pnpmMarkerPath}"
if [ "$#" -ge 1 ] && [ "$1" = "install" ]; then
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/pm2 <<'EOF'
${localPm2Script}
EOF
  chmod +x node_modules/.bin/pm2
  exit 0
fi
if [ "$#" -ge 2 ] && [ "$1" = "rebuild" ] && [ "$2" = "better-sqlite3" ]; then
  : > "${nativeRebuildMarkerPath}"
  exit 0
fi
if [ "$#" -ge 2 ] && [ "$1" = "exec" ] && [ "$2" = "pm2" ]; then
  shift 2
  exec "$PWD/node_modules/.bin/pm2" "$@"
fi
exit 0
`
    : '#!/usr/bin/env bash\nexit 0\n';
  writeExecutable(binDir, 'pnpm', pnpmScript);
  const pm2Script = options.requireAdminPasswordForPm2
    ? '#!/usr/bin/env bash\ncase "${1:-}" in\n  jlist)\n    printf \'[]\\n\'\n    exit 0\n    ;;\nesac\nif [ -z "${ADMIN_PASSWORD:-}" ]; then\n  printf \'ADMIN_PASSWORD missing\\n\' >&2\n  exit 1\nfi\nexit 0\n'
    : '#!/usr/bin/env bash\ncase "${1:-}" in\n  jlist)\n    printf \'[]\\n\'\n    ;;\nesac\nexit 0\n';
  if (!options.installLocalPm2) {
    writeExecutable(binDir, 'pm2', pm2Script);
  }
  writeExecutable(binDir, 'node', '#!/usr/bin/env bash\nexit 0\n');

  return {
    rootDir,
    binDir,
    pm2MarkerPath,
    pnpmMarkerPath,
    scriptPath,
  };
}

function createDeployPromobotFixture(
  options: {
    envFileContent?: string;
    existingPm2Process?: boolean;
    failReload?: boolean;
  } = {},
) {
  const rootDir = createTempDir('promobot-deploy-local-script-');
  const binDir = path.join(rootDir, 'bin');
  const pm2MarkerPath = path.join(rootDir, 'pm2-invocations.log');
  const pnpmMarkerPath = path.join(rootDir, 'pnpm-invocations.log');
  const smokeMarkerPath = path.join(rootDir, 'smoke-invocations.log');
  const scriptPath = path.join(rootDir, 'ops/deploy-promobot.sh');

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(path.resolve(repoRoot, 'ops/deploy-promobot.sh'), scriptPath);

  writeFile(rootDir, 'package.json', '{}\n');
  writeFile(rootDir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeFile(rootDir, 'pm2.config.js', 'export default {};\n');

  if (options.envFileContent) {
    writeFile(rootDir, '.env', options.envFileContent);
  }

  writeExecutable(
    binDir,
    'pnpm',
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${pnpmMarkerPath}"
if [ "\${1:-}" = "smoke:server" ]; then
  printf 'PROMOBOT_ADMIN_PASSWORD=%s\\n' "\${PROMOBOT_ADMIN_PASSWORD:-}" >> "${smokeMarkerPath}"
  printf 'ARGS=%s\\n' "$*" >> "${smokeMarkerPath}"
fi
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
if [ "\${1:-}" = "reload" ] && [ "${options.failReload ? '1' : '0'}" = "1" ]; then
  exit 1
fi
exit 0
`,
  );

  return {
    rootDir,
    binDir,
    pm2MarkerPath,
    pnpmMarkerPath,
    scriptPath,
    smokeMarkerPath,
  };
}

function createPreflightPromobotFixture(
  options: {
    rootEnvFileContent?: string;
    shellEnvFileContent?: string;
    preflightExitCode?: number;
    preflightFailureMessage?: string;
  } = {},
) {
  const rootDir = createTempDir('promobot-preflight-local-script-');
  const binDir = path.join(rootDir, 'bin');
  const pnpmMarkerPath = path.join(rootDir, 'pnpm-invocations.log');
  const smokeMarkerPath = path.join(rootDir, 'smoke-invocations.log');
  const scriptPath = path.join(rootDir, 'ops/preflight-promobot.sh');

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(path.resolve(repoRoot, 'ops/preflight-promobot.sh'), scriptPath);

  writeFile(rootDir, 'package.json', '{}\n');

  if (options.rootEnvFileContent) {
    writeFile(rootDir, '.env', options.rootEnvFileContent);
  }

  if (options.shellEnvFileContent) {
    writeFile(rootDir, 'shell/.env', options.shellEnvFileContent);
  }

  writeExecutable(
    binDir,
    'pnpm',
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${pnpmMarkerPath}"
if [ "\${1:-}" = "preflight:prod" ] && [ "${options.preflightExitCode ?? 0}" -ne 0 ]; then
  printf '%s\\n' "${options.preflightFailureMessage ?? 'preflight failed'}" >&2
  exit ${options.preflightExitCode ?? 0}
fi
if [ "\${1:-}" = "smoke:server" ]; then
  printf 'PROMOBOT_ADMIN_PASSWORD=%s\\n' "\${PROMOBOT_ADMIN_PASSWORD:-}" >> "${smokeMarkerPath}"
  printf 'ARGS=%s\\n' "$*" >> "${smokeMarkerPath}"
fi
exit 0
`,
  );

  return {
    rootDir,
    binDir,
    pnpmMarkerPath,
    scriptPath,
    smokeMarkerPath,
  };
}

function createDownloadedReleaseFixture() {
  const rootDir = createTempDir('promobot-verify-downloaded-release-');
  const scriptPath = path.join(rootDir, 'ops/verify-downloaded-release.sh');
  const archivePath = path.join(rootDir, 'downloads/promobot-release-bundle.tar.gz');
  const metadataPath = `${archivePath}.metadata.json`;
  const checksumPath = `${archivePath}.sha256`;
  const bundleSourceDir = path.join(rootDir, 'bundle-source/promobot-release-bundle');

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(path.resolve(repoRoot, 'ops/verify-downloaded-release.sh'), scriptPath);

  writeFile(rootDir, 'bundle-source/promobot-release-bundle/manifest.json', '{}\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/dist/server/index.js', 'console.log("server");\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/dist/client/index.html', '<!doctype html>\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/pm2.config.js', 'export default {};\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/ops/deploy-release.sh', '#!/usr/bin/env bash\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/ops/verify-release.sh', '#!/usr/bin/env bash\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/package.json', '{}\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
  writeFile(rootDir, 'bundle-source/promobot-release-bundle/dist/server/cli/releaseVerify.js', 'console.log("verify");\n');

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });

  const tarResult = spawnSync(
    'tar',
    ['-czf', archivePath, '-C', path.dirname(bundleSourceDir), path.basename(bundleSourceDir)],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  );
  if (tarResult.status !== 0) {
    throw new Error(`Failed to create archive fixture: ${tarResult.stderr || tarResult.stdout}`);
  }

  const hashResult = spawnSync('sha256sum', [archivePath], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (hashResult.status !== 0) {
    throw new Error(`Failed to hash archive fixture: ${hashResult.stderr || hashResult.stdout}`);
  }

  const checksumLine = hashResult.stdout.trim();
  fs.writeFileSync(checksumPath, `${checksumLine}\n`, 'utf8');

  writeFile(
    rootDir,
    path.relative(rootDir, metadataPath),
    JSON.stringify(
      {
        schema_version: 1,
        checksum_algorithm: 'sha256',
        archive_format: 'tar.gz',
        artifact_name: 'promobot-release-bundle-artifact',
        asset_basename: 'promobot-release-bundle',
        event_name: 'workflow_dispatch',
        ref: 'refs/heads/main',
        ref_name: 'main',
        ref_type: 'branch',
        tag: null,
        prerelease: false,
        commit_sha: '0123456789abcdef0123456789abcdef01234567',
        test_execution: {
          state: 'executed',
          mode: 'manual_default',
          summary: 'executed (default manual behavior)',
        },
        archive_file: path.basename(archivePath),
        checksum_file: path.basename(checksumPath),
        metadata_file: path.basename(metadataPath),
        assets: [
          { kind: 'archive', name: path.basename(archivePath) },
          { kind: 'checksum', name: path.basename(checksumPath) },
          { kind: 'metadata', name: path.basename(metadataPath) },
        ],
        bundle_dir_name: 'promobot-release-bundle',
        generated_at: '2026-04-24T00:00:00Z',
        run_url: 'https://github.com/Tofu-killer/promobot/actions/runs/123',
        release_url: null,
      },
      null,
      2,
    ) + '\n',
  );

  return {
    rootDir,
    scriptPath,
    archivePath,
    checksumPath,
    metadataPath,
  };
}

function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function writeExecutable(binDir: string, name: string, content: string) {
  const targetPath = path.join(binDir, name);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  fs.chmodSync(targetPath, 0o755);
}

function writeFile(rootDir: string, relativePath: string, content: string) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}
