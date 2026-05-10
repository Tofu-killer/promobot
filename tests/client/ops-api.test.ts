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

describe('ops request helpers', () => {
  it('loads unscoped and project-scoped ops data through shared helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, unread: 0 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ total: 0, positive: 0, neutral: 0, negative: 0, trend: [], items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, unread: 0 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ total: 0, positive: 0, neutral: 0, negative: 0, trend: [], items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const opsApiModule = (await import('../../src/client/lib/opsApi')) as Record<string, unknown>;

    const loadInboxRequest = opsApiModule.loadInboxRequest as <TResponse>(projectId?: number) => Promise<TResponse>;
    const loadMonitorFeedRequest = opsApiModule.loadMonitorFeedRequest as <TResponse>(
      projectId?: number,
    ) => Promise<TResponse>;
    const loadReputationRequest = opsApiModule.loadReputationRequest as <TResponse>(
      projectId?: number,
    ) => Promise<TResponse>;

    await loadInboxRequest();
    await loadMonitorFeedRequest();
    await loadReputationRequest();
    await loadInboxRequest(12);
    await loadMonitorFeedRequest(12);
    await loadReputationRequest(12);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/inbox', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/monitor/feed', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/reputation/stats', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/inbox?projectId=12', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/monitor/feed?projectId=12', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/reputation/stats?projectId=12', undefined);
  });
});
