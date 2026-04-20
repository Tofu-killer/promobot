export interface XSearchRecord {
  externalId: string;
  platform: 'x';
  sourceType: 'x_search';
  source: 'x';
  title: string;
  detail: string;
  content: string;
  summary: string;
  url: string;
  author?: string;
  matchedKeywords: string[];
  metadata: Record<string, unknown>;
}

interface XSeedRecord {
  id?: string;
  query?: string;
  title?: string;
  text?: string;
  author?: string;
  url?: string;
}

interface XSearchResponse {
  data?: Array<{
    id?: string;
    text?: string;
    author_id?: string;
  }>;
  includes?: {
    users?: Array<{
      id?: string;
      username?: string;
    }>;
  };
}

const X_SEARCH_ENDPOINT = 'https://api.twitter.com/2/tweets/search/recent';

export async function searchX(query: string): Promise<XSearchRecord[]> {
  const seeded = collectSeededResults(query);
  if (seeded.length > 0) {
    return seeded;
  }

  const accessToken = getAccessToken();
  if (!accessToken) {
    return [];
  }

  const searchUrl = `${X_SEARCH_ENDPOINT}?${new URLSearchParams({
    query,
    max_results: '10',
    expansions: 'author_id',
    'tweet.fields': 'author_id,text',
    'user.fields': 'username',
  }).toString()}`;

  const response = await fetch(searchUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`x search failed with status ${response.status}`);
  }

  const data = (await response.json()) as XSearchResponse;
  const usersById = new Map(
    (data.includes?.users ?? [])
      .filter((user): user is NonNullable<typeof user> => Boolean(user?.id))
      .map((user) => [user.id ?? '', user.username ?? '']),
  );

  return (data.data ?? [])
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.id && item?.text))
    .map((item) => {
      const author = item.author_id ? usersById.get(item.author_id) : undefined;
      const text = item.text?.trim() ?? '';

      return {
        externalId: item.id ?? '',
        platform: 'x' as const,
        sourceType: 'x_search' as const,
        source: 'x' as const,
        title: text.length > 80 ? `${text.slice(0, 77)}...` : text,
        detail: `${author ? `@${author}` : 'x'} · matched x search for ${query}`,
        content: text,
        summary: text,
        url: item.id ? `https://x.com/i/web/status/${item.id}` : '',
        ...(author ? { author } : {}),
        matchedKeywords: query ? [query] : [],
        metadata: {
          ...(item.author_id ? { authorId: item.author_id } : {}),
          ...(query ? { searchQuery: query } : {}),
        },
      };
    });
}

function collectSeededResults(query: string): XSearchRecord[] {
  const seeds = parseSeedRecords(process.env.MONITOR_X_SEARCH_SEEDS);

  return seeds
    .filter((seed) => !seed.query || seed.query === query)
    .filter((seed): seed is Required<Pick<XSeedRecord, 'id' | 'title'>> & XSeedRecord =>
      Boolean(seed.id && seed.title),
    )
    .map((seed) => ({
      externalId: seed.id ?? '',
      platform: 'x' as const,
      sourceType: 'x_search' as const,
      source: 'x' as const,
      title: seed.title ?? 'Untitled X match',
      detail: `${seed.author ? `@${seed.author}` : 'x'} · matched x search seed for ${query}`,
      content: seed.text?.trim() || seed.title || '',
      summary: seed.title ?? '',
      url: seed.url ?? (seed.id ? `https://x.com/i/web/status/${seed.id}` : ''),
      ...(seed.author ? { author: seed.author } : {}),
      matchedKeywords: query ? [query] : [],
      metadata: {
        mode: 'seed',
        ...(query ? { searchQuery: query } : {}),
      },
    }));
}

function getAccessToken() {
  return process.env.X_ACCESS_TOKEN?.trim() || process.env.X_BEARER_TOKEN?.trim() || null;
}

function parseSeedRecords(raw: string | undefined): XSeedRecord[] {
  if (!raw?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is XSeedRecord => typeof item === 'object' && item !== null)
      : [];
  } catch {
    return [];
  }
}
