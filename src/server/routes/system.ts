import { Router } from 'express';

export const systemRouter = Router();

systemRouter.get('/health', (_request, response) => {
  response.json({ ok: true });
});
