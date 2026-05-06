import { describe, expect, it } from 'vitest';
import { parseOptionalProjectId, parseProjectIdQuery } from '../../src/server/lib/projectId';

describe('server projectId helpers', () => {
  it('parses positive integer project ids from query strings only', () => {
    expect(parseProjectIdQuery('7')).toBe(7);
    expect(parseProjectIdQuery(' 12 ')).toBe(12);
    expect(parseProjectIdQuery('01')).toBe(1);

    expect(parseProjectIdQuery(undefined)).toBeUndefined();
    expect(parseProjectIdQuery(7)).toBeUndefined();
    expect(parseProjectIdQuery('0')).toBeUndefined();
    expect(parseProjectIdQuery('-1')).toBeUndefined();
    expect(parseProjectIdQuery('1.5')).toBeUndefined();
    expect(parseProjectIdQuery('bad')).toBeUndefined();
  });

  it('parses positive integer project ids from body numbers only', () => {
    expect(parseOptionalProjectId(7)).toBe(7);

    expect(parseOptionalProjectId(undefined)).toBeUndefined();
    expect(parseOptionalProjectId('7')).toBeUndefined();
    expect(parseOptionalProjectId(0)).toBeUndefined();
    expect(parseOptionalProjectId(-1)).toBeUndefined();
    expect(parseOptionalProjectId(1.5)).toBeUndefined();
    expect(parseOptionalProjectId(Number.NaN)).toBeUndefined();
  });
});
