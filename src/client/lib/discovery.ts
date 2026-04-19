import { apiRequest } from './api';

type UnknownRecord = Record<string, unknown>;

export interface DiscoveryItem {
  id: string | number;
  title: string;
  summary: string;
  source: string;
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

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDiscoveryItem(value: unknown, index: number): DiscoveryItem {
  const record = asRecord(value);
  const id = record?.id;
  const numericId = asNumber(id);
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
    id: numericId ?? asString(id) ?? index + 1,
    title,
    summary,
    source,
    status,
    score,
    createdAt,
  };
}

function normalizeDiscoveryResponse(payload: unknown): DiscoveryResponse {
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
