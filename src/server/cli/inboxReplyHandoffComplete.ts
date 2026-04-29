import {
  InboxReplyHandoffCompletionSubmitError,
  submitInboxReplyHandoffCompletion,
  type SubmitInboxReplyHandoffCompletionInput,
} from '../services/inbox/replyHandoffCompletionSubmitter.js';

export function parseInboxReplyHandoffCompleteArgs(
  argv: string[],
): SubmitInboxReplyHandoffCompletionInput & {
  showHelp?: boolean;
} {
  const parsed: SubmitInboxReplyHandoffCompletionInput & { showHelp?: boolean } = {
    artifactPath: '',
    replyStatus: 'sent',
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
      parsed.replyStatus = nextValue === 'failed' ? 'failed' : 'sent';
      index += 1;
      continue;
    }

    if (token === '--message') {
      parsed.message = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--delivery-url') {
      parsed.deliveryUrl = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--external-id') {
      parsed.externalId = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--delivered-at') {
      parsed.deliveredAt = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--queue-result') {
      parsed.queueResult = true;
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

export function getInboxReplyHandoffCompleteHelpText() {
  return [
    'Usage:',
    '  pnpm inbox:reply:handoff:complete -- --artifact-path <path> [options]',
    '  node dist/server/cli/inboxReplyHandoffComplete.js --artifact-path <path> [options]',
    '',
    'Required:',
    '  --artifact-path <path>       Existing inbox reply handoff artifact path',
    '',
    'Optional:',
    '  --status <sent|failed>       Defaults to sent',
    '  --message <text>',
    '  --delivery-url <url>',
    '  --external-id <id>',
    '  --delivered-at <iso8601>',
    '  --queue-result              Write a local result artifact for poll-based import',
    '  --base-url <origin>          Import through /api/system/inbox-reply-handoffs/import',
    '  --admin-password <value>     Required when --base-url is provided',
    '  --help',
  ].join('\n');
}

async function main() {
  const input = parseInboxReplyHandoffCompleteArgs(process.argv.slice(2));
  if (input.showHelp) {
    process.stdout.write(`${getInboxReplyHandoffCompleteHelpText()}\n`);
    return;
  }

  if (!input.artifactPath.trim()) {
    throw new InboxReplyHandoffCompletionSubmitError('artifactPath is required', 400);
  }

  const result = await submitInboxReplyHandoffCompletion(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMainModule) {
  void main().catch((error) => {
    if (error instanceof InboxReplyHandoffCompletionSubmitError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
