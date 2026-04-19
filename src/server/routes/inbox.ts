import { Router } from 'express';
import { createInboxStore } from '../store/inbox';

export const inboxRouter = Router();
const inboxStore = createInboxStore();

inboxRouter.get('/', (_request, response) => {
  const items = inboxStore.list();
  response.json({
    items,
    total: items.length,
    unread: items.filter((item) => item.status !== 'handled').length,
  });
});
