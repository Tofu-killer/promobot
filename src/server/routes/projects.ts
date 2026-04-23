import { Router } from 'express';
import { createProjectStore } from '../store/projects.js';
import { createSourceConfigStore } from '../store/sourceConfigs.js';

const projectStore = createProjectStore();
const sourceConfigStore = createSourceConfigStore();

export const projectsRouter = Router();

projectsRouter.get('/', (_request, response) => {
  response.json({ projects: projectStore.list() });
});

projectsRouter.get('/:id/source-configs', (request, response) => {
  const projectId = parseRouteId(request.params.id);
  if (!projectId) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  if (!projectExists(projectId)) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  response.json({
    sourceConfigs: sourceConfigStore.listByProject(projectId),
  });
});

projectsRouter.post('/', (request, response) => {
  const {
    name,
    siteName,
    siteUrl,
    siteDescription,
    sellingPoints,
    brandVoice,
    ctas,
  } = request.body ?? {};

  if (
    typeof name !== 'string' ||
    typeof siteName !== 'string' ||
    typeof siteUrl !== 'string' ||
    typeof siteDescription !== 'string' ||
    !Array.isArray(sellingPoints) ||
    (brandVoice !== undefined && typeof brandVoice !== 'string') ||
    (ctas !== undefined && !Array.isArray(ctas))
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
    brandVoice: typeof brandVoice === 'string' ? brandVoice : '',
    ctas: Array.isArray(ctas) ? ctas.filter((value: unknown): value is string => typeof value === 'string') : [],
  });

  response.status(201).json({
    project,
  });
});

projectsRouter.post('/:id/source-configs', (request, response) => {
  const projectId = parseRouteId(request.params.id);
  if (!projectId) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  if (!projectExists(projectId)) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  const input = parseCreateSourceConfigInput(request.body, projectId);
  if (!input) {
    response.status(400).json({ error: 'invalid source config payload' });
    return;
  }

  const sourceConfig = sourceConfigStore.create(input);

  response.status(201).json({
    sourceConfig,
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
    brandVoice: typeof input.brandVoice === 'string' ? input.brandVoice : undefined,
    ctas: Array.isArray(input.ctas)
      ? input.ctas.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
    archived: typeof input.archived === 'boolean' ? input.archived : undefined,
  });

  if (!project) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  response.json({ project });
});

projectsRouter.post('/:id/archive', (request, response) => {
  const projectId = parseRouteId(request.params.id);
  if (!projectId) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const project = projectStore.archive(projectId);
  if (!project) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  response.json({ project });
});

projectsRouter.patch('/:id/source-configs/:sourceConfigId', (request, response) => {
  const projectId = parseRouteId(request.params.id);
  if (!projectId) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const sourceConfigId = parseRouteId(request.params.sourceConfigId);
  if (!sourceConfigId) {
    response.status(400).json({ error: 'invalid source config id' });
    return;
  }

  if (!projectExists(projectId)) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  const input = parseUpdateSourceConfigInput(request.body, projectId);
  if (!input) {
    response.status(400).json({ error: 'invalid source config payload' });
    return;
  }

  const sourceConfig = sourceConfigStore.update(projectId, sourceConfigId, input);

  if (!sourceConfig) {
    response.status(404).json({ error: 'source config not found' });
    return;
  }

  response.json({ sourceConfig });
});

function parseRouteId(value: string | undefined) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function projectExists(projectId: number) {
  return projectStore.list().some((project) => project.id === projectId);
}

function parseCreateSourceConfigInput(body: unknown, projectId: number) {
  const input = asObject(body);
  if (!input) {
    return undefined;
  }

  if (
    !isPositiveInteger(input.projectId) ||
    input.projectId !== projectId ||
    typeof input.sourceType !== 'string' ||
    typeof input.platform !== 'string' ||
    typeof input.label !== 'string' ||
    !isPlainObject(input.configJson) ||
    typeof input.enabled !== 'boolean' ||
    !isPositiveInteger(input.pollIntervalMinutes)
  ) {
    return undefined;
  }

  return {
    projectId,
    sourceType: input.sourceType,
    platform: input.platform,
    label: input.label,
    configJson: input.configJson,
    enabled: input.enabled,
    pollIntervalMinutes: input.pollIntervalMinutes,
  };
}

function parseUpdateSourceConfigInput(body: unknown, projectId: number) {
  const input = asObject(body);
  if (!input) {
    return undefined;
  }

  if (input.projectId !== undefined && (!isPositiveInteger(input.projectId) || input.projectId !== projectId)) {
    return undefined;
  }

  if (input.sourceType !== undefined && typeof input.sourceType !== 'string') {
    return undefined;
  }

  if (input.platform !== undefined && typeof input.platform !== 'string') {
    return undefined;
  }

  if (input.label !== undefined && typeof input.label !== 'string') {
    return undefined;
  }

  if (input.configJson !== undefined && !isPlainObject(input.configJson)) {
    return undefined;
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    return undefined;
  }

  if (input.pollIntervalMinutes !== undefined && !isPositiveInteger(input.pollIntervalMinutes)) {
    return undefined;
  }

  return {
    sourceType: typeof input.sourceType === 'string' ? input.sourceType : undefined,
    platform: typeof input.platform === 'string' ? input.platform : undefined,
    label: typeof input.label === 'string' ? input.label : undefined,
    configJson: isPlainObject(input.configJson) ? input.configJson : undefined,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
    pollIntervalMinutes: isPositiveInteger(input.pollIntervalMinutes)
      ? input.pollIntervalMinutes
      : undefined,
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
