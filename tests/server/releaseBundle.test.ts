import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type ReleaseBundleSummary = {
  checksums: Record<string, string>;
  createdAt: string;
  files: string[];
  manifestPath: string;
  missing: string[];
  ok: boolean;
  outputDir: string;
  repoRoot: string;
};

type ReleaseBundleModule = {
  applyReleaseBundleExitCode: (summary: { ok: boolean } | null) => void;
  getReleaseBundleHelpText: () => string;
  parseReleaseBundleArgs: (argv: string[]) => {
    outputDir?: string;
    showHelp?: boolean;
  };
  runReleaseBundle: (
    input: {
      outputDir: string;
      repoRoot: string;
    },
    dependencies?: {
      now?: () => Date;
    },
  ) => ReleaseBundleSummary;
  runReleaseBundleCli: (
    argv: string[],
    dependencies?: {
      now?: () => Date;
      repoRootDir?: string;
      stdout?: Pick<NodeJS.WriteStream, 'write'>;
    },
  ) => Promise<ReleaseBundleSummary | null>;
};

type ReleaseVerifyModule = {
  runReleaseVerify: (input: { inputDir: string }) => {
    missing: Array<{
      kind: 'manifest' | 'manifest-item';
      name: string;
      target: string;
    }>;
    ok: boolean;
    warnings: Array<{
      code: string;
      message: string;
      target: string;
    }>;
  };
};

const tempDirs = new Set<string>();

afterEach(() => {
  process.exitCode = undefined;

  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('release bundle cli', () => {
  it('parses args, exposes help text, and registers the release bundle scripts', async () => {
    const releaseBundle = await loadReleaseBundleModule();

    expect(releaseBundle).toBeTruthy();
    if (!releaseBundle) {
      return;
    }

    expect(releaseBundle.parseReleaseBundleArgs([])).toEqual({});
    expect(releaseBundle.parseReleaseBundleArgs(['--output-dir', '/tmp/release'])).toEqual({
      outputDir: '/tmp/release',
    });
    expect(releaseBundle.parseReleaseBundleArgs(['--', '--help'])).toEqual({
      showHelp: true,
    });
    expect(() => releaseBundle.parseReleaseBundleArgs(['--output-dir'])).toThrow(
      '--output-dir requires a value',
    );
    expect(() => releaseBundle.parseReleaseBundleArgs(['--wat'])).toThrow(
      'unknown argument: --wat',
    );
    expect(releaseBundle.getReleaseBundleHelpText()).toContain('pnpm release:bundle');
    expect(releaseBundle.getReleaseBundleHelpText()).toContain('--output-dir <path>');

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['release:bundle']).toBe('tsx src/server/cli/releaseBundle.ts');
    expect(packageJson.scripts?.['release:deploy']).toBe('bash ops/deploy-release.sh');

    const stdout = createStdoutBuffer();
    const summary = await releaseBundle.runReleaseBundleCli(['--help'], {
      stdout: stdout.stdout,
    });

    expect(summary).toBeNull();
    expect(stdout.read()).toContain('pnpm release:bundle');
  });

  it('reports missing required release inputs and sets a non-zero exit code', async () => {
    const releaseBundle = await loadReleaseBundleModule();

    expect(releaseBundle).toBeTruthy();
    if (!releaseBundle) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, '.env.example', 'ADMIN_PASSWORD=change-me\n');
    writeFile(repoRoot, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'ops/deploy-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');

    const outputDir = path.join(repoRoot, 'release');
    const summary = releaseBundle.runReleaseBundle(
      {
        repoRoot,
        outputDir,
      },
      {
        now: () => new Date('2026-04-25T09:00:00.000Z'),
      },
    );

    expect(summary).toEqual({
      ok: false,
      checksums: {
        '.env.example': sha256Hex('ADMIN_PASSWORD=change-me\n'),
        'database/schema.sql': sha256Hex('create table drafts (id integer primary key);\n'),
        'dist/server/index.js': sha256Hex('console.log("server");\n'),
        'docs/DEPLOYMENT.md': sha256Hex('# Deploy\n'),
        'ops/deploy-promobot.sh': sha256Hex('#!/usr/bin/env bash\n'),
        'ops/deploy-release.sh': sha256Hex('#!/usr/bin/env bash\n'),
        'package.json': sha256Hex('{ "name": "promobot" }\n'),
      },
      createdAt: '2026-04-25T09:00:00.000Z',
      repoRoot,
      outputDir,
      manifestPath: path.join(outputDir, 'manifest.json'),
      files: [
        '.env.example',
        'database/schema.sql',
        'dist/server/index.js',
        'docs/DEPLOYMENT.md',
        'manifest.json',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
        'package.json',
      ],
      missing: [
        'dist/client/**',
        'pnpm-lock.yaml',
        'pm2.config.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'ops/verify-downloaded-release.sh',
        'ops/verify-release.sh',
      ],
    });
    expect(Object.keys(summary.checksums).sort()).toEqual(
      summary.files.filter((relativePath) => relativePath !== 'manifest.json'),
    );
    expect(summary.checksums).not.toHaveProperty('manifest.json');
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'))).toEqual(
      summary,
    );

    releaseBundle.applyReleaseBundleExitCode(summary);
    expect(process.exitCode).toBe(1);
  });

  it('reports missing release verification inputs that must ship inside a valid bundle', async () => {
    const releaseBundle = await loadReleaseBundleModule();

    expect(releaseBundle).toBeTruthy();
    if (!releaseBundle) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'pnpm-lock.yaml', 'lockfile\n');
    writeFile(repoRoot, 'pm2.config.js', 'export default {};\n');
    writeFile(repoRoot, '.env.example', 'ADMIN_PASSWORD=change-me\n');
    writeFile(repoRoot, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(repoRoot, 'ops/deploy-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');

    const outputDir = path.join(repoRoot, 'artifacts', 'release-bundle');
    const summary = releaseBundle.runReleaseBundle({
      repoRoot,
      outputDir,
    });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual(
      expect.arrayContaining([
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'ops/verify-downloaded-release.sh',
        'ops/verify-release.sh',
      ]),
    );
  });

  it('fails when the downloaded release verifier helper is absent from an otherwise valid bundle input set', async () => {
    const releaseBundle = await loadReleaseBundleModule();

    expect(releaseBundle).toBeTruthy();
    if (!releaseBundle) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'pnpm-lock.yaml', 'lockfile\n');
    writeFile(repoRoot, 'pm2.config.js', 'export default {};\n');
    writeFile(repoRoot, '.env.example', 'ADMIN_PASSWORD=change-me\n');
    writeFile(repoRoot, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
    writeFile(
      repoRoot,
      'dist/server/cli/browserHandoffComplete.js',
      'console.log("browser handoff complete");\n',
    );
    writeFile(
      repoRoot,
      'dist/server/cli/inboxReplyHandoffComplete.js',
      'console.log("handoff complete");\n',
    );
    writeFile(repoRoot, 'dist/server/cli/releaseVerify.js', 'console.log("verify");\n');
    writeFile(repoRoot, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(repoRoot, 'ops/deploy-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/verify-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/preflight-promobot.sh', '#!/usr/bin/env bash\n');

    const outputDir = path.join(repoRoot, 'artifacts', 'release-bundle');
    const summary = releaseBundle.runReleaseBundle({
      repoRoot,
      outputDir,
    });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual(
      expect.arrayContaining(['ops/verify-downloaded-release.sh']),
    );
    expect(summary.files).not.toContain('ops/verify-downloaded-release.sh');
    expect(summary.checksums).not.toHaveProperty('ops/verify-downloaded-release.sh');
  });

  it('fails when a bundle is missing required release entrypoints and deploy scripts', async () => {
    const releaseBundle = await loadReleaseBundleModule();

    expect(releaseBundle).toBeTruthy();
    if (!releaseBundle) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'pnpm-lock.yaml', 'lockfile\n');
    writeFile(repoRoot, 'pm2.config.js', 'export default {};\n');
    writeFile(repoRoot, '.env.example', 'ADMIN_PASSWORD=change-me\n');
    writeFile(repoRoot, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, 'dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
    writeFile(
      repoRoot,
      'dist/server/cli/browserHandoffComplete.js',
      'console.log("browser handoff complete");\n',
    );
    writeFile(
      repoRoot,
      'dist/server/cli/inboxReplyHandoffComplete.js',
      'console.log("handoff complete");\n',
    );
    writeFile(repoRoot, 'dist/server/cli/releaseVerify.js', 'console.log("verify");\n');
    writeFile(repoRoot, 'ops/verify-release.sh', '#!/usr/bin/env bash\n');

    const outputDir = path.join(repoRoot, 'artifacts', 'release-bundle');
    const summary = releaseBundle.runReleaseBundle({
      repoRoot,
      outputDir,
    });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual(
      expect.arrayContaining([
        'dist/server/index.js',
        'dist/client/index.html',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
      ]),
    );
  });

  it('copies the release bundle into the output directory and writes a machine-readable manifest with checksums', async () => {
    const releaseBundle = await loadReleaseBundleModule();
    const releaseVerify = await loadReleaseVerifyModule();

    expect(releaseBundle).toBeTruthy();
    expect(releaseVerify).toBeTruthy();
    if (!releaseBundle || !releaseVerify) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'pnpm-lock.yaml', 'lockfile\n');
    writeFile(repoRoot, 'pm2.config.js', 'export default {};\n');
    writeFile(repoRoot, '.env.example', 'ADMIN_PASSWORD=change-me\n');
    writeFile(repoRoot, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'dist/server/chunks/app.js', 'export const app = true;\n');
    writeFile(repoRoot, 'dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
    writeFile(
      repoRoot,
      'dist/server/cli/browserHandoffComplete.js',
      'console.log("browser handoff complete");\n',
    );
    writeFile(
      repoRoot,
      'dist/server/cli/inboxReplyHandoffComplete.js',
      'console.log("handoff complete");\n',
    );
    writeFile(repoRoot, 'dist/server/cli/releaseVerify.js', 'console.log("verify");\n');
    writeFile(repoRoot, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(repoRoot, 'dist/client/assets/app.js', 'console.log("client");\n');
    writeFile(repoRoot, 'ops/deploy-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/preflight-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/rollback-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/verify-downloaded-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/verify-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/logrotate.promobot.conf', 'rotate 7\n');

    const outputDir = path.join(repoRoot, 'artifacts', 'release-bundle');
    const stdout = createStdoutBuffer();
    const summary = await releaseBundle.runReleaseBundleCli(['--output-dir', outputDir], {
      repoRootDir: repoRoot,
      now: () => new Date('2026-04-25T10:00:00.000Z'),
      stdout: stdout.stdout,
    });

    expect(summary).toMatchObject({
      ok: true,
      createdAt: '2026-04-25T10:00:00.000Z',
      repoRoot,
      outputDir,
      manifestPath: path.join(outputDir, 'manifest.json'),
      files: [
        '.env.example',
        'database/schema.sql',
        'dist/client/assets/app.js',
        'dist/client/index.html',
        'dist/server/chunks/app.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/server/index.js',
        'docs/DEPLOYMENT.md',
        'manifest.json',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
        'ops/preflight-promobot.sh',
        'ops/rollback-promobot.sh',
        'ops/verify-downloaded-release.sh',
        'ops/verify-release.sh',
        'package.json',
        'pm2.config.js',
        'pnpm-lock.yaml',
      ],
      missing: [],
      checksums: {
        '.env.example': sha256Hex('ADMIN_PASSWORD=change-me\n'),
        'database/schema.sql': sha256Hex('create table drafts (id integer primary key);\n'),
        'dist/client/assets/app.js': sha256Hex('console.log("client");\n'),
        'dist/server/index.js': sha256Hex('console.log("server");\n'),
        'ops/rollback-promobot.sh': sha256Hex('#!/usr/bin/env bash\n'),
        'package.json': sha256Hex('{ "name": "promobot" }\n'),
      },
    });
    expect(Object.keys(summary.checksums).sort()).toEqual(
      summary.files.filter((relativePath) => relativePath !== 'manifest.json'),
    );
    expect(summary.checksums['dist/server/chunks/app.js']).toBe(
      sha256Hex('export const app = true;\n'),
    );
    expect(summary.checksums['dist/server/cli/deploymentSmoke.js']).toBe(
      sha256Hex('console.log("smoke");\n'),
    );
    expect(summary.checksums['dist/server/cli/browserHandoffComplete.js']).toBe(
      sha256Hex('console.log("browser handoff complete");\n'),
    );
    expect(summary.checksums['dist/server/cli/inboxReplyHandoffComplete.js']).toBe(
      sha256Hex('console.log("handoff complete");\n'),
    );
    expect(summary.checksums['dist/server/cli/releaseVerify.js']).toBe(
      sha256Hex('console.log("verify");\n'),
    );
    expect(summary.checksums['dist/client/index.html']).toBe(sha256Hex('<!doctype html>\n'));
    expect(summary.checksums['docs/DEPLOYMENT.md']).toBe(sha256Hex('# Deploy\n'));
    expect(summary.checksums['ops/verify-downloaded-release.sh']).toBe(
      sha256Hex('#!/usr/bin/env bash\n'),
    );
    expect(summary.checksums['ops/verify-release.sh']).toBe(sha256Hex('#!/usr/bin/env bash\n'));
    expect(summary.checksums).not.toHaveProperty('manifest.json');

    expect(fs.readFileSync(path.join(outputDir, 'dist/server/index.js'), 'utf8')).toBe(
      'console.log("server");\n',
    );
    expect(fs.readFileSync(path.join(outputDir, 'dist/client/index.html'), 'utf8')).toBe(
      '<!doctype html>\n',
    );
    expect(
      fs.readFileSync(path.join(outputDir, 'ops/verify-downloaded-release.sh'), 'utf8'),
    ).toBe('#!/usr/bin/env bash\n');
    expect(fs.existsSync(path.join(outputDir, 'ops/logrotate.promobot.conf'))).toBe(false);
    expect(JSON.parse(stdout.read())).toEqual(summary);
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'))).toEqual(
      summary,
    );
    expect(releaseVerify.runReleaseVerify({ inputDir: outputDir })).toEqual(
      expect.objectContaining({
        ok: true,
        missing: [],
        warnings: [],
      }),
    );
  });

  it('removes stale undeclared files from an existing output directory before writing a new bundle', async () => {
    const releaseBundle = await loadReleaseBundleModule();
    const releaseVerify = await loadReleaseVerifyModule();

    expect(releaseBundle).toBeTruthy();
    expect(releaseVerify).toBeTruthy();
    if (!releaseBundle || !releaseVerify) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'pnpm-lock.yaml', 'lockfile\n');
    writeFile(repoRoot, 'pm2.config.js', 'export default {};\n');
    writeFile(repoRoot, '.env.example', 'ADMIN_PASSWORD=change-me\n');
    writeFile(repoRoot, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'dist/server/cli/deploymentSmoke.js', 'console.log("smoke");\n');
    writeFile(
      repoRoot,
      'dist/server/cli/browserHandoffComplete.js',
      'console.log("browser handoff complete");\n',
    );
    writeFile(
      repoRoot,
      'dist/server/cli/inboxReplyHandoffComplete.js',
      'console.log("handoff complete");\n',
    );
    writeFile(repoRoot, 'dist/server/cli/releaseVerify.js', 'console.log("verify");\n');
    writeFile(repoRoot, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(repoRoot, 'ops/deploy-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/verify-release.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/verify-downloaded-release.sh', '#!/usr/bin/env bash\n');

    const outputDir = path.join(repoRoot, 'artifacts', 'release-bundle');
    writeFile(outputDir, 'notes.txt', 'stale notes\n');
    writeFile(outputDir, 'database/old.sql', '-- stale schema\n');
    writeFile(outputDir, 'dist/client/stale.js', 'console.log("stale client");\n');
    writeFile(outputDir, 'ops/legacy-helper.sh', '#!/usr/bin/env bash\n');

    const summary = releaseBundle.runReleaseBundle({
      repoRoot,
      outputDir,
    });

    expect(summary.ok).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'notes.txt'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'database/old.sql'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'dist/client/stale.js'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'ops/legacy-helper.sh'))).toBe(false);
    expect(releaseVerify.runReleaseVerify({ inputDir: outputDir })).toEqual(
      expect.objectContaining({
        ok: true,
        missing: [],
        warnings: [],
      }),
    );
  });

  it('rejects output directories that would delete the repo root during bundle cleanup', async () => {
    const releaseBundle = await loadReleaseBundleModule();

    expect(releaseBundle).toBeTruthy();
    if (!releaseBundle) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    const rmSyncSpy = vi
      .spyOn(fs, 'rmSync')
      .mockImplementation(() => undefined as ReturnType<typeof fs.rmSync>);

    try {
      for (const outputDir of [repoRoot, path.dirname(repoRoot)]) {
        expect(() =>
          releaseBundle.runReleaseBundle({
            repoRoot,
            outputDir,
          }),
        ).toThrow('--output-dir must stay outside the repo root cleanup boundary');
      }
      expect(rmSyncSpy).not.toHaveBeenCalled();
    } finally {
      rmSyncSpy.mockRestore();
    }
  });
});

async function loadReleaseBundleModule(): Promise<ReleaseBundleModule | null> {
  try {
    return (await import('../../src/server/cli/releaseBundle')) as ReleaseBundleModule;
  } catch {
    return null;
  }
}

async function loadReleaseVerifyModule(): Promise<ReleaseVerifyModule | null> {
  try {
    return (await import('../../src/server/cli/releaseVerify')) as ReleaseVerifyModule;
  } catch {
    return null;
  }
}

function createTempRepoRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promobot-release-test-'));
  tempDirs.add(dir);
  return dir;
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

function writeFile(repoRoot: string, relativePath: string, content: string) {
  const targetPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function sha256Hex(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
