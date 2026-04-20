import type { PublishRequest, PublishResult, Publisher } from './types';
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

const REDDIT_TOKEN_ENDPOINT = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_SUBMIT_ENDPOINT = 'https://oauth.reddit.com/api/submit';

interface RedditAccessTokenResponse {
  access_token?: string;
}

interface RedditSubmitResponse {
  json?: {
    data?: {
      id?: string;
      url?: string;
    };
  };
}

type RedditAccessTokenResult =
  | {
      accessToken: string;
      retry: RetryStageDetails;
    }
  | {
      failure: PublishResult;
    };

export const publishToReddit: Publisher = async (
  request: PublishRequest,
): Promise<PublishResult> => {
  const subreddit = normalizeSubreddit(request.target);
  const config = readRedditConfig();
  if (!config) {
    return createFailedPublishResult(request, subreddit, {
      message:
        'missing reddit credentials: configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD',
      retry: {
        oauth: {
          attempts: 0,
          maxAttempts: 0,
          stage: 'oauth',
        },
      },
      error: {
        category: 'auth',
        retriable: false,
        stage: 'oauth',
      },
    });
  }

  const accessTokenResult = await getAccessToken(config, subreddit);
  if (isAccessTokenFailure(accessTokenResult)) {
    return accessTokenResult.failure;
  }

  const title = normalizeTitle(request);
  let submitRequest;
  try {
    submitRequest = await fetchWithRetry(
      REDDIT_SUBMIT_ENDPOINT,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessTokenResult.accessToken}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': config.userAgent,
        },
        body: new URLSearchParams({
          api_type: 'json',
          kind: 'self',
          sr: subreddit,
          title,
          text: request.content,
        }).toString(),
      },
      {
        stage: 'submit',
      },
    );
  } catch (error) {
    return createFailedPublishResult(request, subreddit, {
      message:
        error instanceof FetchRetryError
          ? `reddit submit request failed: ${error.message}`
          : 'reddit submit request failed',
      retry: {
        oauth: accessTokenResult.retry,
        submit:
          error instanceof FetchRetryError
            ? error.retry
            : {
                attempts: 1,
                maxAttempts: 3,
                stage: 'submit',
              },
      },
      error: createTransientError(
        'submit',
        sanitizeSnippet(error instanceof Error ? error.message : String(error)),
      ),
    });
  }

  const { response, retry } = submitRequest;
  if (!response.ok) {
    return createFailedPublishResult(request, subreddit, {
      message: `reddit publish failed with status ${response.status}`,
      retry: {
        oauth: accessTokenResult.retry,
        submit: retry,
      },
      error: classifyHttpError(response.status, 'submit', await readResponseSnippet(response)),
    });
  }

  let data: RedditSubmitResponse;
  try {
    data = (await response.json()) as RedditSubmitResponse;
  } catch (error) {
    return createFailedPublishResult(request, subreddit, {
      message: 'reddit publish response was not valid JSON',
      retry: {
        oauth: accessTokenResult.retry,
        submit: retry,
      },
      error: createInvalidResponseError(
        'submit',
        sanitizeSnippet(error instanceof Error ? error.message : String(error)),
      ),
    });
  }

  const externalId = data.json?.data?.id?.trim() ?? null;
  const publishUrl = data.json?.data?.url?.trim() || null;
  if (!externalId) {
    return createFailedPublishResult(request, subreddit, {
      message: 'reddit publish response missing submission id',
      retry: {
        oauth: accessTokenResult.retry,
        submit: retry,
      },
      error: createInvalidResponseError('submit', sanitizeSnippet(JSON.stringify(data))),
    });
  }

  return {
    platform: 'reddit',
    mode: 'api',
    status: 'published',
    success: true,
    publishUrl,
    externalId,
    message: `reddit api published draft ${String(request.draftId)}`,
    publishedAt: new Date().toISOString(),
    details: {
      subreddit,
      retry: {
        oauth: accessTokenResult.retry,
        submit: retry,
      },
    },
  };
};

interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

function readRedditConfig(): RedditConfig | null {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim() ?? '';
  const username = process.env.REDDIT_USERNAME?.trim() ?? '';
  const password = process.env.REDDIT_PASSWORD?.trim() ?? '';

  if (!clientId || !clientSecret || !username || !password) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    username,
    password,
    userAgent: process.env.REDDIT_USER_AGENT?.trim() || 'promobot/0.1',
  };
}

async function getAccessToken(
  config: RedditConfig,
  subreddit: string,
): Promise<RedditAccessTokenResult> {
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  let tokenRequest;
  try {
    tokenRequest = await fetchWithRetry(
      REDDIT_TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${basicAuth}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': config.userAgent,
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: config.username,
          password: config.password,
        }).toString(),
      },
      {
        stage: 'oauth',
      },
    );
  } catch (error) {
    return {
      failure: createFailedPublishResult(
        {
          draftId: 'oauth',
          content: '',
        },
        subreddit,
        {
          message:
            error instanceof FetchRetryError
              ? `reddit oauth request failed: ${error.message}`
              : 'reddit oauth request failed',
          retry: {
            oauth:
              error instanceof FetchRetryError
                ? error.retry
                : {
                    attempts: 1,
                    maxAttempts: 3,
                    stage: 'oauth',
                  },
          },
          error: createTransientError(
            'oauth',
            sanitizeSnippet(error instanceof Error ? error.message : String(error)),
          ),
        },
      ),
    };
  }

  const { response, retry } = tokenRequest;
  if (!response.ok) {
    return {
      failure: createFailedPublishResult(
        {
          draftId: 'oauth',
          content: '',
        },
        subreddit,
        {
          message: `reddit oauth failed with status ${response.status}`,
          retry: {
            oauth: retry,
          },
          error: classifyHttpError(response.status, 'oauth', await readResponseSnippet(response)),
        },
      ),
    };
  }

  let data: RedditAccessTokenResponse;
  try {
    data = (await response.json()) as RedditAccessTokenResponse;
  } catch (error) {
    return {
      failure: createFailedPublishResult(
        {
          draftId: 'oauth',
          content: '',
        },
        subreddit,
        {
          message: 'reddit oauth response was not valid JSON',
          retry: {
            oauth: retry,
          },
          error: createInvalidResponseError(
            'oauth',
            sanitizeSnippet(error instanceof Error ? error.message : String(error)),
          ),
        },
      ),
    };
  }

  const accessToken = data.access_token?.trim();
  if (!accessToken) {
    return {
      failure: createFailedPublishResult(
        {
          draftId: 'oauth',
          content: '',
        },
        subreddit,
        {
          message: 'reddit oauth response missing access token',
          retry: {
            oauth: retry,
          },
          error: createInvalidResponseError('oauth', sanitizeSnippet(JSON.stringify(data))),
        },
      ),
    };
  }

  return {
    accessToken,
    retry,
  };
}

function createFailedPublishResult(
  request: PublishRequest,
  subreddit: string,
  input: {
    message: string;
    retry: Record<string, unknown>;
    error: PublisherErrorDetails;
  },
): PublishResult {
  return {
    platform: 'reddit',
    mode: 'api',
    status: 'failed',
    success: false,
    publishUrl: null,
    externalId: null,
    message: input.message,
    publishedAt: null,
    details: {
      subreddit,
      retry: input.retry,
      error: input.error,
    },
  };
}

function normalizeSubreddit(target: string | undefined) {
  const trimmed = target?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.replace(/^r\//i, '') : 'promobot';
}

function normalizeTitle(request: PublishRequest) {
  const title = request.title?.trim();
  if (title && title.length > 0) {
    return title;
  }

  return `PromoBot draft ${String(request.draftId)}`;
}

function isAccessTokenFailure(result: RedditAccessTokenResult): result is { failure: PublishResult } {
  return 'failure' in result;
}
