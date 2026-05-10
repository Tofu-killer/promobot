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

describe('system job request helpers', () => {
  it('loads system jobs and browser lane requests through the shared helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobs: [], queue: {}, recentJobs: [] }))
      .mockResolvedValueOnce(jsonResponse({ requests: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const systemJobsModule = (await import('../../src/client/lib/systemJobs')) as Record<string, unknown>;

    const loadSystemJobsRequest = systemJobsModule.loadSystemJobsRequest as <TResponse>(limit?: number) => Promise<TResponse>;
    const loadBrowserLaneRequestsRequest = systemJobsModule.loadBrowserLaneRequestsRequest as <TResponse>(
      limit?: number,
    ) => Promise<TResponse>;

    await loadSystemJobsRequest(35);
    await loadBrowserLaneRequestsRequest(15);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/system/jobs?limit=35', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/system/browser-lane-requests?limit=15', undefined);
  });

  it('posts browser lane import with trimmed notes through the shared helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
        session: null,
        channelAccount: {
          id: 17,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const systemJobsModule = (await import('../../src/client/lib/systemJobs')) as Record<string, unknown>;

    const importBrowserLaneRequestResultRequest = systemJobsModule.importBrowserLaneRequestResultRequest as <TResponse>(
      input: {
        requestArtifactPath: string;
        storageState: Record<string, unknown>;
        notes?: string;
      },
    ) => Promise<TResponse>;

    await importBrowserLaneRequestResultRequest({
      requestArtifactPath: 'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      storageState: {
        cookies: [],
      },
      notes: ' imported from local browser lane ',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/browser-lane-requests/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestArtifactPath: 'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
          storageState: {
            cookies: [],
          },
          notes: 'imported from local browser lane',
        }),
      }),
    );
  });

  it('posts retry, cancel, and enqueue through the shared helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job: { id: 11 }, runtime: {} }))
      .mockResolvedValueOnce(jsonResponse({ job: { id: 12 }, runtime: {} }))
      .mockResolvedValueOnce(jsonResponse({ job: { id: 13 }, runtime: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const systemJobsModule = (await import('../../src/client/lib/systemJobs')) as Record<string, unknown>;

    const retrySystemJobRequest = systemJobsModule.retrySystemJobRequest as <TResponse>(
      jobId: number,
      runAt?: string,
    ) => Promise<TResponse>;
    const cancelSystemJobRequest = systemJobsModule.cancelSystemJobRequest as <TResponse>(
      jobId: number,
    ) => Promise<TResponse>;
    const enqueueSystemJobRequest = systemJobsModule.enqueueSystemJobRequest as <TResponse>(input: {
      type: string;
      payload?: Record<string, unknown>;
      runAt?: string;
    }) => Promise<TResponse>;

    await retrySystemJobRequest(11, '2026-04-19T12:20:00.000Z');
    await cancelSystemJobRequest(12);
    await enqueueSystemJobRequest({
      type: 'reputation_fetch',
      payload: {},
      runAt: '2026-04-20T09:00',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/system/jobs/11/retry',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runAt: '2026-04-19T12:20:00.000Z' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/system/jobs/12/cancel',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reputation_fetch',
          payload: {},
          runAt: '2026-04-20T09:00',
        }),
      }),
    );
  });

  it('omits runAt from retry requests by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job: { id: 11 }, runtime: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const systemJobsModule = (await import('../../src/client/lib/systemJobs')) as Record<string, unknown>;

    const retrySystemJobRequest = systemJobsModule.retrySystemJobRequest as <TResponse>(
      jobId: number,
      runAt?: string,
    ) => Promise<TResponse>;

    await retrySystemJobRequest(11);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs/11/retry',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
  });
});
