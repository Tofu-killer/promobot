export interface SourceConfigValidationInput {
  sourceType: string;
  platform: string;
  label: string;
  configJson: Record<string, unknown>;
  pollIntervalMinutes: number;
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

const QUERY_SOURCE_TYPES = new Set(['keyword', 'keyword+reddit', 'keyword+x', 'v2ex_search']);
const PROFILE_SOURCE_TYPES = new Set(['profile', 'profile+instagram', 'profile+tiktok']);

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

  if (
    PROFILE_SOURCE_TYPES.has(sourceType) &&
    !readConfigString(input.configJson, 'handle', 'username', 'profileUrl', 'url')
  ) {
    return 'Profile source config 需要 handle、username、profileUrl 或 url';
  }

  return null;
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

function formatPlatformList(platforms: readonly string[]) {
  return platforms.length === 1 ? platforms[0] : platforms.join(' 或 ');
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
