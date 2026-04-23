import {
  BrowserHandoffCompletionSubmitError,
  submitBrowserHandoffCompletion,
  type SubmitBrowserHandoffCompletionInput,
} from '../services/publishers/browserHandoffCompletionSubmitter.js';

export function parseBrowserHandoffCompleteArgs(argv: string[]): SubmitBrowserHandoffCompletionInput & {
  showHelp?: boolean;
} {
  const parsed: SubmitBrowserHandoffCompletionInput & { showHelp?: boolean } = {
    artifactPath: '',
    publishStatus: 'published',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (token === '--artifact-path') {
      parsed.artifactPath = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--status') {
      parsed.publishStatus = nextValue === 'failed' ? 'failed' : 'published';
      index += 1;
      continue;
    }

    if (token === '--message') {
      parsed.message = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--publish-url') {
      parsed.publishUrl = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--external-id') {
      parsed.externalId = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--published-at') {
      parsed.publishedAt = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--base-url') {
      parsed.importBaseUrl = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--admin-password') {
      parsed.adminPassword = nextValue ?? '';
      index += 1;
      continue;
    }
  }

  return parsed;
}

export function getBrowserHandoffCompleteHelpText() {
  return [
    'Usage: tsx src/server/cli/browserHandoffComplete.ts --artifact-path <path> [options]',
    '',
    'Required:',
    '  --artifact-path <path>       Existing browser handoff artifact path',
    '',
    'Optional:',
    '  --status <published|failed>  Defaults to published',
    '  --message <text>',
    '  --publish-url <url>',
    '  --external-id <id>',
    '  --published-at <iso8601>',
    '  --base-url <origin>          Import through /api/system/browser-handoffs/import',
    '  --admin-password <value>     Required when --base-url is provided',
    '  --help',
  ].join('\n');
}

async function main() {
  const input = parseBrowserHandoffCompleteArgs(process.argv.slice(2));
  if (input.showHelp) {
    process.stdout.write(`${getBrowserHandoffCompleteHelpText()}\n`);
    return;
  }

  if (!input.artifactPath.trim()) {
    throw new BrowserHandoffCompletionSubmitError('artifactPath is required', 400);
  }

  const result = await submitBrowserHandoffCompletion(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMainModule) {
  void main().catch((error) => {
    if (error instanceof BrowserHandoffCompletionSubmitError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
