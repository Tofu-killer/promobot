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

  it('keeps the uploaded release bundle artifact aligned with the standalone helper and sidecars', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const uploadArtifactStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Upload release bundle artifact'),
      releaseBundleWorkflow.indexOf('      - name: Write workflow run summary'),
    );

    expect(uploadArtifactStep).toContain("uses: actions/upload-artifact@v7.0.1");
    expect(uploadArtifactStep).toContain('name: ${{ steps.asset_names.outputs.artifact_name }}');
    expect(uploadArtifactStep).toContain('${{ steps.asset_names.outputs.bundle_dir }}');
    expect(uploadArtifactStep).toContain('${{ steps.asset_names.outputs.helper_path }}');
    expect(uploadArtifactStep).toContain('${{ steps.asset_names.outputs.archive_path }}');
    expect(uploadArtifactStep).toContain('${{ steps.asset_names.outputs.checksum_path }}');
    expect(uploadArtifactStep).toContain('${{ steps.asset_names.outputs.metadata_path }}');
    expect(uploadArtifactStep).toContain('if-no-files-found: error');
    expect(uploadArtifactStep).toContain('compression-level: 0');
  });

  it('keeps the GitHub Release body guidance aligned with the downloaded helper contract', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const releaseBodyStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Generate GitHub Release body'),
      releaseBundleWorkflow.indexOf('      - name: Publish release bundle assets to GitHub Release'),
    );

    expect(releaseBodyStep).toContain('Release status:');
    expect(releaseBodyStep).toContain('Published release asset set:');
    expect(releaseBodyStep).toContain(
      'Metadata asset contract remains the ordered archive/checksum/metadata trio',
    );
    expect(releaseBodyStep).toContain('Standalone helper purpose:');
    expect(releaseBodyStep).toContain('Download order:');
    expect(releaseBodyStep).toContain('Recommended verification flow:');
    expect(releaseBodyStep).toContain('bash -n ./${helperFile}');
    expect(releaseBodyStep).toContain(
      'bash ./${helperFile} --archive ./${assetsByKind.archive}',
    );
    expect(releaseBodyStep).toContain('The extracted directory name should match');
    expect(releaseBodyStep).toContain('bundle_dir_name: ${bundleDirName}');
    expect(releaseBodyStep).toContain('assetsByKind.metadata');
  });
});
