import { afterEach, describe, expect, it, vi } from 'vitest';

import { publishToReddit } from '../../src/server/services/publishers/reddit';

const originalEnv = {
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_USERNAME: process.env.REDDIT_USERNAME,
  REDDIT_PASSWORD: process.env.REDDIT_PASSWORD,
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
};

afterEach(() => {
  process.env.REDDIT_CLIENT_ID = originalEnv.REDDIT_CLIENT_ID;
  process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
  process.env.REDDIT_USERNAME = originalEnv.REDDIT_USERNAME;
  process.env.REDDIT_PASSWORD = originalEnv.REDDIT_PASSWORD;
  process.env.REDDIT_USER_AGENT = originalEnv.REDDIT_USER_AGENT;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reddit publisher', () => {
  it('uses the real reddit api contract when credentials are configured', async () => {
    process.env.REDDIT_CLIENT_ID = 'client-id';
    process.env.REDDIT_CLIENT_SECRET = 'client-secret';
    process.env.REDDIT_USERNAME = 'promo-user';
    process.env.REDDIT_PASSWORD = 'promo-pass';
    process.env.REDDIT_USER_AGENT = 'promobot/test';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'reddit-access-token',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            json: {
              data: {
                id: 'abc123',
                url: 'https://reddit.com/r/LocalLLaMA/comments/abc123/promobot_post',
              },
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToReddit({
      draftId: 8,
      title: 'Claude routing in AU',
      content: 'PromoBot can route Claude traffic with lower APAC latency.',
      target: 'LocalLLaMA',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.reddit.com/api/v1/access_token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'user-agent': 'promobot/test',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://oauth.reddit.com/api/submit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer reddit-access-token',
          'user-agent': 'promobot/test',
        }),
      }),
    );
    expect(result).toMatchObject({
      platform: 'reddit',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://reddit.com/r/LocalLLaMA/comments/abc123/promobot_post',
      externalId: 'abc123',
    });
  });

  it('falls back to the stub contract when reddit credentials are missing', async () => {
    process.env.REDDIT_CLIENT_ID = '';
    process.env.REDDIT_CLIENT_SECRET = '';
    process.env.REDDIT_USERNAME = '';
    process.env.REDDIT_PASSWORD = '';
    process.env.REDDIT_USER_AGENT = '';

    const result = await publishToReddit({
      draftId: 3,
      content: 'Fallback reddit publish',
    });

    expect(result).toMatchObject({
      platform: 'reddit',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://reddit.com/r/promobot/comments/3',
      externalId: 'reddit-3',
    });
    expect(result.message).toContain('stub');
  });
});
