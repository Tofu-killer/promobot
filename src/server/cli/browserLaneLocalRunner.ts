import { runBrowserLaneBridge } from './browserLaneBridge.js';
import { loadServerEnvFromRoot } from '../env.js';
import type { SubmitSessionRequestResultInput } from '../services/browser/sessionResultSubmitter.js';
import type { SubmitBrowserHandoffCompletionInput } from '../services/publishers/browserHandoffCompletionSubmitter.js';
import type { SubmitInboxReplyHandoffCompletionInput } from '../services/inbox/replyHandoffCompletionSubmitter.js';

interface BrowserLaneLocalRunnerDependencies {
  now?: () => Date;
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

export function parseBrowserLaneLocalRunnerArgs(argv: string[]) {
  return {
    showHelp: argv.some((token) => token === '--help' || token === '-h'),
  };
}

export function buildBrowserLaneLocalRunnerEnv(
  env: NodeJS.ProcessEnv,
  now: () => Date = () => new Date(),
) {
  const completedAt = now().toISOString();
  const dispatchKind = env.PROMOBOT_BROWSER_DISPATCH_KIND?.trim();

  switch (dispatchKind) {
    case 'session_request':
      return {
        ...env,
        PROMOBOT_BROWSER_STORAGE_STATE_FILE:
          normalizeEnvValue(env.PROMOBOT_BROWSER_STORAGE_STATE_FILE) ??
          normalizeEnvValue(env.PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH) ??
          '',
        PROMOBOT_BROWSER_SESSION_STATUS:
          normalizeEnvValue(env.PROMOBOT_BROWSER_SESSION_STATUS) ?? 'active',
        PROMOBOT_BROWSER_VALIDATED_AT:
          normalizeEnvValue(env.PROMOBOT_BROWSER_VALIDATED_AT) ?? completedAt,
        PROMOBOT_BROWSER_COMPLETED_AT:
          normalizeEnvValue(env.PROMOBOT_BROWSER_COMPLETED_AT) ?? completedAt,
        PROMOBOT_BROWSER_NOTES:
          normalizeEnvValue(env.PROMOBOT_BROWSER_NOTES) ??
          'browser lane local runner reused the managed storage state',
      };
    case 'publish_handoff':
      if (!normalizeEnvValue(env.PROMOBOT_BROWSER_PUBLISH_STATUS)) {
        return { ...env };
      }

      return {
        ...env,
        PROMOBOT_BROWSER_MESSAGE:
          normalizeEnvValue(env.PROMOBOT_BROWSER_MESSAGE) ??
          'browser handoff completed by the local runner',
        PROMOBOT_BROWSER_PUBLISHED_AT:
          normalizeEnvValue(env.PROMOBOT_BROWSER_PUBLISHED_AT) ?? completedAt,
      };
    case 'inbox_reply_handoff':
      if (!normalizeEnvValue(env.PROMOBOT_BROWSER_REPLY_STATUS)) {
        return { ...env };
      }

      return {
        ...env,
        PROMOBOT_BROWSER_MESSAGE:
          normalizeEnvValue(env.PROMOBOT_BROWSER_MESSAGE) ??
          'inbox reply handoff completed by the local runner',
        PROMOBOT_BROWSER_DELIVERED_AT:
          normalizeEnvValue(env.PROMOBOT_BROWSER_DELIVERED_AT) ?? completedAt,
      };
    default:
      return { ...env };
  }
}

export async function runBrowserLaneLocalRunner(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: BrowserLaneLocalRunnerDependencies = {},
) {
  return await runBrowserLaneBridge(buildBrowserLaneLocalRunnerEnv(env, dependencies.now), {
    submitSessionRequestResult: dependencies.submitSessionRequestResult,
    submitBrowserHandoffCompletion: dependencies.submitBrowserHandoffCompletion,
    submitInboxReplyHandoffCompletion: dependencies.submitInboxReplyHandoffCompletion,
  });
}

export function getBrowserLaneLocalRunnerHelpText() {
  return [
    'Usage:',
    '  pnpm browser:lane:local',
    '  node dist/server/cli/browserLaneLocalRunner.js',
    '',
    'This opt-in local runner consumes browserLaneDispatch env and reuses existing submitters.',
    'It does not provide full Playwright-style browser automation.',
    '',
    'Dispatch env:',
    '  PROMOBOT_BROWSER_DISPATCH_KIND   session_request | publish_handoff | inbox_reply_handoff',
    '  PROMOBOT_BROWSER_ARTIFACT_PATH   Dispatch artifact path forwarded by browserLaneDispatch',
    '',
    'Session request defaults:',
    '  PROMOBOT_BROWSER_STORAGE_STATE_FILE         Falls back to PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH',
    '  PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH Reused managed storageState path from dispatch',
    '  PROMOBOT_BROWSER_SESSION_STATUS             Defaults to active',
    '  PROMOBOT_BROWSER_VALIDATED_AT               Defaults to now',
    '  PROMOBOT_BROWSER_COMPLETED_AT               Defaults to now',
    '  PROMOBOT_BROWSER_NOTES                      Defaults to a managed-session reuse note',
    '',
    'Publish handoff env:',
    '  PROMOBOT_BROWSER_PUBLISH_STATUS             Required. published | failed',
    '  PROMOBOT_BROWSER_MESSAGE                    Defaults after PROMOBOT_BROWSER_PUBLISH_STATUS is set',
    '  PROMOBOT_BROWSER_PUBLISHED_AT               Defaults to now after PROMOBOT_BROWSER_PUBLISH_STATUS is set',
    '',
    'Inbox reply handoff env:',
    '  PROMOBOT_BROWSER_REPLY_STATUS               Required. sent | failed',
    '  PROMOBOT_BROWSER_MESSAGE                    Defaults after PROMOBOT_BROWSER_REPLY_STATUS is set',
    '  PROMOBOT_BROWSER_DELIVERED_AT               Defaults to now after PROMOBOT_BROWSER_REPLY_STATUS is set',
    '',
    'Dispatch integration:',
    '  PROMOBOT_BROWSER_LOCAL_AUTORUN              true | 1 | yes to use this runner for session_request when no explicit browser lane command is configured',
    '  PROMOBOT_BROWSER_LOCAL_RUNNER_COMMAND       Explicit fallback runner for any browser lane dispatch when PROMOBOT_BROWSER_LOCAL_AUTORUN is enabled',
    '',
    'Any explicit bridge env still wins over these defaults. --help',
  ].join('\n');
}

function normalizeEnvValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function main() {
  const { showHelp } = parseBrowserLaneLocalRunnerArgs(process.argv.slice(2));
  if (showHelp) {
    process.stdout.write(`${getBrowserLaneLocalRunnerHelpText()}\n`);
    return;
  }

  loadServerEnvFromRoot();
  const result = await runBrowserLaneLocalRunner(process.env);
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
