import { Router } from 'express';
import { createInboxStore } from '../store/inbox';
import { createMonitorStore } from '../store/monitor';

export interface DiscoveryItemRecord {
  id: string;
  source: string;
  type: 'inbox' | 'monitor';
  title: string;
  detail: string;
  status: string;
  createdAt: string;
}

export const discoveryRouter = Router();
const inboxStore = createInboxStore();
const monitorStore = createMonitorStore();

discoveryRouter.get('/', (request, response) => {
  const projectId = parseProjectIdQuery(request.query.projectId);

  if (request.query.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const inboxItems = filterProjectAwareRecords(inboxStore.list(), projectId);
  const monitorItems = filterProjectAwareRecords(monitorStore.list(), projectId);
  const items: DiscoveryItemRecord[] = [
    ...inboxItems.map((item) => ({
      id: `inbox-${item.id}`,
      source: item.source,
      type: 'inbox' as const,
      title: item.title,
      detail: item.excerpt,
      status: item.status,
      createdAt: item.createdAt,
    })),
    ...monitorItems.map((item) => ({
      id: `monitor-${item.id}`,
      source: item.source,
      type: 'monitor' as const,
      title: item.title,
      detail: item.detail,
      status: item.status,
      createdAt: item.createdAt,
    })),
  ];

  response.json({
    items,
    total: items.length,
  });
});

function parseProjectIdQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function filterProjectAwareRecords<T extends { projectId?: number | null }>(
  records: T[],
  projectId?: number,
) {
  if (projectId === undefined) {
    return records;
  }

  return records.filter((record) => record.projectId === projectId);
}
