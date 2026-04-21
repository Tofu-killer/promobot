export class ApiRequestError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
}

const ADMIN_PASSWORD_STORAGE_KEY = 'promobot_admin_password';
const ADMIN_PASSWORD_STORAGE_MODE_KEY = 'promobot_admin_password_mode';
const AUTH_ERROR_EVENT = 'promobot-auth-error';

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, withAdminPassword(init));
  const body = await parseResponseBody(response);

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : typeof body === 'string' && body.length > 0
          ? body
          : `Request failed with status ${response.status}`;

    if (response.status === 401) {
      clearStoredAdminPassword();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, { detail: { message } }));
      }
    }

    throw new ApiRequestError(response.status, message, body);
  }

  return body as T;
}

export async function validateAdminPassword(password: string): Promise<void> {
  const headers = new Headers();
  headers.set('x-admin-password', password);

  const response = await fetch('/api/auth/probe', {
    method: 'GET',
    headers,
  });
  const body = await parseResponseBody(response);

  if (response.ok) {
    return;
  }

  const message =
    response.status === 401
      ? '管理员密码无效'
      : typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof body.error === 'string'
        ? body.error
        : typeof body === 'string' && body.length > 0
          ? body
          : `Request failed with status ${response.status}`;

  throw new ApiRequestError(response.status, message, body);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown request error';
}

export function getStoredAdminPassword() {
  if (typeof window === 'undefined') {
    return null;
  }

  const sessionStorage = getSessionStorage();
  const sessionValue = readStorageValue(sessionStorage);
  if (sessionValue) {
    return sessionValue;
  }

  const localStorage = getLegacyLocalStorage();
  const legacyValue = readStorageValue(localStorage);
  if (!legacyValue) {
    return null;
  }

  const storageMode = readStorageMode(localStorage);
  if (storageMode === 'persistent') {
    return legacyValue;
  }

  try {
    sessionStorage?.setItem(ADMIN_PASSWORD_STORAGE_KEY, legacyValue);
    localStorage?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
    localStorage?.removeItem(ADMIN_PASSWORD_STORAGE_MODE_KEY);
  } catch {
    return legacyValue;
  }

  return legacyValue;
}

export function storeAdminPassword(password: string, options: { persist?: boolean } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const persist = options.persist === true;

  if (persist) {
    try {
      getLegacyLocalStorage()?.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
      getLegacyLocalStorage()?.setItem(ADMIN_PASSWORD_STORAGE_MODE_KEY, 'persistent');
      getSessionStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
    } catch {
      getSessionStorage()?.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
    }
    return;
  }

  try {
    getSessionStorage()?.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
    getLegacyLocalStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
    getLegacyLocalStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_MODE_KEY);
  } catch {
    getLegacyLocalStorage()?.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
    getLegacyLocalStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_MODE_KEY);
  }
}

export function clearStoredAdminPassword() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    getSessionStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }

  try {
    getLegacyLocalStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
    getLegacyLocalStorage()?.removeItem(ADMIN_PASSWORD_STORAGE_MODE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function getAuthErrorEventName() {
  return AUTH_ERROR_EVENT;
}

export function getAdminPasswordStorageKey() {
  return ADMIN_PASSWORD_STORAGE_KEY;
}

function readStorageMode(
  storage:
    | {
        getItem: (key: string) => string | null;
      }
    | null,
) {
  try {
    return storage?.getItem(ADMIN_PASSWORD_STORAGE_MODE_KEY) ?? null;
  } catch {
    return null;
  }
}

function withAdminPassword(init: RequestInit | undefined): RequestInit | undefined {
  const adminPassword = getStoredAdminPassword();
  if (!adminPassword) {
    return init;
  }

  const headers = new Headers(init?.headers);
  headers.set('x-admin-password', adminPassword);

  return {
    ...init,
    headers,
  };
}

function readStorageValue(
  storage:
    | {
        getItem: (key: string) => string | null;
      }
    | null,
) {
  try {
    const value = storage?.getItem(ADMIN_PASSWORD_STORAGE_KEY) ?? null;
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function getSessionStorage() {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

function getLegacyLocalStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}
