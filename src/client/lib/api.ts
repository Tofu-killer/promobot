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
  const response = await fetch(input, init);
  const body = await parseResponseBody(response);

  if (!response.ok) {
    const message =
      response.status === 401
        ? '管理员登录已过期'
        : typeof body === 'object' &&
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

export async function probeAdminSession(): Promise<void> {
  const response = await fetch('/api/auth/probe', {
    method: 'GET',
  });
  const body = await parseResponseBody(response);

  if (response.ok) {
    clearLegacyAdminPasswordStorage();
    return;
  }

  const message =
    response.status === 401
      ? '管理员登录已过期'
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

export async function loginAdminSession(
  password: string,
  options: { remember?: boolean } = {},
): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password,
      remember: options.remember === true,
    }),
  });
  const body = await parseResponseBody(response);

  if (response.ok) {
    clearLegacyAdminPasswordStorage();
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

export async function logoutAdminSession(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
  });
  const body = await parseResponseBody(response);

  if (response.ok) {
    clearLegacyAdminPasswordStorage();
    return;
  }

  const message =
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
      ? body.error
      : typeof body === 'string' && body.length > 0
        ? body
        : `Request failed with status ${response.status}`;

  throw new ApiRequestError(response.status, message, body);
}

export async function validateAdminPassword(password: string): Promise<void> {
  await loginAdminSession(password);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown request error';
}

export function getStoredAdminPassword() {
  clearLegacyAdminPasswordStorage();
  return null;
}

export function storeAdminPassword(password: string, options: { persist?: boolean } = {}) {
  void password;
  void options;
  clearLegacyAdminPasswordStorage();
}

export function clearStoredAdminPassword() {
  clearLegacyAdminPasswordStorage();
}

export function getAuthErrorEventName() {
  return AUTH_ERROR_EVENT;
}

export function getAdminPasswordStorageKey() {
  return 'promobot_admin_password';
}

function clearLegacyAdminPasswordStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }

  try {
    window.localStorage?.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
    window.localStorage?.removeItem(ADMIN_PASSWORD_STORAGE_MODE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}
