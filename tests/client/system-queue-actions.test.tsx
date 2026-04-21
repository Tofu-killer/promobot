import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

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

  it('loads browser lane requests through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        requests: [
          {
            channelAccountId: 7,
            platform: 'x',
            accountKey: 'acct-browser',
            action: 'request_session',
            jobStatus: 'pending',
            requestedAt: '2026-04-21T09:00:00.000Z',
            artifactPath:
              'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.loadBrowserLaneRequestsRequest).toBe('function');

    const loadBrowserLaneRequestsRequest = queueModule.loadBrowserLaneRequestsRequest as (
      limit?: number,
    ) => Promise<{ requests: Array<{ platform: string; action: string }>; total: number }>;

    const result = await loadBrowserLaneRequestsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/browser-lane-requests?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.requests[0]).toEqual(
      expect.objectContaining({
        platform: 'x',
        action: 'request_session',
      }),
    );
  });

  it('loads browser handoffs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          {
            platform: 'facebookGroup',
            draftId: '13',
            title: 'Community update',
            accountKey: 'launch-campaign',
            status: 'resolved',
            artifactPath:
              'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
            createdAt: '2026-04-21T09:10:00.000Z',
            updatedAt: '2026-04-21T09:20:00.000Z',
            resolvedAt: '2026-04-21T09:20:00.000Z',
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.loadBrowserHandoffsRequest).toBe('function');

    const loadBrowserHandoffsRequest = queueModule.loadBrowserHandoffsRequest as (
      limit?: number,
    ) => Promise<{ handoffs: Array<{ platform: string; draftId: string }>; total: number }>;

    const result = await loadBrowserHandoffsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/browser-handoffs?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.handoffs[0]).toEqual(
      expect.objectContaining({
        platform: 'facebookGroup',
        draftId: '13',
      }),
    );
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

  it('posts queue retry without a runAt payload by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.retrySystemQueueJobRequest).toBe('function');

    const retrySystemQueueJobRequest = queueModule.retrySystemQueueJobRequest as (
      jobId: number,
      runAt?: string,
    ) => Promise<unknown>;

    await retrySystemQueueJobRequest(11);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs/11/retry',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
            done: 3,
            failed: 1,
            canceled: 1,
            duePending: 1,
          },
          recentJobs: [
            {
              id: 17,
              type: 'monitor_fetch',
              status: 'done',
              runAt: '2026-04-19T13:00:00.000Z',
              attempts: 1,
            },
          ],
        },
      },
      browserLaneStateOverride: {
        status: 'success',
        data: {
          requests: [
            {
              channelAccountId: 7,
              platform: 'x',
              accountKey: 'acct-browser',
              action: 'request_session',
              jobStatus: 'pending',
              requestedAt: '2026-04-21T09:00:00.000Z',
              artifactPath:
                'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
              resolvedAt: null,
            },
          ],
          total: 1,
        },
      },
      browserHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              platform: 'facebookGroup',
              draftId: '13',
              title: 'Community update',
              accountKey: 'launch-campaign',
              status: 'resolved',
              artifactPath:
                'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
              createdAt: '2026-04-21T09:10:00.000Z',
              updatedAt: '2026-04-21T09:20:00.000Z',
              resolvedAt: '2026-04-21T09:20:00.000Z',
              resolution: {
                status: 'resolved',
                publishStatus: 'published',
              },
            },
          ],
          total: 1,
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
    expect(html).toContain('Done Jobs');
    expect(html).toContain('Canceled Jobs');
    expect(html).toContain('前往创建表单');
    expect(html).toContain('创建作业');
    expect(html).toContain('队列作业');
    expect(html).toContain('Browser Lane 工单');
    expect(html).toContain('Browser Handoff 工单');
    expect(html).toContain('最近作业');
    expect(html).toContain('request_session');
    expect(html).toContain('artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json');
    expect(html).toContain('artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json');
    expect(html).toContain('resolution: resolved');
    expect(html).toContain('resolution detail: published');
    expect(html).toContain('#11 · publish');
    expect(html).toContain('#17 · monitor_fetch · done');
    expect(html).toContain('lastError: boom');
    expect(html).toContain('重试');
  });

  it('focuses the create-job form from the header CTA without enqueueing immediately', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const loadSystemQueueAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        running: 0,
        failed: 0,
        duePending: 0,
      },
      recentJobs: [],
    });
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const enqueueSystemQueueJobAction = vi.fn().mockResolvedValue({
      job: {
        id: 13,
        type: 'monitor_fetch',
        status: 'pending',
        runAt: '2026-04-20T09:00',
        attempts: 0,
      },
      runtime: { available: true },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          enqueueSystemQueueJobAction,
        }),
      );
      await flush();
      await flush();
    });

    const headerCreateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('前往创建表单'),
    );
    const typeField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'type');

    expect(headerCreateButton).not.toBeNull();
    expect(typeField).not.toBeNull();
    expect(document.activeElement).not.toBe(typeField);

    await act(async () => {
      headerCreateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(enqueueSystemQueueJobAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(typeField);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('refreshes browser lane and browser handoff queries together with the main queue refresh action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const loadSystemQueueAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        running: 0,
        failed: 0,
        duePending: 0,
      },
      recentJobs: [],
    });
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(loadSystemQueueAction).toHaveBeenCalledTimes(1);
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(1);
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(1);

    const refreshButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新队列'),
    );

    await act(async () => {
      refreshButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadSystemQueueAction).toHaveBeenCalledTimes(2);
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(2);
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders the create-job runAt field as blank by default', async () => {
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const html = renderPage(SystemQueuePage, {
      stateOverride: {
        status: 'success',
        data: {
          jobs: [],
          queue: {
            pending: 0,
            running: 0,
            failed: 0,
            duePending: 0,
          },
          recentJobs: [],
        },
      },
    });

    expect(html).toContain('data-system-queue-field="runAt"');
    expect(html).not.toContain('value="2026-04-20T09:00"');
  });
});
