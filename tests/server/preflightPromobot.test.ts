import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('preflight promobot cli', () => {
  it('parses cli arguments and documents supported options', async () => {
    const preflight = await loadPreflightModule();
    expect(preflight).toBeTruthy();
    if (!preflight) {
      return;
    }

    expect(
      preflight.parsePreflightPromobotArgs([
        '--repo-root',
        '/tmp/promobot',
        '--require-env',
        'AI_API_KEY, PROMOBOT_ADMIN_PASSWORD ,,PORT',
        '--help',
      ]),
    ).toEqual({
      repoRoot: '/tmp/promobot',
      requireEnv: ['AI_API_KEY', 'PROMOBOT_ADMIN_PASSWORD', 'PORT'],
      showHelp: true,
    });

    expect(preflight.getPreflightPromobotHelpText()).toContain('--repo-root <path>');
    expect(preflight.getPreflightPromobotHelpText()).toContain('--require-env <comma-separated keys>');
    expect(preflight.getPreflightPromobotHelpText()).toContain('JSON summary');
  });

  it('reports missing required files, missing env keys, and optional env warnings', async () => {
    const preflight = await loadPreflightModule();
    expect(preflight).toBeTruthy();
    if (!preflight) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{}\n');

    const result = preflight.runPreflightPromobot(
      {
        repoRoot,
        requiredEnvKeys: ['AI_API_KEY', 'PROMOBOT_ADMIN_PASSWORD'],
      },
      {
        env: {
          PROMOBOT_ADMIN_PASSWORD: 'secret',
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.repoRoot).toBe(repoRoot);
    expect(result.checks).toEqual([
      expect.objectContaining({
        kind: 'file',
        name: 'package.json',
        required: true,
        ok: true,
        target: path.join(repoRoot, 'package.json'),
      }),
      expect.objectContaining({
        kind: 'file',
        name: 'pm2.config.js',
        required: true,
        ok: false,
        target: path.join(repoRoot, 'pm2.config.js'),
      }),
      expect.objectContaining({
        kind: 'file',
        name: 'dist/server/index.js',
        required: true,
        ok: false,
        target: path.join(repoRoot, 'dist/server/index.js'),
      }),
      expect.objectContaining({
        kind: 'file',
        name: 'dist/client/index.html',
        required: true,
        ok: false,
        target: path.join(repoRoot, 'dist/client/index.html'),
      }),
      expect.objectContaining({
        kind: 'file',
        name: '.env',
        required: false,
        ok: false,
        target: path.join(repoRoot, '.env'),
      }),
      expect.objectContaining({
        kind: 'env',
        name: 'AI_API_KEY',
        required: true,
        ok: false,
        target: 'AI_API_KEY',
      }),
      expect.objectContaining({
        kind: 'env',
        name: 'PROMOBOT_ADMIN_PASSWORD',
        required: true,
        ok: true,
        source: 'process',
        target: 'PROMOBOT_ADMIN_PASSWORD',
      }),
    ]);
    expect(result.missing).toEqual([
      {
        kind: 'file',
        name: 'pm2.config.js',
        target: path.join(repoRoot, 'pm2.config.js'),
      },
      {
        kind: 'file',
        name: 'dist/server/index.js',
        target: path.join(repoRoot, 'dist/server/index.js'),
      },
      {
        kind: 'file',
        name: 'dist/client/index.html',
        target: path.join(repoRoot, 'dist/client/index.html'),
      },
      {
        kind: 'env',
        name: 'AI_API_KEY',
        target: 'AI_API_KEY',
      },
    ]);
    expect(result.warnings).toEqual([
      {
        code: 'optional-env-missing',
        message: 'Optional .env file is missing',
        target: path.join(repoRoot, '.env'),
      },
    ]);
  });

  it('passes when required files exist and env keys come from shell or .env', async () => {
    const preflight = await loadPreflightModule();
    expect(preflight).toBeTruthy();
    if (!preflight) {
      return;
    }

    const repoRoot = createTempRepoRoot();
    writeFile(repoRoot, 'package.json', '{ "name": "promobot" }\n');
    writeFile(repoRoot, 'pm2.config.js', 'export default {};\n');
    writeFile(repoRoot, 'dist/server/index.js', 'console.log("server");\n');
    writeFile(repoRoot, 'dist/client/index.html', '<!doctype html>\n');
    writeFile(repoRoot, '.env', 'AI_API_KEY=from-file\nPORT=3001\n');

    const result = preflight.runPreflightPromobot(
      {
        repoRoot,
        requiredEnvKeys: ['AI_API_KEY', 'PROMOBOT_ADMIN_PASSWORD'],
      },
      {
        env: {
          PROMOBOT_ADMIN_PASSWORD: 'secret',
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'file',
          name: '.env',
          required: false,
          ok: true,
          target: path.join(repoRoot, '.env'),
        }),
        expect.objectContaining({
          kind: 'env',
          name: 'AI_API_KEY',
          ok: true,
          required: true,
          source: '.env',
          target: 'AI_API_KEY',
        }),
        expect.objectContaining({
          kind: 'env',
          name: 'PROMOBOT_ADMIN_PASSWORD',
          ok: true,
          required: true,
          source: 'process',
          target: 'PROMOBOT_ADMIN_PASSWORD',
        }),
      ]),
    );
  });

  it('exposes the prod preflight script in package.json', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['preflight:prod']).toBe('tsx src/server/cli/preflightPromobot.ts');
  });
});

async function loadPreflightModule() {
  try {
    return await import('../../src/server/cli/preflightPromobot');
  } catch {
    return null;
  }
}

function createTempRepoRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promobot-preflight-test-'));
  tempDirs.add(dir);
  return dir;
}

function writeFile(repoRoot: string, relativePath: string, content: string) {
  const targetPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}
