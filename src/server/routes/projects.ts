import { Router } from 'express';
import { createProjectStore } from '../store/projects.js';
import {
  createSourceConfigStore,
  type CreateSourceConfigInput,
  type SourceConfigRecord,
  type UpdateSourceConfigInput,
} from '../store/sourceConfigs.js';
import { isSupportedSourceType, validateSourceConfigInput } from '../lib/sourceConfigValidation.js';

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
    !sellingPoints.every((value: unknown) => typeof value === 'string') ||
    (brandVoice !== undefined && typeof brandVoice !== 'string') ||
    (ctas !== undefined &&
      (!Array.isArray(ctas) || !ctas.every((value: unknown) => typeof value === 'string')))
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
  if (!input.ok) {
    response.status(400).json({ error: input.error });
    return;
  }

  const sourceConfig = sourceConfigStore.create(input.value);

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

  if (!projectExists(id)) {
    response.status(404).json({ error: 'project not found' });
    return;
  }

  const input = request.body;
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    response.status(400).json({ error: 'invalid project payload' });
    return;
  }

  const body = (input ?? {}) as Record<string, unknown>;
  if (
    body.sellingPoints !== undefined &&
    (!Array.isArray(body.sellingPoints) ||
      !body.sellingPoints.every((value: unknown) => typeof value === 'string'))
  ) {
    response.status(400).json({ error: 'invalid project payload' });
    return;
  }

  if (
    body.ctas !== undefined &&
    (!Array.isArray(body.ctas) || !body.ctas.every((value: unknown) => typeof value === 'string'))
  ) {
    response.status(400).json({ error: 'invalid project payload' });
    return;
  }

  if (
    hasInvalidOptionalStringField(body, 'name') ||
    hasInvalidOptionalStringField(body, 'siteName') ||
    hasInvalidOptionalStringField(body, 'siteUrl') ||
    hasInvalidOptionalStringField(body, 'siteDescription') ||
    hasInvalidOptionalStringField(body, 'brandVoice')
  ) {
    response.status(400).json({ error: 'invalid project payload' });
    return;
  }

  if (input !== null && typeof input === 'object' && 'archived' in input) {
    response.status(400).json({ error: 'project archive must use POST /api/projects/:id/archive' });
    return;
  }

  const project = projectStore.update(id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    siteName: typeof body.siteName === 'string' ? body.siteName : undefined,
    siteUrl: typeof body.siteUrl === 'string' ? body.siteUrl : undefined,
    siteDescription: typeof body.siteDescription === 'string' ? body.siteDescription : undefined,
    sellingPoints: Array.isArray(body.sellingPoints)
      ? body.sellingPoints.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
    brandVoice: typeof body.brandVoice === 'string' ? body.brandVoice : undefined,
    ctas: Array.isArray(body.ctas)
      ? body.ctas.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
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

  const existingSourceConfig = sourceConfigStore
    .listByProject(projectId)
    .find((item) => item.id === sourceConfigId);
  if (!existingSourceConfig) {
    response.status(404).json({ error: 'source config not found' });
    return;
  }

  const input = parseUpdateSourceConfigInput(request.body, projectId, existingSourceConfig);
  if (!input.ok) {
    response.status(400).json({ error: input.error });
    return;
  }

  const sourceConfig = sourceConfigStore.update(projectId, sourceConfigId, input.value);

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

function hasInvalidOptionalStringField(
  body: Record<string, unknown>,
  field: 'name' | 'siteName' | 'siteUrl' | 'siteDescription' | 'brandVoice',
) {
  return body[field] !== undefined && typeof body[field] !== 'string';
}

type SourceConfigParseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: string;
    };

function parseCreateSourceConfigInput(
  body: unknown,
  projectId: number,
): SourceConfigParseResult<CreateSourceConfigInput> {
  const input = asObject(body);
  if (!input) {
    return invalidSourceConfigPayload();
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
    return invalidSourceConfigPayload();
  }

  const value: CreateSourceConfigInput = {
    projectId,
    sourceType: input.sourceType.trim(),
    platform: input.platform.trim(),
    label: input.label.trim(),
    configJson: input.configJson,
    enabled: input.enabled,
    pollIntervalMinutes: input.pollIntervalMinutes,
  };

  const validationError = validateSourceConfigInput(value);
  if (validationError) {
    return {
      ok: false,
      error: validationError,
    };
  }

  return {
    ok: true,
    value,
  };
}

function parseUpdateSourceConfigInput(
  body: unknown,
  projectId: number,
  existingSourceConfig: SourceConfigRecord,
): SourceConfigParseResult<UpdateSourceConfigInput> {
  const input = asObject(body);
  if (!input) {
    return invalidSourceConfigPayload();
  }

  if (input.projectId !== undefined && (!isPositiveInteger(input.projectId) || input.projectId !== projectId)) {
    return invalidSourceConfigPayload();
  }

  if (input.sourceType !== undefined && typeof input.sourceType !== 'string') {
    return invalidSourceConfigPayload();
  }

  if (input.platform !== undefined && typeof input.platform !== 'string') {
    return invalidSourceConfigPayload();
  }

  if (input.label !== undefined && typeof input.label !== 'string') {
    return invalidSourceConfigPayload();
  }

  if (input.configJson !== undefined && !isPlainObject(input.configJson)) {
    return invalidSourceConfigPayload();
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    return invalidSourceConfigPayload();
  }

  if (input.pollIntervalMinutes !== undefined && !isPositiveInteger(input.pollIntervalMinutes)) {
    return invalidSourceConfigPayload();
  }

  const value: UpdateSourceConfigInput = {
    sourceType: typeof input.sourceType === 'string' ? input.sourceType.trim() : undefined,
    platform: typeof input.platform === 'string' ? input.platform.trim() : undefined,
    label: typeof input.label === 'string' ? input.label.trim() : undefined,
    configJson: isPlainObject(input.configJson) ? input.configJson : undefined,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
    pollIntervalMinutes: isPositiveInteger(input.pollIntervalMinutes)
      ? input.pollIntervalMinutes
      : undefined,
  };

  const mergedSourceType = value.sourceType ?? existingSourceConfig.sourceType;
  const mergedPlatform = value.platform ?? existingSourceConfig.platform;
  const mergedConfigJson = value.configJson ?? existingSourceConfig.configJson;
  const allowUnsupportedSourceType =
    !isSupportedSourceType(mergedSourceType) &&
    mergedSourceType === existingSourceConfig.sourceType &&
    mergedPlatform === existingSourceConfig.platform &&
    areComparableJsonObjectsEqual(mergedConfigJson, existingSourceConfig.configJson);
  const validationError = validateSourceConfigInput({
    sourceType: mergedSourceType,
    platform: mergedPlatform,
    label: value.label ?? existingSourceConfig.label,
    configJson: mergedConfigJson,
    pollIntervalMinutes: value.pollIntervalMinutes ?? existingSourceConfig.pollIntervalMinutes,
    allowUnsupportedSourceType,
  });
  if (validationError) {
    return {
      ok: false,
      error: validationError,
    };
  }

  return {
    ok: true,
    value,
  };
}

function invalidSourceConfigPayload(): SourceConfigParseResult<never> {
  return {
    ok: false,
    error: 'invalid source config payload',
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

function areComparableJsonObjectsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return serializeComparableValue(left) === serializeComparableValue(right);
}

function serializeComparableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeComparableValue(item)).join(',')}]`;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, itemValue]) => `${JSON.stringify(key)}:${serializeComparableValue(itemValue)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}
