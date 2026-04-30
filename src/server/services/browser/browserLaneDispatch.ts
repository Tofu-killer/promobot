import { spawn, type ChildProcess } from 'node:child_process';

import type { BrowserSessionAction } from './sessionStore.js';

export type BrowserLaneDispatchKind =
  | 'session_request'
  | 'publish_handoff'
  | 'inbox_reply_handoff';

export interface BrowserLaneDispatchInput {
  kind: BrowserLaneDispatchKind;
  artifactPath: string;
  platform: string;
  accountKey: string;
  sessionAction?: BrowserSessionAction | null;
  channelAccountId?: number;
  requestJobId?: number;
  draftId?: string;
  itemId?: string;
}

export type BrowserLaneDispatch = (input: BrowserLaneDispatchInput) => void;

interface BrowserLaneDispatchDependencies {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, 'warn'>;
  now?: () => Date;
  spawn?: (
    command: string,
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      shell: true;
      stdio: 'ignore';
    },
  ) => ChildProcess;
}

export function createBrowserLaneDispatch(
  dependencies: BrowserLaneDispatchDependencies = {},
): BrowserLaneDispatch {
  const cwd = dependencies.cwd ?? process.cwd();
  const env = dependencies.env ?? process.env;
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? (() => new Date());
  const spawnProcess =
    dependencies.spawn ??
    ((command, options) => spawn(command, options));

  return (input) => {
    const command = resolveBrowserLaneDispatchCommand(env, input.kind);
    if (!command) {
      return;
    }

    try {
      const child = spawnProcess(command, {
        cwd,
        env: {
          ...env,
          ...buildBrowserLaneDispatchEnv(input, now),
        },
        shell: true,
        stdio: 'ignore',
      });

      child.once('error', (error) => {
        logger.warn(
          `[browser-lane-dispatch] ${input.kind} failed for ${input.artifactPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      child.once('close', (code, signal) => {
        if (code === 0) {
          return;
        }

        const outcome = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
        logger.warn(
          `[browser-lane-dispatch] ${input.kind} exited with ${outcome} for ${input.artifactPath}`,
        );
      });
      child.unref();
    } catch (error) {
      logger.warn(
        `[browser-lane-dispatch] ${input.kind} failed for ${input.artifactPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

function resolveBrowserLaneDispatchCommand(
  env: NodeJS.ProcessEnv,
  kind: BrowserLaneDispatchKind,
) {
  const fallback = normalizeCommand(env.PROMOBOT_BROWSER_LANE_COMMAND);
  switch (kind) {
    case 'session_request':
      return normalizeCommand(env.PROMOBOT_BROWSER_SESSION_REQUEST_COMMAND) ?? fallback;
    case 'publish_handoff':
      return normalizeCommand(env.PROMOBOT_BROWSER_PUBLISH_HANDOFF_COMMAND) ?? fallback;
    case 'inbox_reply_handoff':
      return normalizeCommand(env.PROMOBOT_BROWSER_INBOX_REPLY_HANDOFF_COMMAND) ?? fallback;
  }
}

function normalizeCommand(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildBrowserLaneDispatchEnv(
  input: BrowserLaneDispatchInput,
  now: () => Date,
): Record<string, string> {
  return {
    PROMOBOT_BROWSER_DISPATCHED_AT: now().toISOString(),
    PROMOBOT_BROWSER_DISPATCH_KIND: input.kind,
    PROMOBOT_BROWSER_ARTIFACT_PATH: input.artifactPath,
    PROMOBOT_BROWSER_PLATFORM: input.platform,
    PROMOBOT_BROWSER_ACCOUNT_KEY: input.accountKey,
    ...(input.sessionAction ? { PROMOBOT_BROWSER_SESSION_ACTION: input.sessionAction } : {}),
    ...(typeof input.channelAccountId === 'number'
      ? { PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID: String(input.channelAccountId) }
      : {}),
    ...(typeof input.requestJobId === 'number'
      ? { PROMOBOT_BROWSER_REQUEST_JOB_ID: String(input.requestJobId) }
      : {}),
    ...(typeof input.draftId === 'string' && input.draftId.trim()
      ? { PROMOBOT_BROWSER_DRAFT_ID: input.draftId }
      : {}),
    ...(typeof input.itemId === 'string' && input.itemId.trim()
      ? { PROMOBOT_BROWSER_ITEM_ID: input.itemId }
      : {}),
  };
}
