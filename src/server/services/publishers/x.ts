import type { PublishRequest, PublishResult } from './types';
import {
  FetchRetryError,
  type PublisherErrorDetails,
  type RetryStageDetails,
  classifyHttpError,
  createInvalidResponseError,
  createTransientError,
  fetchWithRetry,
  readResponseSnippet,
  sanitizeSnippet,
} from './http';

interface XCreateTweetResponse {
  data?: {
    id?: string;
  };
}

export async function publishToX(request: PublishRequest): Promise<PublishResult> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return createFailedPublishResult(request, {
      message: 'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
      retry: {
        publish: {
          attempts: 0,
          maxAttempts: 0,
          stage: 'publish',
        },
      },
      error: {
        category: 'auth',
        retriable: false,
        stage: 'publish',
      },
    });
  }

  let publishRequest;
  try {
    publishRequest = await fetchWithRetry(
      'https://api.twitter.com/2/tweets',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          text: request.content,
        }),
      },
      {
        stage: 'publish',
      },
    );
  } catch (error) {
    return createFailedPublishResult(
      request,
      error instanceof FetchRetryError
        ? {
            message: `x publish request failed: ${error.message}`,
            retry: {
              publish: error.retry,
            },
            error: createTransientError('publish', sanitizeSnippet(error.message)),
          }
        : {
            message: 'x publish request failed',
            retry: {
              publish: {
                attempts: 1,
                maxAttempts: 3,
                stage: 'publish',
              },
            },
            error: createTransientError(
              'publish',
              sanitizeSnippet(error instanceof Error ? error.message : String(error)),
            ),
          },
    );
  }

  const { response, retry } = publishRequest;
  if (!response.ok) {
    return createFailedPublishResult(request, {
      message: `X publish request failed with status ${response.status}`,
      retry: {
        publish: retry,
      },
      error: classifyHttpError(response.status, 'publish', await readResponseSnippet(response)),
    });
  }

  let data: XCreateTweetResponse;
  try {
    data = (await response.json()) as XCreateTweetResponse;
  } catch (error) {
    return createFailedPublishResult(request, {
      message: 'x publish response was not valid JSON',
      retry: {
        publish: retry,
      },
      error: createInvalidResponseError(
        'publish',
        sanitizeSnippet(error instanceof Error ? error.message : String(error)),
      ),
    });
  }

  const tweetId = data.data?.id?.trim();
  if (!tweetId) {
    return createFailedPublishResult(request, {
      message: 'x publish response missing tweet id',
      retry: {
        publish: retry,
      },
      error: createInvalidResponseError('publish', sanitizeSnippet(JSON.stringify(data))),
    });
  }

  return {
    platform: 'x',
    mode: 'api',
    status: 'published',
    success: true,
    publishUrl: `https://x.com/i/web/status/${tweetId}`,
    externalId: tweetId,
    message: `x api published draft ${String(request.draftId)}`,
    publishedAt: new Date().toISOString(),
    details: {
      ...(request.target ? { target: request.target } : {}),
      retry: {
        publish: retry,
      },
    },
  };
}

function createFailedPublishResult(
  request: PublishRequest,
  input: {
    message: string;
    retry: {
      publish: RetryStageDetails;
    };
    error: PublisherErrorDetails;
  },
): PublishResult {
  return {
    platform: 'x',
    mode: 'api',
    status: 'failed',
    success: false,
    publishUrl: null,
    externalId: null,
    message: input.message,
    publishedAt: null,
    details: {
      ...(request.target ? { target: request.target } : {}),
      retry: input.retry,
      error: input.error,
    },
  };
}

function getAccessToken(): string | null {
  const accessToken = process.env.X_ACCESS_TOKEN?.trim();
  if (accessToken) {
    return accessToken;
  }

  const bearerToken = process.env.X_BEARER_TOKEN?.trim();
  if (bearerToken) {
    return bearerToken;
  }

  return null;
}
