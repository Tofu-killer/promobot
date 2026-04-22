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

function updateFieldValue(element: { value?: string } | null, value: string, window: { Event: typeof Event }) {
  if (!element) {
    throw new Error('expected input element');
  }

  element.value = value;

  const reactPropsKey = Object.keys(element as object).find((key) => key.startsWith('__reactProps'));
  const reactProps =
    reactPropsKey && reactPropsKey in (element as object)
      ? ((element as Record<string, unknown>)[reactPropsKey] as {
          onChange?: (event: { target: { value: string } }) => void;
        })
      : null;

  if (reactProps?.onChange) {
    reactProps.onChange({ target: { value } });
    return;
  }

  (element as { dispatchEvent: (event: Event) => void }).dispatchEvent(new window.Event('input', { bubbles: true }));
  (element as { dispatchEvent: (event: Event) => void }).dispatchEvent(new window.Event('change', { bubbles: true }));
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function hasAncestorWithText(element: { parentNode: unknown } | null, text: string) {
  let current = element?.parentNode as
    | ({ parentNode: unknown } & Record<string, unknown>)
    | null;

  while (current) {
    if (collectText(current as never).includes(text)) {
      return true;
    }
    current = (current.parentNode as ({ parentNode: unknown } & Record<string, unknown>) | null) ?? null;
  }

  return false;
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
            channelAccountId: 7,
            accountDisplayName: 'FB Group Manual',
            platform: 'facebookGroup',
            draftId: '13',
            title: 'Community update',
            accountKey: 'launch-campaign',
            ownership: 'direct',
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
              channelAccountId: 7,
              accountDisplayName: 'FB Group Manual',
              platform: 'facebookGroup',
              draftId: '13',
              title: 'Community update',
              accountKey: 'launch-campaign',
              ownership: 'direct',
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
    expect(html).toContain('accountKey: acct-browser');
    expect(html).toContain('artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json');
    expect(html).toContain('account #7');
    expect(html).toContain('account: FB Group Manual');
    expect(html).toContain('ownership: direct');
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

  it('keeps retry loading feedback scoped to the clicked job instead of all queue actions', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const pendingRetry = createDeferredPromise<{
      job: {
        id: number;
        type: string;
        status: string;
        runAt: string;
        attempts: number;
      };
      runtime: Record<string, unknown>;
    }>();
    const loadSystemQueueAction = vi.fn().mockResolvedValue({
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
        {
          id: 12,
          type: 'monitor_fetch',
          status: 'failed',
          runAt: '2026-04-19T12:30:00.000Z',
          attempts: 1,
          canRetry: true,
          canCancel: false,
        },
      ],
      queue: {
        pending: 1,
        running: 0,
        failed: 2,
        duePending: 1,
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
    const retrySystemQueueJobAction = vi.fn().mockReturnValue(pendingRetry.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          retrySystemQueueJobAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstRetryButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('重试') &&
        hasAncestorWithText(element, '#11 · publish'),
    );

    expect(firstRetryButton).not.toBeNull();

    await act(async () => {
      firstRetryButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(retrySystemQueueJobAction).toHaveBeenCalledWith(11, undefined);
    expect(collectText(container)).toContain('正在重试...');
    expect(collectText(container).split('正在重试...').length - 1).toBe(1);
    expect(collectText(container)).toContain('创建作业');
    expect(collectText(container)).not.toContain('正在创建作业...');

    await act(async () => {
      pendingRetry.resolve({
        job: {
          id: 11,
          type: 'publish',
          status: 'pending',
          runAt: '2026-04-19T12:15:00.000Z',
          attempts: 2,
        },
        runtime: { available: true },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('passes a user-provided payload when enqueueing a system job from the System Queue page', async () => {
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
        type: 'reputation_fetch',
        status: 'pending',
        runAt: '2026-04-20T09:00:00.000Z',
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

    const typeField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'type');
    const payloadField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'payload');
    const runAtField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'runAt');
    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建作业'),
    );

    await act(async () => {
      updateFieldValue(typeField as never, 'reputation_fetch', window as never);
      updateFieldValue(payloadField as never, '{"source":"reddit","limit":5}', window as never);
      updateFieldValue(runAtField as never, '2026-04-20T09:00:00.000Z', window as never);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(enqueueSystemQueueJobAction).toHaveBeenCalledWith({
      type: 'reputation_fetch',
      payload: {
        source: 'reddit',
        limit: 5,
      },
      runAt: '2026-04-20T09:00:00.000Z',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('omits payload when enqueue payload JSON is blank', async () => {
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
        id: 14,
        type: 'monitor_fetch',
        status: 'pending',
        runAt: '2026-04-20T09:00:00.000Z',
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

    const typeField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'type');
    const payloadField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'payload');
    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建作业'),
    );

    await act(async () => {
      updateFieldValue(typeField as never, 'monitor_fetch', window as never);
      updateFieldValue(payloadField as never, '   ', window as never);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(enqueueSystemQueueJobAction).toHaveBeenCalledWith({
      type: 'monitor_fetch',
      runAt: undefined,
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows enqueue payload validation errors when payload JSON is invalid or not an object', async () => {
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
        type: 'reputation_fetch',
        status: 'pending',
        runAt: '2026-04-20T09:00:00.000Z',
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

    const payloadField = findElement(container, (element) => element.getAttribute('data-system-queue-field') === 'payload');
    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建作业'),
    );

    await act(async () => {
      updateFieldValue(payloadField as never, '{"source":"reddit"', window as never);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(enqueueSystemQueueJobAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('队列动作失败：payload JSON 必须是合法的 JSON 对象');

    await act(async () => {
      updateFieldValue(payloadField as never, '[]', window as never);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(enqueueSystemQueueJobAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('队列动作失败：payload JSON 必须是 JSON 对象');

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
