export interface InstagramProfileInput {
  handle?: string;
  profileUrl: string;
}

export interface InstagramProfileSignal {
  source: 'instagram';
  title: string;
  detail: string;
  profileUrl: string;
}

export async function fetchInstagramProfileSignal(
  input: InstagramProfileInput,
): Promise<InstagramProfileSignal> {
  const response = await fetch(input.profileUrl, {
    headers: {
      'user-agent': 'promobot/0.1',
    },
  });

  if (!response.ok) {
    throw new Error(`instagram profile fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const ogTitle = readMetaContent(html, 'og:title');
  const ogDescription = readMetaContent(html, 'og:description');
  const normalizedSummary = normalizeInstagramSummary(ogDescription);
  const resolvedProfileUrl = normalizeInstagramProfileUrl(response.url) ?? input.profileUrl;
  const requestedHandle = normalizeHandle(input.handle) ?? readHandleFromProfileUrl(input.profileUrl);
  const resolvedHandle = normalizeHandle(
    readHandleFromOgTitle(ogTitle) ?? readHandleFromProfileUrl(resolvedProfileUrl),
  );
  if (requestedHandle && resolvedHandle && requestedHandle !== resolvedHandle) {
    throw new Error(
      `instagram profile response resolved to ${resolvedHandle} instead of ${requestedHandle}`,
    );
  }

  const handle = resolvedHandle ?? requestedHandle;
  if (!looksLikePublicInstagramProfilePage(html, ogTitle, normalizedSummary, handle)) {
    throw new Error('instagram profile response did not look like a public profile page');
  }

  const title = handle ? `Instagram profile update: ${handle}` : 'Instagram profile update';
  const summary = normalizedSummary ??
    ogDescription ??
    readMetaContent(html, 'description') ??
    ogTitle ??
    input.profileUrl;

  return {
    source: 'instagram',
    title,
    detail: `${summary}\n\n${resolvedProfileUrl}`,
    profileUrl: resolvedProfileUrl,
  };
}

function readMetaContent(html: string, key: string) {
  const escapedKey = escapeRegExp(key);
  const propertyFirstMatch = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    ),
  );
  if (propertyFirstMatch?.[1]) {
    return normalizeText(propertyFirstMatch[1]);
  }

  const contentFirstMatch = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`,
      'i',
    ),
  );
  return contentFirstMatch?.[1] ? normalizeText(contentFirstMatch[1]) : null;
}

function readHandleFromProfileUrl(profileUrl: string) {
  try {
    const url = new URL(profileUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    if (url.hostname.toLowerCase() !== 'www.instagram.com' && url.hostname.toLowerCase() !== 'instagram.com') {
      return null;
    }
    if (segments.length !== 1) {
      return null;
    }

    const [segment] = segments;
    const handle = normalizeHandle(segment);
    if (!handle || INSTAGRAM_RESERVED_PROFILE_SEGMENTS.has(handle.slice(1))) {
      return null;
    }

    return handle;
  } catch {
    return null;
  }
}

function readHandleFromOgTitle(title: string | null) {
  if (!title) {
    return null;
  }

  const directMatch = title.match(/\(@([^)\s]+)\)/);
  if (directMatch?.[1]) {
    return normalizeHandle(`@${directMatch[1]}`);
  }

  const fallbackMatch = title.match(/@([A-Za-z0-9._]+)/);
  return fallbackMatch?.[0] ? normalizeHandle(fallbackMatch[0]) : null;
}

function normalizeHandle(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/^@+/, '').replace(/\/+$/, '').toLowerCase();
  return trimmed.length > 0 ? `@${trimmed}` : null;
}

function normalizeInstagramProfileUrl(profileUrl: string | null | undefined) {
  const handle = readHandleFromProfileUrl(profileUrl ?? '');
  return handle ? `https://www.instagram.com/${handle.slice(1)}/` : null;
}

function normalizeText(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function looksLikePublicInstagramProfilePage(
  html: string,
  ogTitle: string | null,
  normalizedSummary: string | null,
  expectedHandle: string | null,
) {
  if (containsBlockedInstagramPageMarkers(html, expectedHandle)) {
    return false;
  }

  if (normalizedSummary) {
    return true;
  }

  if (!ogTitle || !/instagram/i.test(ogTitle)) {
    return false;
  }

  const titleHandle = readHandleFromOgTitle(ogTitle);
  if (expectedHandle && titleHandle && titleHandle !== expectedHandle) {
    return false;
  }

  return titleHandle !== null && /instagram photos and videos/i.test(ogTitle);
}

function containsBlockedInstagramPageMarkers(html: string, expectedHandle: string | null) {
  const normalizedHtml = normalizeText(html).toLowerCase();
  const blockedMarkers = [
    'login • instagram',
    'sign in to see photos and videos from friends',
    'create an account or log in to instagram',
    'please wait a few minutes before you try again',
    'use the instagram app to get back into your account',
    'we suspect automated behavior',
  ];

  if (blockedMarkers.some((marker) => normalizedHtml.includes(marker))) {
    return true;
  }

  if (normalizedHtml.includes('checkpoint') || normalizedHtml.includes('challenge_required')) {
    return true;
  }

  if (!expectedHandle) {
    return false;
  }

  return (
    normalizedHtml.includes(`continue as ${expectedHandle.toLowerCase()}`) ||
    normalizedHtml.includes(`log in as ${expectedHandle.toLowerCase()}`)
  );
}

function normalizeInstagramSummary(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(
    /^([^,]+)\s+Followers,\s*([^,]+)\s+Following,\s*([^-\n]+)\s+Posts\b/i,
  );
  if (!match) {
    return null;
  }

  const followers = normalizeCount(match[1]);
  const following = normalizeCount(match[2]);
  const posts = normalizeCount(match[3]);
  if (!followers || !following || !posts) {
    return null;
  }

  return `${followers} followers · ${following} following · ${posts} posts`;
}

function normalizeCount(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INSTAGRAM_RESERVED_PROFILE_SEGMENTS = new Set([
  'accounts',
  'api',
  'challenge',
  'checkpoint',
  'developer',
  'direct',
  'explore',
  'legal',
  'press',
  'reel',
  'reels',
  'shop',
  'stories',
  'tv',
  'web',
]);
