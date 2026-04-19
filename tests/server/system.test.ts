import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('bootstrap', () => {
  it('loads the app entry module', async () => {
    const mod = await import('../../src/server/app');
    expect(mod.createApp).toBeTypeOf('function');
  });

  it('keeps server and client build outputs separate', () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.resolve('tsconfig.json'), 'utf8')) as {
      compilerOptions?: { outDir?: string; rootDir?: string };
      include?: string[];
    };
    const viteConfig = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8');

    expect(tsconfig.compilerOptions?.outDir).toBe('dist/server');
    expect(tsconfig.compilerOptions?.rootDir).toBe('src/server');
    expect(tsconfig.include).toEqual(['src/server/**/*.ts']);
    expect(viteConfig).toContain("outDir: 'dist/client'");
  });

  it('starts without pm2', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: { start?: string };
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts?.start).toBe('node dist/server/index.js');
    expect(packageJson.devDependencies?.pm2).toBeUndefined();
  });
});
