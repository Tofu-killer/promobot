import { Router } from 'express';
import { createInboxStore } from '../store/inbox.js';
import { chatJson } from '../services/aiClient.js';
import { createInboxFetchService } from '../services/inboxFetch.js';

export const inboxRouter = Router();
const inboxStore = createInboxStore();
const inboxFetchService = createInboxFetchService();

const allowedStatuses = new Set(['handled', 'snoozed', 'needs_reply', 'needs_review']);

function isAllowedStatus(value: string): boolean {
  return allowedStatuses.has(value);
}

inboxRouter.get('/', (request, response) => {
  const projectId = parseProjectIdQuery(request.query.projectId);

  if (request.query.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const items = inboxStore.list(projectId);
  response.json({
    items,
    total: items.length,
    unread: items.filter((item) => item.status !== 'handled').length,
  });
});

inboxRouter.post('/fetch', (request, response) => {
  const projectId = parseOptionalProjectId(request.body?.projectId);

  if (request.body?.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const result = inboxFetchService.fetchNow(projectId);
  const items = inboxStore.list(projectId);

  response.status(201).json({
    items: result.items,
    inserted: result.inserted,
    total: items.length,
    unread: items.filter((item) => item.status !== 'handled').length,
  });
});

inboxRouter.patch('/:id', (request, response) => {
  const id = Number(request.params.id);
  const status = request.body?.status;

  if (!Number.isInteger(id) || typeof status !== 'string' || !isAllowedStatus(status)) {
    response.status(400).json({ error: 'invalid inbox update' });
    return;
  }

  const item = inboxStore.updateStatus(id, status);
  if (!item) {
    response.status(404).json({ error: 'inbox item not found' });
    return;
  }

  response.json({ item });
});

inboxRouter.post('/:id/suggest-reply', async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({ error: 'invalid inbox item id' });
    return;
  }

  const items = inboxStore.list();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    response.status(404).json({ error: 'inbox item not found' });
    return;
  }

  const suggestion = await chatJson<{ reply: string }>(
    'You write short, helpful reply suggestions for inbox items.',
    [
      `Source: ${item.source}`,
      `Author: ${item.author ?? ''}`,
      `Title: ${item.title}`,
      `Excerpt: ${item.excerpt}`,
      'Return JSON with a reply field.',
    ].join('\n'),
  );

  response.json({ suggestion: { reply: suggestion.reply } });
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
