export function parseProjectId(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

export function getProjectIdValidationError(value: string) {
  return parseProjectId(value) === undefined && value.trim().length > 0
    ? '项目 ID 必须是大于 0 的整数'
    : null;
}

export function withProjectIdQuery(path: string, projectId?: number) {
  if (projectId === undefined) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}projectId=${projectId}`;
}

export function createProjectIdBody(projectId?: number) {
  return projectId === undefined ? undefined : JSON.stringify({ projectId });
}

export function createProjectPayload(projectId?: number): Record<string, never> | { projectId: number } {
  return projectId === undefined ? {} : { projectId };
}

export const projectInputStyle = {
  width: '100%',
  maxWidth: '240px',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export const queueInputStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;
