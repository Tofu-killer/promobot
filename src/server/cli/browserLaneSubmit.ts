import {
  SessionRequestResultSubmitError,
  submitSessionRequestResult,
  type SubmitSessionRequestResultInput,
} from '../services/browser/sessionResultSubmitter.js';

export function parseBrowserLaneSubmitArgs(argv: string[]): SubmitSessionRequestResultInput & {
  showHelp?: boolean;
} {
  const parsed: SubmitSessionRequestResultInput & { showHelp?: boolean } = {
    requestArtifactPath: '',
    storageStateFilePath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (token === '--request-artifact') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--request-artifact requires a value');
      }
      parsed.requestArtifactPath = nextValue;
      index += 1;
      continue;
    }

    if (token === '--storage-state-file') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--storage-state-file requires a value');
      }
      parsed.storageStateFilePath = nextValue;
      index += 1;
      continue;
    }

    if (token === '--base-url') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--base-url requires a value');
      }
      parsed.importBaseUrl = nextValue;
      index += 1;
      continue;
    }

    if (token === '--admin-password') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--admin-password requires a value');
      }
      parsed.adminPassword = nextValue;
      index += 1;
      continue;
    }

    if (token === '--status') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--status requires a value');
      }
      if (nextValue !== 'active' && nextValue !== 'expired' && nextValue !== 'missing') {
        throw new Error('--status must be one of: active, expired, missing');
      }
      parsed.sessionStatus = nextValue;
      index += 1;
      continue;
    }

    if (token === '--validated-at') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--validated-at requires a value');
      }
      parsed.validatedAt = nextValue;
      index += 1;
      continue;
    }

    if (token === '--notes') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--notes requires a value');
      }
      parsed.notes = nextValue;
      index += 1;
      continue;
    }

    if (token === '--completed-at') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--completed-at requires a value');
      }
      parsed.completedAt = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getBrowserLaneSubmitHelpText() {
  return [
    'Usage: tsx src/server/cli/browserLaneSubmit.ts --request-artifact <path> --storage-state-file <path> [options]',
    '',
    'Required:',
    '  --request-artifact <path>    Existing browser_lane_request artifact path',
    '  --storage-state-file <path>  Local storageState JSON file to submit',
    '',
    'Optional:',
    '  --status <active|expired|missing>',
    '  --validated-at <iso8601>',
    '  --notes <text>',
    '  --completed-at <iso8601>',
    '  --base-url <origin>          Import the result through /api/system/browser-lane-requests/import',
    '  --admin-password <value>     Required when --base-url is provided',
    '  --help',
  ].join('\n');
}

async function main() {
  const input = parseBrowserLaneSubmitArgs(process.argv.slice(2));
  if (input.showHelp) {
    process.stdout.write(`${getBrowserLaneSubmitHelpText()}\n`);
    return;
  }

  if (!input.requestArtifactPath.trim() || !input.storageStateFilePath.trim()) {
    throw new SessionRequestResultSubmitError(
      'requestArtifactPath and storageStateFilePath are required',
      400,
    );
  }

  const result = await submitSessionRequestResult(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMainModule) {
  void main().catch((error) => {
    if (error instanceof SessionRequestResultSubmitError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
