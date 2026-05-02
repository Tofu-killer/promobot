import { apiRequest } from './api';

type UnknownRecord = Record<string, unknown>;

export interface DiscoveryItem {
  id: string | number;
  title: string;
  summary: string;
  source: string;
  type: 'monitor' | 'inbox';
  status: string;
  score: number | null;
  createdAt: string | null;
}

export interface DiscoveryStats {
  sources: number;
  averageScore: number | null;
}

export interface DiscoveryResponse {
  items: DiscoveryItem[];
  total: number;
  stats: DiscoveryStats;
}

type DiscoveryItemLike = {
  id: string | number;
  type?: DiscoveryItem['type'] | null;
};

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  const normalized = asString(value);
  if (!normalized || !/^\d+$/.test(normalized)) {
    return null;
  }

  const numericValue = Number(normalized);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function asDiscoveryItemType(value: unknown): DiscoveryItem['type'] | null {
  return value === 'monitor' || value === 'inbox' ? value : null;
}

function parseDiscoveryItemId(value: unknown) {
  const normalized = asString(value);
  const match = normalized?.match(/^(monitor|inbox)-(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    type: match[1] as DiscoveryItem['type'],
    numericId: Number(match[2]),
  };
}

function coerceDiscoveryItemId(id: unknown, type: DiscoveryItem['type']): string | null {
  const parsedId = parseDiscoveryItemId(id);
  if (parsedId) {
    return `${parsedId.type}-${parsedId.numericId}`;
  }

  const numericId = asPositiveInteger(id);
  return numericId === null ? null : `${type}-${numericId}`;
}

export function resolveDiscoveryItemType(item: DiscoveryItemLike): DiscoveryItem['type'] {
  return parseDiscoveryItemId(item.id)?.type ?? asDiscoveryItemType(item.type) ?? 'monitor';
}

export function normalizeDiscoveryItemId(
  id: unknown,
  type: DiscoveryItem['type'],
  fallbackIndex: number,
): string {
  return coerceDiscoveryItemId(id, type) ?? asString(id) ?? `${type}-${fallbackIndex + 1}`;
}

export function resolveDiscoveryMonitorActionId(item: DiscoveryItemLike): string | null {
  const type = resolveDiscoveryItemType(item);
  if (type !== 'monitor') {
    return null;
  }

  return coerceDiscoveryItemId(item.id, type);
}

function normalizeDiscoveryItem(value: unknown, index: number): DiscoveryItem {
  const record = asRecord(value);
  const id = record?.id;
  const normalizedType = resolveDiscoveryItemType({
    id: asPositiveInteger(id) ?? asString(id) ?? index + 1,
    type: asDiscoveryItemType(record?.type),
  });
  const normalizedId = normalizeDiscoveryItemId(id, normalizedType, index);
  const title =
    asString(record?.title) ??
    asString(record?.headline) ??
    asString(record?.topic) ??
    asString(record?.name) ??
    `发现条目 #${index + 1}`;
  const summary =
    asString(record?.summary) ??
    asString(record?.detail) ??
    asString(record?.description) ??
    asString(record?.excerpt) ??
    '暂无摘要';
  const source =
    asString(record?.source) ??
    asString(record?.sourceName) ??
    asString(record?.channel) ??
    asString(record?.origin) ??
    'Unknown source';
  const status = asString(record?.status) ?? asString(record?.stage) ?? 'unclassified';
  const score = asNumber(record?.score) ?? asNumber(record?.priority) ?? asNumber(record?.relevance);
  const createdAt =
    asString(record?.createdAt) ??
    asString(record?.discoveredAt) ??
    asString(record?.publishedAt) ??
    null;

  return {
    id: normalizedId,
    title,
    summary,
    source,
    type: normalizedType,
    status,
    score,
    createdAt,
  };
}

export function normalizeDiscoveryResponse(payload: unknown): DiscoveryResponse {
  const record = asRecord(payload);
  const statsRecord = asRecord(record?.stats) ?? asRecord(record?.summary);
  const itemsValue = Array.isArray(record?.items)
    ? record.items
    : Array.isArray(record?.entries)
      ? record.entries
      : [];
  const items = itemsValue.map((item, index) => normalizeDiscoveryItem(item, index));
  const total = asNumber(record?.total) ?? items.length;
  const sources = asNumber(statsRecord?.sources) ?? new Set(items.map((item) => item.source)).size;
  const averageScore =
    asNumber(statsRecord?.averageScore) ??
    (items.filter((item) => item.score !== null).length > 0
      ? Math.round(
          items
            .filter((item): item is DiscoveryItem & { score: number } => item.score !== null)
            .reduce((sum, item) => sum + item.score, 0) /
            items.filter((item) => item.score !== null).length,
        )
      : null);

  return {
    items,
    total,
    stats: {
      sources,
      averageScore,
    },
  };
}

export async function loadDiscoveryRequest(): Promise<DiscoveryResponse> {
  const payload = await apiRequest<unknown>('/api/discovery');
  return normalizeDiscoveryResponse(payload);
}
