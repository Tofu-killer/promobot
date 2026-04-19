import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseV2exSearch, searchV2ex } from '../../src/server/services/monitor/v2exSearch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('v2ex search service', () => {
  it('parses v2ex search html into normalized monitor records for downstream monitor ingestion', () => {
    const items = parseV2exSearch(`
      <div class="cell item">
        <span class="item_title">
          <a href="/t/123456#reply2">OpenRouter 替代方案讨论</a>
        </span>
        <strong><a href="/member/alice">alice</a></strong>
        <span class="topic_info">
          <a class="node" href="/go/devops">DevOps</a>
          • <a class="count" href="/t/123456#reply2">2 replies</a>
        </span>
      </div>
    `);

    expect(items).toEqual([
      {
        externalId: '123456',
        platform: 'v2ex',
        sourceType: 'v2ex_search',
        source: 'v2ex',
        title: 'OpenRouter 替代方案讨论',
        detail: 'V2EX DevOps · alice · 2 replies',
        content: 'OpenRouter 替代方案讨论',
        summary: 'OpenRouter 替代方案讨论',
        url: 'https://www.v2ex.com/t/123456#reply2',
        author: 'alice',
        node: 'DevOps',
        replies: 2,
        matchedKeywords: [],
        metadata: {
          authorProfileUrl: 'https://www.v2ex.com/member/alice',
          nodeUrl: 'https://www.v2ex.com/go/devops',
          replies: 2,
        },
      },
    ]);
  });

  it('fetches v2ex search results through fetch and passes the query into normalized items', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = String(url);
        return new Response(
          `
            <div class="cell item">
              <span class="item_title">
                <a href="/t/888888">Cheap LLM API routing</a>
              </span>
            </div>
          `,
          { status: 200 },
        );
      }),
    );

    const items = await searchV2ex('llm api');

    expect(requestedUrl).toContain('search?q=llm%20api');
    expect(items).toEqual([
      {
        externalId: '888888',
        platform: 'v2ex',
        sourceType: 'v2ex_search',
        source: 'v2ex',
        title: 'Cheap LLM API routing',
        detail: 'V2EX topic match for llm api',
        content: 'Cheap LLM API routing',
        summary: 'Cheap LLM API routing',
        url: 'https://www.v2ex.com/t/888888',
        author: undefined,
        node: undefined,
        replies: undefined,
        matchedKeywords: ['llm api'],
        metadata: {
          searchQuery: 'llm api',
        },
      },
    ]);
  });

  it('throws when v2ex search fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));

    await expect(searchV2ex('llm api')).rejects.toThrow('v2ex search failed with status 500');
  });

  it('returns an empty list for non-search html instead of throwing', () => {
    expect(parseV2exSearch('<html><body>nothing here</body></html>')).toEqual([]);
  });
});
