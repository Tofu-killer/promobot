import {
  submitSessionRequestResult,
  type SubmitSessionRequestResultInput,
} from '../services/browser/sessionResultSubmitter.js';
import type { BrowserLaneDispatchKind } from '../services/browser/browserLaneDispatch.js';
import {
  submitBrowserHandoffCompletion,
  type SubmitBrowserHandoffCompletionInput,
} from '../services/publishers/browserHandoffCompletionSubmitter.js';
import {
  submitInboxReplyHandoffCompletion,
  type SubmitInboxReplyHandoffCompletionInput,
} from '../services/inbox/replyHandoffCompletionSubmitter.js';

export class BrowserLaneBridgeError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'BrowserLaneBridgeError';
    this.statusCode = statusCode;
  }
}

export type ParsedBrowserLaneBridgeCommand =
  | {
      kind: 'session_request';
      input: SubmitSessionRequestResultInput;
    }
  | {
      kind: 'publish_handoff';
      input: SubmitBrowserHandoffCompletionInput;
    }
  | {
      kind: 'inbox_reply_handoff';
      input: SubmitInboxReplyHandoffCompletionInput;
    };

interface BrowserLaneBridgeDependencies {
  submitSessionRequestResult?: (
    input: SubmitSessionRequestResultInput,
  ) => Promise<unknown>;
  submitBrowserHandoffCompletion?: (
    input: SubmitBrowserHandoffCompletionInput,
  ) => Promise<unknown>;
  submitInboxReplyHandoffCompletion?: (
    input: SubmitInboxReplyHandoffCompletionInput,
  ) => Promise<unknown>;
}

export function parseBrowserLaneBridgeArgs(argv: string[]) {
  return {
    showHelp: argv.some((token) => token === '--help' || token === '-h'),
  };
}

export function parseBrowserLaneBridgeEnv(
  env: NodeJS.ProcessEnv,
): ParsedBrowserLaneBridgeCommand {
  const kind = parseDispatchKind(env.PROMOBOT_BROWSER_DISPATCH_KIND);

  switch (kind) {
    case 'session_request':
      {
        const sessionStatus = parseSessionStatus(env.PROMOBOT_BROWSER_SESSION_STATUS);
        const validatedAt = optionalEnvValue(env.PROMOBOT_BROWSER_VALIDATED_AT);
        const notes = optionalEnvValue(env.PROMOBOT_BROWSER_NOTES);
        const completedAt = optionalEnvValue(env.PROMOBOT_BROWSER_COMPLETED_AT);
        const importBaseUrl = optionalEnvValue(env.PROMOBOT_BROWSER_IMPORT_BASE_URL);
        const adminPassword = optionalEnvValue(env.PROMOBOT_BROWSER_ADMIN_PASSWORD);

      return {
        kind,
        input: {
          requestArtifactPath: requireEnvValue(
            env.PROMOBOT_BROWSER_ARTIFACT_PATH,
            'PROMOBOT_BROWSER_ARTIFACT_PATH is required for session_request dispatches',
          ),
          storageStateFilePath: requireEnvValue(
            env.PROMOBOT_BROWSER_STORAGE_STATE_FILE,
            'PROMOBOT_BROWSER_STORAGE_STATE_FILE is required for session_request dispatches',
          ),
          ...(sessionStatus ? { sessionStatus } : {}),
          ...(validatedAt ? { validatedAt } : {}),
          ...(notes ? { notes } : {}),
          ...(completedAt ? { completedAt } : {}),
          ...(importBaseUrl ? { importBaseUrl } : {}),
          ...(adminPassword ? { adminPassword } : {}),
        },
      };
      }
    case 'publish_handoff':
      {
        const message = optionalEnvValue(env.PROMOBOT_BROWSER_MESSAGE);
        const publishUrl = optionalEnvValue(env.PROMOBOT_BROWSER_PUBLISH_URL);
        const externalId = optionalEnvValue(env.PROMOBOT_BROWSER_EXTERNAL_ID);
        const publishedAt = optionalEnvValue(env.PROMOBOT_BROWSER_PUBLISHED_AT);
        const queueResult = parseBooleanEnv(env.PROMOBOT_BROWSER_QUEUE_RESULT);
        const importBaseUrl = optionalEnvValue(env.PROMOBOT_BROWSER_IMPORT_BASE_URL);
        const adminPassword = optionalEnvValue(env.PROMOBOT_BROWSER_ADMIN_PASSWORD);

      return {
        kind,
        input: {
          artifactPath: requireEnvValue(
            env.PROMOBOT_BROWSER_ARTIFACT_PATH,
            'PROMOBOT_BROWSER_ARTIFACT_PATH is required for publish_handoff dispatches',
          ),
          publishStatus: parsePublishStatus(env.PROMOBOT_BROWSER_PUBLISH_STATUS),
          ...(message ? { message } : {}),
          ...(publishUrl ? { publishUrl } : {}),
          ...(externalId ? { externalId } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          ...(queueResult ? { queueResult } : {}),
          ...(importBaseUrl ? { importBaseUrl } : {}),
          ...(adminPassword ? { adminPassword } : {}),
        },
      };
      }
    case 'inbox_reply_handoff':
      {
        const message = optionalEnvValue(env.PROMOBOT_BROWSER_MESSAGE);
        const deliveryUrl = optionalEnvValue(env.PROMOBOT_BROWSER_DELIVERY_URL);
        const externalId = optionalEnvValue(env.PROMOBOT_BROWSER_EXTERNAL_ID);
        const deliveredAt = optionalEnvValue(env.PROMOBOT_BROWSER_DELIVERED_AT);
        const queueResult = parseBooleanEnv(env.PROMOBOT_BROWSER_QUEUE_RESULT);
        const importBaseUrl = optionalEnvValue(env.PROMOBOT_BROWSER_IMPORT_BASE_URL);
        const adminPassword = optionalEnvValue(env.PROMOBOT_BROWSER_ADMIN_PASSWORD);

      return {
        kind,
        input: {
          artifactPath: requireEnvValue(
            env.PROMOBOT_BROWSER_ARTIFACT_PATH,
            'PROMOBOT_BROWSER_ARTIFACT_PATH is required for inbox_reply_handoff dispatches',
          ),
          replyStatus: parseReplyStatus(env.PROMOBOT_BROWSER_REPLY_STATUS),
          ...(message ? { message } : {}),
          ...(deliveryUrl ? { deliveryUrl } : {}),
          ...(externalId ? { externalId } : {}),
          ...(deliveredAt ? { deliveredAt } : {}),
          ...(queueResult ? { queueResult } : {}),
          ...(importBaseUrl ? { importBaseUrl } : {}),
          ...(adminPassword ? { adminPassword } : {}),
        },
      };
      }
  }
}

export async function runBrowserLaneBridge(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: BrowserLaneBridgeDependencies = {},
) {
  const parsed = parseBrowserLaneBridgeEnv(env);

  switch (parsed.kind) {
    case 'session_request':
      return await (
        dependencies.submitSessionRequestResult ?? submitSessionRequestResult
      )(parsed.input);
    case 'publish_handoff':
      return await (
        dependencies.submitBrowserHandoffCompletion ?? submitBrowserHandoffCompletion
      )(parsed.input);
    case 'inbox_reply_handoff':
      return await (
        dependencies.submitInboxReplyHandoffCompletion ?? submitInboxReplyHandoffCompletion
      )(parsed.input);
  }
}

export function getBrowserLaneBridgeHelpText() {
  return [
    'Usage:',
    '  pnpm browser:lane:bridge',
    '  node dist/server/cli/browserLaneBridge.js',
    '',
    'Required env:',
    '  PROMOBOT_BROWSER_DISPATCH_KIND   session_request | publish_handoff | inbox_reply_handoff',
    '  PROMOBOT_BROWSER_ARTIFACT_PATH   Dispatch artifact path forwarded by browserLaneDispatch',
    '',
    'Session request env:',
    '  PROMOBOT_BROWSER_STORAGE_STATE_FILE',
    '  PROMOBOT_BROWSER_SESSION_STATUS  active | expired | missing',
    '  PROMOBOT_BROWSER_VALIDATED_AT',
    '  PROMOBOT_BROWSER_NOTES',
    '  PROMOBOT_BROWSER_COMPLETED_AT',
    '',
    'Publish handoff env:',
    '  PROMOBOT_BROWSER_PUBLISH_STATUS  published | failed',
    '  PROMOBOT_BROWSER_MESSAGE',
    '  PROMOBOT_BROWSER_PUBLISH_URL',
    '  PROMOBOT_BROWSER_EXTERNAL_ID',
    '  PROMOBOT_BROWSER_PUBLISHED_AT',
    '  PROMOBOT_BROWSER_QUEUE_RESULT    true | 1 to write a result artifact without immediate import',
    '',
    'Inbox reply handoff env:',
    '  PROMOBOT_BROWSER_REPLY_STATUS    sent | failed',
    '  PROMOBOT_BROWSER_MESSAGE',
    '  PROMOBOT_BROWSER_DELIVERY_URL',
    '  PROMOBOT_BROWSER_EXTERNAL_ID',
    '  PROMOBOT_BROWSER_DELIVERED_AT',
    '  PROMOBOT_BROWSER_QUEUE_RESULT    true | 1 to write a result artifact without immediate import',
    '',
    'Shared optional env:',
    '  PROMOBOT_BROWSER_IMPORT_BASE_URL',
    '  PROMOBOT_BROWSER_ADMIN_PASSWORD',
    '  --help',
  ].join('\n');
}

function parseDispatchKind(value: string | undefined): BrowserLaneDispatchKind {
  const normalized = optionalEnvValue(value);
  if (
    normalized === 'session_request' ||
    normalized === 'publish_handoff' ||
    normalized === 'inbox_reply_handoff'
  ) {
    return normalized;
  }

  throw new BrowserLaneBridgeError(
    'PROMOBOT_BROWSER_DISPATCH_KIND must be one of session_request, publish_handoff, inbox_reply_handoff',
  );
}

function requireEnvValue(value: string | undefined, message: string) {
  const normalized = optionalEnvValue(value);
  if (normalized) {
    return normalized;
  }

  throw new BrowserLaneBridgeError(message);
}

function optionalEnvValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseBooleanEnv(value: string | undefined) {
  const normalized = optionalEnvValue(value)?.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseSessionStatus(value: string | undefined) {
  const normalized = optionalEnvValue(value);
  if (normalized === 'active' || normalized === 'expired' || normalized === 'missing') {
    return normalized;
  }

  return undefined;
}

function parsePublishStatus(value: string | undefined) {
  return optionalEnvValue(value) === 'failed' ? 'failed' : 'published';
}

function parseReplyStatus(value: string | undefined) {
  return optionalEnvValue(value) === 'failed' ? 'failed' : 'sent';
}

async function main() {
  const { showHelp } = parseBrowserLaneBridgeArgs(process.argv.slice(2));
  if (showHelp) {
    process.stdout.write(`${getBrowserLaneBridgeHelpText()}\n`);
    return;
  }

  const result = await runBrowserLaneBridge(process.env);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
