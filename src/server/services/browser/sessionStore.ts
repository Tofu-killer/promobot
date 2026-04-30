import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';

export type SessionStatus = 'active' | 'expired' | 'missing';
export type BrowserSessionAction = 'relogin' | 'request_session';
export type BrowserSessionPlatform = string;

export interface SessionMetadata {
  id: string;
  platform: BrowserSessionPlatform;
  accountKey: string;
  storageStatePath: string;
  status: SessionStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string | null;
}

export interface SaveSessionInput {
  platform: BrowserSessionPlatform;
  accountKey: string;
  storageStatePath?: string;
  storageState?: Record<string, unknown>;
  status: SessionStatus;
  notes?: string;
  lastValidatedAt?: string | null;
}

export interface SessionSummary {
  hasSession: boolean;
  id?: string;
  status: SessionStatus;
  validatedAt: string | null;
  storageStatePath: string | null;
  notes?: string;
}

export interface BrowserSessionResolution {
  session: SessionSummary;
  sessionAction: BrowserSessionAction | null;
}

export interface ManagedBrowserSessionResolution {
  sessionMetadata: SessionMetadata | null;
  resolution: BrowserSessionResolution;
}

export interface SessionStoreOptions {
  rootDir: string;
}

export function createSessionStore(rootDir = resolveDefaultSessionRootDir()) {
  return new SessionStore({ rootDir });
}

export function buildManagedStorageStatePath(
  platform: BrowserSessionPlatform,
  accountKey: string,
) {
  return toPortablePath(
    path.join(
      'browser-sessions',
      'managed',
      sanitizePlatformKey(platform),
      `${sanitizeAccountKey(accountKey)}.json`,
    ),
  );
}

export function resolveManagedStorageStateAbsolutePath(
  managedStorageStatePath: string,
  rootDir = resolveDefaultSessionRootDir(),
) {
  const normalizedPath = managedStorageStatePath.trim();
  if (!normalizedPath) {
    return '';
  }

  if (path.isAbsolute(normalizedPath)) {
    return path.resolve(normalizedPath);
  }

  return path.join(path.dirname(rootDir), normalizedPath);
}

export class SessionStore {
  constructor(private readonly options: SessionStoreOptions) {}

  saveSession(input: SaveSessionInput): SessionMetadata {
    const normalizedPlatform = normalizeBrowserSessionPlatform(input.platform);
    const storageKey = sanitizeAccountKey(input.accountKey);
    const existing = this.getSession(input.platform, input.accountKey);
    const existingByStorageKey = this.getSessionByStorageKey(input.platform, storageKey);
    const now = new Date().toISOString();

    if (
      existingByStorageKey &&
      existingByStorageKey.accountKey !== input.accountKey
    ) {
      throw new Error(
        `session key collision for platform ${input.platform}: ${input.accountKey}`,
      );
    }

    const storageStatePath =
      input.storageState !== undefined
        ? this.writeManagedStorageState(input.platform, storageKey, input.storageState)
        : input.storageStatePath ?? existing?.storageStatePath;

    if (!storageStatePath) {
      throw new Error(
        `storage state path is required for platform ${input.platform}: ${input.accountKey}`,
      );
    }

    if (
      input.storageState === undefined &&
      input.storageStatePath !== undefined &&
      !isUsableStorageStateFile(storageStatePath, this.options.rootDir)
    ) {
      assertStorageStateFileUsable(storageStatePath, this.options.rootDir, input.platform);
    }

    const metadata: SessionMetadata = {
      id: buildSessionId(normalizedPlatform, storageKey),
      platform: normalizedPlatform,
      accountKey: input.accountKey,
      storageStatePath,
      status: input.status,
      notes: input.notes ?? existing?.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastValidatedAt: input.lastValidatedAt ?? existing?.lastValidatedAt ?? null,
    };

    const metadataPath = this.getMetadataPath(normalizedPlatform, storageKey);
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  getSession(platform: BrowserSessionPlatform, accountKey: string): SessionMetadata | null {
    return this.getSessionByStorageKey(platform, sanitizeAccountKey(accountKey));
  }

  restoreManagedSession(
    platform: BrowserSessionPlatform,
    accountKey: string,
  ): SessionMetadata | null {
    const managedPath = resolveManagedStorageStateAbsolutePath(
      buildManagedStorageStatePath(platform, accountKey),
      this.options.rootDir,
    );

    if (!hasValidStorageStateFileContents(managedPath)) {
      return null;
    }

    const validatedAt = fs.statSync(managedPath).mtime.toISOString();

    return this.saveSession({
      platform,
      accountKey,
      storageStatePath: buildManagedStorageStatePath(platform, accountKey),
      status: 'active',
      lastValidatedAt: validatedAt,
    });
  }

  private getSessionByStorageKey(
    platform: BrowserSessionPlatform,
    storageKey: string,
  ): SessionMetadata | null {
    for (const metadataPath of this.getMetadataPathCandidates(platform, storageKey)) {
      if (!fs.existsSync(metadataPath)) {
        continue;
      }

      const raw = fs.readFileSync(metadataPath, 'utf8');
      return normalizeLoadedSession(JSON.parse(raw) as SessionMetadata, this.options.rootDir);
    }

    return null;
  }

  listSessions(): SessionMetadata[] {
    if (!fs.existsSync(this.options.rootDir)) {
      return [];
    }

    const sessions: SessionMetadata[] = [];

    for (const entry of fs.readdirSync(this.options.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const platformDir = path.join(this.options.rootDir, entry.name);
      for (const file of fs.readdirSync(platformDir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.json')) {
          continue;
        }

        const raw = fs.readFileSync(path.join(platformDir, file.name), 'utf8');
        sessions.push(normalizeLoadedSession(JSON.parse(raw) as SessionMetadata, this.options.rootDir));
      }
    }

    return sessions.sort((left, right) => left.id.localeCompare(right.id));
  }

  private getMetadataPath(platform: BrowserSessionPlatform, storageKey: string): string {
    return path.join(
      this.options.rootDir,
      sanitizePlatformKey(platform),
      `${storageKey}.json`,
    );
  }

  private getMetadataPathCandidates(platform: BrowserSessionPlatform, storageKey: string) {
    const normalizedPlatform = normalizeBrowserSessionPlatform(platform);
    const candidates = [this.getMetadataPath(normalizedPlatform, storageKey)];

    if (normalizedPlatform === 'facebookGroup') {
      candidates.push(this.getMetadataPath('facebook-group', storageKey));
    }

    return Array.from(new Set(candidates));
  }

  private writeManagedStorageState(
    platform: BrowserSessionPlatform,
    storageKey: string,
    storageState: Record<string, unknown>,
  ): string {
    if (!isValidStorageStatePayload(storageState)) {
      throw new Error(`storage state payload is invalid for platform ${platform}`);
    }

    const managedStorageStatePath = buildManagedStorageStatePath(platform, storageKey);
    const managedPath = resolveManagedStorageStateAbsolutePath(
      managedStorageStatePath,
      this.options.rootDir,
    );

    fs.mkdirSync(path.dirname(managedPath), { recursive: true });
    fs.writeFileSync(managedPath, JSON.stringify(storageState, null, 2));

    return managedStorageStatePath;
  }
}

export function buildSessionSummary(session: SessionMetadata | null): SessionSummary {
  if (!session) {
    return {
      hasSession: false,
      status: 'missing',
      validatedAt: null,
      storageStatePath: null,
    };
  }

  return {
    hasSession: session.status !== 'missing',
    id: session.id,
    status: session.status,
    validatedAt: session.lastValidatedAt,
    storageStatePath: session.storageStatePath,
    notes: session.notes,
  };
}

export function buildBrowserSessionResolution(
  session: SessionMetadata | null,
): BrowserSessionResolution {
  const summary = buildSessionSummary(session);

  if (!summary.hasSession || summary.status === 'missing') {
    return {
      session: summary,
      sessionAction: 'request_session',
    };
  }

  if (summary.status === 'expired') {
    return {
      session: summary,
      sessionAction: 'relogin',
    };
  }

  return {
    session: summary,
    sessionAction: null,
  };
}

export function resolveManagedBrowserSession(
  sessionStore: Pick<SessionStore, 'getSession' | 'restoreManagedSession'>,
  platform: BrowserSessionPlatform,
  accountKey: string,
): ManagedBrowserSessionResolution {
  let session = sessionStore.getSession(platform, accountKey);
  let resolution = buildBrowserSessionResolution(session);

  if (!session || resolution.session.status === 'missing') {
    const restoredSession =
      typeof sessionStore.restoreManagedSession === 'function'
        ? sessionStore.restoreManagedSession(platform, accountKey)
        : null;
    if (restoredSession) {
      session = restoredSession;
      resolution = buildBrowserSessionResolution(restoredSession);
    }
  }

  return {
    sessionMetadata: session,
    resolution,
  };
}

function buildSessionId(platform: BrowserSessionPlatform, storageKey: string): string {
  return `${platform}:${storageKey}`;
}

function sanitizeAccountKey(accountKey: string): string {
  const sanitized = accountKey.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function sanitizePlatformKey(platform: string): string {
  const sanitized = platform.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function normalizeBrowserSessionPlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function resolveDefaultSessionRootDir() {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return path.resolve(process.cwd(), 'data/browser-sessions');
  }

  return path.join(path.dirname(databasePath), 'browser-sessions');
}

function toPortablePath(value: string) {
  return value.split(path.sep).join('/');
}

function normalizeLoadedSession(session: SessionMetadata, rootDir: string): SessionMetadata {
  const normalizedPlatform = normalizeBrowserSessionPlatform(session.platform);
  const normalizedSession: SessionMetadata = {
    ...session,
    platform: normalizedPlatform,
    id: buildSessionId(normalizedPlatform, sanitizeAccountKey(session.accountKey)),
  };

  if (!isUsableStorageStateFile(session.storageStatePath, rootDir)) {
    return {
      ...normalizedSession,
      status: 'missing',
    };
  }

  return normalizedSession;
}

function isUsableStorageStateFile(storageStatePath: string, rootDir: string) {
  const resolvedFile = resolveStorageStateFile(storageStatePath, rootDir);
  if (!resolvedFile.ok) {
    return false;
  }

  return hasValidStorageStateFileContents(resolvedFile.absolutePath);
}

function assertStorageStateFileUsable(
  storageStatePath: string,
  rootDir: string,
  platform: BrowserSessionPlatform,
) {
  const resolvedFile = resolveStorageStateFile(storageStatePath, rootDir);
  if (!resolvedFile.ok) {
    if (resolvedFile.reason === 'outside_roots') {
      throw new Error(
        `storage state path is outside allowed roots for platform ${platform}: ${storageStatePath}`,
      );
    }

    throw new Error(
      `storage state path does not exist for platform ${platform}: ${storageStatePath}`,
    );
  }

  if (!hasValidStorageStateFileContents(resolvedFile.absolutePath)) {
    throw new Error(
      `storage state file is invalid for platform ${platform}: ${storageStatePath}`,
    );
  }
}

function resolveStorageStateFile(storageStatePath: string, rootDir: string) {
  const normalizedPath = storageStatePath.trim();
  if (!normalizedPath) {
    return { ok: false as const, reason: 'missing' as const };
  }

  const allowedRoots = getAllowedStorageStateRoots(rootDir);

  if (path.isAbsolute(normalizedPath)) {
    const absolutePath = path.resolve(normalizedPath);

    if (!allowedRoots.some((allowedRoot) => isPathWithinRoot(absolutePath, allowedRoot))) {
      return { ok: false as const, reason: 'outside_roots' as const };
    }

    return fs.existsSync(absolutePath)
      ? { ok: true as const, absolutePath }
      : { ok: false as const, reason: 'missing' as const };
  }

  let escapedAllowedRoots = false;

  for (const allowedRoot of allowedRoots) {
    const candidate = path.resolve(allowedRoot, normalizedPath);
    if (!isPathWithinRoot(candidate, allowedRoot)) {
      escapedAllowedRoots = true;
      continue;
    }

    if (fs.existsSync(candidate)) {
      return { ok: true as const, absolutePath: candidate };
    }
  }

  return escapedAllowedRoots
    ? { ok: false as const, reason: 'outside_roots' as const }
    : { ok: false as const, reason: 'missing' as const };
}

function getAllowedStorageStateRoots(rootDir: string) {
  return Array.from(
    new Set([
      path.resolve(process.cwd()),
      path.resolve(rootDir),
      path.resolve(path.dirname(rootDir)),
    ]),
  );
}

function isPathWithinRoot(candidatePath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function hasValidStorageStateFileContents(absolutePath: string) {
  try {
    const raw = fs.readFileSync(absolutePath, 'utf8');
    return isValidStorageStatePayload(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return false;
  }
}

function isValidStorageStatePayload(value: Record<string, unknown>) {
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
