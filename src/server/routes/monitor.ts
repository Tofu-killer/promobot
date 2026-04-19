import { Router } from 'express';
import { createMonitorStore, type MonitorItemRecord } from '../store/monitor';
import { createSQLiteDraftStore } from '../store/drafts';
import { systemDashboardRouter } from './systemDashboard';

export const monitorRouter = Router();
const monitorStore = createMonitorStore();
const draftStore = createSQLiteDraftStore();

monitorRouter.use(systemDashboardRouter);

monitorRouter.get('/feed', (_request, response) => {
  const items = monitorStore.list();
  response.json({
    items,
    total: items.length,
  });
});

monitorRouter.post('/:id/generate-follow-up', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid monitor id' });
    return;
  }

  const item = monitorStore.getById(id);
  if (!item) {
    response.status(404).json({ error: 'monitor item not found' });
    return;
  }

  const draft = draftStore.create({
    platform: typeof request.body?.platform === 'string' && request.body.platform.trim()
      ? request.body.platform.trim()
      : item.source,
    title: `Follow-up: ${item.title}`,
    content: buildFollowUpContent(item),
    status: 'draft',
  });

  response.status(201).json({ draft });
});

function buildFollowUpContent(item: MonitorItemRecord) {
  return [
    `Follow-up draft for ${item.source}.`,
    `Signal: ${item.title}`,
    item.detail,
  ].join('\n\n');
}
