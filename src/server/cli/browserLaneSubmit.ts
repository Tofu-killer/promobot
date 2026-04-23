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

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (token === '--request-artifact') {
      parsed.requestArtifactPath = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--storage-state-file') {
      parsed.storageStateFilePath = nextValue ?? '';
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

    if (token === '--status') {
      const status = nextValue ?? '';
      if (status === 'active' || status === 'expired' || status === 'missing') {
        parsed.sessionStatus = status;
      } else {
        parsed.sessionStatus = undefined;
      }
      index += 1;
      continue;
    }

    if (token === '--validated-at') {
      parsed.validatedAt = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--notes') {
      parsed.notes = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--completed-at') {
      parsed.completedAt = nextValue ?? '';
      index += 1;
      continue;
    }
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
