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
      expect(result.stdout).toContain(
        'Usage: ops/verify-release.sh --input-dir <path> [options] [-- <release:verify args>]',
      );
      expect(result.stdout).toContain('--input-dir <path>');
      expect(result.stdout).toContain('--smoke');
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

function createDeployReleaseFixture(options: { requireAdminPasswordForPm2?: boolean } = {}) {
  const rootDir = createTempDir('promobot-deploy-release-script-');
  const binDir = path.join(rootDir, 'bin');
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

  writeExecutable(binDir, 'pnpm', '#!/usr/bin/env bash\nexit 0\n');
  const pm2Script = options.requireAdminPasswordForPm2
    ? '#!/usr/bin/env bash\ncase "${1:-}" in\n  jlist)\n    printf \'[]\\n\'\n    exit 0\n    ;;\nesac\nif [ -z "${ADMIN_PASSWORD:-}" ]; then\n  printf \'ADMIN_PASSWORD missing\\n\' >&2\n  exit 1\nfi\nexit 0\n'
    : '#!/usr/bin/env bash\ncase "${1:-}" in\n  jlist)\n    printf \'[]\\n\'\n    ;;\nesac\nexit 0\n';
  writeExecutable(binDir, 'pm2', pm2Script);
  writeExecutable(binDir, 'node', '#!/usr/bin/env bash\nexit 0\n');

  return {
    rootDir,
    binDir,
    scriptPath,
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
