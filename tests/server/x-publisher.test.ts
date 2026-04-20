import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishToX } from '../../src/server/services/publishers/x';

const originalEnv = {
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
};

beforeEach(() => {
  delete process.env.X_ACCESS_TOKEN;
  delete process.env.X_BEARER_TOKEN;
});

afterEach(() => {
  process.env.X_ACCESS_TOKEN = originalEnv.X_ACCESS_TOKEN;
  process.env.X_BEARER_TOKEN = originalEnv.X_BEARER_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('x publisher', () => {
  it('uses the real x api contract when an access token is configured', async () => {
    process.env.X_ACCESS_TOKEN = 'x-access-token';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: '1888888888888',
          },
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToX({
      draftId: 42,
      content: 'PromoBot can route Claude traffic with lower AU latency.',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.twitter.com/2/tweets',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer x-access-token',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          text: 'PromoBot can route Claude traffic with lower AU latency.',
        }),
      }),
    );
    expect(result).toMatchObject({
      platform: 'x',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/i/web/status/1888888888888',
      externalId: '1888888888888',
    });
  });

  it('returns a failed contract when x credentials are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToX({
      draftId: 7,
      content: 'Fallback publish contract',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      platform: 'x',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      details: {
        error: {
          category: 'auth',
          retriable: false,
          stage: 'publish',
        },
        retry: {
          publish: {
            attempts: 0,
            maxAttempts: 0,
            stage: 'publish',
          },
        },
      },
    });
    expect(result.message).toContain('missing x credentials');
  });

  it('retries transient x api failures and reports retry details on success', async () => {
    process.env.X_ACCESS_TOKEN = 'x-access-token';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [{ message: 'upstream unavailable' }],
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
            data: {
              id: '1999999999999',
            },
          }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToX({
      draftId: 9,
      content: 'Retry the transient x failure.',
      target: '@promobot',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      platform: 'x',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/i/web/status/1999999999999',
      externalId: '1999999999999',
      details: {
        target: '@promobot',
        retry: {
          publish: {
            attempts: 2,
            maxAttempts: 3,
            stage: 'publish',
            lastHttpStatus: 201,
          },
        },
      },
    });
  });

  it('returns a failed contract with classified auth errors for x api failures', async () => {
    process.env.X_ACCESS_TOKEN = 'x-access-token';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: 'Unauthorized',
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

    const result = await publishToX({
      draftId: 10,
      content: 'This should fail.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      platform: 'x',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      details: {
        error: {
          category: 'auth',
          retriable: false,
          httpStatus: 401,
          stage: 'publish',
        },
        retry: {
          publish: {
            attempts: 1,
            maxAttempts: 3,
            stage: 'publish',
            lastHttpStatus: 401,
          },
        },
      },
    });
  });
});
