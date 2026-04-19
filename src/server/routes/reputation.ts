import { Router } from 'express';
import { createReputationStore } from '../store/reputation';

export const reputationRouter = Router();
const reputationStore = createReputationStore();

reputationRouter.get('/stats', (_request, response) => {
  response.json(reputationStore.getStats());
});
