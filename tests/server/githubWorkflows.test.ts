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

  it('keeps the release-bundle manual preview, test policy, and metadata contracts aligned', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const publishReleaseJob = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );

    expect(releaseBundleWorkflow).toContain('      asset_suffix:');
    expect(releaseBundleWorkflow).toContain('      skip_tests:');
    expect(releaseBundleWorkflow).toContain("tests_summary='executed (required for tag release)'");
    expect(releaseBundleWorkflow).toContain(
      "tests_summary='skipped via manual workflow_dispatch input'",
    );
    expect(releaseBundleWorkflow).toContain(
      "tests_summary='executed (default manual behavior)'",
    );
    expect(releaseBundleWorkflow).toContain(
      "if: ${{ steps.test_policy.outputs.skip_tests != 'true' }}",
    );
    expect(releaseBundleWorkflow).toContain(
      "[[ ! \"$ASSET_SUFFIX\" =~ ^[a-z0-9]([a-z0-9._-]{0,30}[a-z0-9])?$ ]]",
    );
    expect(releaseBundleWorkflow).toContain('asset_suffix must be 1-32 chars');
    expect(releaseBundleWorkflow).toContain('test_execution: {');
    expect(releaseBundleWorkflow).toContain('summary: process.env.TESTS_SUMMARY');
    expect(releaseBundleWorkflow).toContain(
      "release_url: process.env.GITHUB_REF_TYPE === 'tag'",
    );
    expect(releaseBundleWorkflow).toContain(': null,');
    expect(releaseBundleWorkflow).toContain("uses: actions/upload-artifact@v7.0.1");
    expect(releaseBundleWorkflow).toContain('Write workflow run summary');

    expect(publishReleaseJob).toContain('  publish-release-asset:');
    expect(publishReleaseJob).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    );
    expect(publishReleaseJob).toContain('Publish release bundle assets to GitHub Release');
    expect(publishReleaseJob).toContain('uses: softprops/action-gh-release@v2');
    expect(publishReleaseJob).toContain('name: Generate GitHub Release body');
    expect(publishReleaseJob).toContain('echo "body_path=$RELEASE_BODY_PATH" >> "$GITHUB_OUTPUT"');
    expect(publishReleaseJob).toContain('body_path: ${{ steps.release_body.outputs.body_path }}');
    expect(publishReleaseJob).toContain('${{ steps.archive.outputs.helper_path }}');
    expect(publishReleaseJob).toContain('${{ steps.archive.outputs.archive_path }}');
    expect(publishReleaseJob).toContain('${{ steps.archive.outputs.checksum_path }}');
    expect(publishReleaseJob).toContain('${{ steps.archive.outputs.metadata_path }}');
    expect(publishReleaseJob).toContain('Expected standalone $HELPER_FILE in the downloaded release bundle artifact');
    expect(publishReleaseJob).toContain('Expected $ARCHIVE_FILE in the downloaded release bundle artifact');
    expect(publishReleaseJob).toContain('Expected $CHECKSUM_FILE in the downloaded release bundle artifact');
    expect(publishReleaseJob).toContain('Expected $METADATA_FILE in the downloaded release bundle artifact');
  });
});
