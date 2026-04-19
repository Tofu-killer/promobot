import { Router } from 'express';

export const inboxRouter = Router();

inboxRouter.get('/', (_request, response) => {
  response.json({
    items: [],
    total: 0,
    unread: 0,
  });
});
