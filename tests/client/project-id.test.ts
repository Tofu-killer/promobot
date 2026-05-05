import { describe, expect, it } from 'vitest';
import {
  createProjectIdBody,
  createProjectPayload,
  getProjectIdValidationError,
  parseOptionalProjectId,
  parseProjectIdDraft,
  parseProjectId,
  projectInputStyle,
  withProjectIdQuery,
} from '../../src/client/lib/projectId';

describe('project id helpers', () => {
  it('parses valid project ids and rejects invalid input', () => {
    expect(parseProjectId('')).toBeUndefined();
    expect(parseProjectId(' 12 ')).toBe(12);
    expect(parseProjectId('0')).toBeUndefined();
    expect(parseProjectId('abc')).toBeUndefined();
  });

  it('returns the shared validation error only for non-empty invalid input', () => {
    expect(getProjectIdValidationError('')).toBeNull();
    expect(getProjectIdValidationError('  ')).toBeNull();
    expect(getProjectIdValidationError(' 12 ')).toBeNull();
    expect(getProjectIdValidationError('0')).toBe('项目 ID 必须是大于 0 的整数');
  });

  it('supports create and edit semantics for optional project ids', () => {
    expect(parseOptionalProjectId('')).toBeUndefined();
    expect(parseOptionalProjectId(' 12 ')).toBe(12);
    expect(parseOptionalProjectId('0')).toBeUndefined();
    expect(parseOptionalProjectId('', null)).toBeNull();
    expect(parseOptionalProjectId(' 12 ', null)).toBe(12);
    expect(parseOptionalProjectId('0', null)).toBeNull();
  });

  it('parses shared projectId drafts for the app shell', () => {
    expect(parseProjectIdDraft('')).toBeNull();
    expect(parseProjectIdDraft(' 0012 ')).toBe(12);
    expect(parseProjectIdDraft('abc')).toBeNull();
  });

  it('builds project-scoped requests and payloads', () => {
    expect(withProjectIdQuery('/api/drafts')).toBe('/api/drafts');
    expect(withProjectIdQuery('/api/drafts', 12)).toBe('/api/drafts?projectId=12');
    expect(withProjectIdQuery('/api/system/browser-handoffs?limit=100', 12)).toBe(
      '/api/system/browser-handoffs?limit=100&projectId=12',
    );
    expect(createProjectIdBody()).toBeUndefined();
    expect(createProjectIdBody(12)).toBe('{"projectId":12}');
    expect(createProjectPayload()).toEqual({});
    expect(createProjectPayload(12)).toEqual({ projectId: 12 });
    expect(projectInputStyle).toMatchObject({
      width: '100%',
      maxWidth: '240px',
      borderRadius: '14px',
      border: '1px solid #cbd5e1',
      padding: '12px 14px',
      font: 'inherit',
      background: '#ffffff',
    });
  });
});
