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

function createDeployReleaseFixture() {
  const rootDir = createTempDir('promobot-deploy-release-script-');
  const binDir = path.join(rootDir, 'bin');
  const scriptPath = path.join(rootDir, 'ops/deploy-release.sh');

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(path.resolve(repoRoot, 'ops/deploy-release.sh'), scriptPath);

  writeFile(rootDir, 'package.json', '{}\n');
  writeFile(rootDir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeFile(rootDir, 'pm2.config.js', 'export default {};\n');
  writeFile(rootDir, 'dist/server/index.js', 'console.log("server");\n');
  writeFile(rootDir, 'dist/client/index.html', '<!doctype html>\n');
  writeFile(rootDir, 'dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
  writeFile(rootDir, 'dist/server/cli/releaseVerify.js', 'console.log("verify");\n');

  writeExecutable(binDir, 'pnpm', '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(
    binDir,
    'pm2',
    '#!/usr/bin/env bash\ncase "${1:-}" in\n  jlist)\n    printf \'[]\\n\'\n    ;;\nesac\nexit 0\n',
  );
  writeExecutable(binDir, 'node', '#!/usr/bin/env bash\nexit 0\n');

  return {
    rootDir,
    binDir,
    scriptPath,
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
