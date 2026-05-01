import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseBundleArgs {
  outputDir?: string;
  showHelp?: boolean;
}

export interface ReleaseBundleSummary {
  checksums: Record<string, string>;
  createdAt: string;
  files: string[];
  manifestPath: string;
  missing: string[];
  ok: boolean;
  outputDir: string;
  repoRoot: string;
}

interface RunReleaseBundleInput {
  outputDir: string;
  repoRoot: string;
}

interface RunReleaseBundleDependencies {
  now?: () => Date;
}

interface ReleaseBundleCliDependencies extends RunReleaseBundleDependencies {
  repoRootDir?: string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

const REQUIRED_DIRECTORIES = [
  {
    destinationRelativePath: path.join('dist', 'server'),
    relativePath: path.join('dist', 'server'),
    spec: 'dist/server/**',
  },
  {
    destinationRelativePath: path.join('dist', 'client'),
    relativePath: path.join('dist', 'client'),
    spec: 'dist/client/**',
  },
] as const;

const REQUIRED_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pm2.config.js',
  path.join('database', 'schema.sql'),
  path.join('docs', 'DEPLOYMENT.md'),
  '.env.example',
  path.join('dist', 'server', 'index.js'),
  path.join('dist', 'server', 'cli', 'deploymentSmoke.js'),
  path.join('dist', 'server', 'cli', 'inboxReplyHandoffComplete.js'),
  path.join('dist', 'server', 'cli', 'releaseVerify.js'),
  path.join('dist', 'client', 'index.html'),
  path.join('ops', 'deploy-promobot.sh'),
  path.join('ops', 'deploy-release.sh'),
  path.join('ops', 'verify-release.sh'),
] as const;

export function parseReleaseBundleArgs(argv: string[]): ReleaseBundleArgs {
  const parsed: ReleaseBundleArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (token === '--output-dir') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--output-dir requires a value');
      }

      parsed.outputDir = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getReleaseBundleHelpText() {
  return [
    'Usage: pnpm release:bundle [--output-dir <path>]',
    '',
    'Copy the deployment-ready bundle into release/ by default and emit manifest.json.',
    '',
    'Options:',
    '  --output-dir <path>   Write the bundle into a custom directory',
    '  --help                Show this help text',
  ].join('\n');
}

export function runReleaseBundle(
  input: RunReleaseBundleInput,
  dependencies: RunReleaseBundleDependencies = {},
): ReleaseBundleSummary {
  const repoRoot = path.resolve(input.repoRoot);
  const outputDir = path.resolve(input.outputDir);
  const manifestPath = path.join(outputDir, 'manifest.json');
  const createdAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const copiedFiles = new Set<string>();
  const missing: string[] = [];

  prepareOutputDir(outputDir);

  for (const directory of REQUIRED_DIRECTORIES) {
    copyRequiredDirectory({
      copiedFiles,
      destinationRelativePath: directory.destinationRelativePath,
      destinationDir: path.join(outputDir, directory.destinationRelativePath),
      missing,
      sourceDir: path.join(repoRoot, directory.relativePath),
      spec: directory.spec,
    });
  }

  for (const relativePath of REQUIRED_FILES) {
    copyRequiredFile({
      copiedFiles,
      destinationRelativePath: relativePath,
      destinationPath: path.join(outputDir, relativePath),
      missing,
      sourcePath: path.join(repoRoot, relativePath),
      spec: toPosixPath(relativePath),
    });
  }

  copyRequiredOpsScripts({
    copiedFiles,
    destinationDir: path.join(outputDir, 'ops'),
    missing,
    sourceDir: path.join(repoRoot, 'ops'),
  });

  const bundledFiles = sortRelativePaths([...copiedFiles]);
  const summary: ReleaseBundleSummary = {
    ok: missing.length === 0,
    checksums: createFileChecksums(outputDir, bundledFiles),
    createdAt,
    repoRoot,
    outputDir,
    manifestPath,
    files: sortRelativePaths([...bundledFiles, 'manifest.json']),
    missing,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(summary, null, 2), 'utf8');

  return summary;
}

export async function runReleaseBundleCli(
  argv: string[],
  dependencies: ReleaseBundleCliDependencies = {},
) {
  const parsed = parseReleaseBundleArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;

  if (parsed.showHelp) {
    stdout.write(`${getReleaseBundleHelpText()}\n`);
    return null;
  }

  const repoRoot = path.resolve(dependencies.repoRootDir ?? resolveRepoRootDir());
  const outputDir = path.resolve(parsed.outputDir?.trim() || path.join(repoRoot, 'release'));
  const summary = runReleaseBundle(
    {
      repoRoot,
      outputDir,
    },
    {
      now: dependencies.now,
    },
  );

  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function applyReleaseBundleExitCode(summary: { ok: boolean } | null) {
  if (summary && !summary.ok) {
    process.exitCode = 1;
  }
}

function copyRequiredDirectory(input: {
  copiedFiles: Set<string>;
  destinationRelativePath: string;
  destinationDir: string;
  missing: string[];
  sourceDir: string;
  spec: string;
}) {
  const sourceFiles = listFilesRecursively(input.sourceDir);
  if (sourceFiles.length === 0) {
    input.missing.push(input.spec);
    return;
  }

  fs.mkdirSync(path.dirname(input.destinationDir), { recursive: true });
  fs.cpSync(input.sourceDir, input.destinationDir, { recursive: true });

  for (const sourceFile of sourceFiles) {
    const sourceRelativePath = path.relative(input.sourceDir, sourceFile);
    const destinationRelativePath = path.join(
      input.destinationRelativePath,
      sourceRelativePath,
    );
    input.copiedFiles.add(toPosixPath(destinationRelativePath));
  }
}

function copyRequiredFile(input: {
  copiedFiles: Set<string>;
  destinationRelativePath: string;
  destinationPath: string;
  missing: string[];
  sourcePath: string;
  spec: string;
}) {
  if (!isRegularFile(input.sourcePath)) {
    input.missing.push(input.spec);
    return;
  }

  fs.mkdirSync(path.dirname(input.destinationPath), { recursive: true });
  fs.copyFileSync(input.sourcePath, input.destinationPath);
  input.copiedFiles.add(toPosixPath(input.destinationRelativePath));
}

function copyRequiredOpsScripts(input: {
  copiedFiles: Set<string>;
  destinationDir: string;
  missing: string[];
  sourceDir: string;
}) {
  if (!isDirectory(input.sourceDir)) {
    input.missing.push('ops/*.sh');
    return;
  }

  const entries = fs
    .readdirSync(input.sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sh'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (entries.length === 0) {
    input.missing.push('ops/*.sh');
    return;
  }

  fs.mkdirSync(input.destinationDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(input.sourceDir, entry);
    const destinationPath = path.join(input.destinationDir, entry);
    fs.copyFileSync(sourcePath, destinationPath);
    input.copiedFiles.add(toPosixPath(path.join('ops', entry)));
  }
}

function listFilesRecursively(targetPath: string): string[] {
  if (!isDirectory(targetPath)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function prepareOutputDir(outputDir: string) {
  fs.mkdirSync(outputDir, { recursive: true });

  removeOutputTarget(path.join(outputDir, 'dist', 'server'));
  removeOutputTarget(path.join(outputDir, 'dist', 'client'));
  removeOutputTarget(path.join(outputDir, '.env.example'));
  removeOutputTarget(path.join(outputDir, 'docs', 'DEPLOYMENT.md'));
  removeOutputTarget(path.join(outputDir, 'ops'));
  removeOutputTarget(path.join(outputDir, 'package.json'));
  removeOutputTarget(path.join(outputDir, 'pm2.config.js'));
  removeOutputTarget(path.join(outputDir, 'pnpm-lock.yaml'));
  removeOutputTarget(path.join(outputDir, 'manifest.json'));
}

function removeOutputTarget(targetPath: string) {
  fs.rmSync(targetPath, { force: true, recursive: true });
}

function isDirectory(targetPath: string) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(targetPath: string) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function sortRelativePaths(paths: string[]) {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function createFileChecksums(outputDir: string, relativePaths: string[]) {
  return Object.fromEntries(
    relativePaths.map((relativePath) => [
      relativePath,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(outputDir, relativePath)))
        .digest('hex'),
    ]),
  );
}

function toPosixPath(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

function resolveRepoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

async function main() {
  const summary = await runReleaseBundleCli(process.argv.slice(2));
  applyReleaseBundleExitCode(summary);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMainModule) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
