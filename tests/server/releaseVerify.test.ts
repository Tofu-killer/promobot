import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = new Set<string>();

afterEach(() => {
  process.exitCode = undefined;
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('release verify cli', () => {
  it('parses args, exposes help text, and registers the release:verify script', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    expect(releaseVerify.parseReleaseVerifyArgs([])).toEqual({});
    expect(releaseVerify.parseReleaseVerifyArgs(['--input-dir', '/tmp/release'])).toEqual({
      inputDir: '/tmp/release',
    });
    expect(releaseVerify.parseReleaseVerifyArgs(['--', '--help'])).toEqual({
      showHelp: true,
    });
    expect(() => releaseVerify.parseReleaseVerifyArgs(['--input-dir'])).toThrow(
      '--input-dir requires a value',
    );
    expect(releaseVerify.getReleaseVerifyHelpText()).toContain('--input-dir <path>');

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['release:verify']).toBe('tsx src/server/cli/releaseVerify.ts');
  });

  it('fails when manifest or required bundle files are missing', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    const missingManifest = releaseVerify.runReleaseVerify({ inputDir });

    expect(missingManifest.ok).toBe(false);
    expect(missingManifest.missing).toEqual([
      {
        kind: 'manifest',
        name: 'manifest.json',
        target: path.join(inputDir, 'manifest.json'),
      },
    ]);

    writeManifest(inputDir, {
      ok: false,
      files: ['dist/server/index.js'],
      missing: ['dist/client/**'],
    });
    writeFile(inputDir, 'dist/server/index.js', 'console.log("server");\n');

    const incompleteBundle = releaseVerify.runReleaseVerify({ inputDir });
    expect(incompleteBundle.ok).toBe(false);
    expect(incompleteBundle.warnings).toEqual(
      expect.arrayContaining([
        {
          code: 'bundle-marked-incomplete',
          message: 'Bundle manifest is already marked incomplete',
          target: path.join(inputDir, 'manifest.json'),
        },
        {
          code: 'bundle-marked-missing',
          message: 'Bundle manifest recorded missing input: dist/client/**',
          target: 'dist/client/**',
        },
      ]),
    );
    expect(incompleteBundle.missing).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'dist/client/index.html',
          target: path.join(inputDir, 'dist/client/index.html'),
        },
        {
          kind: 'manifest-item',
          name: 'pm2.config.js',
          target: path.join(inputDir, 'pm2.config.js'),
        },
      ]),
    );
  });

  it('passes when manifest and required bundle files exist', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    writeFile(inputDir, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(inputDir, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(inputDir, 'pm2.config.js', 'export default {};\n');
    writeFile(inputDir, 'ops/deploy-promobot.sh', '#!/usr/bin/env bash\n');

    writeManifest(inputDir, {
      ok: true,
      files: [
        'dist/server/index.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
      ],
      missing: [],
    });

    const stdout = createStdoutBuffer();
    const summary = await releaseVerify.runReleaseVerifyCli(['--input-dir', inputDir], {
      stdout: stdout.stdout,
    });

    expect(summary).toEqual({
      ok: true,
      inputDir,
      manifestPath: path.join(inputDir, 'manifest.json'),
      checks: [
        {
          kind: 'manifest',
          name: 'manifest.json',
          ok: true,
          target: path.join(inputDir, 'manifest.json'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/server/index.js',
          ok: true,
          target: path.join(inputDir, 'dist/server/index.js'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/client/index.html',
          ok: true,
          target: path.join(inputDir, 'dist/client/index.html'),
        },
        {
          kind: 'manifest-item',
          name: 'pm2.config.js',
          ok: true,
          target: path.join(inputDir, 'pm2.config.js'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/deploy-promobot.sh',
          ok: true,
          target: path.join(inputDir, 'ops/deploy-promobot.sh'),
        },
      ],
      missing: [],
      warnings: [],
    });
    expect(JSON.parse(stdout.read())).toEqual(summary);
  });
});

async function loadReleaseVerifyModule() {
  try {
    return await import('../../src/server/cli/releaseVerify');
  } catch {
    return null;
  }
}

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promobot-release-verify-'));
  tempDirs.add(dir);
  return dir;
}

function writeManifest(
  inputDir: string,
  manifest: {
    ok: boolean;
    files: string[];
    missing: string[];
  },
) {
  writeFile(
    inputDir,
    'manifest.json',
    JSON.stringify(
      {
        ...manifest,
        createdAt: '2026-04-25T10:00:00.000Z',
        repoRoot: '/tmp/promobot',
        outputDir: inputDir,
        manifestPath: path.join(inputDir, 'manifest.json'),
      },
      null,
      2,
    ),
  );
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

function writeFile(rootDir: string, relativePath: string, content: string) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}
