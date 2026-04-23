import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnvFromRoot } from '../env.js';
import { getDatabasePath } from '../lib/persistence.js';

export interface RuntimeBackupArgs {
  outputDir?: string;
  showHelp?: boolean;
}

interface RuntimeBackupDependencies {
  now?: () => Date;
  repoRootDir?: string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

interface RuntimeBackupPaths {
  databasePath: string;
  databaseDestinationName: string;
  browserSessionsPath: string;
}

interface RuntimeBackupSummaryItem {
  kind: 'database' | 'browserSessions' | 'envFile';
  type: 'file' | 'directory';
  sourcePath: string;
  destinationPath: string;
}

interface RuntimeBackupMissingItem {
  kind: 'database' | 'browserSessions' | 'envFile';
  type: 'file' | 'directory';
  expectedPath: string;
}

interface RuntimeBackupSummary {
  ok: boolean;
  createdAt: string;
  repoRoot: string;
  outputDir: string;
  manifestPath: string;
  copied: RuntimeBackupSummaryItem[];
  missing: RuntimeBackupMissingItem[];
}

export function parseRuntimeBackupArgs(argv: string[]): RuntimeBackupArgs {
  const parsed: RuntimeBackupArgs = {};

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

export function getRuntimeBackupHelpText() {
  return [
    'Usage: tsx src/server/cli/runtimeBackup.ts [options]',
    '',
    'Create a point-in-time runtime backup under backups/<timestamp> by default.',
    '',
    'Options:',
    '  --output-dir <path>   Write the backup into a custom directory',
    '  --help                Show this help text',
  ].join('\n');
}

export async function runRuntimeBackupCli(
  argv: string[],
  dependencies: RuntimeBackupDependencies = {},
) {
  const parsed = parseRuntimeBackupArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;

  if (parsed.showHelp) {
    stdout.write(`${getRuntimeBackupHelpText()}\n`);
    return null;
  }

  const repoRootDir = path.resolve(dependencies.repoRootDir ?? resolveRepoRootDir());
  loadServerEnvFromRoot({ repoRootDir });

  const createdAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const outputDir = path.resolve(
    parsed.outputDir?.trim() || path.join(repoRootDir, 'backups', sanitizeTimestamp(createdAt)),
  );

  const summary: RuntimeBackupSummary = {
    ok: true,
    createdAt,
    repoRoot: repoRootDir,
    outputDir,
    manifestPath: path.join(outputDir, 'manifest.json'),
    copied: [],
    missing: [],
  };

  fs.mkdirSync(outputDir, { recursive: true });

  const runtimePaths = resolveRuntimePaths(repoRootDir);
  const envFilePath = path.join(repoRootDir, '.env');

  copyBackupItem(
    {
      kind: 'database',
      type: 'file',
      sourcePath: runtimePaths.databasePath,
      destinationPath: path.join(outputDir, 'database', runtimePaths.databaseDestinationName),
    },
    summary,
  );
  copyBackupItem(
    {
      kind: 'browserSessions',
      type: 'directory',
      sourcePath: runtimePaths.browserSessionsPath,
      destinationPath: path.join(outputDir, 'browser-sessions'),
    },
    summary,
  );
  copyBackupItem(
    {
      kind: 'envFile',
      type: 'file',
      sourcePath: envFilePath,
      destinationPath: path.join(outputDir, '.env'),
    },
    summary,
  );

  summary.ok = summary.missing.length === 0;

  fs.writeFileSync(summary.manifestPath, JSON.stringify(summary, null, 2), 'utf8');
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function applyRuntimeBackupExitCode(summary: RuntimeBackupSummary | null) {
  if (summary && !summary.ok) {
    process.exitCode = 1;
  }
}

function copyBackupItem(
  item: RuntimeBackupSummaryItem,
  summary: RuntimeBackupSummary,
) {
  if (!fs.existsSync(item.sourcePath)) {
    summary.missing.push({
      kind: item.kind,
      type: item.type,
      expectedPath: item.sourcePath,
    });
    return;
  }

  const stats = fs.statSync(item.sourcePath);
  const matchesType =
    (item.type === 'file' && stats.isFile()) || (item.type === 'directory' && stats.isDirectory());
  if (!matchesType) {
    summary.missing.push({
      kind: item.kind,
      type: item.type,
      expectedPath: item.sourcePath,
    });
    return;
  }

  fs.mkdirSync(path.dirname(item.destinationPath), { recursive: true });
  if (item.type === 'file') {
    fs.copyFileSync(item.sourcePath, item.destinationPath);
  } else {
    fs.cpSync(item.sourcePath, item.destinationPath, { recursive: true });
  }

  summary.copied.push(item);
}

function resolveRuntimePaths(repoRootDir: string): RuntimeBackupPaths {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:') {
    return {
      databasePath: ':memory:',
      databaseDestinationName: 'promobot.sqlite',
      browserSessionsPath: path.resolve(process.cwd(), 'data', 'browser-sessions'),
    };
  }

  if (databasePath.startsWith('file:')) {
    return {
      databasePath,
      databaseDestinationName: 'promobot.sqlite',
      browserSessionsPath: path.resolve(process.cwd(), 'data', 'browser-sessions'),
    };
  }

  const resolvedDatabasePath = path.isAbsolute(databasePath)
    ? databasePath
    : path.resolve(process.cwd(), databasePath);
  return {
    databasePath: resolvedDatabasePath,
    databaseDestinationName: path.basename(resolvedDatabasePath),
    browserSessionsPath: path.join(path.dirname(resolvedDatabasePath), 'browser-sessions'),
  };
}

function sanitizeTimestamp(value: string) {
  return value.replace(/:/g, '-');
}

function resolveRepoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

async function main() {
  const summary = await runRuntimeBackupCli(process.argv.slice(2));
  applyRuntimeBackupExitCode(summary);
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
