import { Router } from 'express';
import { createInboxStore } from '../store/inbox';
import { chatJson } from '../services/aiClient';
import { createInboxFetchService } from '../services/inboxFetch';

export const inboxRouter = Router();
const inboxStore = createInboxStore();
const inboxFetchService = createInboxFetchService();

const allowedStatuses = new Set(['handled', 'snoozed', 'needs_reply', 'needs_review']);

function isAllowedStatus(value: string): boolean {
  return allowedStatuses.has(value);
}

inboxRouter.get('/', (_request, response) => {
  const items = inboxStore.list();
  response.json({
    items,
    total: items.length,
    unread: items.filter((item) => item.status !== 'handled').length,
  });
});

inboxRouter.post('/fetch', (_request, response) => {
  const result = inboxFetchService.fetchNow();
  const items = inboxStore.list();

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
