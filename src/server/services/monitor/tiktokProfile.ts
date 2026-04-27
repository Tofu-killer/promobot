export interface TiktokProfileInput {
  handle?: string;
  profileUrl: string;
}

export interface TiktokProfileSignal {
  source: 'tiktok';
  title: string;
  detail: string;
  profileUrl: string;
}

interface TiktokOEmbedResponse {
  author_name?: string;
  author_url?: string;
  embed_type?: string;
  title?: string;
  type?: string;
}

const TIKTOK_OEMBED_ENDPOINT = 'https://www.tiktok.com/oembed';
const TIKTOK_PROFILE_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);

export async function fetchTiktokProfileSignal(
  input: TiktokProfileInput,
): Promise<TiktokProfileSignal> {
  const response = await fetch(
    `${TIKTOK_OEMBED_ENDPOINT}?${new URLSearchParams({ url: input.profileUrl }).toString()}`,
    {
      headers: {
        'user-agent': 'promobot/0.1',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`tiktok oembed fetch failed with status ${response.status}`);
  }

  const payload = (await response.json()) as TiktokOEmbedResponse;
  const requestedHandle = normalizeHandle(input.handle) ?? readHandleFromProfileUrl(input.profileUrl);
  const authorUrl = readString(payload.author_url);
  const authorName = readString(payload.author_name);
  const embedType = readString(payload.embed_type) ?? readString(payload.type);
  const summary = readString(payload.title);
  const profileUrl = normalizeProfileUrl(authorUrl);

  if (!authorUrl || !authorName || !summary || embedType?.toLowerCase() !== 'profile') {
    throw new Error('tiktok oembed response did not look like a profile payload');
  }

  if (!profileUrl) {
    throw new Error('tiktok oembed response did not include a canonical profile url');
  }

  const resolvedHandle = normalizeHandle(readHandleFromProfileUrl(profileUrl));
  if (!resolvedHandle) {
    throw new Error('tiktok oembed response did not include a canonical profile url');
  }

  if (requestedHandle && requestedHandle !== resolvedHandle) {
    throw new Error(`tiktok oembed response resolved to ${resolvedHandle} instead of ${requestedHandle}`);
  }

  const handle = resolvedHandle;
  const title = handle ? `TikTok profile update: ${handle}` : 'TikTok profile update';

  return {
    source: 'tiktok',
    title,
    detail: `${authorName} · ${summary}\n\n${profileUrl}`,
    profileUrl,
  };
}

function readHandleFromProfileUrl(profileUrl: string) {
  try {
    const url = new URL(profileUrl);
    if (!TIKTOK_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1 || !segments[0]?.startsWith('@')) {
      return null;
    }

    return normalizeHandle(segments[0]);
  } catch {
    return null;
  }
}

function normalizeProfileUrl(profileUrl: string | null) {
  const handle = readHandleFromProfileUrl(profileUrl ?? '');
  return handle ? `https://www.tiktok.com/${handle}` : null;
}

function normalizeHandle(value: string | null | undefined) {
  const trimmed = readString(value)?.replace(/^@+/, '').toLowerCase();
  return trimmed ? `@${trimmed}` : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
