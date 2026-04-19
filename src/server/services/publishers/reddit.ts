import { createStubPublisher } from './stub';
import type { PublishRequest, PublishResult, Publisher } from './types';

const stubPublisher = createStubPublisher({
  platform: 'reddit',
  mode: 'api',
});

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

export const publishToReddit: Publisher = async (
  request: PublishRequest,
): Promise<PublishResult> => {
  const config = readRedditConfig();
  if (!config) {
    return stubPublisher(request);
  }

  const accessToken = await getAccessToken(config);
  if (!accessToken) {
    return {
      platform: 'reddit',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'reddit oauth response missing access token',
      publishedAt: null,
    };
  }

  const subreddit = normalizeSubreddit(request.target);
  const title = normalizeTitle(request);

  const response = await fetch(REDDIT_SUBMIT_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
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
  });

  if (!response.ok) {
    return {
      platform: 'reddit',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: `reddit publish failed with status ${response.status}`,
      publishedAt: null,
      details: {
        subreddit,
      },
    };
  }

  const data = (await response.json()) as RedditSubmitResponse;
  const externalId = data.json?.data?.id?.trim() ?? null;
  const publishUrl = data.json?.data?.url?.trim() || null;

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

async function getAccessToken(config: RedditConfig) {
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(REDDIT_TOKEN_ENDPOINT, {
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
  });

  if (!response.ok) {
    throw new Error(`reddit oauth failed with status ${response.status}`);
  }

  const data = (await response.json()) as RedditAccessTokenResponse;
  return data.access_token?.trim() ?? null;
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
