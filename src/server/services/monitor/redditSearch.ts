export interface RedditSearchRecord {
  externalId: string;
  platform: 'reddit';
  sourceType: 'reddit_search';
  source: 'reddit';
  title: string;
  detail: string;
  content: string;
  summary: string;
  url: string;
  subreddit?: string;
  author?: string;
  matchedKeywords: string[];
  metadata: Record<string, unknown>;
}

interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

interface RedditTokenResponse {
  access_token?: string;
}

interface RedditSearchResponse {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        selftext?: string;
        permalink?: string;
        url?: string;
        subreddit_name_prefixed?: string;
        subreddit?: string;
        author?: string;
      };
    }>;
  };
}

const REDDIT_TOKEN_ENDPOINT = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_SEARCH_ENDPOINT = 'https://oauth.reddit.com/search';

export async function searchReddit(query: string): Promise<RedditSearchRecord[]> {
  const config = readRedditConfig();
  if (!config) {
    return [];
  }

  const accessToken = await getAccessToken(config);
  if (!accessToken) {
    throw new Error('reddit search oauth response missing access token');
  }

  const searchUrl = `${REDDIT_SEARCH_ENDPOINT}?${new URLSearchParams({
    q: query,
    limit: '10',
    sort: 'new',
    type: 'link,self',
  }).toString()}`;

  const response = await fetch(searchUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'user-agent': config.userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`reddit search failed with status ${response.status}`);
  }

  const data = (await response.json()) as RedditSearchResponse;
  const children = data.data?.children ?? [];

  return children
    .map((child) => child.data)
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.id && item?.title))
    .map((item) => ({
      externalId: item.id ?? '',
      platform: 'reddit' as const,
      sourceType: 'reddit_search' as const,
      source: 'reddit' as const,
      title: item.title ?? 'Untitled Reddit match',
      detail: `${item.subreddit_name_prefixed ?? item.subreddit ?? 'reddit'} · ${item.author ?? 'unknown'}`,
      content: item.selftext?.trim() || item.title || '',
      summary: item.title ?? '',
      url: item.permalink ? `https://www.reddit.com${item.permalink}` : item.url ?? '',
      ...(item.subreddit_name_prefixed || item.subreddit
        ? { subreddit: item.subreddit_name_prefixed ?? item.subreddit }
        : {}),
      ...(item.author ? { author: item.author } : {}),
      matchedKeywords: query ? [query] : [],
      metadata: {
        ...(item.permalink ? { permalink: item.permalink } : {}),
      },
    }));
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

  const data = (await response.json()) as RedditTokenResponse;
  return data.access_token?.trim() ?? null;
}
