export interface SourceConfigValidationInput {
  sourceType: string;
  platform: string;
  label: string;
  configJson: Record<string, unknown>;
  pollIntervalMinutes: number;
  allowUnsupportedSourceType?: boolean;
}

const SOURCE_TYPE_PLATFORM_RULES: Record<string, readonly string[]> = {
  rss: ['rss'],
  keyword: ['reddit', 'x'],
  'keyword+reddit': ['reddit'],
  'keyword+x': ['x'],
  v2ex_search: ['v2ex'],
  profile: ['instagram', 'tiktok'],
  'profile+instagram': ['instagram'],
  'profile+tiktok': ['tiktok'],
};
const SUPPORTED_SOURCE_TYPES = new Set(Object.keys(SOURCE_TYPE_PLATFORM_RULES));

const QUERY_SOURCE_TYPES = new Set(['keyword', 'keyword+reddit', 'keyword+x', 'v2ex_search']);
const PROFILE_SOURCE_TYPES = new Set(['profile', 'profile+instagram', 'profile+tiktok']);
const INSTAGRAM_PROFILE_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const TIKTOK_PROFILE_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const CANONICAL_PROFILE_HANDLE_PATTERN = /^[a-z0-9._]+$/;
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

export function parseSourceConfigJsonText(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateSourceConfigInput(input: SourceConfigValidationInput): string | null {
  const sourceType = input.sourceType.trim();
  const platform = input.platform.trim();
  const label = input.label.trim();

  if (sourceType.length === 0) {
    return 'Source Type 不能为空';
  }

  if (platform.length === 0) {
    return 'Platform 不能为空';
  }

  if (label.length === 0) {
    return 'Label 不能为空';
  }

  if (!input.allowUnsupportedSourceType && !SUPPORTED_SOURCE_TYPES.has(sourceType)) {
    return `Unsupported Source Type ${sourceType}`;
  }

  if (!Number.isInteger(input.pollIntervalMinutes) || input.pollIntervalMinutes <= 0) {
    return 'Poll interval 必须是正整数';
  }

  const allowedPlatforms = SOURCE_TYPE_PLATFORM_RULES[sourceType];
  if (allowedPlatforms && !allowedPlatforms.includes(platform)) {
    return `Source Type ${sourceType} 只能搭配 platform ${formatPlatformList(allowedPlatforms)}`;
  }

  if (sourceType === 'rss' && !readConfigString(input.configJson, 'feedUrl', 'url')) {
    return 'RSS source config 需要 feedUrl 或 url';
  }

  if (QUERY_SOURCE_TYPES.has(sourceType) && !hasQueryConfig(input.configJson)) {
    return 'Keyword source config 需要 query 或 keywords';
  }

  if (PROFILE_SOURCE_TYPES.has(sourceType)) {
    if (!readConfigString(input.configJson, 'handle', 'username', 'profileUrl', 'url')) {
      return 'Profile source config 需要 handle、username、profileUrl 或 url';
    }

    const profileValidationError = validateProfileSourceConfig(platform, input.configJson);
    if (profileValidationError) {
      return profileValidationError;
    }
  }

  return null;
}

export function isSupportedSourceType(sourceType: string) {
  return SUPPORTED_SOURCE_TYPES.has(sourceType.trim());
}

function hasQueryConfig(configJson: Record<string, unknown>) {
  if (readConfigString(configJson, 'query')) {
    return true;
  }

  const keywords = configJson.keywords;
  return Array.isArray(keywords) && keywords.some((value) => readString(value));
}

function readConfigString(configJson: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = readString(configJson[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function validateProfileSourceConfig(platform: string, configJson: Record<string, unknown>) {
  const rawHandle = readConfigString(configJson, 'handle', 'username');
  const rawProfileUrl = readConfigString(configJson, 'profileUrl', 'url');

  if (platform === 'instagram') {
    const normalizedHandle = normalizeInstagramProfileHandle(rawHandle);
    const handleFromUrl = rawProfileUrl ? readInstagramHandleFromProfileUrl(rawProfileUrl) : null;
    const handle = handleFromUrl ?? normalizedHandle;
    if (!handle) {
      return 'Instagram profile source config 需要有效的 handle、username、profileUrl 或 url';
    }
  }

  if (platform === 'tiktok') {
    const normalizedHandle = normalizeTiktokProfileHandle(rawHandle);
    const handleFromUrl = rawProfileUrl ? readTiktokHandleFromProfileUrl(rawProfileUrl) : null;
    const handle = handleFromUrl ?? normalizedHandle;
    if (!handle) {
      return 'TikTok profile source config 需要有效的 handle、username、profileUrl 或 url';
    }
  }

  return null;
}

function formatPlatformList(platforms: readonly string[]) {
  return platforms.length === 1 ? platforms[0] : platforms.join(' 或 ');
}

function normalizeRawProfileHandle(value: string | null) {
  const normalized = value?.replace(/^@+/, '').replace(/\/+$/, '').trim().toLowerCase();
  return normalized || null;
}

function normalizeInstagramProfileHandle(value: string | null) {
  const normalized = normalizeRawProfileHandle(value);
  if (!normalized || isReservedInstagramProfileHandle(normalized)) {
    return null;
  }

  if (!CANONICAL_PROFILE_HANDLE_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeTiktokProfileHandle(value: string | null) {
  const normalized = normalizeRawProfileHandle(value);
  if (!normalized || !CANONICAL_PROFILE_HANDLE_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function readInstagramHandleFromProfileUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!INSTAGRAM_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) {
      return null;
    }

    const handle = normalizeInstagramProfileHandle(segments[0]);
    if (!handle || isReservedInstagramProfileHandle(handle)) {
      return null;
    }

    return handle;
  } catch {
    return null;
  }
}

function isReservedInstagramProfileHandle(handle: string) {
  return INSTAGRAM_RESERVED_PROFILE_SEGMENTS.has(handle.toLowerCase());
}

function readTiktokHandleFromProfileUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!TIKTOK_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1 || !segments[0]?.startsWith('@')) {
      return null;
    }

    return normalizeTiktokProfileHandle(segments[0]);
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
