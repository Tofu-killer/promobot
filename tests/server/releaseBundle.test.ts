import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

type ReleaseBundleSummary = {
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

const tempDirs = new Set<string>();

afterEach(() => {
  process.exitCode = undefined;

  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('release bundle cli', () => {
  it('parses args, exposes help text, and registers the release:bundle script', async () => {
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
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
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
      createdAt: '2026-04-25T09:00:00.000Z',
      repoRoot,
      outputDir,
      manifestPath: path.join(outputDir, 'manifest.json'),
      files: [
        '.env.example',
        'dist/server/index.js',
        'docs/DEPLOYMENT.md',
        'manifest.json',
        'ops/deploy-promobot.sh',
        'package.json',
      ],
      missing: ['dist/client/**', 'pnpm-lock.yaml', 'pm2.config.js'],
    });
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'))).toEqual(
      summary,
    );

    releaseBundle.applyReleaseBundleExitCode(summary);
    expect(process.exitCode).toBe(1);
  });

  it('copies the release bundle into the output directory and writes a machine-readable manifest', async () => {
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
    writeFile(repoRoot, 'docs/DEPLOYMENT.md', '# Deploy\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'dist/server/chunks/app.js', 'export const app = true;\n');
    writeFile(repoRoot, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(repoRoot, 'dist/client/assets/app.js', 'console.log("client");\n');
    writeFile(repoRoot, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/preflight-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/rollback-promobot.sh', '#!/usr/bin/env bash\n');
    writeFile(repoRoot, 'ops/logrotate.promobot.conf', 'rotate 7\n');

    const outputDir = path.join(repoRoot, 'artifacts', 'release-bundle');
    const stdout = createStdoutBuffer();
    const summary = await releaseBundle.runReleaseBundleCli(['--output-dir', outputDir], {
      repoRootDir: repoRoot,
      now: () => new Date('2026-04-25T10:00:00.000Z'),
      stdout: stdout.stdout,
    });

    expect(summary).toEqual({
      ok: true,
      createdAt: '2026-04-25T10:00:00.000Z',
      repoRoot,
      outputDir,
      manifestPath: path.join(outputDir, 'manifest.json'),
      files: [
        '.env.example',
        'dist/client/assets/app.js',
        'dist/client/index.html',
        'dist/server/chunks/app.js',
        'dist/server/index.js',
        'docs/DEPLOYMENT.md',
        'manifest.json',
        'ops/deploy-promobot.sh',
        'ops/preflight-promobot.sh',
        'ops/rollback-promobot.sh',
        'package.json',
        'pm2.config.js',
        'pnpm-lock.yaml',
      ],
      missing: [],
    });

    expect(fs.readFileSync(path.join(outputDir, 'dist/server/index.js'), 'utf8')).toBe(
      'console.log("server");\n',
    );
    expect(fs.readFileSync(path.join(outputDir, 'dist/client/index.html'), 'utf8')).toBe(
      '<!doctype html>\n',
    );
    expect(fs.existsSync(path.join(outputDir, 'ops/logrotate.promobot.conf'))).toBe(false);
    expect(JSON.parse(stdout.read())).toEqual(summary);
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'))).toEqual(
      summary,
    );
  });
});

async function loadReleaseBundleModule(): Promise<ReleaseBundleModule | null> {
  try {
    return (await import('../../src/server/cli/releaseBundle')) as ReleaseBundleModule;
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
