export function parseProjectIdQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

export function parseOptionalProjectId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
