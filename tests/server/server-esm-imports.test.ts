import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('server ESM import specifiers', () => {
  it('uses explicit .js extensions for every relative static import in src/server', () => {
    const rootDir = path.resolve('src/server');
    const files = collectServerFiles(rootDir);
    const invalidSpecifiers: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const matches = source.matchAll(/from\s+['"](\.\.?\/[^'"\n]+)['"]/g);

      for (const match of matches) {
        const specifier = match[1];
        if (!specifier) {
          continue;
        }

        if (!specifier.endsWith('.js') && !specifier.endsWith('.json')) {
          invalidSpecifiers.push({
            file: path.relative(process.cwd(), file),
            specifier,
          });
        }
      }
    }

    expect(invalidSpecifiers).toEqual([]);
  });
});

function collectServerFiles(rootDir: string) {
  const files: string[] = [];

  walk(rootDir, files);

  return files.sort();
}

function walk(directory: string, files: string[]) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
}
