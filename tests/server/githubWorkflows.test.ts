import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function expectOrdered(content: string, snippets: string[]) {
  let previousIndex = -1;

  for (const snippet of snippets) {
    const index = content.indexOf(snippet);
    expect(index, `expected section to contain ${snippet}`).toBeGreaterThanOrEqual(0);
    expect(index, `expected ${snippet} to appear after the previous step`).toBeGreaterThan(
      previousIndex,
    );
    previousIndex = index;
  }
}

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
    expect(ciWorkflow).toContain('  pull_request:');
    expect(ciWorkflow).toContain('    branches: [main]');
    expect(ciWorkflow).toContain('  workflow_dispatch:');
    expect(ciWorkflow).toContain('concurrency:');
    expect(ciWorkflow).toContain('  cancel-in-progress: true');

    expect(releaseBundleWorkflow).toContain('  workflow_dispatch:');
    expect(releaseBundleWorkflow).toContain('  push:');
    expect(releaseBundleWorkflow).toContain('    tags:');
    expect(releaseBundleWorkflow).toContain("      - 'v*'");
    expect(releaseBundleWorkflow).not.toContain('    branches:');
  });

  it('keeps CI workflow lint and release bundle smoke aligned with the documented contract', () => {
    const ciWorkflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8');
    const deploymentDoc = fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8');
    const lintJob = ciWorkflow.slice(ciWorkflow.indexOf('  lint:'), ciWorkflow.indexOf('  ci:'));
    const ciJob = ciWorkflow.slice(ciWorkflow.indexOf('  ci:'));

    expect(readme).toContain(
      'GitHub Actions `CI`：所有 branch push（忽略 `v*` tag）和指向 `main` 的 pull request 现在都会先跑 `lint` job，通过 `rhysd/actionlint@v1.7.12` 校验 workflow，并用 `bash -n ops/*.sh` 检查 ops shell wrapper 语法；`lint` 和 `ci` 两个 job 都显式收敛到 `permissions: contents: read`；随后 `ci` job 继续运行 `pnpm test`、`pnpm build`，并追加一轮目录型 release bundle smoke：基于已构建的 `dist/server/cli/releaseBundle.js` 产出 bundle，再调用 bundle 自带的 `ops/verify-release.sh` 校验，用于提前拦截 workflow / shell wrapper 语法、测试、构建以及 release bundle 交付链回归',
    );
    expect(deploymentDoc).toContain(
      '与之分开的主 GitHub Actions `CI` workflow 会在所有 branch push（忽略 `v*` tag）和指向 `main` 的 pull request 上先跑 `lint` job：通过 `rhysd/actionlint@v1.7.12` 校验 workflow，并用 `bash -n ops/*.sh` 检查 ops shell wrapper 语法；`lint` 和 `ci` 两个 job 都显式收敛到 `permissions: contents: read`；随后 `ci` job 再执行 `pnpm test`、`pnpm build`，并追加一轮目录型 release bundle smoke：基于已构建的 `dist/server/cli/releaseBundle.js` 产出 bundle，再调用 bundle 自带的 `ops/verify-release.sh` 校验',
    );

    expect(lintJob).toContain('    permissions:');
    expect(lintJob).toContain('      contents: read');
    expect(lintJob).toContain('uses: rhysd/actionlint@v1.7.12');
    expect(lintJob).toContain('run: bash -n ops/*.sh');

    expect(ciJob).toContain('    permissions:');
    expect(ciJob).toContain('      contents: read');
    expect(ciJob).toContain('uses: pnpm/action-setup@v6.0.3');
    expect(ciJob).toContain('          version: 10');
    expect(ciJob).toContain('uses: actions/setup-node@v6.4.0');
    expect(ciJob).toContain('          node-version: 22');
    expect(ciJob).toContain('run: pnpm test');
    expect(ciJob).toContain('run: pnpm build');
    expect(ciJob).toContain('      - name: Smoke release bundle flow');
    expect(ciJob).toContain('RELEASE_BUNDLE_DIR: ${{ runner.temp }}/promobot-release');
    expect(ciJob).toContain(
      'node dist/server/cli/releaseBundle.js --output-dir "$RELEASE_BUNDLE_DIR"',
    );
    expect(ciJob).toContain(
      'bash "$RELEASE_BUNDLE_DIR/ops/verify-release.sh" --input-dir "$RELEASE_BUNDLE_DIR"',
    );
    expectOrdered(ciJob, [
      '      - name: Install dependencies',
      '      - name: Rebuild native dependencies',
      '      - name: Run tests',
      '      - name: Build',
      '      - name: Smoke release bundle flow',
    ]);
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

  it('stages and verifies the standalone downloaded release helper before upload', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const stageHelperStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Stage downloaded release verification helper'),
      releaseBundleWorkflow.indexOf('      - name: Reset archived release bundle metadata file'),
    );
    const verifyHelperStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Verify standalone downloaded release helper'),
      releaseBundleWorkflow.indexOf('      - name: Upload release bundle artifact'),
    );

    expect(stageHelperStep).toContain('HELPER_PATH: ${{ steps.asset_names.outputs.helper_path }}');
    expect(stageHelperStep).toContain('cp ops/verify-downloaded-release.sh "$HELPER_PATH"');
    expect(stageHelperStep).toContain('chmod +x "$HELPER_PATH"');
    expect(stageHelperStep).toContain('bash -n "$HELPER_PATH"');

    expect(verifyHelperStep).toContain('HELPER_PATH: ${{ steps.asset_names.outputs.helper_path }}');
    expect(verifyHelperStep).toContain('ARCHIVE_PATH: ${{ steps.asset_names.outputs.archive_path }}');
    expect(verifyHelperStep).toContain('CHECKSUM_PATH: ${{ steps.asset_names.outputs.checksum_path }}');
    expect(verifyHelperStep).toContain('METADATA_PATH: ${{ steps.asset_names.outputs.metadata_path }}');
    expect(verifyHelperStep).toContain('bash "$HELPER_PATH" \\');
    expect(verifyHelperStep).toContain('--archive-file "$ARCHIVE_PATH" \\');
    expect(verifyHelperStep).toContain('--checksum-file "$CHECKSUM_PATH" \\');
    expect(verifyHelperStep).toContain('--metadata-file "$METADATA_PATH"');
  });

  it('keeps the GitHub Release body guidance aligned with the downloaded helper contract', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const downloadedHelperScript = fs.readFileSync(
      path.resolve('ops/verify-downloaded-release.sh'),
      'utf8',
    );
    const releaseBodyStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Generate GitHub Release body'),
      releaseBundleWorkflow.indexOf('      - name: Publish release bundle assets to GitHub Release'),
    );

    expect(downloadedHelperScript).toContain(
      'Usage: ops/verify-downloaded-release.sh --archive-file <path> [options]',
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
      'bash ./${helperFile} --archive-file ./${assetsByKind.archive}',
    );
    expect(releaseBodyStep).toContain('The extracted directory name should match');
    expect(releaseBodyStep).toContain('bundle_dir_name: ${bundleDirName}');
    expect(releaseBodyStep).toContain('assetsByKind.metadata');
  });

  it('keeps the workflow run summary guidance aligned with the downloaded helper contract', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const downloadedHelperScript = fs.readFileSync(
      path.resolve('ops/verify-downloaded-release.sh'),
      'utf8',
    );
    const summaryStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Write workflow run summary'),
    );

    expect(downloadedHelperScript).toContain(
      'Usage: ops/verify-downloaded-release.sh --archive-file <path> [options]',
    );
    expect(summaryStep).toContain('Recommended verification order:');
    expect(summaryStep).toContain('bash -n ./${metadata.helper_file}');
    expect(summaryStep).toContain(
      'bash ./${metadata.helper_file} --archive-file ./${assetsByKind.archive}',
    );
  });

  it('keeps prerelease status aligned across workflow outputs, metadata, release body, and run summary', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const summaryStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Write workflow run summary'),
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );
    const publishReleaseJob = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );

    expect(releaseBundleWorkflow).toContain('      - name: Derive release prerelease flag');
    expect(releaseBundleWorkflow).toContain('echo "prerelease=$is_prerelease" >> "$GITHUB_OUTPUT"');
    expect(releaseBundleWorkflow).toContain(
      '      prerelease: ${{ steps.release_flags.outputs.prerelease }}',
    );
    expect(releaseBundleWorkflow).toContain("prerelease: process.env.PRERELEASE === 'true'");
    expect(releaseBundleWorkflow).toContain(
      "const releaseTypeLabel = metadata.prerelease ? 'Prerelease' : 'Full release';",
    );
    expect(summaryStep).toContain("['Release status', releaseTypeLabel]");
    expect(publishReleaseJob).toContain('uses: softprops/action-gh-release@v2');
    expect(publishReleaseJob).toContain(
      'prerelease: ${{ needs.release-bundle.outputs.prerelease }}',
    );
  });

  it('keeps the default release bundle verification chain aligned with the documented workflow steps', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8');
    const deploymentDoc = fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8');
    const releaseBundleJob = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('  release-bundle:'),
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );

    expect(readme).toContain(
      'GitHub Actions `Release Bundle`：支持手动触发和 `v*` tag push；默认都会执行 `pnpm test`、`pnpm build`、静态 preflight、release bundle 生成与校验。',
    );
    expect(deploymentDoc).toContain(
      '默认会执行 `pnpm test`、`pnpm build`、静态 `preflight`、`release:bundle` 和 `release:verify`',
    );

    expectOrdered(releaseBundleJob, [
      '      - name: Run tests',
      '      - name: Build',
      '      - name: Run static preflight',
      '      - name: Generate release bundle',
      '      - name: Verify release bundle',
      '      - name: Archive release bundle',
      '      - name: Verify archived release bundle',
      '      - name: Generate archived release bundle checksum sidecar',
      '      - name: Verify archived release bundle checksum sidecar',
      '      - name: Stage downloaded release verification helper',
      '      - name: Generate archived release bundle metadata',
      '      - name: Verify archived release bundle metadata',
      '      - name: Verify standalone downloaded release helper',
    ]);
  });

  it('keeps release-bundle concurrency and timeout protections aligned with deployment guidance', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const deploymentDoc = fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8');
    const releaseBundleJob = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('  release-bundle:'),
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );
    const publishReleaseJob = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );

    expect(deploymentDoc).toContain(
      'workflow 还会把同一 ref 的 run 串行化，并给 build / publish job 加超时保护，避免并发运行或卡死 runner 时互相踩资产',
    );

    expect(releaseBundleWorkflow).toContain('concurrency:');
    expect(releaseBundleWorkflow).toContain(
      '  group: ${{ github.workflow }}-${{ github.ref || github.run_id }}',
    );
    expect(releaseBundleWorkflow).toContain('  cancel-in-progress: false');

    expect(releaseBundleJob).toContain('    timeout-minutes: 45');
    expect(publishReleaseJob).toContain('    timeout-minutes: 20');
  });

  it('keeps release body and workflow summary status semantics aligned with the documented release guidance', () => {
    const releaseBundleWorkflow = fs.readFileSync(
      path.resolve('.github/workflows/release-bundle.yml'),
      'utf8',
    );
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8');
    const deploymentDoc = fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8');
    const summaryStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Write workflow run summary'),
      releaseBundleWorkflow.indexOf('  publish-release-asset:'),
    );
    const releaseBodyStep = releaseBundleWorkflow.slice(
      releaseBundleWorkflow.indexOf('      - name: Generate GitHub Release body'),
      releaseBundleWorkflow.indexOf('      - name: Publish release bundle assets to GitHub Release'),
    );

    for (const doc of [readme, deploymentDoc]) {
      expect(doc).toContain(
        '也会把该 tag 的 `prerelease` 和 `test_execution.summary` 对应的测试执行状态写成给人读的页面说明',
      );
    }

    expect(readme).toContain(
      '对手动 preview run，它会显示带 preview suffix 的最终派生命名；对 tag release（`v*` tag push），它会显示带 tag 版本号的最终派生命名，并把下一步指向 GitHub Release 页面。',
    );
    expect(deploymentDoc).toContain(
      '对手动 preview run，它会显示带 preview suffix 的最终派生命名；对 tag release（`v*` tag push），它会显示带 tag 版本号的最终派生命名，并把下一步指向 GitHub Release 页面',
    );

    expect(releaseBodyStep).toContain("['Release type', releaseTypeLabel]");
    expect(releaseBodyStep).toContain("['Tests summary', metadata.test_execution.summary]");
    expect(releaseBodyStep).toContain("['Verification helper', `\\`${helperFile}\\``]");

    expect(summaryStep).toContain("['Run mode', 'Tag release']");
    expect(summaryStep).toContain("['Release tag', `\\`${process.env.GITHUB_REF_NAME}\\``]");
    expect(summaryStep).toContain("['`pnpm test`', metadata.test_execution.summary]");
    expect(summaryStep).toContain("['Run mode', 'Manual preview']");
    expect(summaryStep).toContain(
      "['Requested `asset_suffix`', requestedPreviewSuffix ? `\\`${requestedPreviewSuffix}\\`` : '`not set`']",
    );
    expect(summaryStep).toContain(
      "['`asset_suffix` effective', requestedPreviewSuffix",
    );
    expect(summaryStep).toContain(
      'Next step: the publish job will attach the same files plus',
    );
    expect(summaryStep).toContain('to the [GitHub Release page](${releasePageUrl})');
    expect(summaryStep).toContain(
      ': `Next step: download the \\`${process.env.ARTIFACT_NAME}\\` artifact from this run; it now includes \\`${metadata.helper_file}\\` alongside the archive and sidecars.`,',
    );
  });
});
