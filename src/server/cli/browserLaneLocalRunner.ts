import { runBrowserLaneBridge } from './browserLaneBridge.js';
import { loadServerEnvFromRoot } from '../env.js';
import type { SubmitSessionRequestResultInput } from '../services/browser/sessionResultSubmitter.js';
import type { SubmitBrowserHandoffCompletionInput } from '../services/publishers/browserHandoffCompletionSubmitter.js';
import type { SubmitInboxReplyHandoffCompletionInput } from '../services/inbox/replyHandoffCompletionSubmitter.js';
import {
  runSessionAutomationRequest,
  type RunSessionAutomationRequestInput,
} from '../services/browser/sessionAutomationRunner.js';

interface BrowserLaneLocalRunnerDependencies {
  now?: () => Date;
  runSessionAutomation?: (
    input: RunSessionAutomationRequestInput,
  ) => Promise<unknown>;
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
): NodeJS.ProcessEnv {
  const completedAt = now().toISOString();
  const dispatchKind = env.PROMOBOT_BROWSER_DISPATCH_KIND?.trim();

  switch (dispatchKind) {
    case 'session_request':
      return { ...env };
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
  const normalizedEnv = buildBrowserLaneLocalRunnerEnv(env, dependencies.now);
  const dispatchKind = normalizedEnv.PROMOBOT_BROWSER_DISPATCH_KIND?.trim();

  if (dispatchKind === 'session_request') {
    return await (dependencies.runSessionAutomation ?? runSessionAutomationRequest)({
      requestArtifactPath: requireEnvValue(
        normalizedEnv.PROMOBOT_BROWSER_ARTIFACT_PATH,
        'PROMOBOT_BROWSER_ARTIFACT_PATH is required for session_request dispatches',
      ),
      managedStorageStatePath: normalizeEnvValue(
        normalizedEnv.PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH,
      ),
      platform: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_PLATFORM),
      accountKey: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_ACCOUNT_KEY),
      action: parseSessionAction(normalizedEnv.PROMOBOT_BROWSER_SESSION_ACTION),
      channelAccountId: parseOptionalInteger(
        normalizedEnv.PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID,
        'PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID must be an integer for session_request dispatches',
      ),
      requestJobId: parseOptionalInteger(
        normalizedEnv.PROMOBOT_BROWSER_REQUEST_JOB_ID,
        'PROMOBOT_BROWSER_REQUEST_JOB_ID must be an integer for session_request dispatches',
      ),
      startUrl: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_SESSION_START_URL),
      headless: parseOptionalBoolean(normalizedEnv.PROMOBOT_BROWSER_SESSION_HEADLESS),
      timeoutMs: parseOptionalInteger(
        normalizedEnv.PROMOBOT_BROWSER_SESSION_TIMEOUT_MS,
        'PROMOBOT_BROWSER_SESSION_TIMEOUT_MS must be a positive integer for session_request dispatches',
      ),
      browserChannel: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_LAUNCH_CHANNEL),
      executablePath: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_EXECUTABLE_PATH),
      validatedAt: normalizeNullableEnvValue(normalizedEnv.PROMOBOT_BROWSER_VALIDATED_AT),
      completedAt: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_COMPLETED_AT),
      notes: normalizeEnvValue(normalizedEnv.PROMOBOT_BROWSER_NOTES),
    });
  }

  return await runBrowserLaneBridge(normalizedEnv, {
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
    'This opt-in local runner consumes browserLaneDispatch env, automates local session capture for session_request, and reuses the existing completion submitters.',
    'For session_request it attempts local browser session automation and then submits the managed storage state.',
    'Publish and inbox reply handoffs still require explicit completion env from the caller.',
    '',
    'Dispatch env:',
    '  PROMOBOT_BROWSER_DISPATCH_KIND   session_request | publish_handoff | inbox_reply_handoff',
    '  PROMOBOT_BROWSER_ARTIFACT_PATH   Dispatch artifact path forwarded by browserLaneDispatch',
    '',
    'Session request env:',
    '  PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH Managed storageState path forwarded by dispatch or request artifact',
    '  PROMOBOT_BROWSER_PLATFORM                  Optional override for the request platform',
    '  PROMOBOT_BROWSER_ACCOUNT_KEY               Optional override for the request account key',
    '  PROMOBOT_BROWSER_SESSION_ACTION            Optional override for request_session | relogin',
    '  PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID        Optional channel account id override',
    '  PROMOBOT_BROWSER_REQUEST_JOB_ID            Optional request job id override',
    '  PROMOBOT_BROWSER_SESSION_START_URL         Optional login landing page override',
    '  PROMOBOT_BROWSER_SESSION_HEADLESS          true | 1 | yes to launch headless',
    '  PROMOBOT_BROWSER_SESSION_TIMEOUT_MS        Optional positive integer timeout applied first to initial page navigation, then again to post-navigation login polling',
    '  PROMOBOT_BROWSER_LAUNCH_CHANNEL            Optional Playwright browser channel',
    '  PROMOBOT_BROWSER_EXECUTABLE_PATH           Optional browser executable path',
    '  PROMOBOT_BROWSER_VALIDATED_AT              Optional validation timestamp forwarded to the submitter',
    '  PROMOBOT_BROWSER_NOTES                     Optional submitter notes override',
    '  PROMOBOT_BROWSER_COMPLETED_AT              Optional completion timestamp override forwarded to the submitter',
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
    '  PROMOBOT_BROWSER_LOCAL_AUTORUN              true | 1 | yes to use this runner for session_request, and for publish/reply only when the matching result env is already present',
    '  PROMOBOT_BROWSER_LOCAL_RUNNER_COMMAND       Explicit runner command for any browser lane dispatch only after local autorun is enabled and no kind-specific or generic browser lane command is configured; custom wrappers must enforce any publish/reply gating they need',
    '',
    'Any explicit bridge env still wins over these defaults. --help',
  ].join('\n');
}

function normalizeEnvValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNullableEnvValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function requireEnvValue(value: string | undefined, message: string) {
  const normalized = normalizeEnvValue(value);
  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function parseOptionalBoolean(value: string | undefined) {
  const normalized = normalizeEnvValue(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(
    'PROMOBOT_BROWSER_SESSION_HEADLESS must be true/false, 1/0, or yes/no for session_request dispatches',
  );
}

function parseOptionalInteger(value: string | undefined, message: string) {
  const normalized = normalizeEnvValue(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(message);
  }

  return parsed;
}

function parseSessionAction(value: string | undefined) {
  const normalized = normalizeEnvValue(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'request_session' || normalized === 'relogin') {
    return normalized;
  }

  throw new Error(
    'PROMOBOT_BROWSER_SESSION_ACTION must be request_session or relogin for session_request dispatches',
  );
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
