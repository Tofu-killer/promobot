import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseVerifyArgs {
  inputDir?: string;
  showHelp?: boolean;
}

interface ReleaseVerifyCliDependencies {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

interface ReleaseBundleManifest {
  ok?: boolean;
  createdAt?: string;
  repoRoot?: string;
  outputDir?: string;
  manifestPath?: string;
  files?: Array<string | ReleaseBundleManifestFileEntry>;
  missing?: string[];
  checksum?: Record<string, string>;
  checksums?: Record<string, string>;
}

interface ReleaseBundleManifestFileEntry {
  checksum?: string;
  name?: string;
  path?: string;
  relativePath?: string;
}

type ReleaseVerifyCheck =
  | {
      kind: 'manifest';
      name: 'manifest.json';
      ok: boolean;
      target: string;
    }
  | {
      kind: 'manifest-item';
      name: string;
      ok: boolean;
      target: string;
    };

export interface ReleaseVerifySummary {
  ok: boolean;
  inputDir: string;
  manifestPath: string;
  checks: ReleaseVerifyCheck[];
  missing: Array<{
    kind: 'manifest' | 'manifest-item';
    name: string;
    target: string;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    target: string;
  }>;
}

const REQUIRED_RELEASE_PATHS = [
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
  'ops/verify-release.sh',
] as const;

interface ReleaseVerifyManifestFile {
  checksum?: string;
  relativePath: string;
}

export function parseReleaseVerifyArgs(argv: string[]): ReleaseVerifyArgs {
  const parsed: ReleaseVerifyArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (token === '--input-dir') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--input-dir requires a value');
      }
      parsed.inputDir = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getReleaseVerifyHelpText() {
  return [
    'Usage: tsx src/server/cli/releaseVerify.ts [options]',
    '',
    'Verify a directory-based release bundle and print a JSON summary.',
    '',
    'Options:',
    '  --input-dir <path>   Release bundle directory to verify',
    '  --help               Show this help text',
  ].join('\n');
}

export function runReleaseVerify(input: { inputDir: string }): ReleaseVerifySummary {
  const inputDir = path.resolve(input.inputDir);
  const manifestPath = path.join(inputDir, 'manifest.json');
  const checks: ReleaseVerifyCheck[] = [];
  const missing: ReleaseVerifySummary['missing'] = [];
  const warnings: ReleaseVerifySummary['warnings'] = [];

  const manifestExists = fs.existsSync(manifestPath);
  checks.push({
    kind: 'manifest',
    name: 'manifest.json',
    ok: manifestExists,
    target: manifestPath,
  });
  if (!manifestExists) {
    missing.push({
      kind: 'manifest',
      name: 'manifest.json',
      target: manifestPath,
    });
    return {
      ok: false,
      inputDir,
      manifestPath,
      checks,
      missing,
      warnings,
    };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ReleaseBundleManifest;
  const manifestFiles = normalizeManifestFiles(manifest);
  const manifestChecksums = getManifestChecksumMap(manifest);
  const manifestFilePaths = new Set(manifestFiles.map((entry) => entry.relativePath));
  const manifestMissing = Array.isArray(manifest.missing) ? manifest.missing : [];

  if (manifest.ok === false) {
    warnings.push({
      code: 'bundle-marked-incomplete',
      message: 'Bundle manifest is already marked incomplete',
      target: manifestPath,
    });
  }

  for (const manifestFile of manifestFiles) {
    recordManifestItemCheck({
      checks,
      checksum: manifestFile.checksum,
      inputDir,
      missing,
      relativePath: manifestFile.relativePath,
      warnings,
    });
  }

  for (const requiredPath of REQUIRED_RELEASE_PATHS) {
    if (manifestFilePaths.has(requiredPath)) {
      continue;
    }

    recordManifestItemCheck({
      checks,
      checksum: manifestChecksums.get(requiredPath),
      inputDir,
      missing,
      relativePath: requiredPath,
      warnings,
    });
  }

  if (manifestMissing.length > 0) {
    for (const missingSpec of manifestMissing) {
      warnings.push({
        code: 'bundle-marked-missing',
        message: `Bundle manifest recorded missing input: ${missingSpec}`,
        target: missingSpec,
      });
    }
  }

  return {
    ok: missing.length === 0 && manifestMissing.length === 0 && manifest.ok !== false,
    inputDir,
    manifestPath,
    checks,
    missing,
    warnings,
  };
}

function recordManifestItemCheck(input: {
  checks: ReleaseVerifyCheck[];
  checksum?: string;
  inputDir: string;
  missing: ReleaseVerifySummary['missing'];
  relativePath: string;
  warnings: ReleaseVerifySummary['warnings'];
}) {
  const target = path.join(input.inputDir, input.relativePath);
  const exists = fs.existsSync(target);
  const check: ReleaseVerifyCheck = {
    kind: 'manifest-item',
    name: input.relativePath,
    ok: exists,
    target,
  };

  if (!exists) {
    input.checks.push(check);
    input.missing.push({
      kind: 'manifest-item',
      name: input.relativePath,
      target,
    });
    return;
  }

  const checksum = input.checksum?.trim();
  if (!checksum) {
    input.checks.push(check);
    return;
  }

  const checksumResult = verifyFileChecksum(target, checksum);
  if (checksumResult.ok) {
    input.checks.push(check);
    return;
  }

  input.checks.push({
    ...check,
    ok: false,
  });
  input.missing.push({
    kind: 'manifest-item',
    name: input.relativePath,
    target,
  });
  input.warnings.push({
    code: checksumResult.code,
    message: checksumResult.message,
    target,
  });
}

function normalizeManifestFiles(manifest: ReleaseBundleManifest): ReleaseVerifyManifestFile[] {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const checksumMap = getManifestChecksumMap(manifest);
  const normalizedFiles: ReleaseVerifyManifestFile[] = [];

  for (const entry of files) {
    if (typeof entry === 'string') {
      const relativePath = entry.trim();
      if (!relativePath) {
        continue;
      }
      normalizedFiles.push({
        checksum: checksumMap.get(relativePath),
        relativePath,
      });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const relativePath =
      readOptionalString(entry.path) ??
      readOptionalString(entry.relativePath) ??
      readOptionalString(entry.name);
    if (!relativePath) {
      continue;
    }

    normalizedFiles.push({
      checksum: readOptionalString(entry.checksum) ?? checksumMap.get(relativePath),
      relativePath,
    });
  }

  return normalizedFiles;
}

function getManifestChecksumMap(manifest: ReleaseBundleManifest) {
  const checksumMap = new Map<string, string>();

  for (const source of [manifest.checksums, manifest.checksum]) {
    if (!isRecord(source)) {
      continue;
    }

    for (const [relativePath, checksum] of Object.entries(source)) {
      const normalizedPath = relativePath.trim();
      const normalizedChecksum = readOptionalString(checksum);
      if (!normalizedPath || !normalizedChecksum) {
        continue;
      }

      checksumMap.set(normalizedPath, normalizedChecksum);
    }
  }

  return checksumMap;
}

function verifyFileChecksum(target: string, expectedChecksum: string) {
  const parsedChecksum = parseExpectedChecksum(expectedChecksum);
  if (!parsedChecksum) {
    return {
      ok: false as const,
      code: 'checksum-invalid',
      message: `Bundle manifest recorded an invalid checksum for ${path.basename(target)}`,
    };
  }

  try {
    const actualDigest = crypto
      .createHash(parsedChecksum.algorithm)
      .update(fs.readFileSync(target))
      .digest('hex')
      .toLowerCase();
    const actualChecksum = `${parsedChecksum.algorithm}:${actualDigest}`;

    if (actualDigest === parsedChecksum.digest) {
      return {
        ok: true as const,
      };
    }

    return {
      ok: false as const,
      code: 'checksum-mismatch',
      message: `Bundle checksum mismatch for ${target}: expected ${parsedChecksum.normalized}, got ${actualChecksum}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      code: 'checksum-invalid',
      message: `Bundle checksum could not be verified for ${target}: ${message}`,
    };
  }
}

function parseExpectedChecksum(expectedChecksum: string) {
  const trimmedChecksum = expectedChecksum.trim();
  if (!trimmedChecksum) {
    return null;
  }

  const separatorIndex = trimmedChecksum.indexOf(':');
  if (separatorIndex === -1) {
    return {
      algorithm: 'sha256',
      digest: trimmedChecksum.toLowerCase(),
      normalized: `sha256:${trimmedChecksum.toLowerCase()}`,
    };
  }

  const algorithm = trimmedChecksum.slice(0, separatorIndex).trim().toLowerCase();
  const digest = trimmedChecksum.slice(separatorIndex + 1).trim().toLowerCase();
  if (!algorithm || !digest) {
    return null;
  }

  return {
    algorithm,
    digest,
    normalized: `${algorithm}:${digest}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue || undefined;
}

export async function runReleaseVerifyCli(
  argv: string[],
  dependencies: ReleaseVerifyCliDependencies = {},
) {
  const parsed = parseReleaseVerifyArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;

  if (parsed.showHelp) {
    stdout.write(`${getReleaseVerifyHelpText()}\n`);
    return null;
  }

  if (!parsed.inputDir?.trim()) {
    throw new Error('--input-dir is required');
  }

  const summary = runReleaseVerify({
    inputDir: parsed.inputDir,
  });
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
  return summary;
}

function resolveRepoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

async function main() {
  const parsed = parseReleaseVerifyArgs(process.argv.slice(2));
  if (!parsed.inputDir && !parsed.showHelp) {
    throw new Error('--input-dir is required');
  }

  if (parsed.showHelp) {
    process.stdout.write(`${getReleaseVerifyHelpText()}\n`);
    return;
  }

  await runReleaseVerifyCli(['--input-dir', parsed.inputDir ?? '']);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

void resolveRepoRootDir;

if (isMainModule) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
