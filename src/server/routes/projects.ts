import { Router } from 'express';
import { createProjectStore } from '../store/projects';

const projectStore = createProjectStore();

export const projectsRouter = Router();

projectsRouter.get('/', (_request, response) => {
  response.json({ projects: projectStore.list() });
});

projectsRouter.post('/', (request, response) => {
  const {
    name,
    siteName,
    siteUrl,
    siteDescription,
    sellingPoints,
  } = request.body ?? {};

  if (
    typeof name !== 'string' ||
    typeof siteName !== 'string' ||
    typeof siteUrl !== 'string' ||
    typeof siteDescription !== 'string' ||
    !Array.isArray(sellingPoints)
  ) {
    response.status(400).json({ error: 'invalid project payload' });
    return;
  }

  const project = projectStore.create({
    name,
    siteName,
    siteUrl,
    siteDescription,
    sellingPoints: sellingPoints.filter((value: unknown): value is string => typeof value === 'string'),
  });

  response.status(201).json({
    project,
  });
});

projectsRouter.patch('/:id', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const input = request.body ?? {};
  const project = projectStore.update(id, {
    name: typeof input.name === 'string' ? input.name : undefined,
    siteName: typeof input.siteName === 'string' ? input.siteName : undefined,
    siteUrl: typeof input.siteUrl === 'string' ? input.siteUrl : undefined,
    siteDescription: typeof input.siteDescription === 'string' ? input.siteDescription : undefined,
    sellingPoints: Array.isArray(input.sellingPoints)
      ? input.sellingPoints.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
  });

  if (!project) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  response.json({ project });
});
