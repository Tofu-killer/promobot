import { describe, expect, it } from 'vitest';

import { publishToBlog } from '../../src/server/services/publishers/blog';

describe('publishToBlog', () => {
  it('returns a manual handoff contract instead of a fake published result', async () => {
    const result = await publishToBlog({
      draftId: 12,
      title: 'Launch post',
      content: 'Blog draft body',
      target: 'blog-main',
    });

    expect(result).toEqual({
      platform: 'blog',
      mode: 'manual',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'blog stub publisher accepted draft 12',
      publishedAt: null,
      details: {
        target: 'blog-main',
      },
    });
  });
});
