type FetchLike = typeof fetch;

export interface MonitorRssItemMetadata {
  feedUrl: string;
  feedTitle: string;
  link?: string;
  publishedAt?: string;
  guid?: string;
}

export interface MonitorRssItem {
  source: 'rss';
  title: string;
  detail: string;
  status: 'new';
  metadata: MonitorRssItemMetadata;
}

export interface MonitorRssFailure {
  feedUrl: string;
  status: number | null;
  message: string;
}

export interface MonitorRssFetchResult {
  items: MonitorRssItem[];
  failures: MonitorRssFailure[];
}

export interface MonitorRssServiceOptions {
  fetchImpl?: FetchLike;
}

export function createMonitorRssService(options: MonitorRssServiceOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available for monitor rss service');
  }

  return {
    async fetchFeeds(feedUrls: string[]): Promise<MonitorRssFetchResult> {
      const items: MonitorRssItem[] = [];
      const failures: MonitorRssFailure[] = [];

      for (const rawFeedUrl of feedUrls) {
        const feedUrl = rawFeedUrl.trim();

        if (!feedUrl) {
          failures.push({
            feedUrl: rawFeedUrl,
            status: null,
            message: 'feed url is required',
          });
          continue;
        }

        try {
          const response = await fetchImpl(feedUrl, {
            headers: {
              accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
            },
          });

          if (!response.ok) {
            failures.push({
              feedUrl,
              status: response.status,
              message: response.statusText || `HTTP ${response.status}`,
            });
            continue;
          }

          const xml = await response.text();
          items.push(...parseFeed(feedUrl, xml));
        } catch (error) {
          failures.push({
            feedUrl,
            status: null,
            message: error instanceof Error ? error.message : 'unknown rss fetch failure',
          });
        }
      }

      return {
        items,
        failures,
      };
    },
  };
}

function parseFeed(feedUrl: string, xml: string): MonitorRssItem[] {
  const source = xml.trim();

  if (!source) {
    throw new Error('empty rss response body');
  }

  if (/<(?:[\w-]+:)?rss\b/i.test(source) || /<rdf:RDF\b/i.test(source)) {
    return parseRssFeed(feedUrl, source);
  }

  if (/<(?:[\w-]+:)?feed\b/i.test(source)) {
    return parseAtomFeed(feedUrl, source);
  }

  throw new Error('response body is not a supported RSS or Atom feed');
}

function parseRssFeed(feedUrl: string, xml: string): MonitorRssItem[] {
  const channelBlock = getFirstBlock(xml, 'channel') ?? xml;
  const feedTitle = normalizeText(getFirstTagValue(channelBlock, ['title'])) || feedUrl;
  const itemBlocks = getBlocks(channelBlock, 'item');

  if (itemBlocks.length === 0) {
    throw new Error('rss feed does not contain any items');
  }

  return itemBlocks.map((itemBlock) => {
    const title = normalizeText(getFirstTagValue(itemBlock, ['title'])) || 'Untitled RSS item';
    const detail = normalizeText(
      getFirstTagValue(itemBlock, ['description', 'content:encoded', 'content', 'summary']),
    ) || title;
    const link =
      normalizeText(getFirstTagValue(itemBlock, ['link'])) ||
      normalizeText(getFirstTagValue(itemBlock, ['guid']));
    const publishedAt = normalizeText(getFirstTagValue(itemBlock, ['pubDate', 'dc:date']));
    const guid = normalizeText(getFirstTagValue(itemBlock, ['guid']));

    return createMonitorRssItem({
      feedUrl,
      feedTitle,
      title,
      detail,
      link,
      publishedAt,
      guid,
    });
  });
}

function parseAtomFeed(feedUrl: string, xml: string): MonitorRssItem[] {
  const feedTitle = normalizeText(getFirstTagValue(xml, ['title'])) || feedUrl;
  const entryBlocks = getBlocks(xml, 'entry');

  if (entryBlocks.length === 0) {
    throw new Error('atom feed does not contain any entries');
  }

  return entryBlocks.map((entryBlock) => {
    const title = normalizeText(getFirstTagValue(entryBlock, ['title'])) || 'Untitled RSS item';
    const detail = normalizeText(getFirstTagValue(entryBlock, ['summary', 'content'])) || title;
    const link = extractAtomLink(entryBlock);
    const publishedAt = normalizeText(getFirstTagValue(entryBlock, ['published', 'updated']));
    const guid = normalizeText(getFirstTagValue(entryBlock, ['id']));

    return createMonitorRssItem({
      feedUrl,
      feedTitle,
      title,
      detail,
      link,
      publishedAt,
      guid,
    });
  });
}

function createMonitorRssItem(input: {
  feedUrl: string;
  feedTitle: string;
  title: string;
  detail: string;
  link?: string;
  publishedAt?: string;
  guid?: string;
}): MonitorRssItem {
  return {
    source: 'rss',
    title: input.title,
    detail: input.detail,
    status: 'new',
    metadata: {
      feedUrl: input.feedUrl,
      feedTitle: input.feedTitle,
      link: input.link || undefined,
      publishedAt: input.publishedAt || undefined,
      guid: input.guid || undefined,
    },
  };
}

function getBlocks(input: string, tagName: string): string[] {
  const matcher = new RegExp(
    `<${buildTagNamePattern(tagName)}\\b[^>]*>([\\s\\S]*?)</${buildTagNamePattern(tagName)}>`,
    'gi',
  );
  return Array.from(input.matchAll(matcher), (match) => match[1]);
}

function getFirstBlock(input: string, tagName: string): string | undefined {
  return getBlocks(input, tagName)[0];
}

function getFirstTagValue(input: string, tagNames: string[]): string | undefined {
  for (const tagName of tagNames) {
    const matcher = new RegExp(
      `<${buildTagNamePattern(tagName)}\\b[^>]*>([\\s\\S]*?)</${buildTagNamePattern(tagName)}>`,
      'i',
    );
    const match = input.match(matcher);
    if (match) {
      return stripCdata(match[1]);
    }
  }

  return undefined;
}

function extractAtomLink(entryBlock: string): string | undefined {
  const matcher = /<(?:(?:[\w-]+):)?link\b([^>]*)\/?>/gi;

  for (const match of entryBlock.matchAll(matcher)) {
    const attributes = match[1] ?? '';
    const href = getAttributeValue(attributes, 'href');
    const rel = getAttributeValue(attributes, 'rel');

    if (!href) {
      continue;
    }

    if (!rel || rel === 'alternate') {
      return decodeXmlEntities(href.trim());
    }
  }

  return undefined;
}

function getAttributeValue(attributes: string, name: string): string | undefined {
  const matcher = new RegExp(`${escapeRegex(name)}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return attributes.match(matcher)?.[2];
}

function normalizeText(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const withoutMarkup = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ');

  return decodeXmlEntities(withoutMarkup)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|#39);/g, (entity, token: string) => {
    switch (token) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
      case '#39':
        return "'";
      default:
        if (token.startsWith('#x')) {
          return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
        }
        if (token.startsWith('#')) {
          return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
        }
        return entity;
    }
  });
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function buildTagNamePattern(tagName: string): string {
  const escaped = escapeRegex(tagName);
  return tagName.includes(':') ? escaped : `(?:[\\w-]+:)?${escaped}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
