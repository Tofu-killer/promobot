import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('GitHub workflow contracts', () => {
  it('runs CI for branch pushes, keeps tag releases on the release-bundle workflow, and exposes manual entrypoints', () => {
    const ciWorkflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );

    expect(ciWorkflow).toContain('  push:');
    expect(ciWorkflow).toContain("      - '**'");
    expect(ciWorkflow).toContain('    tags-ignore:');
    expect(ciWorkflow).toContain("      - 'v*'");
    expect(ciWorkflow).toContain('  workflow_dispatch:');
    expect(ciWorkflow).toContain('concurrency:');
    expect(ciWorkflow).toContain('  cancel-in-progress: true');

    expect(releaseBundleWorkflow).toContain('  workflow_dispatch:');
    expect(releaseBundleWorkflow).toContain('  push:');
    expect(releaseBundleWorkflow).toContain('    tags:');
    expect(releaseBundleWorkflow).toContain("      - 'v*'");
    expect(releaseBundleWorkflow).not.toContain('    branches:');
  });
});
