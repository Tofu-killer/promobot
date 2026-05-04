import fs from 'node:fs';
import path from 'node:path';

import { getSessionRequestArtifactByPath } from './sessionRequestArtifacts.js';
import {
  resolveManagedStorageStateAbsolutePath,
  type BrowserSessionAction,
} from './sessionStore.js';
import {
  submitSessionRequestResult,
  type SubmitSessionRequestResultInput,
} from './sessionResultSubmitter.js';

export class SessionAutomationRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionAutomationRunnerError';
  }
}

export interface RunSessionAutomationRequestInput {
  requestArtifactPath: string;
  managedStorageStatePath?: string;
  platform?: string;
  accountKey?: string;
  action?: BrowserSessionAction;
  channelAccountId?: number;
  requestJobId?: number;
  startUrl?: string;
  headless?: boolean;
  timeoutMs?: number;
  browserChannel?: string;
  executablePath?: string;
  validatedAt?: string | null;
  completedAt?: string;
  notes?: string;
}

export interface SessionAutomationExecutionInput {
  requestArtifactPath: string;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  managedStorageStatePath: string;
  managedStorageStateAbsolutePath: string;
  initialStorageStateFilePath: string | null;
  startUrl: string;
  headless: boolean;
  timeoutMs: number;
  browserChannel?: string;
  executablePath?: string;
}

export interface SessionAutomationExecutionResult {
  storageState: Record<string, unknown>;
  validatedAt?: string | null;
  completedAt?: string;
  notes?: string;
}

export interface SessionAutomationRunnerDependencies {
  now?: () => Date;
  runAutomation?: (
    input: SessionAutomationExecutionInput,
  ) => Promise<SessionAutomationExecutionResult>;
  submitSessionRequestResult?: (
    input: SubmitSessionRequestResultInput,
  ) => Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_SUCCESS_NOTES = 'browser lane local runner captured a managed browser session';

export async function runSessionAutomationRequest(
  input: RunSessionAutomationRequestInput,
  dependencies: SessionAutomationRunnerDependencies = {},
) {
  const requestArtifact = getSessionRequestArtifactByPath(input.requestArtifactPath);
  if (!requestArtifact) {
    throw new SessionAutomationRunnerError('browser lane request artifact not found');
  }

  const platform = input.platform ?? requestArtifact.platform;
  const accountKey = input.accountKey ?? requestArtifact.accountKey;
  const action = input.action ?? requestArtifact.action;
  const managedStorageStatePath =
    input.managedStorageStatePath ?? requestArtifact.managedStorageStatePath;

  if (!managedStorageStatePath?.trim()) {
    throw new SessionAutomationRunnerError(
      'managed storage state path is required for browser session automation',
    );
  }

  const normalizedManagedStorageStatePath = managedStorageStatePath.trim();
  const managedStorageStateAbsolutePath = resolveManagedStorageStateAbsolutePath(
    normalizedManagedStorageStatePath,
  );
  if (!managedStorageStateAbsolutePath) {
    throw new SessionAutomationRunnerError(
      'managed storage state path is required for browser session automation',
    );
  }

  const initialStorageStateFilePath = hasUsableStorageStateFile(managedStorageStateAbsolutePath)
    ? managedStorageStateAbsolutePath
    : null;
  const startUrl = input.startUrl ?? resolveDefaultStartUrl(platform);
  const headless = input.headless ?? false;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = dependencies.now ?? (() => new Date());
  const runAutomation = dependencies.runAutomation ?? defaultRunAutomation;
  const automationResult = await runAutomation({
    requestArtifactPath: input.requestArtifactPath,
    platform,
    accountKey,
    action,
    managedStorageStatePath: normalizedManagedStorageStatePath,
    managedStorageStateAbsolutePath,
    initialStorageStateFilePath,
    startUrl,
    headless,
    timeoutMs,
    ...(input.browserChannel ? { browserChannel: input.browserChannel } : {}),
    ...(input.executablePath ? { executablePath: input.executablePath } : {}),
  });

  if (!hasUsableAuthenticatedStorageState(automationResult.storageState, platform)) {
    throw new SessionAutomationRunnerError(
      'browser session automation did not capture a usable authenticated storage state',
    );
  }

  const stagedStorageStateAbsolutePath = createStagedStorageStateAbsolutePath(
    managedStorageStateAbsolutePath,
  );
  writeStorageStateFile(stagedStorageStateAbsolutePath, automationResult.storageState);

  const completedAt = input.completedAt ?? automationResult.completedAt ?? now().toISOString();
  const validatedAt =
    input.validatedAt !== undefined ? input.validatedAt : automationResult.validatedAt ?? completedAt;
  const storageStateFilePathForSubmit =
    stagedStorageStateAbsolutePath;

  try {
    const result = await (dependencies.submitSessionRequestResult ?? submitSessionRequestResult)({
      requestArtifactPath: input.requestArtifactPath,
      storageStateFilePath: storageStateFilePathForSubmit,
      sessionStatus: 'active',
      validatedAt,
      completedAt,
      notes: input.notes ?? automationResult.notes ?? DEFAULT_SUCCESS_NOTES,
    });

    writeStorageStateFile(managedStorageStateAbsolutePath, automationResult.storageState);
    return result;
  } finally {
    removeStorageStateFile(stagedStorageStateAbsolutePath);
  }
}

async function defaultRunAutomation(
  input: SessionAutomationExecutionInput,
): Promise<SessionAutomationExecutionResult> {
  let playwrightModule: unknown;

  try {
    playwrightModule = await loadPlaywrightModule();
  } catch {
    throw new SessionAutomationRunnerError(
      'Playwright is not installed for local browser session automation',
    );
  }

  const chromium = getChromiumLauncher(playwrightModule);
  if (!chromium) {
    throw new SessionAutomationRunnerError(
      'Playwright chromium launcher is unavailable for local browser session automation',
    );
  }

  const browser = await chromium.launch({
    headless: input.headless,
    ...(input.browserChannel ? { channel: input.browserChannel } : {}),
    ...(input.executablePath ? { executablePath: input.executablePath } : {}),
  });

  try {
    const context = await browser.newContext(
      input.initialStorageStateFilePath
        ? { storageState: input.initialStorageStateFilePath }
        : undefined,
    );

    try {
      const page = await context.newPage();
      await page.goto(input.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: input.timeoutMs,
      });
      const startedAt = Date.now();
      let latestStorageState = (await context.storageState()) as Record<string, unknown>;

      while (!hasUsableAuthenticatedStorageState(latestStorageState, input.platform)) {
        const remainingMs = input.timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          break;
        }

        await page.waitForTimeout(Math.min(1000, remainingMs));
        latestStorageState = (await context.storageState()) as Record<string, unknown>;
      }

      return {
        storageState: latestStorageState,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<unknown>;

function loadPlaywrightModule() {
  return dynamicImport('playwright');
}

function getChromiumLauncher(playwrightModule: unknown) {
  if (
    typeof playwrightModule !== 'object' ||
    playwrightModule === null ||
    !('chromium' in playwrightModule)
  ) {
    return null;
  }

  const chromium = (playwrightModule as { chromium?: unknown }).chromium;
  if (
    typeof chromium !== 'object' ||
    chromium === null ||
    !('launch' in chromium) ||
    typeof (chromium as { launch?: unknown }).launch !== 'function'
  ) {
    return null;
  }

  return chromium as {
    launch: (options?: Record<string, unknown>) => Promise<{
      newContext: (
        options?: Record<string, unknown>,
      ) => Promise<{
        newPage: () => Promise<{
          goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
          waitForTimeout: (timeout: number) => Promise<unknown>;
        }>;
        storageState: () => Promise<unknown>;
        close: () => Promise<unknown>;
      }>;
      close: () => Promise<unknown>;
    }>;
  };
}

function resolveDefaultStartUrl(platform: string) {
  switch (platform) {
    case 'instagram':
      return 'https://www.instagram.com/';
    case 'x':
      return 'https://x.com/';
    case 'facebook':
      return 'https://www.facebook.com/';
    case 'facebook-group':
    case 'facebookGroup':
      return 'https://www.facebook.com/groups/';
    case 'tiktok':
      return 'https://www.tiktok.com/';
    case 'weibo':
      return 'https://weibo.com/';
    case 'xiaohongshu':
      return 'https://www.xiaohongshu.com/';
    default:
      return 'about:blank';
  }
}

function hasUsableStorageStateFile(absolutePath: string) {
  try {
    const raw = fs.readFileSync(absolutePath, 'utf8');
    return isStorageStatePayload(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return false;
  }
}

function hasUsableAuthenticatedStorageState(
  value: Record<string, unknown>,
  platform: string,
) {
  if (!isStorageStatePayload(value)) {
    return false;
  }

  const cookies = value.cookies
    .map((cookie) => normalizeCookieName(cookie.name))
    .filter((cookieName): cookieName is string => cookieName !== null);
  if (cookies.length === 0) {
    return false;
  }

  const requiredCookieNames = AUTHENTICATED_COOKIE_NAMES_BY_PLATFORM.get(normalizePlatform(platform));
  if (!requiredCookieNames) {
    return false;
  }

  return cookies.some((cookieName) => requiredCookieNames.has(cookieName));
}

const AUTHENTICATED_COOKIE_NAMES_BY_PLATFORM = new Map<string, Set<string>>([
  ['instagram', new Set(['sessionid'])],
  ['x', new Set(['auth_token'])],
  ['facebook', new Set(['c_user'])],
  ['facebook-group', new Set(['c_user'])],
  ['facebookgroup', new Set(['c_user'])],
  ['tiktok', new Set(['sessionid', 'sessionid_ss'])],
  ['weibo', new Set(['sub'])],
  ['xiaohongshu', new Set(['web_session'])],
]);

function normalizePlatform(platform: string) {
  return platform.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function normalizeCookieName(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function isStorageStatePayload(value: Record<string, unknown>): value is {
  cookies: Record<string, unknown>[];
  origins: Record<string, unknown>[];
} {
  return (
    isPlainObject(value) &&
    Array.isArray(value.cookies) &&
    value.cookies.every(isPlainObject) &&
    Array.isArray(value.origins) &&
    value.origins.every(isPlainObject)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createStagedStorageStateAbsolutePath(managedStorageStateAbsolutePath: string) {
  const directory = path.dirname(managedStorageStateAbsolutePath);
  const filename = path.basename(managedStorageStateAbsolutePath);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return path.join(directory, `${filename}.staged-${suffix}`);
}

function writeStorageStateFile(
  storageStateFilePath: string,
  storageState: Record<string, unknown>,
) {
  fs.mkdirSync(path.dirname(storageStateFilePath), { recursive: true });
  fs.writeFileSync(storageStateFilePath, JSON.stringify(storageState, null, 2), 'utf8');
}

function removeStorageStateFile(storageStateFilePath: string) {
  try {
    fs.unlinkSync(storageStateFilePath);
  } catch {
    // best-effort cleanup for staging artifacts
  }
}
