import { describe, expect, it, vi } from 'vitest';
import { createMonitorRssService } from '../../src/server/services/monitor/rss';

describe('monitor rss service', () => {
  it('fetches and minimally parses RSS items into monitor-ready records', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>OpenAI Blog</title>
            <item>
              <title><![CDATA[GPT-5.4 Released]]></title>
              <link>https://example.com/posts/gpt-5-4</link>
              <description><![CDATA[<p>Latency &amp; pricing update for APAC buyers.</p>]]></description>
              <pubDate>Mon, 20 Apr 2026 10:00:00 GMT</pubDate>
              <guid>gpt-5-4</guid>
            </item>
            <item>
              <title>Routing changes</title>
              <link>https://example.com/posts/routing</link>
              <description>New retry logic &lt;now live&gt;.</description>
            </item>
          </channel>
        </rss>`,
        {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        },
      ),
    );

    const service = createMonitorRssService({
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await service.fetchFeeds(['https://example.com/feed.xml']);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/feed.xml',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: expect.stringContaining('application/rss+xml'),
        }),
      }),
    );
    expect(result).toEqual({
      items: [
        {
          source: 'rss',
          title: 'GPT-5.4 Released',
          detail: 'Latency & pricing update for APAC buyers.',
          status: 'new',
          metadata: {
            feedUrl: 'https://example.com/feed.xml',
            feedTitle: 'OpenAI Blog',
            link: 'https://example.com/posts/gpt-5-4',
            publishedAt: 'Mon, 20 Apr 2026 10:00:00 GMT',
            guid: 'gpt-5-4',
          },
        },
        {
          source: 'rss',
          title: 'Routing changes',
          detail: 'New retry logic <now live>.',
          status: 'new',
          metadata: {
            feedUrl: 'https://example.com/feed.xml',
            feedTitle: 'OpenAI Blog',
            link: 'https://example.com/posts/routing',
            publishedAt: undefined,
            guid: undefined,
          },
        },
      ],
      failures: [],
    });
  });

  it('returns failures for bad fetch responses without throwing away the batch shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('upstream unavailable', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );

    const service = createMonitorRssService({
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await service.fetchFeeds(['https://example.com/feed.xml']);

    expect(result.items).toEqual([]);
    expect(result.failures).toEqual([
      {
        feedUrl: 'https://example.com/feed.xml',
        status: 502,
        message: 'Bad Gateway',
      },
    ]);
  });
});
