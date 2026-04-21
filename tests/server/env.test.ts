import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadServerEnvFromRoot } from '../../src/server/env';

const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('loadServerEnvFromRoot', () => {
  it('loads env file when .env exists in repo root', () => {
    const repoRootDir = createTempRepoRootWithEnv('PORT=4123\n');
    const loadEnvFile = vi.fn();

    loadServerEnvFromRoot({ repoRootDir, loadEnvFile });

    expect(loadEnvFile).toHaveBeenCalledTimes(1);
    expect(loadEnvFile).toHaveBeenCalledWith(path.join(repoRootDir, '.env'));
  });

  it('silently skips when .env is missing in repo root', () => {
    const repoRootDir = createTempRepoRoot();
    const loadEnvFile = vi.fn();

    loadServerEnvFromRoot({ repoRootDir, loadEnvFile });

    expect(loadEnvFile).not.toHaveBeenCalled();
  });

  it('server entry calls env loading before app initialization', () => {
    const source = fs.readFileSync(path.resolve('src/server/index.ts'), 'utf8');
    const envLoadCallOffset = source.indexOf('loadServerEnvFromRoot();');
    const appInitOffset = source.indexOf('const app = createApp(loadConfig()');

    expect(source).toContain("from './env.js'");
    expect(envLoadCallOffset).toBeGreaterThan(-1);
    expect(appInitOffset).toBeGreaterThan(-1);
    expect(envLoadCallOffset).toBeLessThan(appInitOffset);
  });
});

function createTempRepoRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promobot-env-test-'));
  tempDirs.add(dir);
  return dir;
}

function createTempRepoRootWithEnv(content: string) {
  const dir = createTempRepoRoot();
  fs.writeFileSync(path.join(dir, '.env'), content);
  return dir;
}
