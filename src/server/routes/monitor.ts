import { Router } from 'express';

export const monitorRouter = Router();

monitorRouter.get('/feed', (_request, response) => {
  response.json({
    items: [],
    total: 0,
  });
});
