import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const ADMIN_SESSION_COOKIE_NAME = 'promobot_admin_session';
const defaultSessionTtlMs = 12 * 60 * 60 * 1000;
const defaultPersistentSessionTtlMs = 30 * 24 * 60 * 60 * 1000;

interface AdminSessionRecord {
  expiresAt: number;
}

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
  } = {},
): AdminSessionStore {
  const now = options.now ?? (() => Date.now());
  const sessionTtlMs = options.sessionTtlMs ?? defaultSessionTtlMs;
  const persistentSessionTtlMs = options.persistentSessionTtlMs ?? defaultPersistentSessionTtlMs;
  const sessions = new Map<string, AdminSessionRecord>();

  function pruneExpiredSessions() {
    const currentTime = now();

    for (const [token, session] of sessions.entries()) {
      if (session.expiresAt <= currentTime) {
        sessions.delete(token);
      }
    }
  }

  return {
    createSession({ remember = false } = {}) {
      pruneExpiredSessions();
      const expiresAt = now() + (remember ? persistentSessionTtlMs : sessionTtlMs);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { expiresAt });
      return { token, expiresAt };
    },
    hasSession(token) {
      pruneExpiredSessions();
      const session = sessions.get(token);
      if (!session) {
        return false;
      }

      if (session.expiresAt <= now()) {
        sessions.delete(token);
        return false;
      }

      return true;
    },
    revokeSession(token) {
      sessions.delete(token);
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
