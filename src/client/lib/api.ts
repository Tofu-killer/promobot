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

  const value = window.localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
  return value && value.trim().length > 0 ? value : null;
}

export function storeAdminPassword(password: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
}

export function clearStoredAdminPassword() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
}

export function getAuthErrorEventName() {
  return AUTH_ERROR_EVENT;
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
