export interface V2exNormalizedRecord {
  externalId: string;
  platform: 'v2ex';
  sourceType: 'v2ex_search';
  source: 'v2ex';
  title: string;
  detail: string;
  content: string;
  summary: string;
  url: string;
  author?: string;
  node?: string;
  replies?: number;
  matchedKeywords: string[];
  metadata: Record<string, unknown>;
}

export async function searchV2ex(query: string): Promise<V2exNormalizedRecord[]> {
  const url = `https://www.v2ex.com/search?q=${encodeURIComponent(query)}&syntax=plain&order=created`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`v2ex search failed with status ${response.status}`);
  }

  const html = await response.text();
  return parseV2exSearch(html, query);
}

export function parseV2exSearch(html: string, query = ''): V2exNormalizedRecord[] {
  const matches = [...html.matchAll(/<div[^>]*class="cell item"[\s\S]*?<\/div>/gi)];
  if (matches.length === 0) return [];

  return matches
    .map((m) => m[0])
    .reduce<V2exNormalizedRecord[]>((records, block) => {
      const titleMatch = block.match(/<span[^>]*class="item_title"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) return records;
      const relativeUrl = titleMatch[1].trim();
      const title = normalizeText(titleMatch[2] || '');
      const url = relativeUrl.startsWith('http') ? relativeUrl : `https://www.v2ex.com${relativeUrl}`;

      const nodeMatch = block.match(/class="node"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
      const node = nodeMatch ? normalizeText(nodeMatch[2]) : undefined;
      const nodeUrl = nodeMatch ? (nodeMatch[1].startsWith('http') ? nodeMatch[1] : `https://www.v2ex.com${nodeMatch[1]}`) : undefined;

      const repliesMatch = block.match(/class="count"[^>]*>\s*([0-9]+)\s*reply/i) || block.match(/>([0-9]+) replies?</i);
      let replies: number | undefined = undefined;
      if (repliesMatch && repliesMatch[1]) {
        replies = Number(repliesMatch[1]);
      }

      const memberMatch = block.match(/<a[^>]*href="(\/member\/[^"\s]+)"[^>]*>\s*([^<]+?)\s*<\/a>/i);
      const author = memberMatch ? normalizeText(memberMatch[2]) : undefined;
      const authorProfileUrl = memberMatch ? (memberMatch[1].startsWith('http') ? memberMatch[1] : `https://www.v2ex.com${memberMatch[1]}`) : undefined;
      const detail = node && author && replies !== undefined
        ? `V2EX ${node} · ${author} · ${replies} replies`
        : query
          ? `V2EX topic match for ${query}`
          : `Matched V2EX topic for monitor query: ${title}`;

      records.push({
        externalId: extractExternalIdFromUrl(url),
        platform: 'v2ex' as const,
        sourceType: 'v2ex_search' as const,
        source: 'v2ex' as const,
        title,
        detail,
        content: title,
        summary: title,
        url,
        ...(author ? { author } : {}),
        ...(node ? { node } : {}),
        ...(replies !== undefined ? { replies } : {}),
        matchedKeywords: query ? [query] : [],
        metadata: {
          ...(authorProfileUrl ? { authorProfileUrl } : {}),
          ...(nodeUrl ? { nodeUrl } : {}),
          ...(replies !== undefined ? { replies } : {}),
          ...(query ? { searchQuery: query } : {}),
        },
      });

      return records;
    }, []);
}

function extractExternalIdFromUrl(url: string) {
  const m = url.match(/\/t\/(\d+)/);
  return m ? m[1] : url;
}

function normalizeText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
