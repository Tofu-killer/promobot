import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function findPriorityActionCard(root: { childNodes?: unknown[] } | null, title: string) {
  return findElement(
    root,
    (element) => element.tagName === 'ARTICLE' && collectText(element).includes(title),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system/inbox-reply-handoffs')) {
        return Promise.resolve(jsonResponse({ handoffs: [], total: 0 }));
      }

      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  );
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

  it('posts browser lane request completion through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.result.json',
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-24T08:15:00.000Z',
          storageStatePath: 'browser-sessions/managed/x/acct-browser.json',
          notes: 'browser lane imported',
        },
        channelAccount: {
          id: 7,
          metadata: {
            session: {
              hasSession: true,
              id: 'x:acct-browser',
              status: 'active',
              validatedAt: '2026-04-24T08:15:00.000Z',
              storageStatePath: 'browser-sessions/managed/x/acct-browser.json',
              notes: 'browser lane imported',
            },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.importBrowserLaneRequestResultRequest).toBe('function');

    const importBrowserLaneRequestResultRequest = queueModule.importBrowserLaneRequestResultRequest as (input: {
      requestArtifactPath: string;
      storageState: Record<string, unknown>;
      notes?: string;
    }) => Promise<unknown>;

    await importBrowserLaneRequestResultRequest({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      storageState: {
        cookies: [],
        origins: [],
      },
      notes: 'browser lane imported',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/browser-lane-requests/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestArtifactPath:
            'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
          storageState: {
            cookies: [],
            origins: [],
          },
          notes: 'browser lane imported',
        }),
      }),
    );
  });

  it('loads inbox reply handoffs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          {
            channelAccountId: 12,
            platform: 'reddit',
            itemId: '88',
            source: 'reddit',
            title: 'Need help with latency',
            author: 'user123',
            accountKey: 'reddit-main',
            status: 'pending',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
            createdAt: '2026-04-23T09:10:00.000Z',
            updatedAt: '2026-04-23T09:10:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.loadInboxReplyHandoffsRequest).toBe('function');

    const loadInboxReplyHandoffsRequest = queueModule.loadInboxReplyHandoffsRequest as (
      limit?: number,
    ) => Promise<{ handoffs: Array<{ platform: string; itemId: string }>; total: number }>;

    const result = await loadInboxReplyHandoffsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/inbox-reply-handoffs?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.handoffs[0]).toEqual(
      expect.objectContaining({
        platform: 'reddit',
        itemId: '88',
      }),
    );
  });

  it('posts browser handoff completion through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
        draftId: 13,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        externalId: 'fb-post-42',
        message: 'browser lane completed publish',
        publishedAt: '2026-04-23T10:10:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.completeBrowserHandoffRequest).toBe('function');

    const completeBrowserHandoffRequest = queueModule.completeBrowserHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt: number;
      publishStatus: 'published' | 'failed';
      message?: string;
    }) => Promise<unknown>;

    await completeBrowserHandoffRequest({
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      message: 'browser lane completed publish',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/browser-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
          handoffAttempt: 1,
          publishStatus: 'published',
          message: 'browser lane completed publish',
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        }),
      }),
    );
  });

  it('posts browser handoff completion through the shared API helper without a handoff attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13-legacy.json',
        draftId: 13,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        externalId: 'fb-post-42',
        message: 'browser lane completed publish',
        publishedAt: '2026-04-23T10:10:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    const completeBrowserHandoffRequest = queueModule.completeBrowserHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt?: number;
      publishStatus: 'published' | 'failed';
      message?: string;
      publishUrl?: string;
    }) => Promise<unknown>;

    await completeBrowserHandoffRequest({
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13-legacy.json',
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      message: 'browser lane completed publish',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/browser-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13-legacy.json',
          publishStatus: 'published',
          message: 'browser lane completed publish',
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        }),
      }),
    );
  });

  it('posts inbox reply handoff completion through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
        itemId: 88,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/abc123',
        externalId: 'msg-88',
        message: 'inbox reply handoff marked sent',
        deliveredAt: '2026-04-23T11:15:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    expect(typeof queueModule.completeInboxReplyHandoffRequest).toBe('function');

    const completeInboxReplyHandoffRequest = queueModule.completeInboxReplyHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt: number;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => Promise<unknown>;

    await completeInboxReplyHandoffRequest({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'inbox reply handoff marked sent',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/inbox-reply-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
          handoffAttempt: 1,
          replyStatus: 'sent',
          message: 'inbox reply handoff marked sent',
          deliveryUrl: 'https://reddit.com/message/messages/abc123',
        }),
      }),
    );
  });

  it('posts inbox reply handoff completion through the shared API helper without a handoff attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88-legacy.json',
        itemId: 88,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/abc123',
        externalId: 'msg-88',
        message: 'inbox reply handoff marked sent',
        deliveredAt: '2026-04-23T11:15:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queueModule = (await import('../../src/client/pages/SystemQueue')) as Record<string, unknown>;

    const completeInboxReplyHandoffRequest = queueModule.completeInboxReplyHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt?: number;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => Promise<unknown>;

    await completeInboxReplyHandoffRequest({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88-legacy.json',
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'inbox reply handoff marked sent',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/inbox-reply-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88-legacy.json',
          replyStatus: 'sent',
          message: 'inbox reply handoff marked sent',
          deliveryUrl: 'https://reddit.com/message/messages/abc123',
        }),
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
            {
              channelAccountId: 8,
              platform: 'facebookGroup',
              accountKey: 'fb-browser',
              action: 'relogin',
              jobStatus: 'resolved',
              requestedAt: '2026-04-22T09:00:00.000Z',
              artifactPath:
                'artifacts/browser-lane-requests/facebookGroup/fb-browser/relogin-job-18.json',
              resolvedAt: '2026-04-22T09:20:00.000Z',
              resolution: {
                status: 'resolved',
                session: {
                  status: 'active',
                  validatedAt: '2026-04-22T09:20:00.000Z',
                  storageStatePath: 'browser-sessions/managed/facebookGroup/fb-browser.json',
                  notes: 'browser lane imported',
                },
              },
            },
          ],
          total: 2,
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
                publishUrl: 'https://facebook.com/groups/group-123/posts/42',
                message: 'browser lane completed publish',
                publishedAt: '2026-04-23T10:10:00.000Z',
              },
            },
            {
              channelAccountId: 9,
              accountDisplayName: 'Weibo Manual',
              platform: 'weibo',
              draftId: '21',
              title: 'Weibo launch',
              accountKey: 'launch-weibo',
              ownership: 'direct',
              status: 'pending',
              artifactPath:
                'artifacts/browser-handoffs/weibo/launch-weibo/weibo-draft-21.json',
              createdAt: '2026-04-22T09:10:00.000Z',
              updatedAt: '2026-04-22T09:10:00.000Z',
              resolvedAt: null,
              resolution: null,
            },
          ],
          total: 2,
        },
      },
      inboxReplyHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              channelAccountId: 12,
              platform: 'reddit',
              itemId: '88',
              source: 'reddit',
              title: 'Need lower latency in APAC',
              author: 'user123',
              accountKey: 'reddit-main',
              status: 'resolved',
              artifactPath:
                'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
              createdAt: '2026-04-23T09:10:00.000Z',
              updatedAt: '2026-04-23T11:15:00.000Z',
              resolvedAt: '2026-04-23T11:15:00.000Z',
              resolution: {
                status: 'resolved',
                replyStatus: 'sent',
                deliveryUrl: 'https://reddit.com/message/messages/abc123',
                message: 'reply sent manually',
                deliveredAt: '2026-04-23T11:15:00.000Z',
              },
            },
            {
              channelAccountId: 13,
              platform: 'x',
              itemId: '91',
              source: 'x',
              title: 'Need pricing help',
              author: 'prospect-91',
              accountKey: 'x-main',
              status: 'pending',
              artifactPath: 'artifacts/inbox-reply-handoffs/x/x-main/x-item-91.json',
              createdAt: '2026-04-23T12:10:00.000Z',
              updatedAt: '2026-04-23T12:10:00.000Z',
              resolvedAt: null,
              resolution: null,
            },
          ],
          total: 2,
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
    expect(html).toContain('重点待办');
    expect(html).toContain('当前 3 条待处理动作');
    expect(html).toContain('补充 Session · x · acct-browser');
    expect(html).toContain('回复接管 · x · item #91');
    expect(html).toContain('发布接管 · weibo · draft #21');
    expect(html).toContain('前往 Browser Lane 工单');
    expect(html).toContain('前往 Inbox Reply Handoff 工单');
    expect(html).toContain('前往 Browser Handoff 工单');
    expect(html).toContain('Pending Jobs');
    expect(html).toContain('Done Jobs');
    expect(html).toContain('Canceled Jobs');
    expect(html).toContain('前往创建表单');
    expect(html).toContain('创建作业');
    expect(html).toContain('队列作业');
    expect(html).toContain('Browser Lane 工单');
    expect(html).toContain('Browser Handoff 工单');
    expect(html).toContain('Inbox Reply Handoff 工单');
    expect(html).toContain('最近作业');
    expect(html).toContain('request_session');
    expect(html).toContain('accountKey: acct-browser');
    expect(html).toContain('artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json');
    expect(html).toContain('resolution: resolved');
    expect(html).toContain('session status: active');
    expect(html).toContain('storageStatePath: browser-sessions/managed/facebookGroup/fb-browser.json');
    expect(html).toContain('notes: browser lane imported');
    expect(html).toContain('account #7');
    expect(html).toContain('account: FB Group Manual');
    expect(html).toContain('ownership: direct');
    expect(html).toContain('artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json');
    expect(html).toContain('resolution: resolved');
    expect(html).toContain('resolution detail: published');
    expect(html).toContain('publishUrl: https://facebook.com/groups/group-123/posts/42');
    expect(html).toContain('message: browser lane completed publish');
    expect(html).toContain('publishedAt: 2026-04-23T10:10:00.000Z');
    expect(html).toContain('标记已发布');
    expect(html).toContain('标记失败');
    expect(html).toContain('source: reddit');
    expect(html).toContain('author: user123');
    expect(html).toContain('artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json');
    expect(html).toContain('resolution detail: sent');
    expect(html).toContain('deliveryUrl: https://reddit.com/message/messages/abc123');
    expect(html).toContain('deliveredAt: 2026-04-23T11:15:00.000Z');
    expect(html).toContain('标记已发送');
    expect(html).toContain('#11 · publish');
    expect(html).toContain('#17 · monitor_fetch · done');
    expect(html).toContain('lastError: boom');
    expect(html).toContain('重试');
  });

  it('prioritizes relogin work ahead of other pending ops queue items', async () => {
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const html = renderPage(SystemQueuePage, {
      stateOverride: {
        status: 'success',
        data: {
          jobs: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        },
      },
      browserLaneStateOverride: {
        status: 'success',
        data: {
          requests: [
            {
              channelAccountId: 18,
              platform: 'facebookGroup',
              accountKey: 'fb-relogin',
              action: 'relogin',
              jobStatus: 'pending',
              requestedAt: '2026-04-25T08:00:00.000Z',
              artifactPath:
                'artifacts/browser-lane-requests/facebookGroup/fb-relogin/relogin-job-81.json',
              resolvedAt: null,
            },
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
          total: 2,
        },
      },
      browserHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              channelAccountId: 9,
              accountDisplayName: 'Weibo Manual',
              platform: 'weibo',
              draftId: '21',
              title: 'Weibo launch',
              accountKey: 'launch-weibo',
              ownership: 'direct',
              status: 'pending',
              artifactPath:
                'artifacts/browser-handoffs/weibo/launch-weibo/weibo-draft-21.json',
              createdAt: '2026-04-22T09:10:00.000Z',
              updatedAt: '2026-04-22T09:10:00.000Z',
              resolvedAt: null,
              resolution: null,
            },
          ],
          total: 1,
        },
      },
      inboxReplyHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              channelAccountId: 13,
              platform: 'x',
              itemId: '91',
              source: 'x',
              title: 'Need pricing help',
              author: 'prospect-91',
              accountKey: 'x-main',
              status: 'pending',
              artifactPath: 'artifacts/inbox-reply-handoffs/x/x-main/x-item-91.json',
              createdAt: '2026-04-23T12:10:00.000Z',
              updatedAt: '2026-04-23T12:10:00.000Z',
              resolvedAt: null,
              resolution: null,
            },
          ],
          total: 1,
        },
      },
    });

    const reloginIndex = html.indexOf('重新登录 · facebookGroup · fb-relogin');
    const requestSessionIndex = html.indexOf('补充 Session · x · acct-browser');
    const replyHandoffIndex = html.indexOf('回复接管 · x · item #91');
    const publishHandoffIndex = html.indexOf('发布接管 · weibo · draft #21');

    expect(reloginIndex).toBeGreaterThan(-1);
    expect(requestSessionIndex).toBeGreaterThan(-1);
    expect(replyHandoffIndex).toBeGreaterThan(-1);
    expect(publishHandoffIndex).toBeGreaterThan(-1);
    expect(reloginIndex).toBeLessThan(requestSessionIndex);
    expect(requestSessionIndex).toBeLessThan(replyHandoffIndex);
    expect(replyHandoffIndex).toBeLessThan(publishHandoffIndex);
  });

  it('completes a pending browser handoff directly from the prioritized ops queue', async () => {
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
      handoffs: [
        {
          channelAccountId: 7,
          accountDisplayName: 'FB Group Manual',
          handoffAttempt: 1,
          platform: 'facebookGroup',
          draftId: '13',
          title: 'Community update',
          accountKey: 'launch-campaign',
          ownership: 'direct',
          status: 'pending',
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
          createdAt: '2026-04-21T09:10:00.000Z',
          updatedAt: '2026-04-21T09:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 1,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      draftId: 13,
      draftStatus: 'published',
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'published',
      success: true,
      publishUrl: null,
      externalId: null,
      message: 'browser handoff marked published',
      publishedAt: '2026-04-23T10:10:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发布') &&
        hasAncestorWithText(element, '发布接管 · facebookGroup · draft #13'),
    );
    const publishUrlInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-priority-browser-handoff-field') === 'publishUrl' &&
        hasAncestorWithText(element, '发布接管 · facebookGroup · draft #13'),
    );
    const messageInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-priority-browser-handoff-field') === 'message' &&
        hasAncestorWithText(element, '发布接管 · facebookGroup · draft #13'),
    );

    expect(publishButton).not.toBeNull();
    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://facebook.com/groups/group-123/posts/42',
        window as never,
      );
      updateFieldValue(messageInput as never, 'browser lane completed publish', window as never);
      await flush();
    });

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      message: 'browser lane completed publish',
    });
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已结单 handoff draft #13 (published)');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('imports a pending browser lane request directly from the prioritized ops queue', async () => {
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
    const pendingRequest = {
      channelAccountId: 7,
      platform: 'x',
      accountKey: 'acct-browser',
      action: 'request_session',
      jobStatus: 'pending',
      requestedAt: '2026-04-21T09:00:00.000Z',
      artifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      resolvedAt: null,
      resolution: null,
    };
    const loadBrowserLaneRequestsAction = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [pendingRequest],
        total: 1,
      })
      .mockResolvedValueOnce({
        requests: [pendingRequest],
        total: 1,
      });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const importBrowserLaneRequestResultAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.result.json',
      channelAccount: {
        id: 7,
        metadata: {
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-24T08:15:00.000Z',
            storageStatePath: 'browser-sessions/managed/x/acct-browser.json',
            notes: 'browser lane imported',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    const storageStateField = findElement(
      container,
      (element) =>
        element.getAttribute('data-priority-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '补充 Session · x · acct-browser'),
    );
    const notesField = findElement(
      container,
      (element) =>
        element.getAttribute('data-priority-browser-lane-field') === 'notes' &&
        hasAncestorWithText(element, '补充 Session · x · acct-browser'),
    );
    const importButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState') &&
        hasAncestorWithText(element, '补充 Session · x · acct-browser'),
    );

    expect(storageStateField).not.toBeNull();
    expect(notesField).not.toBeNull();
    expect(importButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(storageStateField as never, '{"cookies":[],"origins":[]}', window as never);
      updateFieldValue(notesField as never, 'browser lane imported', window as never);
      await flush();
    });

    await act(async () => {
      importButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).toHaveBeenCalledWith({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      storageState: {
        cookies: [],
        origins: [],
      },
      notes: 'browser lane imported',
    });
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已导入 browser lane session #7 (active)');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('completes a pending inbox reply handoff directly from the prioritized ops queue', async () => {
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
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [
        {
          channelAccountId: 12,
          handoffAttempt: 1,
          platform: 'reddit',
          itemId: '88',
          source: 'reddit',
          title: 'Need lower latency in APAC',
          author: 'user123',
          accountKey: 'reddit-main',
          status: 'pending',
          artifactPath:
            'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
          createdAt: '2026-04-23T09:10:00.000Z',
          updatedAt: '2026-04-23T09:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 1,
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      itemId: 88,
      replyStatus: 'sent',
      status: 'handled',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'inbox reply handoff marked sent',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const markSentButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发送') &&
        hasAncestorWithText(element, '回复接管 · reddit · item #88'),
    );
    const deliveryUrlInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-priority-inbox-reply-handoff-field') === 'deliveryUrl' &&
        hasAncestorWithText(element, '回复接管 · reddit · item #88'),
    );
    const messageInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-priority-inbox-reply-handoff-field') === 'message' &&
        hasAncestorWithText(element, '回复接管 · reddit · item #88'),
    );

    expect(markSentButton).not.toBeNull();
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/abc123',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent manually', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'reply sent manually',
    });
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已结单 inbox reply item #88 (handled)');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('allows independent prioritized browser lane request imports while another import is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const firstImport = createDeferredPromise<{
      ok: true;
      imported: true;
      artifactPath: string;
      session: {
        hasSession: true;
        status: string;
        validatedAt: string;
        storageStatePath: string;
      };
      channelAccount: {
        id: number;
        session: {
          hasSession: true;
          status: string;
          validatedAt: string;
          storageStatePath: string;
        };
      };
    }>();
    const secondImport = createDeferredPromise<{
      ok: true;
      imported: true;
      artifactPath: string;
      session: {
        hasSession: true;
        status: string;
        validatedAt: string;
        storageStatePath: string;
      };
      channelAccount: {
        id: number;
        session: {
          hasSession: true;
          status: string;
          validatedAt: string;
          storageStatePath: string;
        };
      };
    }>();
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
      requests: [
        {
          channelAccountId: 7,
          platform: 'x',
          accountKey: 'acct-browser-a',
          action: 'request_session',
          jobStatus: 'pending',
          requestedAt: '2026-04-28T09:00:00.000Z',
          artifactPath:
            'artifacts/browser-lane-requests/x/acct-browser-a/request-session-job-17.json',
          resolvedAt: null,
          resolution: null,
        },
        {
          channelAccountId: 8,
          platform: 'x',
          accountKey: 'acct-browser-b',
          action: 'request_session',
          jobStatus: 'pending',
          requestedAt: '2026-04-28T09:01:00.000Z',
          artifactPath:
            'artifacts/browser-lane-requests/x/acct-browser-b/request-session-job-18.json',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 2,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const importBrowserLaneRequestResultAction = vi.fn().mockImplementation(({ requestArtifactPath }) => {
      return requestArtifactPath.includes('acct-browser-a') ? firstImport.promise : secondImport.promise;
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstCard = findPriorityActionCard(container, '补充 Session · x · acct-browser-a');
    const secondCard = findPriorityActionCard(container, '补充 Session · x · acct-browser-b');
    const firstStorageStateField = findElement(
      firstCard,
      (element) =>
        element.getAttribute('data-priority-browser-lane-field') === 'storageState',
    );
    const secondStorageStateField = findElement(
      secondCard,
      (element) =>
        element.getAttribute('data-priority-browser-lane-field') === 'storageState',
    );
    const firstImportButton = findElement(
      firstCard,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState'),
    );
    const secondImportButton = findElement(
      secondCard,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState'),
    );

    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    expect(firstStorageStateField).not.toBeNull();
    expect(secondStorageStateField).not.toBeNull();
    expect(firstImportButton).not.toBeNull();
    expect(secondImportButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(firstStorageStateField as never, '{"cookies":[],"origins":[]}', window as never);
      updateFieldValue(secondStorageStateField as never, '{"cookies":[],"origins":[]}', window as never);
      await flush();
    });

    await act(async () => {
      (firstImportButton as { dispatchEvent: (event: Event) => void }).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).toHaveBeenCalledTimes(1);
    expect((secondImportButton as { getAttribute: (name: string) => string | null }).getAttribute('disabled')).toBeNull();

    await act(async () => {
      (secondImportButton as { dispatchEvent: (event: Event) => void }).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).toHaveBeenCalledTimes(2);
    expect(importBrowserLaneRequestResultAction).toHaveBeenNthCalledWith(1, {
      requestArtifactPath: 'artifacts/browser-lane-requests/x/acct-browser-a/request-session-job-17.json',
      storageState: {
        cookies: [],
        origins: [],
      },
    });
    expect(importBrowserLaneRequestResultAction).toHaveBeenNthCalledWith(2, {
      requestArtifactPath: 'artifacts/browser-lane-requests/x/acct-browser-b/request-session-job-18.json',
      storageState: {
        cookies: [],
        origins: [],
      },
    });

    await act(async () => {
      firstImport.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-lane-requests/x/acct-browser-a/request-session-job-17.json',
        session: {
          hasSession: true,
          status: 'active',
          validatedAt: '2026-04-28T09:05:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/x/acct-browser-a.json',
        },
        channelAccount: {
          id: 7,
          session: {
            hasSession: true,
            status: 'active',
            validatedAt: '2026-04-28T09:05:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/x/acct-browser-a.json',
          },
        },
      });
      secondImport.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-lane-requests/x/acct-browser-b/request-session-job-18.json',
        session: {
          hasSession: true,
          status: 'active',
          validatedAt: '2026-04-28T09:06:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/x/acct-browser-b.json',
        },
        channelAccount: {
          id: 8,
          session: {
            hasSession: true,
            status: 'active',
            validatedAt: '2026-04-28T09:06:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/x/acct-browser-b.json',
          },
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('allows independent prioritized browser handoff completions while another completion is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const firstCompletion = createDeferredPromise<{
      ok: true;
      imported: true;
      artifactPath: string;
      draftId: number;
      draftStatus: string;
      platform: string;
      mode: string;
      status: string;
      publishStatus: string;
      success: true;
      publishUrl: string;
      message: string;
      publishedAt: string;
    }>();
    const secondCompletion = createDeferredPromise<{
      ok: true;
      imported: true;
      artifactPath: string;
      draftId: number;
      draftStatus: string;
      platform: string;
      mode: string;
      status: string;
      publishStatus: string;
      success: true;
      publishUrl: string;
      message: string;
      publishedAt: string;
    }>();
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
      handoffs: [
        {
          channelAccountId: 13,
          accountDisplayName: 'Launch A',
          handoffAttempt: 1,
          platform: 'facebookGroup',
          draftId: '13',
          title: 'Community update A',
          accountKey: 'launch-campaign-a',
          ownership: 'direct',
          status: 'pending',
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign-a/facebookGroup-draft-13.json',
          createdAt: '2026-04-28T09:10:00.000Z',
          updatedAt: '2026-04-28T09:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
        {
          channelAccountId: 14,
          accountDisplayName: 'Launch B',
          handoffAttempt: 1,
          platform: 'facebookGroup',
          draftId: '14',
          title: 'Community update B',
          accountKey: 'launch-campaign-b',
          ownership: 'direct',
          status: 'pending',
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign-b/facebookGroup-draft-14.json',
          createdAt: '2026-04-28T09:11:00.000Z',
          updatedAt: '2026-04-28T09:11:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 2,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const completeBrowserHandoffAction = vi.fn().mockImplementation(({ artifactPath }) => {
      return artifactPath.includes('launch-campaign-a') ? firstCompletion.promise : secondCompletion.promise;
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstCard = findPriorityActionCard(container, '发布接管 · facebookGroup · draft #13');
    const secondCard = findPriorityActionCard(container, '发布接管 · facebookGroup · draft #14');
    const firstPublishUrlField = findElement(
      firstCard,
      (element) =>
        element.getAttribute('data-priority-browser-handoff-field') === 'publishUrl',
    );
    const secondPublishUrlField = findElement(
      secondCard,
      (element) =>
        element.getAttribute('data-priority-browser-handoff-field') === 'publishUrl',
    );
    const firstCompleteButton = findElement(
      firstCard,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发布'),
    );
    const secondCompleteButton = findElement(
      secondCard,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发布'),
    );

    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    expect(firstPublishUrlField).not.toBeNull();
    expect(secondPublishUrlField).not.toBeNull();
    expect(firstCompleteButton).not.toBeNull();
    expect(secondCompleteButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(firstPublishUrlField as never, 'https://facebook.com/groups/a/posts/13', window as never);
      updateFieldValue(secondPublishUrlField as never, 'https://facebook.com/groups/b/posts/14', window as never);
      await flush();
    });

    await act(async () => {
      (firstCompleteButton as { dispatchEvent: (event: Event) => void }).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledTimes(1);
    expect((secondCompleteButton as { getAttribute: (name: string) => string | null }).getAttribute('disabled')).toBeNull();

    await act(async () => {
      (secondCompleteButton as { dispatchEvent: (event: Event) => void }).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledTimes(2);
    expect(completeBrowserHandoffAction).toHaveBeenNthCalledWith(1, {
      artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign-a/facebookGroup-draft-13.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/a/posts/13',
    });
    expect(completeBrowserHandoffAction).toHaveBeenNthCalledWith(2, {
      artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign-b/facebookGroup-draft-14.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/b/posts/14',
    });

    await act(async () => {
      firstCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign-a/facebookGroup-draft-13.json',
        draftId: 13,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'resolved',
        publishStatus: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/a/posts/13',
        message: '',
        publishedAt: '2026-04-28T09:15:00.000Z',
      });
      secondCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign-b/facebookGroup-draft-14.json',
        draftId: 14,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'resolved',
        publishStatus: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/b/posts/14',
        message: '',
        publishedAt: '2026-04-28T09:16:00.000Z',
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('allows independent prioritized inbox reply handoff completions while another completion is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const firstCompletion = createDeferredPromise<{
      ok: true;
      imported: true;
      artifactPath: string;
      itemId: number;
      itemStatus: string;
      platform: string;
      mode: string;
      status: string;
      replyStatus: string;
      success: true;
      deliveryUrl: string;
      message: string;
      deliveredAt: string;
    }>();
    const secondCompletion = createDeferredPromise<{
      ok: true;
      imported: true;
      artifactPath: string;
      itemId: number;
      itemStatus: string;
      platform: string;
      mode: string;
      status: string;
      replyStatus: string;
      success: true;
      deliveryUrl: string;
      message: string;
      deliveredAt: string;
    }>();
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
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [
        {
          channelAccountId: 12,
          handoffAttempt: 1,
          platform: 'reddit',
          itemId: '88',
          source: 'reddit',
          title: 'Need lower latency in APAC',
          author: 'user123',
          accountKey: 'reddit-main',
          status: 'pending',
          artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
          createdAt: '2026-04-28T09:10:00.000Z',
          updatedAt: '2026-04-28T09:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
        {
          channelAccountId: 13,
          handoffAttempt: 1,
          platform: 'reddit',
          itemId: '89',
          source: 'reddit',
          title: 'Follow-up on deployment',
          author: 'user456',
          accountKey: 'reddit-secondary',
          status: 'pending',
          artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-secondary/reddit-item-89.json',
          createdAt: '2026-04-28T09:11:00.000Z',
          updatedAt: '2026-04-28T09:11:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 2,
    });
    const completeInboxReplyHandoffAction = vi.fn().mockImplementation(({ artifactPath }) => {
      return artifactPath.includes('reddit-main') ? firstCompletion.promise : secondCompletion.promise;
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstCard = findPriorityActionCard(container, '回复接管 · reddit · item #88');
    const secondCard = findPriorityActionCard(container, '回复接管 · reddit · item #89');
    const firstDeliveryUrlField = findElement(
      firstCard,
      (element) =>
        element.getAttribute('data-priority-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const secondDeliveryUrlField = findElement(
      secondCard,
      (element) =>
        element.getAttribute('data-priority-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const firstCompleteButton = findElement(
      firstCard,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发送'),
    );
    const secondCompleteButton = findElement(
      secondCard,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发送'),
    );

    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    expect(firstDeliveryUrlField).not.toBeNull();
    expect(secondDeliveryUrlField).not.toBeNull();
    expect(firstCompleteButton).not.toBeNull();
    expect(secondCompleteButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(firstDeliveryUrlField as never, 'https://reddit.com/message/messages/88', window as never);
      updateFieldValue(secondDeliveryUrlField as never, 'https://reddit.com/message/messages/89', window as never);
      await flush();
    });

    await act(async () => {
      (firstCompleteButton as { dispatchEvent: (event: Event) => void }).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledTimes(1);
    expect((secondCompleteButton as { getAttribute: (name: string) => string | null }).getAttribute('disabled')).toBeNull();

    await act(async () => {
      (secondCompleteButton as { dispatchEvent: (event: Event) => void }).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledTimes(2);
    expect(completeInboxReplyHandoffAction).toHaveBeenNthCalledWith(1, {
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/88',
    });
    expect(completeInboxReplyHandoffAction).toHaveBeenNthCalledWith(2, {
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-secondary/reddit-item-89.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/89',
    });

    await act(async () => {
      firstCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
        itemId: 88,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'manual',
        status: 'resolved',
        replyStatus: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/88',
        message: '',
        deliveredAt: '2026-04-28T09:18:00.000Z',
      });
      secondCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-secondary/reddit-item-89.json',
        itemId: 89,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'manual',
        status: 'resolved',
        replyStatus: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/89',
        message: '',
        deliveredAt: '2026-04-28T09:19:00.000Z',
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('marks a pending browser handoff as published from the System Queue page and reloads handoffs', async () => {
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
      handoffs: [
        {
          channelAccountId: 7,
          accountDisplayName: 'FB Group Manual',
          handoffAttempt: 1,
          platform: 'facebookGroup',
          draftId: '13',
          title: 'Community update',
          accountKey: 'launch-campaign',
          ownership: 'direct',
          status: 'pending',
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
          createdAt: '2026-04-21T09:10:00.000Z',
          updatedAt: '2026-04-21T09:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 1,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      draftId: 13,
      draftStatus: 'published',
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'published',
      success: true,
      publishUrl: null,
      externalId: null,
      message: 'browser handoff marked published',
      publishedAt: '2026-04-23T10:10:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发布') &&
        hasAncestorWithText(element, 'facebookGroup · draft #13 · pending'),
    );
    const publishUrlInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-handoff-field') === 'publishUrl' &&
        hasAncestorWithText(element, 'facebookGroup · draft #13 · pending'),
    );
    const messageInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-handoff-field') === 'message' &&
        hasAncestorWithText(element, 'facebookGroup · draft #13 · pending'),
    );

    expect(publishButton).not.toBeNull();
    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://facebook.com/groups/group-123/posts/42',
        window as never,
      );
      updateFieldValue(
        messageInput as never,
        'browser lane completed publish',
        window as never,
      );
      await flush();
    });

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      message: 'browser lane completed publish',
    });
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已结单 handoff draft #13 (published)');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps a completed browser handoff locally resolved until refresh catches up, then yields to server truth', async () => {
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
    const pendingHandoff = {
      channelAccountId: 7,
      accountDisplayName: 'FB Group Manual',
      handoffAttempt: 1,
      platform: 'facebookGroup',
      draftId: '13',
      title: 'Community update',
      accountKey: 'launch-campaign',
      ownership: 'direct',
      status: 'pending',
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      createdAt: '2026-04-21T09:10:00.000Z',
      updatedAt: '2026-04-21T09:10:00.000Z',
      resolvedAt: null,
      resolution: null,
    };
    const resolvedHandoff = {
      ...pendingHandoff,
      status: 'published',
      updatedAt: '2026-04-23T10:16:00.000Z',
      resolvedAt: '2026-04-23T10:16:00.000Z',
      resolution: {
        status: 'published',
        draftStatus: 'published',
        publishUrl: 'https://facebook.com/groups/group-123/posts/84',
        message: 'server refresh caught up',
        publishedAt: '2026-04-23T10:16:00.000Z',
      },
    };
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [pendingHandoff],
        total: 1,
      })
      .mockResolvedValueOnce({
        handoffs: [pendingHandoff],
        total: 1,
      })
      .mockResolvedValueOnce({
        handoffs: [resolvedHandoff],
        total: 1,
      });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      draftId: 13,
      draftStatus: 'published',
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'published',
      success: true,
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      externalId: null,
      message: 'browser lane completed publish',
      publishedAt: '2026-04-23T10:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishUrlInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-handoff-field') === 'publishUrl' &&
        hasAncestorWithText(element, 'facebookGroup · draft #13 · pending'),
    );
    const messageInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-handoff-field') === 'message' &&
        hasAncestorWithText(element, 'facebookGroup · draft #13 · pending'),
    );
    const publishButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发布') &&
        hasAncestorWithText(element, 'facebookGroup · draft #13 · pending'),
    );

    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(publishButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://facebook.com/groups/group-123/posts/42',
        window as never,
      );
      updateFieldValue(messageInput as never, 'browser lane completed publish', window as never);
      await flush();
    });

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('facebookGroup · draft #13 · published');
    expect(collectText(container)).toContain('resolvedAt: 2026-04-23T10:15:00.000Z');
    expect(collectText(container)).toContain('publishUrl: https://facebook.com/groups/group-123/posts/42');
    expect(collectText(container)).toContain('message: browser lane completed publish');
    expect(collectText(container)).not.toContain('facebookGroup · draft #13 · pending');
    expect(collectText(container)).not.toContain('发布接管 · facebookGroup · draft #13');

    const refreshButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新队列'),
    );

    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).toContain('resolvedAt: 2026-04-23T10:16:00.000Z');
    expect(collectText(container)).toContain('publishUrl: https://facebook.com/groups/group-123/posts/84');
    expect(collectText(container)).toContain('message: server refresh caught up');
    expect(collectText(container)).not.toContain('message: browser lane completed publish');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('imports a pending browser lane request from the System Queue page, keeps it locally resolved until refresh catches up, then yields to server truth', async () => {
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
    const pendingRequest = {
      channelAccountId: 7,
      platform: 'x',
      accountKey: 'acct-browser',
      action: 'request_session',
      jobStatus: 'pending',
      requestedAt: '2026-04-21T09:00:00.000Z',
      artifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      resolvedAt: null,
      resolution: null,
    };
    const resolvedRequest = {
      ...pendingRequest,
      jobStatus: 'resolved',
      resolvedAt: '2026-04-24T08:16:00.000Z',
      resolution: {
        status: 'resolved',
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-24T08:16:00.000Z',
          storageStatePath: 'browser-sessions/managed/x/acct-browser.json',
          notes: 'server refresh caught up',
        },
      },
    };
    const loadBrowserLaneRequestsAction = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [pendingRequest],
        total: 1,
      })
      .mockResolvedValueOnce({
        requests: [pendingRequest],
        total: 1,
      })
      .mockResolvedValueOnce({
        requests: [resolvedRequest],
        total: 1,
      });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const importBrowserLaneRequestResultAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.result.json',
      channelAccount: {
        id: 7,
        metadata: {
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-24T08:15:00.000Z',
            storageStatePath: 'browser-sessions/managed/x/acct-browser.json',
            notes: 'browser lane imported',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    const storageStateField = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const notesField = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'notes' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const importButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState') &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );

    expect(storageStateField).not.toBeNull();
    expect(notesField).not.toBeNull();
    expect(importButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        storageStateField as never,
        '{"cookies":[],"origins":[]}',
        window as never,
      );
      updateFieldValue(notesField as never, 'browser lane imported', window as never);
      await flush();
    });

    await act(async () => {
      importButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).toHaveBeenCalledWith({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      storageState: {
        cookies: [],
        origins: [],
      },
      notes: 'browser lane imported',
    });
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已导入 browser lane session #7 (active)');

    const storageStateFieldAfterSuccess = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '#7 · x · request_session · resolved'),
    );
    const notesFieldAfterSuccess = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'notes' &&
        hasAncestorWithText(element, '#7 · x · request_session · resolved'),
    );

    const importButtonAfterSuccess = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState') &&
        hasAncestorWithText(element, '#7 · x · request_session · resolved'),
    );

    expect(storageStateFieldAfterSuccess).toBeNull();
    expect(notesFieldAfterSuccess).toBeNull();
    expect(importButtonAfterSuccess).toBeNull();
    expect(collectText(container)).toContain('#7 · x · request_session · resolved');
    expect(collectText(container)).not.toContain('#7 · x · request_session · pending');
    expect(collectText(container)).toContain('resolvedAt: 2026-04-24T08:15:00.000Z');
    expect(collectText(container)).toContain('resolution: resolved');
    expect(collectText(container)).toContain('session status: active');
    expect(collectText(container)).toContain(
      'storageStatePath: browser-sessions/managed/x/acct-browser.json',
    );
    expect(collectText(container)).toContain('notes: browser lane imported');

    const refreshButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新队列'),
    );

    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).toContain('resolvedAt: 2026-04-24T08:16:00.000Z');
    expect(collectText(container)).toContain('notes: server refresh caught up');
    expect(collectText(container)).not.toContain('notes: browser lane imported');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows a client-side error for invalid browser lane storageState JSON without posting', async () => {
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
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const importBrowserLaneRequestResultAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    const storageStateField = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const importButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState') &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );

    expect(storageStateField).not.toBeNull();
    expect(importButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(storageStateField as never, '{"cookies":[]', window as never);
      await flush();
    });

    await act(async () => {
      importButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).not.toHaveBeenCalled();
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain(
      'browser lane session 导入失败：storageState JSON 必须是合法的 JSON 对象',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows a client-side error when browser lane storageState JSON omits cookies or origins arrays', async () => {
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
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const importBrowserLaneRequestResultAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    const storageStateField = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const importButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState') &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );

    expect(storageStateField).not.toBeNull();
    expect(importButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(storageStateField as never, '{}', window as never);
      await flush();
    });

    await act(async () => {
      importButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).not.toHaveBeenCalled();
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain(
      'browser lane session 导入失败：storageState JSON 必须包含 cookies 和 origins 数组',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the browser lane draft visible when the importer rejects the storageState payload', async () => {
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
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const importBrowserLaneRequestResultAction = vi
      .fn()
      .mockRejectedValue(new Error('downstream browser lane importer rejected the payload'));

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    const storageStateField = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const notesField = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'notes' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const importButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('导入 storageState') &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );

    expect(storageStateField).not.toBeNull();
    expect(notesField).not.toBeNull();
    expect(importButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        storageStateField as never,
        '{"cookies":[],"origins":[],"_mock":"semantic-reject"}',
        window as never,
      );
      updateFieldValue(notesField as never, 'needs repair', window as never);
      await flush();
    });

    await act(async () => {
      importButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(importBrowserLaneRequestResultAction).toHaveBeenCalledWith({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
      storageState: {
        cookies: [],
        origins: [],
        _mock: 'semantic-reject',
      },
      notes: 'needs repair',
    });
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain(
      'browser lane session 导入失败：downstream browser lane importer rejected the payload',
    );

    const storageStateFieldAfterError = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'storageState' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );
    const notesFieldAfterError = findElement(
      container,
      (element) =>
        element.getAttribute('data-browser-lane-field') === 'notes' &&
        hasAncestorWithText(element, '#7 · x · request_session · pending'),
    );

    expect(storageStateFieldAfterError?.getAttribute('value') ?? storageStateFieldAfterError?.value).toBe(
      '{"cookies":[],"origins":[],"_mock":"semantic-reject"}',
    );
    expect(notesFieldAfterError?.getAttribute('value') ?? notesFieldAfterError?.value).toBe('needs repair');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('marks a pending inbox reply handoff as sent from the System Queue page and reloads handoffs', async () => {
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
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [
        {
          channelAccountId: 12,
          handoffAttempt: 1,
          platform: 'reddit',
          itemId: '88',
          source: 'reddit',
          title: 'Need lower latency in APAC',
          author: 'user123',
          accountKey: 'reddit-main',
          status: 'pending',
          artifactPath:
            'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
          createdAt: '2026-04-23T09:10:00.000Z',
          updatedAt: '2026-04-23T09:10:00.000Z',
          resolvedAt: null,
          resolution: null,
        },
      ],
      total: 1,
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      itemId: 88,
      replyStatus: 'sent',
      status: 'handled',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'inbox reply handoff marked sent',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const markSentButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发送') &&
        hasAncestorWithText(element, 'reddit · item #88 · pending'),
    );
    const deliveryUrlInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl' &&
        hasAncestorWithText(element, 'reddit · item #88 · pending'),
    );
    const messageInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-inbox-reply-handoff-field') === 'message' &&
        hasAncestorWithText(element, 'reddit · item #88 · pending'),
    );

    expect(markSentButton).not.toBeNull();
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/abc123',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent manually', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'reply sent manually',
    });
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已结单 inbox reply item #88 (handled)');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps blocked inbox reply handoffs visible but read-only and out of the prioritized ops queue', async () => {
    const { container } = installMinimalDom();
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
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [
        {
          channelAccountId: 12,
          handoffAttempt: 1,
          platform: 'weibo',
          itemId: '88',
          source: 'weibo',
          title: 'Need lower latency in APAC',
          author: 'user123',
          accountKey: 'weibo-main',
          status: 'pending',
          readiness: 'blocked',
          sessionAction: 'request_session',
          artifactPath: 'artifacts/inbox-reply-handoffs/weibo/weibo-main/weibo-item-88.json',
          createdAt: '2026-04-28T09:10:00.000Z',
          updatedAt: '2026-04-28T09:10:00.000Z',
          resolvedAt: null,
        },
      ],
      total: 1,
    });
    const importBrowserLaneRequestResultAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          importBrowserLaneRequestResultAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('等待补充 Session 后继续回复接管。');
    expect(collectText(container)).not.toContain('回复接管 · weibo · item #88');
    expect(
      findElement(
        container,
        (element) =>
          element.tagName === 'BUTTON' &&
          collectText(element).includes('标记已发送') &&
          hasAncestorWithText(element, 'weibo · item #88 · pending'),
      ),
    ).toBeNull();
    expect(
      findElement(
        container,
        (element) =>
          element.tagName === 'BUTTON' &&
          collectText(element).includes('标记失败') &&
          hasAncestorWithText(element, 'weibo · item #88 · pending'),
      ),
    ).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps blocked browser handoffs visible but read-only and out of the prioritized ops queue', async () => {
    const { container } = installMinimalDom();
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
      handoffs: [
        {
          channelAccountId: 12,
          handoffAttempt: 1,
          platform: 'weibo',
          draftId: '88',
          title: 'Need lower latency in APAC',
          accountKey: 'weibo-main',
          status: 'pending',
          readiness: 'blocked',
          sessionAction: 'request_session',
          artifactPath: 'artifacts/browser-handoffs/weibo/weibo-main/weibo-draft-88.json',
          createdAt: '2026-04-28T09:10:00.000Z',
          updatedAt: '2026-04-28T09:10:00.000Z',
          resolvedAt: null,
        },
      ],
      total: 1,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
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
          loadInboxReplyHandoffsAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('等待补充 Session 后继续发布接管。');
    expect(collectText(container)).not.toContain('发布接管 · weibo · draft #88');
    expect(
      findElement(
        container,
        (element) =>
          element.tagName === 'BUTTON' &&
          collectText(element).includes('标记已发布') &&
          hasAncestorWithText(element, 'weibo · draft #88 · pending'),
      ),
    ).toBeNull();
    expect(
      findElement(
        container,
        (element) =>
          element.tagName === 'BUTTON' &&
          collectText(element).includes('标记失败') &&
          hasAncestorWithText(element, 'weibo · draft #88 · pending'),
      ),
    ).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps a completed inbox reply handoff locally resolved until refresh catches up, then yields to server truth', async () => {
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
    const pendingHandoff = {
      channelAccountId: 12,
      handoffAttempt: 1,
      platform: 'reddit',
      itemId: '88',
      source: 'reddit',
      title: 'Need lower latency in APAC',
      author: 'user123',
      accountKey: 'reddit-main',
      status: 'pending',
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      createdAt: '2026-04-23T09:10:00.000Z',
      updatedAt: '2026-04-23T09:10:00.000Z',
      resolvedAt: null,
      resolution: null,
    };
    const resolvedHandoff = {
      ...pendingHandoff,
      status: 'handled',
      updatedAt: '2026-04-23T11:16:00.000Z',
      resolvedAt: '2026-04-23T11:16:00.000Z',
      resolution: {
        status: 'handled',
        replyStatus: 'sent',
        itemStatus: 'sent',
        deliveryUrl: 'https://reddit.com/message/messages/xyz789',
        message: 'server refresh caught up',
        deliveredAt: '2026-04-23T11:16:00.000Z',
      },
    };
    const loadInboxReplyHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [pendingHandoff],
        total: 1,
      })
      .mockResolvedValueOnce({
        handoffs: [pendingHandoff],
        total: 1,
      })
      .mockResolvedValueOnce({
        handoffs: [resolvedHandoff],
        total: 1,
      });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      itemId: 88,
      itemStatus: 'sent',
      replyStatus: 'sent',
      status: 'handled',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const deliveryUrlInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl' &&
        hasAncestorWithText(element, 'reddit · item #88 · pending'),
    );
    const messageInput = findElement(
      container,
      (element) =>
        element.getAttribute('data-inbox-reply-handoff-field') === 'message' &&
        hasAncestorWithText(element, 'reddit · item #88 · pending'),
    );
    const markSentButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('标记已发送') &&
        hasAncestorWithText(element, 'reddit · item #88 · pending'),
    );

    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/abc123',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent manually', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('reddit · item #88 · handled');
    expect(collectText(container)).toContain('resolvedAt: 2026-04-23T11:15:00.000Z');
    expect(collectText(container)).toContain('deliveryUrl: https://reddit.com/message/messages/abc123');
    expect(collectText(container)).toContain('message: reply sent manually');
    expect(collectText(container)).not.toContain('reddit · item #88 · pending');
    expect(collectText(container)).not.toContain('回复接管 · reddit · item #88');

    const refreshButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新队列'),
    );

    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).toContain('resolvedAt: 2026-04-23T11:16:00.000Z');
    expect(collectText(container)).toContain('deliveryUrl: https://reddit.com/message/messages/xyz789');
    expect(collectText(container)).toContain('message: server refresh caught up');
    expect(collectText(container)).not.toContain('message: reply sent manually');

    await act(async () => {
      root.unmount();
      await flush();
    });
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
          status: 'pending',
          runAt: '2026-04-19T12:30:00.000Z',
          attempts: 1,
          canRetry: false,
          canCancel: true,
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
    const enqueueSystemQueueJobAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          retrySystemQueueJobAction,
          enqueueSystemQueueJobAction,
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

  it('disables other queue actions while a retry mutation is in flight', async () => {
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
          status: 'pending',
          runAt: '2026-04-19T12:30:00.000Z',
          attempts: 1,
          canRetry: false,
          canCancel: true,
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
    const enqueueSystemQueueJobAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          retrySystemQueueJobAction,
          enqueueSystemQueueJobAction,
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
    const cancelButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('取消') &&
        hasAncestorWithText(element, '#12 · monitor_fetch'),
    );
    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建作业'),
    );

    expect(firstRetryButton).not.toBeNull();
    expect(cancelButton).not.toBeNull();
    expect(createButton).not.toBeNull();

    await act(async () => {
      firstRetryButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const cancelButtonAfterStart = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element).includes('取消') &&
        hasAncestorWithText(element, '#12 · monitor_fetch'),
    );
    const createButtonAfterStart = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        (collectText(element).includes('创建作业') || collectText(element).includes('正在创建作业...')),
    );

    expect(retrySystemQueueJobAction).toHaveBeenCalledWith(11, undefined);
    expect(enqueueSystemQueueJobAction).not.toHaveBeenCalled();
    expect(cancelButtonAfterStart?.getAttribute('disabled')).toBe('');
    expect(createButtonAfterStart?.getAttribute('disabled')).toBe('');

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

  it('refreshes browser lane, browser handoff, and inbox reply handoff queries together with the main queue refresh action', async () => {
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
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
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
          loadInboxReplyHandoffsAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(loadSystemQueueAction).toHaveBeenCalledTimes(1);
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(1);
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(1);
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(1);

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
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live queue context visible while a queue reload is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const pendingReload = createDeferredPromise<{
      jobs: Array<{
        id: number;
        type: string;
        status: string;
        runAt: string;
        attempts: number;
        canRetry?: boolean;
        canCancel?: boolean;
      }>;
      queue: {
        pending: number;
        running: number;
        failed: number;
        duePending: number;
      };
      recentJobs: Array<{
        id: number;
        type: string;
        status: string;
        runAt: string;
        attempts: number;
      }>;
    }>();
    const loadSystemQueueAction = vi
      .fn()
      .mockResolvedValueOnce({
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
          running: 0,
          failed: 1,
          duePending: 1,
        },
        recentJobs: [],
      })
      .mockImplementationOnce(() => pendingReload.promise);
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

    const refreshButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新队列'),
    );

    expect(refreshButton).not.toBeNull();
    expect(collectText(container)).toContain('#11 · publish');

    await act(async () => {
      refreshButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadSystemQueueAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('正在加载 system queue...');
    expect(collectText(container)).toContain('#11 · publish');
    expect(collectText(container)).not.toContain('当前没有 system jobs。');

    await act(async () => {
      pendingReload.resolve({
        jobs: [
          {
            id: 12,
            type: 'monitor_fetch',
            status: 'pending',
            runAt: '2026-04-19T12:20:00.000Z',
            attempts: 2,
            canRetry: false,
            canCancel: true,
          },
        ],
        queue: {
          pending: 1,
          running: 0,
          failed: 0,
          duePending: 0,
        },
        recentJobs: [],
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live browser lane, browser handoff, and inbox reply handoff entries visible while their reloads are pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SystemQueuePage } = await import('../../src/client/pages/SystemQueue');

    const pendingBrowserLaneReload = createDeferredPromise<{
      requests: Array<{
        channelAccountId: number;
        platform: string;
        accountKey: string;
        action: string;
        jobStatus: string;
        requestedAt: string;
        artifactPath: string;
        resolvedAt: string | null;
      }>;
      total: number;
    }>();
    const pendingBrowserHandoffReload = createDeferredPromise<{
      handoffs: Array<{
        channelAccountId?: number;
        accountDisplayName?: string;
        ownership?: string;
        platform: string;
        draftId: string;
        title: string | null;
        accountKey: string;
        status: string;
        artifactPath: string;
        createdAt: string;
        updatedAt: string;
        resolvedAt: string | null;
        resolution?: unknown;
      }>;
      total: number;
    }>();
    const pendingInboxReplyHandoffReload = createDeferredPromise<{
      handoffs: Array<{
        channelAccountId?: number;
        platform: string;
        itemId: string;
        source: string;
        title?: string | null;
        author?: string | null;
        accountKey: string;
        status: string;
        artifactPath: string;
        createdAt: string;
        updatedAt: string;
        resolvedAt: string | null;
        resolution?: unknown;
      }>;
      total: number;
    }>();
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
    const loadBrowserLaneRequestsAction = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [
          {
            channelAccountId: 7,
            platform: 'x',
            accountKey: 'acct-browser',
            action: 'request_session',
            jobStatus: 'pending',
            requestedAt: '2026-04-21T09:00:00.000Z',
            artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
            resolvedAt: null,
          },
        ],
        total: 1,
      })
      .mockImplementationOnce(() => pendingBrowserLaneReload.promise);
    const loadBrowserHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
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
            artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
            createdAt: '2026-04-21T09:10:00.000Z',
            updatedAt: '2026-04-21T09:20:00.000Z',
            resolvedAt: '2026-04-21T09:20:00.000Z',
            resolution: {
              status: 'resolved',
            },
          },
        ],
        total: 1,
      })
      .mockImplementationOnce(() => pendingBrowserHandoffReload.promise);
    const loadInboxReplyHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [
          {
            channelAccountId: 12,
            platform: 'reddit',
            itemId: '88',
            source: 'reddit',
            title: 'Need lower latency in APAC',
            author: 'user123',
            accountKey: 'reddit-main',
            status: 'resolved',
            artifactPath:
              'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
            createdAt: '2026-04-23T09:10:00.000Z',
            updatedAt: '2026-04-23T11:15:00.000Z',
            resolvedAt: '2026-04-23T11:15:00.000Z',
            resolution: {
              status: 'resolved',
              replyStatus: 'sent',
            },
          },
        ],
        total: 1,
      })
      .mockImplementationOnce(() => pendingInboxReplyHandoffReload.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SystemQueuePage as never, {
          loadSystemQueueAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
        }),
      );
      await flush();
      await flush();
    });

    const refreshButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新队列'),
    );

    expect(refreshButton).not.toBeNull();
    expect(collectText(container)).toContain('acct-browser');
    expect(collectText(container)).toContain('FB Group Manual');
    expect(collectText(container)).toContain('Need lower latency in APAC');

    await act(async () => {
      refreshButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(2);
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('正在加载 browser lane requests...');
    expect(collectText(container)).toContain('正在加载 browser handoffs...');
    expect(collectText(container)).toContain('正在加载 inbox reply handoffs...');
    expect(collectText(container)).toContain('acct-browser');
    expect(collectText(container)).toContain('FB Group Manual');
    expect(collectText(container)).toContain('Need lower latency in APAC');

    await act(async () => {
      pendingBrowserLaneReload.resolve({
        requests: [],
        total: 0,
      });
      pendingBrowserHandoffReload.resolve({
        handoffs: [],
        total: 0,
      });
      pendingInboxReplyHandoffReload.resolve({
        handoffs: [],
        total: 0,
      });
      await flush();
    });

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
