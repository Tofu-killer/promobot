const DEFAULT_MAX_ATTEMPTS = 3;
const RETRIABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_BODY_SNIPPET_LENGTH = 240;

export type PublisherErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'transient'
  | 'validation'
  | 'provider'
  | 'invalid_response';

export interface RetryStageDetails {
  attempts: number;
  maxAttempts: number;
  stage: string;
  lastHttpStatus?: number;
  retryAfterMs?: number;
}

export interface PublisherErrorDetails {
  category: PublisherErrorCategory;
  retriable: boolean;
  stage: string;
  httpStatus?: number;
  bodySnippet?: string;
}

export class FetchRetryError extends Error {
  readonly retry: RetryStageDetails;

  constructor(message: string, retry: RetryStageDetails) {
    super(message);
    this.name = 'FetchRetryError';
    this.retry = retry;
  }
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: {
    stage: string;
    maxAttempts?: number;
  },
): Promise<{ response: Response; retry: RetryStageDetails }> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let retryAfterMs: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      retryAfterMs = readRetryAfterMs(response.headers.get('retry-after')) ?? retryAfterMs;

      if (attempt < maxAttempts && RETRIABLE_HTTP_STATUSES.has(response.status)) {
        continue;
      }

      return {
        response,
        retry: createRetryStageDetails(
          options.stage,
          attempt,
          maxAttempts,
          response.status,
          retryAfterMs,
        ),
      };
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new FetchRetryError(
          error instanceof Error ? error.message : String(error),
          createRetryStageDetails(options.stage, attempt, maxAttempts, undefined, retryAfterMs),
        );
      }
    }
  }

  throw new FetchRetryError(
    `${options.stage} request exhausted retries`,
    createRetryStageDetails(options.stage, maxAttempts, maxAttempts),
  );
}

export function createRetryStageDetails(
  stage: string,
  attempts: number,
  maxAttempts: number,
  lastHttpStatus?: number,
  retryAfterMs?: number,
): RetryStageDetails {
  return {
    attempts,
    maxAttempts,
    stage,
    ...(typeof lastHttpStatus === 'number' ? { lastHttpStatus } : {}),
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
  };
}

export function classifyHttpError(
  httpStatus: number,
  stage: string,
  bodySnippet?: string,
): PublisherErrorDetails {
  if (httpStatus === 401 || httpStatus === 403) {
    return createErrorDetails('auth', false, stage, httpStatus, bodySnippet);
  }

  if (httpStatus === 429) {
    return createErrorDetails('rate_limit', true, stage, httpStatus, bodySnippet);
  }

  if (httpStatus === 400 || httpStatus === 422) {
    return createErrorDetails('validation', false, stage, httpStatus, bodySnippet);
  }

  if (httpStatus >= 500) {
    return createErrorDetails('transient', true, stage, httpStatus, bodySnippet);
  }

  return createErrorDetails('provider', false, stage, httpStatus, bodySnippet);
}

export function createInvalidResponseError(
  stage: string,
  bodySnippet?: string,
): PublisherErrorDetails {
  return createErrorDetails('invalid_response', false, stage, undefined, bodySnippet);
}

export function createTransientError(stage: string, message?: string): PublisherErrorDetails {
  return createErrorDetails('transient', true, stage, undefined, message);
}

export async function readResponseSnippet(response: Response): Promise<string | undefined> {
  const text = await response.clone().text();
  return sanitizeSnippet(text);
}

export function sanitizeSnippet(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, MAX_BODY_SNIPPET_LENGTH);
}

function createErrorDetails(
  category: PublisherErrorCategory,
  retriable: boolean,
  stage: string,
  httpStatus?: number,
  bodySnippet?: string,
): PublisherErrorDetails {
  return {
    category,
    retriable,
    stage,
    ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    ...(bodySnippet ? { bodySnippet } : {}),
  };
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.max(0, timestamp - Date.now());
}
