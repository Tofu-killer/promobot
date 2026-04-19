import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function renderPage(Component: unknown, props: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(Component as (properties: Record<string, unknown>) => React.JSX.Element, props),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('System Queue actions', () => {
  it('loads system jobs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        jobs: [
          {
            id: 11,
            type: 'publish',
            status: 'failed',
            runAt: '2026-04-19T12:15:00.000Z',
            attempts: 1,
            canRetry: true,
            canCancel: false,
          },
        ],
        queue: {
          pending: 1,
          failed: 1,
        },
        recentJobs: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.loadSystemQueueRequest).toBe('function');

    const loadSystemQueueRequest = queueModule.loadSystemQueueRequest as (limit?: number) => Promise<unknown>;
    await loadSystemQueueRequest(25);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/jobs?limit=25', undefined);
  });

  it('posts queue retry, cancel, and enqueue through the shared API helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: 11,
            type: 'publish',
            status: 'pending',
            runAt: '2026-04-19T12:20:00.000Z',
            attempts: 1,
          },
          runtime: { available: true },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: 12,
            type: 'monitor_fetch',
            status: 'canceled',
            runAt: '2026-04-19T12:21:00.000Z',
            attempts: 0,
          },
          runtime: { available: true },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: 13,
            type: 'reputation_fetch',
            status: 'pending',
            runAt: '2026-04-20T09:00',
            attempts: 0,
          },
          runtime: { available: true },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.retrySystemQueueJobRequest).toBe('function');
    expect(typeof queueModule.cancelSystemQueueJobRequest).toBe('function');
    expect(typeof queueModule.enqueueSystemQueueJobRequest).toBe('function');

    const retrySystemQueueJobRequest = queueModule.retrySystemQueueJobRequest as (
      jobId: number,
      runAt?: string,
    ) => Promise<unknown>;
    const cancelSystemQueueJobRequest = queueModule.cancelSystemQueueJobRequest as (
      jobId: number,
    ) => Promise<unknown>;
    const enqueueSystemQueueJobRequest = queueModule.enqueueSystemQueueJobRequest as (input: {
      type: string;
      payload?: Record<string, unknown>;
      runAt?: string;
    }) => Promise<unknown>;

    await retrySystemQueueJobRequest(11, '2026-04-19T12:20:00.000Z');
    await cancelSystemQueueJobRequest(12);
    await enqueueSystemQueueJobRequest({
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

  it('renders queue metrics, jobs, and create controls', async () => {
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const html = renderPage(SystemQueuePage, {
      stateOverride: {
        status: 'success',
        data: {
          jobs: [
            {
              id: 11,
              type: 'publish',
              status: 'failed',
              runAt: '2026-04-19T12:15:00.000Z',
              attempts: 1,
              lastError: 'boom',
              canRetry: true,
              canCancel: false,
            },
          ],
          queue: {
            pending: 1,
            running: 0,
            failed: 1,
            duePending: 1,
          },
          recentJobs: [],
        },
      },
      mutationStateOverride: {
        status: 'success',
        data: {
          job: {
            id: 11,
            type: 'publish',
            status: 'pending',
            runAt: '2026-04-19T12:20:00.000Z',
            attempts: 1,
          },
          runtime: {
            available: true,
          },
        },
      },
    });

    expect(html).toContain('System Queue');
    expect(html).toContain('Pending Jobs');
    expect(html).toContain('创建作业');
    expect(html).toContain('队列作业');
    expect(html).toContain('#11 · publish');
    expect(html).toContain('lastError: boom');
    expect(html).toContain('重试');
  });
});
