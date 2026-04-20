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
  storageStatePath: string;
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

export interface SessionStoreOptions {
  rootDir: string;
}

export function createSessionStore(rootDir = resolveDefaultSessionRootDir()) {
  return new SessionStore({ rootDir });
}

export class SessionStore {
  constructor(private readonly options: SessionStoreOptions) {}

  saveSession(input: SaveSessionInput): SessionMetadata {
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

    const metadata: SessionMetadata = {
      id: buildSessionId(input.platform, storageKey),
      platform: input.platform,
      accountKey: input.accountKey,
      storageStatePath: input.storageStatePath,
      status: input.status,
      notes: input.notes ?? existing?.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastValidatedAt: input.lastValidatedAt ?? existing?.lastValidatedAt ?? null,
    };

    const metadataPath = this.getMetadataPath(input.platform, storageKey);
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  getSession(platform: BrowserSessionPlatform, accountKey: string): SessionMetadata | null {
    return this.getSessionByStorageKey(platform, sanitizeAccountKey(accountKey));
  }

  private getSessionByStorageKey(
    platform: BrowserSessionPlatform,
    storageKey: string,
  ): SessionMetadata | null {
    const metadataPath = this.getMetadataPath(platform, storageKey);

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    const raw = fs.readFileSync(metadataPath, 'utf8');
    return JSON.parse(raw) as SessionMetadata;
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
        sessions.push(JSON.parse(raw) as SessionMetadata);
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
    hasSession: true,
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

function resolveDefaultSessionRootDir() {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return path.resolve(process.cwd(), 'data/browser-sessions');
  }

  return path.join(path.dirname(databasePath), 'browser-sessions');
}
