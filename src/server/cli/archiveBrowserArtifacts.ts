import {
  archiveBrowserArtifacts,
  type ArchiveBrowserArtifactsOptions,
  type ArchiveBrowserArtifactsSummary,
} from '../services/browser/artifactArchiver.js';

export interface ArchiveBrowserArtifactsCliArgs {
  apply: boolean;
  includeResults: boolean;
  olderThanHours: number;
  showHelp?: boolean;
}

export interface ArchiveBrowserArtifactsCliDependencies {
  now?: () => Date;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

export function parseArchiveBrowserArtifactsArgs(argv: string[]): ArchiveBrowserArtifactsCliArgs {
  const parsed: ArchiveBrowserArtifactsCliArgs = {
    apply: false,
    includeResults: false,
    olderThanHours: 24,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (token === '--apply') {
      parsed.apply = true;
      continue;
    }

    if (token === '--include-results') {
      parsed.includeResults = true;
      continue;
    }

    if (token === '--older-than-hours') {
      const nextValue = argv[index + 1];
      const parsedValue = Number(nextValue);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        throw new Error('older-than-hours must be a positive number');
      }

      parsed.olderThanHours = parsedValue;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getArchiveBrowserArtifactsHelpText() {
  return [
    'Usage: tsx src/server/cli/archiveBrowserArtifacts.ts [options]',
    '',
    'Archive old non-pending browser artifacts into artifacts/archive/. Defaults to dry-run.',
    '',
    'Options:',
    '  --apply                   Move eligible files into artifacts/archive/',
    '  --older-than-hours <n>    Archive artifacts older than n hours (default: 24)',
    '  --include-results         Include consumed browser lane result artifacts',
    '  --help                    Show this help text',
  ].join('\n');
}

export async function runArchiveBrowserArtifactsCli(
  argv: string[],
  dependencies: ArchiveBrowserArtifactsCliDependencies = {},
): Promise<ArchiveBrowserArtifactsSummary | null> {
  const input = parseArchiveBrowserArtifactsArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;

  if (input.showHelp) {
    stdout.write(`${getArchiveBrowserArtifactsHelpText()}\n`);
    return null;
  }

  const options: ArchiveBrowserArtifactsOptions = {
    apply: input.apply,
    includeResults: input.includeResults,
    olderThanHours: input.olderThanHours,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  };
  const summary = archiveBrowserArtifacts(options);

  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  await runArchiveBrowserArtifactsCli(process.argv.slice(2));
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
