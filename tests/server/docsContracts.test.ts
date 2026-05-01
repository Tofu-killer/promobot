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
  });
});
