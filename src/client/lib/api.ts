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

  return body as T;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown request error';
}
