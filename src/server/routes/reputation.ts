import { Router } from 'express';
import { createReputationFetchService } from '../services/reputationFetch.js';
import { selectInboxStatus } from '../services/inbox/fetchers/types.js';
import { createInboxStore } from '../store/inbox.js';
import { createReputationStore } from '../store/reputation.js';

export const reputationRouter = Router();
const inboxStore = createInboxStore();
const reputationStore = createReputationStore();
const reputationFetchService = createReputationFetchService();

reputationRouter.get('/feed', (request, response) => {
  const projectId = parseProjectIdQuery(request.query.projectId);

  if (request.query.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const stats = reputationStore.getStats(projectId);

  response.json({
    items: stats.items,
    total: stats.total,
  });
});

reputationRouter.get('/stats', (request, response) => {
  const projectId = parseProjectIdQuery(request.query.projectId);

  if (request.query.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  response.json(reputationStore.getStats(projectId));
});

reputationRouter.post('/fetch', async (request, response, next) => {
  if (request.body !== undefined && !isPlainObject(request.body)) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const projectId = parseOptionalProjectId(request.body?.projectId);

  if (request.body?.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  try {
    const result = await reputationFetchService.fetchNow(projectId);
    const stats = reputationStore.getStats(projectId);

    response.status(201).json({
      items: result.items,
      inserted: result.inserted,
      total: stats.total,
    });
  } catch (error) {
    next(error);
  }
});

reputationRouter.patch('/:id', (request, response) => {
  const id = Number(request.params.id);
  const status = request.body?.status;

  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid reputation id' });
    return;
  }

  if (typeof status !== 'string' || !status.trim()) {
    response.status(400).json({ error: 'invalid reputation status' });
    return;
  }

  const item = reputationStore.updateStatus(id, status);
  if (!item) {
    response.status(404).json({ error: 'reputation item not found' });
    return;
  }

  const inboxItem =
    status === 'escalate'
      ? inboxStore.create({
          projectId: item.projectId,
          source: item.source,
          status: selectInboxStatus(item.source),
          title: item.title,
          excerpt: item.detail,
        })
      : undefined;

  response.json({
    item,
    ...(inboxItem ? { inboxItem } : {}),
  });
});

function parseProjectIdQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function parseOptionalProjectId(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype;
}
