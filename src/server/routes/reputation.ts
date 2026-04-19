import { Router } from 'express';
import { createReputationStore } from '../store/reputation';

export const reputationRouter = Router();
const reputationStore = createReputationStore();

reputationRouter.get('/stats', (_request, response) => {
  response.json(reputationStore.getStats());
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

  response.json({ item });
});
