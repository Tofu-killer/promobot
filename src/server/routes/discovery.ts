import { Router } from 'express';
import { createInboxStore } from '../store/inbox.js';
import { createMonitorStore } from '../store/monitor.js';

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

discoveryRouter.patch('/:id', (request, response) => {
  const parsedId = parseDiscoveryItemId(request.params.id);
  const action = parseDiscoveryAction(request.body?.action);
  const projectId = parseOptionalProjectId(request.body?.projectId);

  if (!parsedId || !action) {
    response.status(400).json({ error: 'invalid discovery action' });
    return;
  }

  if (request.body?.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  if (parsedId.kind === 'monitor') {
    const currentItem = monitorStore.getById(parsedId.id);
    if (!currentItem || (projectId !== undefined && currentItem.projectId !== projectId)) {
      response.status(404).json({ error: 'discovery item not found' });
      return;
    }

    const updatedItem = monitorStore.updateStatus(
      parsedId.id,
      action === 'save' ? 'saved' : 'ignored',
    );

    if (!updatedItem) {
      response.status(404).json({ error: 'discovery item not found' });
      return;
    }

    response.json({
      item: {
        id: `monitor-${updatedItem.id}`,
        source: updatedItem.source,
        type: 'monitor',
        title: updatedItem.title,
        detail: updatedItem.detail,
        status: updatedItem.status,
        createdAt: updatedItem.createdAt,
      } satisfies DiscoveryItemRecord,
    });
    return;
  }

  const currentItem = inboxStore.list().find((item) => item.id === parsedId.id);
  if (!currentItem || (projectId !== undefined && currentItem.projectId !== projectId)) {
    response.status(404).json({ error: 'discovery item not found' });
    return;
  }

  const updatedItem = inboxStore.updateStatus(
    parsedId.id,
    action === 'save' ? 'needs_review' : 'ignored',
  );

  if (!updatedItem) {
    response.status(404).json({ error: 'discovery item not found' });
    return;
  }

  response.json({
    item: {
      id: `inbox-${updatedItem.id}`,
      source: updatedItem.source,
      type: 'inbox',
      title: updatedItem.title,
      detail: updatedItem.excerpt,
      status: updatedItem.status,
      createdAt: updatedItem.createdAt,
    } satisfies DiscoveryItemRecord,
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

function parseDiscoveryItemId(value: string) {
  const match = value.match(/^(inbox|monitor)-(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    kind: match[1] as 'inbox' | 'monitor',
    id: Number(match[2]),
  };
}

function parseDiscoveryAction(value: unknown) {
  return value === 'save' || value === 'ignore' ? value : null;
}

function parseOptionalProjectId(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
