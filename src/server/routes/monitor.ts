import { Router } from 'express';
import { createMonitorStore } from '../store/monitor';

export const monitorRouter = Router();
const monitorStore = createMonitorStore();

monitorRouter.get('/feed', (_request, response) => {
  const items = monitorStore.list();
  response.json({
    items,
    total: items.length,
  });
});
