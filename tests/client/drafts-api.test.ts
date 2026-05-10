import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('draft request helpers', () => {
  it('loads status-filtered drafts through the shared helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ drafts: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const draftsModule = (await import('../../src/client/lib/drafts')) as Record<string, unknown>;

    const loadDraftsRequest = draftsModule.loadDraftsRequest as (
      projectId?: number,
      status?: string,
    ) => Promise<{ drafts: unknown[] }>;

    await loadDraftsRequest(undefined, 'review');

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts?status=review', undefined);
  });

  it('loads project-scoped status-filtered drafts through the shared helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ drafts: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const draftsModule = (await import('../../src/client/lib/drafts')) as Record<string, unknown>;

    const loadDraftsRequest = draftsModule.loadDraftsRequest as (
      projectId?: number,
      status?: string,
    ) => Promise<{ drafts: unknown[] }>;

    await loadDraftsRequest(12, 'review');

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts?status=review&projectId=12', undefined);
  });
});
