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
  files?: string[];
  missing?: string[];
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
  'dist/server/index.js',
  'dist/client/index.html',
  'pm2.config.js',
  'ops/deploy-promobot.sh',
] as const;

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
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const manifestMissing = Array.isArray(manifest.missing) ? manifest.missing : [];

  if (manifest.ok === false) {
    warnings.push({
      code: 'bundle-marked-incomplete',
      message: 'Bundle manifest is already marked incomplete',
      target: manifestPath,
    });
  }

  for (const relativePath of manifestFiles) {
    const target = path.join(inputDir, relativePath);
    const ok = fs.existsSync(target);
    checks.push({
      kind: 'manifest-item',
      name: relativePath,
      ok,
      target,
    });
    if (!ok) {
      missing.push({
        kind: 'manifest-item',
        name: relativePath,
        target,
      });
    }
  }

  for (const requiredPath of REQUIRED_RELEASE_PATHS) {
    if (manifestFiles.includes(requiredPath)) {
      continue;
    }

    const target = path.join(inputDir, requiredPath);
    const ok = fs.existsSync(target);
    checks.push({
      kind: 'manifest-item',
      name: requiredPath,
      ok,
      target,
    });
    if (!ok) {
      missing.push({
        kind: 'manifest-item',
        name: requiredPath,
        target,
      });
    }
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
