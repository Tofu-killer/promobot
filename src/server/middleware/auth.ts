import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { withDatabase } from '../lib/persistence.js';

const ADMIN_SESSION_COOKIE_NAME = 'promobot_admin_session';
const defaultSessionTtlMs = 12 * 60 * 60 * 1000;
const defaultPersistentSessionTtlMs = 30 * 24 * 60 * 60 * 1000;

export interface AdminSessionStore {
  createSession(options?: { remember?: boolean }): { token: string; expiresAt: number };
  hasSession(token: string): boolean;
  revokeSession(token: string): void;
}

export interface RequireAdminPasswordOptions {
  adminPassword: string;
  sessionStore?: AdminSessionStore;
  allowHeaderFallback?: boolean;
}

export function createAdminSessionStore(
  options: {
    now?: () => number;
    sessionTtlMs?: number;
    persistentSessionTtlMs?: number;
    passwordFingerprint?: string;
  } = {},
): AdminSessionStore {
  const now = options.now ?? (() => Date.now());
  const sessionTtlMs = options.sessionTtlMs ?? defaultSessionTtlMs;
  const persistentSessionTtlMs = options.persistentSessionTtlMs ?? defaultPersistentSessionTtlMs;
  const passwordFingerprint = options.passwordFingerprint ?? '';

  return {
    createSession({ remember = false } = {}) {
      const expiresAt = now() + (remember ? persistentSessionTtlMs : sessionTtlMs);
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashAdminSessionToken(token, passwordFingerprint);

      withDatabase((database) => {
        ensureAdminSessionsTable(database);
        pruneExpiredAdminSessions(database, now());
        database
          .prepare(
            `
              INSERT OR REPLACE INTO admin_sessions (token_hash, expires_at)
              VALUES (@token_hash, @expires_at)
            `,
          )
          .run({
            token_hash: tokenHash,
            expires_at: new Date(expiresAt).toISOString(),
          });
      });

      return { token, expiresAt };
    },
    hasSession(token) {
      const tokenHash = hashAdminSessionToken(token, passwordFingerprint);
      const currentTime = now();
      const session = withDatabase((database) => {
        ensureAdminSessionsTable(database);
        pruneExpiredAdminSessions(database, currentTime);
        return database
          .prepare(
            `
              SELECT expires_at AS expiresAt
              FROM admin_sessions
              WHERE token_hash = ?
            `,
          )
          .get([tokenHash]) as { expiresAt?: string } | undefined;
      });

      if (!session) {
        return false;
      }

      const expiresAt = Date.parse(String(session.expiresAt ?? ''));
      if (!Number.isFinite(expiresAt) || expiresAt <= currentTime) {
        this.revokeSession(token);
        return false;
      }

      return true;
    },
    revokeSession(token) {
      const tokenHash = hashAdminSessionToken(token, passwordFingerprint);
      withDatabase((database) => {
        ensureAdminSessionsTable(database);
        database
          .prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
          .run([tokenHash]);
      });
    },
  };
}

export function hasValidAdminPassword(request: Request, adminPassword: string): boolean {
  if (!adminPassword) {
    return true;
  }

  return request.header('x-admin-password') === adminPassword;
}

export function hasValidAdminSession(
  request: Request,
  sessionStore: AdminSessionStore | undefined,
): boolean {
  if (!sessionStore) {
    return false;
  }

  const token = readAdminSessionToken(request);
  return token ? sessionStore.hasSession(token) : false;
}

export function readAdminSessionToken(request: Pick<Request, 'header'>): string | null {
  const cookieHeader = request.header('cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = segment.trim().split('=');
    if (rawName !== ADMIN_SESSION_COOKIE_NAME) {
      continue;
    }

    const rawValue = rawValueParts.join('=').trim();
    if (rawValue.length === 0) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return null;
    }
  }

  return null;
}

export function serializeAdminSessionCookie(
  token: string,
  options: { remember?: boolean; expiresAt?: number } = {},
) {
  const remember = options.remember === true;
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  if (remember && typeof options.expiresAt === 'number') {
    const maxAgeSeconds = Math.max(0, Math.floor((options.expiresAt - Date.now()) / 1000));
    parts.push(`Max-Age=${maxAgeSeconds}`);
    parts.push(`Expires=${new Date(options.expiresAt).toUTCString()}`);
  }

  return parts.join('; ');
}

export function serializeClearedAdminSessionCookie() {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function requireAdminPassword(input: string | RequireAdminPasswordOptions) {
  const options: RequireAdminPasswordOptions =
    typeof input === 'string' ? { adminPassword: input } : input;

  return (request: Request, response: Response, next: NextFunction) => {
    if (!options.adminPassword) {
      next();
      return;
    }

    if (hasValidAdminSession(request, options.sessionStore)) {
      next();
      return;
    }

    if (options.allowHeaderFallback !== false && hasValidAdminPassword(request, options.adminPassword)) {
      next();
      return;
    }

    response.status(401).json({ error: 'unauthorized' });
  };
}

function ensureAdminSessionsTable(
  database: {
    exec(sql: string): void;
    prepare(sql: string): { all(params?: unknown[]): Array<{ name?: unknown }> };
  },
) {
  const columns = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_sessions'")
    .all();

  if (columns.length > 0) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function pruneExpiredAdminSessions(
  database: {
    prepare(sql: string): { run(params?: unknown[] | Record<string, unknown>): unknown };
  },
  currentTimeMs: number,
) {
  database
    .prepare('DELETE FROM admin_sessions WHERE expires_at <= ?')
    .run([new Date(currentTimeMs).toISOString()]);
}

function hashAdminSessionToken(token: string, passwordFingerprint: string) {
  return crypto
    .createHash('sha256')
    .update(passwordFingerprint)
    .update(':')
    .update(token)
    .digest('hex');
}
