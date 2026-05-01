import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = new Set<string>();

afterEach(() => {
  process.exitCode = undefined;
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('release verify cli', () => {
  it('parses args, exposes help text, and registers the release:verify script', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    expect(releaseVerify.parseReleaseVerifyArgs([])).toEqual({});
    expect(releaseVerify.parseReleaseVerifyArgs(['--input-dir', '/tmp/release'])).toEqual({
      inputDir: '/tmp/release',
    });
    expect(releaseVerify.parseReleaseVerifyArgs(['--', '--help'])).toEqual({
      showHelp: true,
    });
    expect(() => releaseVerify.parseReleaseVerifyArgs(['--input-dir'])).toThrow(
      '--input-dir requires a value',
    );
    expect(releaseVerify.getReleaseVerifyHelpText()).toContain('--input-dir <path>');

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['release:verify']).toBe('tsx src/server/cli/releaseVerify.ts');
  });

  it('fails when manifest or required bundle files are missing', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    const missingManifest = releaseVerify.runReleaseVerify({ inputDir });

    expect(missingManifest.ok).toBe(false);
    expect(missingManifest.missing).toEqual([
      {
        kind: 'manifest',
        name: 'manifest.json',
        target: path.join(inputDir, 'manifest.json'),
      },
    ]);

    writeManifest(inputDir, {
      ok: false,
      files: ['dist/server/index.js'],
      missing: ['dist/client/**'],
    });
    writeFile(inputDir, 'dist/server/index.js', 'console.log("server");\n');

    const incompleteBundle = releaseVerify.runReleaseVerify({ inputDir });
    expect(incompleteBundle.ok).toBe(false);
    expect(incompleteBundle.warnings).toEqual(
      expect.arrayContaining([
        {
          code: 'bundle-marked-incomplete',
          message: 'Bundle manifest is already marked incomplete',
          target: path.join(inputDir, 'manifest.json'),
        },
        {
          code: 'bundle-marked-missing',
          message: 'Bundle manifest recorded missing input: dist/client/**',
          target: 'dist/client/**',
        },
      ]),
    );
    expect(incompleteBundle.missing).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'package.json',
          target: path.join(inputDir, 'package.json'),
        },
        {
          kind: 'manifest-item',
          name: 'database/schema.sql',
          target: path.join(inputDir, 'database/schema.sql'),
        },
        {
          kind: 'manifest-item',
          name: 'docs/DEPLOYMENT.md',
          target: path.join(inputDir, 'docs/DEPLOYMENT.md'),
        },
        {
          kind: 'manifest-item',
          name: '.env.example',
          target: path.join(inputDir, '.env.example'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/client/index.html',
          target: path.join(inputDir, 'dist/client/index.html'),
        },
        {
          kind: 'manifest-item',
          name: 'pm2.config.js',
          target: path.join(inputDir, 'pm2.config.js'),
        },
      ]),
    );
  });

  it('fails when a recorded checksum does not match an existing bundle file', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    const serverContent = 'console.log("server");\n';
    writeRequiredBundleCore(inputDir, { serverContent });
    writeBundleNativeEntryScripts(inputDir);

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'database/schema.sql',
        'pnpm-lock.yaml',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
      ],
      missing: [],
      checksums: {
        'dist/server/index.js': createSha256Checksum('console.log("tampered");\n'),
      },
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(false);
    expect(summary.checks).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'dist/server/index.js',
          ok: false,
          target: path.join(inputDir, 'dist/server/index.js'),
        },
      ]),
    );
    expect(summary.missing).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'dist/server/index.js',
          target: path.join(inputDir, 'dist/server/index.js'),
        },
      ]),
    );
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'checksum-mismatch',
          target: path.join(inputDir, 'dist/server/index.js'),
        }),
      ]),
    );
    expect(createSha256Checksum(serverContent)).not.toBe(
      createSha256Checksum('console.log("tampered");\n'),
    );
  });

  it('fails when bundle contains files not declared in the manifest contract', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    writeRequiredBundleCore(inputDir);
    writeBundleNativeEntryScripts(inputDir);
    writeFile(inputDir, 'ops/debug.sh', '#!/usr/bin/env bash\n');

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'database/schema.sql',
        'pnpm-lock.yaml',
        'docs/DEPLOYMENT.md',
        '.env.example',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
        'ops/verify-downloaded-release.sh',
        'ops/verify-release.sh',
      ],
      missing: [],
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual([]);
    expect(summary.checks).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'ops/debug.sh',
          ok: false,
          target: path.join(inputDir, 'ops/debug.sh'),
        },
      ]),
    );
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        {
          code: 'unexpected-bundle-file',
          message: 'Bundle contains a regular file not declared by the release manifest: ops/debug.sh',
          target: path.join(inputDir, 'ops/debug.sh'),
        },
      ]),
    );
  });

  it('passes when manifest and required bundle files exist without checksum metadata', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    writeRequiredBundleCore(inputDir);
    writeBundleNativeEntryScripts(inputDir);

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'database/schema.sql',
        'pnpm-lock.yaml',
        'docs/DEPLOYMENT.md',
        '.env.example',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
        'ops/verify-downloaded-release.sh',
        'ops/verify-release.sh',
      ],
      missing: [],
    });

    const stdout = createStdoutBuffer();
    const summary = await releaseVerify.runReleaseVerifyCli(['--input-dir', inputDir], {
      stdout: stdout.stdout,
    });

    expect(summary).toEqual({
      ok: true,
      inputDir,
      manifestPath: path.join(inputDir, 'manifest.json'),
      checks: [
        {
          kind: 'manifest',
          name: 'manifest.json',
          ok: true,
          target: path.join(inputDir, 'manifest.json'),
        },
        {
          kind: 'manifest-item',
          name: 'package.json',
          ok: true,
          target: path.join(inputDir, 'package.json'),
        },
        {
          kind: 'manifest-item',
          name: 'database/schema.sql',
          ok: true,
          target: path.join(inputDir, 'database/schema.sql'),
        },
        {
          kind: 'manifest-item',
          name: 'pnpm-lock.yaml',
          ok: true,
          target: path.join(inputDir, 'pnpm-lock.yaml'),
        },
        {
          kind: 'manifest-item',
          name: 'docs/DEPLOYMENT.md',
          ok: true,
          target: path.join(inputDir, 'docs/DEPLOYMENT.md'),
        },
        {
          kind: 'manifest-item',
          name: '.env.example',
          ok: true,
          target: path.join(inputDir, '.env.example'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/server/index.js',
          ok: true,
          target: path.join(inputDir, 'dist/server/index.js'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/server/cli/deploymentSmoke.js',
          ok: true,
          target: path.join(inputDir, 'dist/server/cli/deploymentSmoke.js'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/server/cli/browserHandoffComplete.js',
          ok: true,
          target: path.join(inputDir, 'dist/server/cli/browserHandoffComplete.js'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/server/cli/inboxReplyHandoffComplete.js',
          ok: true,
          target: path.join(inputDir, 'dist/server/cli/inboxReplyHandoffComplete.js'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/server/cli/releaseVerify.js',
          ok: true,
          target: path.join(inputDir, 'dist/server/cli/releaseVerify.js'),
        },
        {
          kind: 'manifest-item',
          name: 'dist/client/index.html',
          ok: true,
          target: path.join(inputDir, 'dist/client/index.html'),
        },
        {
          kind: 'manifest-item',
          name: 'pm2.config.js',
          ok: true,
          target: path.join(inputDir, 'pm2.config.js'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/deploy-promobot.sh',
          ok: true,
          target: path.join(inputDir, 'ops/deploy-promobot.sh'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/deploy-release.sh',
          ok: true,
          target: path.join(inputDir, 'ops/deploy-release.sh'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/verify-downloaded-release.sh',
          ok: true,
          target: path.join(inputDir, 'ops/verify-downloaded-release.sh'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/verify-release.sh',
          ok: true,
          target: path.join(inputDir, 'ops/verify-release.sh'),
        },
      ],
      missing: [],
      warnings: [],
    });
    expect(JSON.parse(stdout.read())).toEqual(summary);
  });

  it('fails when required bundle files exist on disk but are omitted from manifest declarations', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    writeRequiredBundleCore(inputDir);
    writeBundleNativeEntryScripts(inputDir);

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'database/schema.sql',
        'pnpm-lock.yaml',
        'docs/DEPLOYMENT.md',
        '.env.example',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
      ],
      missing: [],
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual([]);
    expect(summary.checks).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'ops/verify-downloaded-release.sh',
          ok: false,
          target: path.join(inputDir, 'ops/verify-downloaded-release.sh'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/verify-release.sh',
          ok: false,
          target: path.join(inputDir, 'ops/verify-release.sh'),
        },
      ]),
    );
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        {
          code: 'unexpected-bundle-file',
          message:
            'Bundle contains a regular file not declared by the release manifest: ops/verify-downloaded-release.sh',
          target: path.join(inputDir, 'ops/verify-downloaded-release.sh'),
        },
        {
          code: 'unexpected-bundle-file',
          message:
            'Bundle contains a regular file not declared by the release manifest: ops/verify-release.sh',
          target: path.join(inputDir, 'ops/verify-release.sh'),
        },
      ]),
    );
  });

  it('fails when the downloaded release helper is absent from an otherwise valid bundle', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    writeRequiredBundleCore(inputDir);
    writeBundleNativeEntryScripts(inputDir, { includeDownloadedReleaseHelper: false });

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'pnpm-lock.yaml',
        'docs/DEPLOYMENT.md',
        '.env.example',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
        'ops/verify-release.sh',
      ],
      missing: [],
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'ops/verify-downloaded-release.sh',
          target: path.join(inputDir, 'ops/verify-downloaded-release.sh'),
        },
      ]),
    );
    expect(summary.checks).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'ops/verify-downloaded-release.sh',
          ok: false,
          target: path.join(inputDir, 'ops/verify-downloaded-release.sh'),
        },
      ]),
    );
  });

  it('fails when bundle-native release wrapper scripts are missing from an older manifest', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    writeRequiredBundleCore(inputDir);

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'database/schema.sql',
        'pnpm-lock.yaml',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
      ],
      missing: [],
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual(
      expect.arrayContaining([
        {
          kind: 'manifest-item',
          name: 'ops/deploy-release.sh',
          target: path.join(inputDir, 'ops/deploy-release.sh'),
        },
        {
          kind: 'manifest-item',
          name: 'ops/verify-release.sh',
          target: path.join(inputDir, 'ops/verify-release.sh'),
        },
      ]),
    );
  });

  it('passes when recorded checksums match existing bundle files', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    const serverContent = 'console.log("server");\n';
    const clientContent = '<!doctype html>\n';
    const pm2Content = 'export default {};\n';
    const deployScript = '#!/usr/bin/env bash\n';

    writeRequiredBundleCore(inputDir, {
      clientContent,
      deployScript,
      pm2Content,
      serverContent,
    });
    writeBundleNativeEntryScripts(inputDir);

    writeManifest(inputDir, {
      ok: true,
      files: [
        'package.json',
        'database/schema.sql',
        'pnpm-lock.yaml',
        'docs/DEPLOYMENT.md',
        '.env.example',
        'dist/server/index.js',
        'dist/server/cli/deploymentSmoke.js',
        'dist/server/cli/browserHandoffComplete.js',
        'dist/server/cli/inboxReplyHandoffComplete.js',
        'dist/server/cli/releaseVerify.js',
        'dist/client/index.html',
        'pm2.config.js',
        'ops/deploy-promobot.sh',
        'ops/deploy-release.sh',
        'ops/verify-downloaded-release.sh',
        'ops/verify-release.sh',
      ],
      missing: [],
      checksums: {
        'dist/server/index.js': createSha256Checksum(serverContent),
        'dist/client/index.html': createSha256Checksum(clientContent),
        'pm2.config.js': createSha256Checksum(pm2Content),
        'ops/deploy-promobot.sh': createSha256Checksum(deployScript),
      },
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(true);
    expect(summary.missing).toEqual([]);
    expect(summary.warnings).toEqual([]);
  });

  it('passes when an older manifest uses file-entry objects and checksum map', async () => {
    const releaseVerify = await loadReleaseVerifyModule();
    expect(releaseVerify).toBeTruthy();
    if (!releaseVerify) {
      return;
    }

    const inputDir = createTempDir();
    const serverContent = 'console.log("server");\n';

    writeRequiredBundleCore(inputDir, { serverContent });
    writeBundleNativeEntryScripts(inputDir);

    writeManifest(inputDir, {
      ok: true,
      files: [
        { path: 'package.json' },
        { path: 'database/schema.sql' },
        { relativePath: 'pnpm-lock.yaml' },
        { path: 'docs/DEPLOYMENT.md' },
        { relativePath: '.env.example' },
        { path: 'dist/server/index.js' },
        { relativePath: 'dist/server/cli/deploymentSmoke.js' },
        { path: 'dist/server/cli/browserHandoffComplete.js' },
        { path: 'dist/server/cli/inboxReplyHandoffComplete.js' },
        { name: 'dist/server/cli/releaseVerify.js' },
        { path: 'dist/client/index.html' },
        { relativePath: 'pm2.config.js' },
        { name: 'ops/deploy-promobot.sh' },
        { path: 'ops/deploy-release.sh' },
        { name: 'ops/verify-downloaded-release.sh' },
        { relativePath: 'ops/verify-release.sh' },
      ],
      missing: [],
      checksum: {
        'dist/server/index.js': createSha256Checksum(serverContent),
      },
    });

    const summary = releaseVerify.runReleaseVerify({ inputDir });

    expect(summary.ok).toBe(true);
    expect(summary.missing).toEqual([]);
    expect(summary.warnings).toEqual([]);
  });
});

async function loadReleaseVerifyModule() {
  try {
    return await import('../../src/server/cli/releaseVerify');
  } catch {
    return null;
  }
}

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promobot-release-verify-'));
  tempDirs.add(dir);
  return dir;
}

function writeManifest(
  inputDir: string,
  manifest: {
    ok: boolean;
    files: Array<string | { name?: string; path?: string; relativePath?: string }>;
    missing: string[];
    checksum?: Record<string, string>;
    checksums?: Record<string, string>;
  },
) {
  writeFile(
    inputDir,
    'manifest.json',
    JSON.stringify(
      {
        ...manifest,
        createdAt: '2026-04-25T10:00:00.000Z',
        repoRoot: '/tmp/promobot',
        outputDir: inputDir,
        manifestPath: path.join(inputDir, 'manifest.json'),
      },
      null,
      2,
    ),
  );
}

function createStdoutBuffer() {
  let stdout = '';

  return {
    stdout: {
      write(chunk: string) {
        stdout += chunk;
        return true;
      },
    },
    read() {
      return stdout;
    },
  };
}

function writeFile(rootDir: string, relativePath: string, content: string) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function writeBundleNativeEntryScripts(
  rootDir: string,
  options: {
    includeDownloadedReleaseHelper?: boolean;
  } = {},
) {
  writeFile(rootDir, 'ops/deploy-release.sh', '#!/usr/bin/env bash\n');
  if (options.includeDownloadedReleaseHelper !== false) {
    writeFile(rootDir, 'ops/verify-downloaded-release.sh', '#!/usr/bin/env bash\n');
  }
  writeFile(rootDir, 'ops/verify-release.sh', '#!/usr/bin/env bash\n');
}

function writeRequiredBundleCore(
  rootDir: string,
  content: {
    clientContent?: string;
    browserHandoffCompleteCliContent?: string;
    deployScript?: string;
    deploymentSmokeContent?: string;
    deploymentDocContent?: string;
    envExampleContent?: string;
    inboxReplyHandoffCompleteCliContent?: string;
    packageJsonContent?: string;
    pm2Content?: string;
    releaseVerifyCliContent?: string;
    serverContent?: string;
  } = {},
) {
  writeFile(rootDir, 'package.json', content.packageJsonContent ?? '{}\n');
  writeFile(rootDir, 'database/schema.sql', 'create table drafts (id integer primary key);\n');
  writeFile(rootDir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeFile(rootDir, 'docs/DEPLOYMENT.md', content.deploymentDocContent ?? '# Deploy\n');
  writeFile(rootDir, '.env.example', content.envExampleContent ?? 'ADMIN_PASSWORD=change-me\n');
  writeFile(rootDir, 'dist/server/index.js', content.serverContent ?? 'console.log("server");\n');
  writeFile(
    rootDir,
    'dist/server/cli/deploymentSmoke.js',
    content.deploymentSmokeContent ?? 'console.log("smoke");\n',
  );
  writeFile(
    rootDir,
    'dist/server/cli/browserHandoffComplete.js',
    content.browserHandoffCompleteCliContent ?? 'console.log("browser-handoff-complete");\n',
  );
  writeFile(
    rootDir,
    'dist/server/cli/inboxReplyHandoffComplete.js',
    content.inboxReplyHandoffCompleteCliContent ?? 'console.log("handoff-complete");\n',
  );
  writeFile(
    rootDir,
    'dist/server/cli/releaseVerify.js',
    content.releaseVerifyCliContent ?? 'console.log("verify");\n',
  );
  writeFile(rootDir, 'dist/client/index.html', content.clientContent ?? '<!doctype html>\n');
  writeFile(rootDir, 'pm2.config.js', content.pm2Content ?? 'export default {};\n');
  writeFile(
    rootDir,
    'ops/deploy-promobot.sh',
    content.deployScript ?? '#!/usr/bin/env bash\n',
  );
}

function createSha256Checksum(content: string) {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}
