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

  it('returns a failed contract when reddit credentials are missing', async () => {
    process.env.REDDIT_CLIENT_ID = '';
    process.env.REDDIT_CLIENT_SECRET = '';
    process.env.REDDIT_USERNAME = '';
    process.env.REDDIT_PASSWORD = '';
    process.env.REDDIT_USER_AGENT = '';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToReddit({
      draftId: 3,
      content: 'Fallback reddit publish',
    });

    expect(result).toMatchObject({
      platform: 'reddit',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'missing reddit credentials: configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD',
      publishedAt: null,
      details: {
        subreddit: 'promobot',
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
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries transient reddit submit failures and reports retry details on success', async () => {
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
              errors: [['RATELIMIT', 'too fast', 'ratelimit']],
            },
          }),
          {
            status: 503,
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
                id: 'retry123',
                url: 'https://reddit.com/r/LocalLLaMA/comments/retry123/promobot_retry',
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
      draftId: 11,
      title: 'Retry Reddit publish',
      content: 'Retry the transient reddit failure.',
      target: 'LocalLLaMA',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      platform: 'reddit',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://reddit.com/r/LocalLLaMA/comments/retry123/promobot_retry',
      externalId: 'retry123',
      details: {
        subreddit: 'LocalLLaMA',
        retry: {
          oauth: {
            attempts: 1,
            maxAttempts: 3,
            stage: 'oauth',
            lastHttpStatus: 200,
          },
          submit: {
            attempts: 2,
            maxAttempts: 3,
            stage: 'submit',
            lastHttpStatus: 200,
          },
        },
      },
    });
  });

  it('returns a failed contract with classified oauth auth errors for reddit api failures', async () => {
    process.env.REDDIT_CLIENT_ID = 'client-id';
    process.env.REDDIT_CLIENT_SECRET = 'client-secret';
    process.env.REDDIT_USERNAME = 'promo-user';
    process.env.REDDIT_PASSWORD = 'promo-pass';
    process.env.REDDIT_USER_AGENT = 'promobot/test';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToReddit({
      draftId: 12,
      title: 'OAuth should fail',
      content: 'This should fail.',
      target: 'LocalLLaMA',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      platform: 'reddit',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      details: {
        subreddit: 'LocalLLaMA',
        error: {
          category: 'auth',
          retriable: false,
          httpStatus: 401,
          stage: 'oauth',
        },
        retry: {
          oauth: {
            attempts: 1,
            maxAttempts: 3,
            stage: 'oauth',
            lastHttpStatus: 401,
          },
        },
      },
    });
  });
});
