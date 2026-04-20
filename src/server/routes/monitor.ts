import { Router } from 'express';
import { createMonitorFetchService } from '../services/monitorFetch.js';
import { createMonitorStore, type MonitorItemRecord } from '../store/monitor.js';
import { createSQLiteDraftStore } from '../store/drafts.js';
import { systemDashboardRouter } from './systemDashboard.js';

export const monitorRouter = Router();
const monitorStore = createMonitorStore();
const draftStore = createSQLiteDraftStore();
const supportedFollowUpPlatforms = new Set(['x', 'reddit']);

monitorRouter.use(systemDashboardRouter);

monitorRouter.get('/feed', (request, response) => {
  const projectId = parseProjectIdQuery(request.query.projectId);

  if (request.query.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const items = monitorStore.list(projectId);
  response.json({
    items,
    total: items.length,
  });
});

monitorRouter.post('/fetch', async (request, response, next) => {
  const projectId = parseOptionalProjectId(request.body?.projectId);

  if (request.body?.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  try {
    const monitorFetchService = createMonitorFetchService();
    const result = await monitorFetchService.fetchNow(projectId);

    response.status(201).json({
      items: result.items,
      inserted: result.inserted,
      total: monitorStore.list(projectId).length,
    });
  } catch (error) {
    next(error);
  }
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

  const platform = resolveFollowUpPlatform(request.body?.platform, item.source);
  if (!platform) {
    response.status(400).json({ error: 'unsupported follow-up platform' });
    return;
  }

  const draft = draftStore.create({
    projectId: item.projectId,
    platform,
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

function parseProjectIdQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function parseOptionalProjectId(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function resolveFollowUpPlatform(requestedPlatform: unknown, source: string) {
  const candidate =
    typeof requestedPlatform === 'string' && requestedPlatform.trim()
      ? requestedPlatform.trim()
      : source.trim();

  return supportedFollowUpPlatforms.has(candidate) ? candidate : null;
}
