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

discoveryRouter.get('/', (_request, response) => {
  const items: DiscoveryItemRecord[] = [
    ...inboxStore.list().map((item) => ({
      id: `inbox-${item.id}`,
      source: item.source,
      type: 'inbox' as const,
      title: item.title,
      detail: item.excerpt,
      status: item.status,
      createdAt: item.createdAt,
    })),
    ...monitorStore.list().map((item) => ({
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
