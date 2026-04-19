import { Router } from 'express';

export const reputationRouter = Router();

reputationRouter.get('/stats', (_request, response) => {
  response.json({
    total: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
    trend: [],
  });
});
