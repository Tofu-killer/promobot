import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function sliceSection(content: string, startMarker: string, endMarker?: string): string {
  const startIndex = content.indexOf(startMarker);
  expect(startIndex).toBeGreaterThanOrEqual(0);

  if (!endMarker) {
    return content.slice(startIndex);
  }

  const endIndex = content.indexOf(endMarker, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}

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

describe('deployment document contracts', () => {
  it('keeps the README command examples and release flow wording build-first', () => {
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8');
    const devSection = sliceSection(readme, '## 开发与验证', '## Release Bundle 直接部署');
    const releaseFlowSection = sliceSection(readme, '## 最终交付 / 验收流程', '## 生产运维补充');

    expectOrdered(devSection, [
      'pnpm build',
      'pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD',
      'pnpm release:bundle -- --output-dir /tmp/promobot-release',
    ]);
    expect(releaseFlowSection).toContain(
      '最终交付建议把记录统一按 `build -> preflight -> verify -> deploy -> smoke` 五段收口。',
    );
    expect(releaseFlowSection).toContain(
      '如果走 release bundle 交付，则在 `preflight` 和 `verify` 之间补一段 `release bundle`。',
    );
    expect(devSection).toContain(
      'pnpm preflight:local -- --require-env AI_API_KEY,ADMIN_PASSWORD --skip-smoke',
    );
    expect(devSection).toContain(
      '- `pnpm preflight:local -- [options]`：先跑 `preflight:prod`，并把 `--require-env` 这类 prod preflight 参数透传过去，再按需追加 smoke check',
    );
    expect(devSection).toContain(
      '- `pnpm verify:release -- --input-dir <path>`：调用 shell wrapper 校验目录型 release bundle；在源码仓库里会转到 `release:verify`，在已解压的 bundle 根目录里会改用 bundle 自带的 compiled verifier；若显式加 `--smoke`，当前 checkout 还必须提供对应的 `deploymentSmoke` CLI，否则 wrapper 会直接失败',
    );
  });

  it('keeps DEPLOYMENT source and bundle stage mappings aligned with the executable order', () => {
    const deploymentDoc = fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8');
    const releaseFlowSection = sliceSection(
      deploymentDoc,
      '## 最终交付 / 验收流程',
      '## 用 PM2 运行',
    );
    const sourceDeploySection = sliceSection(
      releaseFlowSection,
      '### 路径 A：源码仓库部署',
      '### 路径 B：release bundle 直接部署',
    );
    const bundleDeploySection = sliceSection(
      releaseFlowSection,
      '### 路径 B：release bundle 直接部署',
    );

    expect(releaseFlowSection).toContain(
      '最终交付建议按同一套五段门禁收口：`build -> preflight -> verify -> deploy -> smoke`。',
    );
    expect(releaseFlowSection).toContain(
      '如果走 release bundle 交付，则在 `preflight` 和 `verify` 之间补一段 `release bundle`。',
    );
    expectOrdered(sourceDeploySection, [
      '- `build`：`pnpm build`',
      '- `preflight`：`pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD`',
      '- `verify`：`pnpm test`',
      '- `deploy`：`pnpm deploy:local -- --skip-install --skip-smoke`',
      '- `smoke`：`pnpm smoke:server -- --base-url http://127.0.0.1:3001`',
    ]);
    expectOrdered(bundleDeploySection, [
      '- `build`：`pnpm build`',
      '- `preflight`：`pnpm preflight:prod -- --require-env AI_API_KEY,ADMIN_PASSWORD`',
      '- `release bundle`：`pnpm release:bundle -- --output-dir /tmp/promobot-release`',
      '- `verify`：在源码仓库里执行 `pnpm verify:release -- --input-dir /tmp/promobot-release`',
      '- `deploy`：在 bundle 根目录执行 `pnpm release:deploy -- --skip-smoke`',
      '- `smoke`：在 bundle 根目录执行 `node dist/server/cli/deploymentSmoke.js --base-url http://127.0.0.1:3001`',
    ]);
    expect(deploymentDoc).toContain(
      'pnpm preflight:local -- --require-env AI_API_KEY,ADMIN_PASSWORD --skip-smoke',
    );
    expect(deploymentDoc).toContain(
      '它会先调用 `preflight:prod`，所以也支持把 `--require-env` 这类 prod preflight 参数透传过去，再按需追加 smoke check。',
    );
    expect(deploymentDoc).toContain(
      '如果显式加 `--smoke`，当前 checkout 或已解压 bundle 根目录里还必须存在对应的 smoke CLI：源码仓库要有 `src/server/cli/deploymentSmoke.ts`，bundle 根目录要有 `dist/server/cli/deploymentSmoke.js`；缺少对应入口时 wrapper 会直接失败。',
    );
  });

  it('keeps metadata sidecar schema wording aligned with workflow test_execution fields', () => {
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8');
    const deploymentDoc = fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8');

    for (const doc of [readme, deploymentDoc]) {
      expect(doc).toContain('`test_execution.summary`');
      expect(doc).toContain('`test_execution.state`');
      expect(doc).toContain('`test_execution.mode`');
      expect(doc).not.toContain('新增的 `tests_summary`');
      expect(doc).not.toContain('`tests_summary` 只描述这次 metadata sidecar');
      expect(doc).not.toContain('`.metadata.json` metadata sidecar 里的 `schema_version`、`checksum_algorithm`、`archive_format`、`artifact_name`、`event_name`、`prerelease`、`generated_at`、`run_url`、`release_url`、`tests_summary`');
      expect(doc).not.toContain('读取 `schema_version` / `checksum_algorithm` / `archive_format` / ref / commit / `generated_at` / `run_url` / `release_url` / `tests_summary`');
      expect(doc).not.toContain('查看 `.metadata.json` 中的 `schema_version` / `checksum_algorithm` / `archive_format` / ref / commit / `generated_at` / `run_url` / `release_url` / `tests_summary`');
    }
  });
});
