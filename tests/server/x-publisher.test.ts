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

  it('falls back to the stub contract when x credentials are missing', async () => {
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
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/promobot/status/7',
      externalId: 'x-7',
    });
    expect(result.message).toContain('stub');
  });
});
