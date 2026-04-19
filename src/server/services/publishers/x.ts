import { createStubPublisher } from './stub';
import type { PublishRequest, PublishResult } from './types';

const stubPublisher = createStubPublisher({
  platform: 'x',
  mode: 'api',
});

interface XCreateTweetResponse {
  data?: {
    id?: string;
  };
}

export async function publishToX(request: PublishRequest): Promise<PublishResult> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return await stubPublisher(request);
  }

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      text: request.content,
    }),
  });

  if (!response.ok) {
    throw new Error(`X publish request failed with status ${response.status}`);
  }

  const data = (await response.json()) as XCreateTweetResponse;
  const tweetId = data.data?.id?.trim();
  if (!tweetId) {
    throw new Error('X publish response missing tweet id');
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
    details: request.target ? { target: request.target } : undefined,
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
