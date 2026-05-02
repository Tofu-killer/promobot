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

type ApiState<TData> = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: TData;
  error?: string | null;
};

function renderPage(Component: unknown, props: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(Component as (properties: Record<string, unknown>) => React.JSX.Element, props),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectDisabledButton(html: string, label: string) {
  expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*>${escapeRegExp(label)}</button>`));
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

function findAllElements(
  root: unknown,
  predicate: (element: HTMLElement) => boolean,
): HTMLElement[] {
  const matches: HTMLElement[] = [];

  function visit(node: unknown) {
    if (!node || typeof node !== 'object') {
      return;
    }

    const maybeElement = node as HTMLElement & { childNodes?: unknown[] };
    if (typeof maybeElement.tagName === 'string' && predicate(maybeElement)) {
      matches.push(maybeElement);
    }

    const childNodes = Array.isArray(maybeElement.childNodes) ? maybeElement.childNodes : [];
    for (const childNode of childNodes) {
      visit(childNode);
    }
  }

  visit(root);
  return matches;
}

function hasAncestorTag(element: HTMLElement, tagName: string) {
  let current = (element as HTMLElement & { parentNode?: unknown }).parentNode;

  while (current && typeof current === 'object') {
    const maybeElement = current as HTMLElement & { parentNode?: unknown };
    if (typeof maybeElement.tagName === 'string' && maybeElement.tagName === tagName) {
      return true;
    }
    current = maybeElement.parentNode;
  }

  return false;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Inbox action wiring', () => {
  it('posts inbox fetch through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 7,
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Need lower latency in APAC',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
        inserted: 1,
        total: 1,
        unread: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.fetchInboxRequest).toBe('function');

    const fetchInboxRequest = inboxModule.fetchInboxRequest as () => Promise<{ inserted: number; unread: number }>;
    const result = await fetchInboxRequest();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inbox/fetch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.inserted).toBe(1);
    expect(result.unread).toBe(1);
  });

  it('posts inbox fetch with projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [],
        inserted: 3,
        total: 3,
        unread: 2,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.fetchInboxRequest).toBe('function');

    const fetchInboxRequest = inboxModule.fetchInboxRequest as (projectId?: number) => Promise<{ inserted: number; unread: number }>;
    const result = await fetchInboxRequest(7);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inbox/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 7 }),
      }),
    );
    expect(result.inserted).toBe(3);
    expect(result.unread).toBe(2);
  });

  it('posts queued inbox fetch jobs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        job: {
          id: 13,
          type: 'inbox_fetch',
          status: 'pending',
          runAt: '2026-04-20T09:15:00.000Z',
          attempts: 0,
        },
        runtime: {
          available: true,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.enqueueInboxFetchJobRequest).toBe('function');

    const enqueueInboxFetchJobRequest = inboxModule.enqueueInboxFetchJobRequest as (
      runAt?: string,
    ) => Promise<{ job: { id: number; type: string; runAt: string } }>;

    const result = await enqueueInboxFetchJobRequest('2026-04-20T09:15:00.000Z');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inbox_fetch',
          payload: {},
          runAt: '2026-04-20T09:15:00.000Z',
        }),
      }),
    );
    expect(result.job.id).toBe(13);
    expect(result.job.type).toBe('inbox_fetch');
  });

  it('posts queued inbox fetch jobs with projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        job: {
          id: 14,
          type: 'inbox_fetch',
          status: 'pending',
          runAt: '2026-04-20T09:20:00.000Z',
          attempts: 0,
        },
        runtime: {
          available: true,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.enqueueInboxFetchJobRequest).toBe('function');

    const enqueueInboxFetchJobRequest = inboxModule.enqueueInboxFetchJobRequest as (
      runAt?: string,
      projectId?: number,
    ) => Promise<{ job: { id: number; type: string; runAt: string } }>;

    const result = await enqueueInboxFetchJobRequest('2026-04-20T09:20:00.000Z', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inbox_fetch',
          payload: { projectId: 7 },
          runAt: '2026-04-20T09:20:00.000Z',
        }),
      }),
    );
    expect(result.job.id).toBe(14);
    expect(result.job.type).toBe('inbox_fetch');
  });

  it.each([
    ['handled', '/api/inbox/7'],
    ['snoozed', '/api/inbox/7'],
  ] as const)('patches inbox item status as %s through the shared API helper', async (status, endpoint) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        item: {
          id: 7,
          source: 'reddit',
          status,
          author: 'user123',
          title: 'Need lower latency in APAC',
          excerpt: 'Can you share current response times?',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.updateInboxItemRequest).toBe('function');

    const updateInboxItemRequest = inboxModule.updateInboxItemRequest as (
      id: number,
      nextStatus: string,
    ) => Promise<{ item: { id: number; status: string } }>;

    const result = await updateInboxItemRequest(7, status);

    expect(fetchMock).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    );
    expect(result.item.status).toBe(status);
  });

  it('posts AI reply generation through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        suggestion: {
          reply: 'Thanks for flagging this. We can share current APAC latency benchmarks.',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.suggestInboxReplyRequest).toBe('function');

    const suggestInboxReplyRequest = inboxModule.suggestInboxReplyRequest as (
      id: number,
    ) => Promise<{ suggestion: { reply: string } }>;

    const result = await suggestInboxReplyRequest(7);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inbox/7/suggest-reply',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.suggestion.reply).toContain('APAC latency');
  });

  it('posts inbox send-reply through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        item: {
          id: 7,
          source: 'v2ex',
          status: 'needs_reply',
          author: 'alice',
          title: 'Cursor API follow-up',
          excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
        delivery: {
          success: false,
          status: 'manual_required',
          mode: 'manual',
          message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
          reply: 'Manual follow-up reply.',
          details: {
            manualReplyAssistant: {
              platform: 'v2ex',
              label: 'V2EX',
              copyText: 'Manual follow-up reply.',
              sourceUrl: 'https://www.v2ex.com/t/888888',
              openUrl: 'https://www.v2ex.com/t/888888',
              title: 'Cursor API follow-up',
            },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.sendInboxReplyRequest).toBe('function');

    const sendInboxReplyRequest = inboxModule.sendInboxReplyRequest as (
      id: number,
      reply: string,
    ) => Promise<{
      item: { id: number; status: string };
      delivery: {
        success: boolean;
        status: 'sent' | 'manual_required' | 'failed';
        mode: 'api' | 'browser' | 'manual';
        message: string;
        details?: {
          manualReplyAssistant?: {
            platform?: string;
            label?: string;
            copyText?: string;
            sourceUrl?: string;
            openUrl?: string;
            title?: string;
          };
        };
      };
    }>;

    const result = await sendInboxReplyRequest(7, 'Manual follow-up reply.');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inbox/7/send-reply',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: 'Manual follow-up reply.' }),
      }),
    );
    expect(result.item.status).toBe('needs_reply');
    expect(result.delivery.success).toBe(false);
    expect(result.delivery.status).toBe('manual_required');
    expect(result.delivery.mode).toBe('manual');
    expect(result.delivery.message).toBe('V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.');
    expect(result.delivery.details?.manualReplyAssistant).toEqual({
      platform: 'v2ex',
      label: 'V2EX',
      copyText: 'Manual follow-up reply.',
      sourceUrl: 'https://www.v2ex.com/t/888888',
      openUrl: 'https://www.v2ex.com/t/888888',
      title: 'Cursor API follow-up',
    });
  });

  it('renders inbox action success and error feedback', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      inboxUpdateStateOverride: {
        status: 'success',
        data: {
          item: {
            id: 7,
            source: 'reddit',
            status: 'handled',
            author: 'user123',
            title: 'Need lower latency in APAC',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        },
      } satisfies ApiState<unknown>,
      replySuggestionStateOverride: {
        status: 'error',
        error: 'AI gateway timeout',
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('已将“Need lower latency in APAC”回写为 handled');
    expect(html).toContain('生成回复失败：AI gateway timeout');
    expect(html).toContain('handled');
  });

  it('renders the generated inbox reply suggestion when available', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      replySuggestionStateOverride: {
        status: 'success',
        data: {
          suggestion: {
            reply: 'Thanks for flagging this. We can share current APAC latency benchmarks.',
          },
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('已生成最新回复建议');
    expect(html).toContain('Thanks for flagging this. We can share current APAC latency benchmarks.');
  });

  it('clears stale inbox reply suggestions after selecting a different item', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const suggestReplyAction = vi.fn().mockResolvedValue({
      suggestion: {
        reply: 'Reply for item A only.',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'x',
                  status: 'needs_reply',
                  author: 'ops-team',
                  title: 'Question about billing caps',
                  excerpt: 'How do monthly usage caps work?',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
          suggestReplyAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('当前会话：reddit · user123');

    const generateReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('AI 生成回复'),
    );

    await act(async () => {
      generateReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(suggestReplyAction).toHaveBeenCalledWith(7);
    expect(collectText(container)).toContain('已生成最新回复建议');
    expect(collectText(container)).toContain('Reply for item A only.');

    const secondItem = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Question about billing caps'),
    );

    expect(secondItem).not.toBeNull();

    await act(async () => {
      secondItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('当前会话：x · ops-team');
    expect(collectText(container)).not.toContain('已生成最新回复建议');
    expect(collectText(container)).not.toContain('Reply for item A only.');
    expect(collectText(container)).toContain('点击“AI 生成回复”后，这里会展示最新的 AI 草稿。');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live inbox context visible while a reload is pending after a successful status update', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const pendingReload = createDeferredPromise<{
      items: Array<{
        id: number;
        source: string;
        status: string;
        author: string;
        title: string;
        excerpt: string;
        createdAt: string;
      }>;
      total: number;
      unread: number;
    }>();
    const loadInboxAction = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 7,
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Need lower latency in APAC',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      })
      .mockImplementationOnce(() => pendingReload.promise);
    const updateInboxAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'handled',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          loadInboxAction,
          updateInboxAction,
        }),
      );
      await flush();
      await flush();
    });

    const handledButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );

    expect(handledButton).not.toBeNull();
    expect(collectText(container)).toContain('Need lower latency in APAC');

    await act(async () => {
      handledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateInboxAction).toHaveBeenCalledWith(7, 'handled');
    expect(loadInboxAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('Need lower latency in APAC');
    expect(collectText(container)).toContain('已将“Need lower latency in APAC”回写为 handled');
    expect(collectText(container)).not.toContain('预览数据不可回写状态或生成回复。');

    await act(async () => {
      pendingReload.resolve({
        items: [
          {
            id: 7,
            source: 'reddit',
            status: 'handled',
            author: 'user123',
            title: 'Need lower latency in APAC',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
        total: 1,
        unread: 0,
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps inbox loading feedback bound to the original item when another item is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const pendingUpdate = createDeferredPromise<{
      item: {
        id: number;
        source: string;
        status: string;
        author: string;
        title: string;
        excerpt: string;
        createdAt: string;
      };
    }>();
    const updateInboxAction = vi.fn().mockReturnValue(pendingUpdate.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'x',
                  status: 'needs_reply',
                  author: 'ops-team',
                  title: 'Question about billing caps',
                  excerpt: 'How do monthly usage caps work?',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
          updateInboxAction,
        }),
      );
      await flush();
    });

    const firstArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Need lower latency in APAC'),
    );
    const secondArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Question about billing caps'),
    );
    const firstHandledButton = findElement(
      firstArticle as never,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );

    expect(firstArticle).not.toBeNull();
    expect(secondArticle).not.toBeNull();
    expect(firstHandledButton).not.toBeNull();

    await act(async () => {
      firstHandledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstArticleAfterStart = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Need lower latency in APAC'),
    );
    const secondArticleAfterStart = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Question about billing caps'),
    );

    expect(updateInboxAction).toHaveBeenCalledWith(7, 'handled');
    expect(collectText(firstArticleAfterStart as never)).toContain('处理中...');
    expect(collectText(secondArticleAfterStart as never)).not.toContain('处理中...');

    await act(async () => {
      secondArticle?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstArticleAfterSwitch = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Need lower latency in APAC'),
    );
    const secondArticleAfterSwitch = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Question about billing caps'),
    );

    expect(collectText(firstArticleAfterSwitch as never)).toContain('处理中...');
    expect(collectText(secondArticleAfterSwitch as never)).not.toContain('处理中...');

    await act(async () => {
      pendingUpdate.resolve({
        item: {
          id: 7,
          source: 'reddit',
          status: 'handled',
          author: 'user123',
          title: 'Need lower latency in APAC',
          excerpt: 'Can you share current response times?',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale inbox loading feedback after switching project scope with the same item id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const pendingUpdate = createDeferredPromise<{
      item: {
        id: number;
        source: string;
        status: string;
        author: string;
        title: string;
        excerpt: string;
        createdAt: string;
      };
    }>();
    const projectBInboxState = {
      items: [
        {
          id: 7,
          source: 'x',
          status: 'needs_reply',
          author: 'ops-team',
          title: 'Project B inbox thread',
          excerpt: 'How do monthly usage caps work?',
          createdAt: '2026-04-19T10:05:00.000Z',
        },
      ],
      total: 1,
      unread: 1,
    };
    const loadInboxAction = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 7,
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Project A inbox thread',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      })
      .mockResolvedValue(projectBInboxState);
    const updateInboxAction = vi.fn().mockReturnValue(pendingUpdate.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          loadInboxAction,
          updateInboxAction,
        }),
      );
      await flush();
      await flush();
    });

    const handledButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );
    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(handledButton).not.toBeNull();
    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      handledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateInboxAction).toHaveBeenCalledWith(7, 'handled');
    expect(collectText(container)).toContain('处理中...');

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
      await flush();
    });

    expect(loadInboxAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B inbox thread');
    expect(collectText(container)).not.toContain('处理中...');

    await act(async () => {
      pendingUpdate.resolve({
        item: {
          id: 7,
          source: 'reddit',
          status: 'handled',
          author: 'user123',
          title: 'Project A inbox thread',
          excerpt: 'Can you share current response times?',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale inbox reply suggestions after switching project scope with the same item id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const loadInboxAction = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 7,
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Project A inbox thread',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 7,
            source: 'x',
            status: 'needs_reply',
            author: 'ops-team',
            title: 'Project B inbox thread',
            excerpt: 'How do monthly usage caps work?',
            createdAt: '2026-04-19T10:05:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      });
    const suggestReplyAction = vi.fn().mockResolvedValue({
      suggestion: {
        reply: 'Reply for project A only.',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          loadInboxAction,
          suggestReplyAction,
        }),
      );
      await flush();
      await flush();
    });

    const generateReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('AI 生成回复'),
    );
    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(generateReplyButton).not.toBeNull();
    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      generateReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(suggestReplyAction).toHaveBeenCalledWith(7);
    expect(collectText(container)).toContain('Reply for project A only.');

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
      await flush();
    });

    expect(loadInboxAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B inbox thread');
    expect(collectText(container)).not.toContain('Reply for project A only.');
    expect(collectText(container)).not.toContain('已生成最新回复建议');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders inbox preview data as read-only when live data has not loaded yet', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'idle',
      } satisfies ApiState<unknown>,
    });

    expectDisabledButton(html, 'AI 生成回复');
    expectDisabledButton(html, '标记已处理');
    expectDisabledButton(html, '稍后处理');
    expect(html).toContain('预览数据不可回写状态或生成回复。');
    expect(html).toContain('暂无可生成回复的会话');
    expect(html).not.toContain('当前会话：Reddit · preview-user');
  });

  it('disables AI reply generation when the inbox loads successfully with no items', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [],
          total: 0,
          unread: 0,
        },
      } satisfies ApiState<unknown>,
    });

    expectDisabledButton(html, 'AI 生成回复');
    expect(html).toContain('暂无可生成回复的会话');
    expect(html).toContain('收件箱为空，暂无可生成回复的会话。');
    expect(html).toContain('这里还没有真实收件箱会话');
    expect(html).toContain('前往 Settings 配置监控源');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('前往 Projects 配置 Source Config');
    expect(html).toContain('href="/projects"');
  });

  it('renders a real original-post link when the inbox item excerpt already includes a source URL', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt:
                'Can you share current response times?\n\nhttps://www.reddit.com/r/Promobot/comments/abc123/thread/',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('href="https://www.reddit.com/r/Promobot/comments/abc123/thread/"');
    expect(html).toContain('打开原帖');
    expect(html).not.toContain('原帖跳转暂未接入，请在源站手动打开。');
  });

  it('prefers a structured original-post sourceUrl when the excerpt does not include a link', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 8,
              source: 'v2ex',
              status: 'needs_reply',
              author: 'user456',
              title: 'Need a multi-region webhook retry queue',
              excerpt: 'The post body was imported without an inline source link.',
              createdAt: '2026-04-19T10:05:00.000Z',
              metadata: {
                sourceUrl: 'https://www.v2ex.com/t/888888',
              },
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('href="https://www.v2ex.com/t/888888"');
    expect(html).toContain('打开原帖');
    expect(html).not.toContain('原帖跳转暂未接入，请在源站手动打开。');
  });

  it('ignores a structured original-post sourceUrl when it is not an absolute http(s) URL', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 9,
              source: 'v2ex',
              status: 'needs_reply',
              author: 'user789',
              title: 'Unsafe source URL should stay inert',
              excerpt: 'The post body was imported without an inline source link.',
              createdAt: '2026-04-19T10:06:00.000Z',
              metadata: {
                sourceUrl: 'javascript:alert(1)',
              },
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain('原帖跳转暂未接入，请在源站手动打开。');
  });

  it('falls back to the excerpt link when a structured original-post sourceUrl is unsafe', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 10,
              source: 'v2ex',
              status: 'needs_reply',
              author: 'user999',
              title: 'Unsafe source URL should not hide the excerpt link',
              excerpt: 'Please keep the original topic link.\n\nhttps://www.v2ex.com/t/999999',
              createdAt: '2026-04-19T10:07:00.000Z',
              metadata: {
                sourceUrl: 'javascript:alert(1)',
              },
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain('href="https://www.v2ex.com/t/999999"');
    expect(html).toContain('打开原帖');
    expect(html).not.toContain('原帖跳转暂未接入，请在源站手动打开。');
  });

  it('filters inbox items by platform and status and keeps list metrics aligned with the current filter', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'x',
                  status: 'handled',
                  author: 'ops-team',
                  title: 'Billing caps answered',
                  excerpt: 'Already answered in-thread.',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
                {
                  id: 9,
                  source: 'reddit',
                  status: 'handled',
                  author: 'builder',
                  title: 'Reddit follow-up already sent',
                  excerpt: 'Manual reply delivered.',
                  createdAt: '2026-04-19T10:10:00.000Z',
                },
              ],
              total: 3,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
    });

    const redditPlatformFilter = findElement(
      container,
      (element) => element.getAttribute('data-inbox-filter-platform') === 'reddit',
    );
    const handledStatusFilter = findElement(
      container,
      (element) => element.getAttribute('data-inbox-filter-status') === 'handled',
    );

    expect(redditPlatformFilter).not.toBeNull();
    expect(handledStatusFilter).not.toBeNull();

    await act(async () => {
      redditPlatformFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(redditPlatformFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('Need lower latency in APAC');
    expect(collectText(container)).toContain('Reddit follow-up already sent');
    expect(collectText(container)).not.toContain('Billing caps answered');

    await act(async () => {
      handledStatusFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(handledStatusFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('Reddit follow-up already sent');
    expect(collectText(container)).not.toContain('Need lower latency in APAC');
    expect(collectText(container)).not.toContain('Billing caps answered');
    expect(collectText(container)).toContain('当前筛选下 1 条 / 总计 3 条收件箱记录');
    expect(collectText(container)).toContain('待处理会话1跨渠道统一排队视图');
    expect(collectText(container)).toContain('未读命中0等待人工回复或分流的记录');
    expect(collectText(container)).toContain('需人工接管0高价值或需要人工确认的会话');

    const needsReviewStatusFilter = findElement(
      container,
      (element) => element.getAttribute('data-inbox-filter-status') === 'needs_review',
    );

    expect(needsReviewStatusFilter).not.toBeNull();

    await act(async () => {
      needsReviewStatusFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('当前筛选下 0 条 / 总计 3 条收件箱记录');
    expect(collectText(container)).toContain('当前筛选下暂无命中内容');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('preserves the selected inbox item and reply draft when narrowing to matching filters', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'x',
                  status: 'needs_reply',
                  author: 'ops-team',
                  title: 'Question about billing caps',
                  excerpt: 'How do monthly usage caps work?',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
    });

    const firstItem = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Need lower latency in APAC'),
    );
    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');

    expect(firstItem).not.toBeNull();
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      firstItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      updateFieldValue(replyDraftField, 'Follow up with APAC numbers.', window);
      await flush();
    });

    const redditPlatformFilter = findElement(
      container,
      (element) => element.getAttribute('data-inbox-filter-platform') === 'reddit',
    );
    const needsReplyStatusFilter = findElement(
      container,
      (element) => element.getAttribute('data-inbox-filter-status') === 'needs_reply',
    );

    expect(redditPlatformFilter).not.toBeNull();
    expect(needsReplyStatusFilter).not.toBeNull();

    await act(async () => {
      redditPlatformFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      needsReplyStatusFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('当前会话：reddit · user123');
    expect(findElement(container, (element) => element.tagName === 'TEXTAREA')?.getAttribute('data-reply-draft')).toBe(
      'Follow up with APAC numbers.',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders an editable reply draft box and enabled apply-suggestion CTA when a suggestion is available', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      replySuggestionStateOverride: {
        status: 'success',
        data: {
          suggestion: {
            reply: 'Thanks for flagging this. We can share current APAC latency benchmarks.',
          },
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('回复草稿');
    expect(html).toContain('textarea');
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>应用建议（人工复制）<\/button>/);
  });

  it('shows browser handoff details and keeps the inbox item pending when browser delivery still needs manual follow-up', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Weibo reply requires the browser session to be refreshed before delivery.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            readiness: 'blocked',
            sessionAction: 'relogin',
            artifact: 'artifacts/browser-handoffs/weibo/acct-ops/inbox-reply-7.json',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledWith(7, 'Manual follow-up reply.');
    expect(collectText(container)).toContain('Weibo reply requires the browser session to be refreshed before delivery.');
    expect(collectText(container)).toContain('Handoff 状态：blocked');
    expect(collectText(container)).toContain('Handoff 动作：relogin');
    expect(collectText(container)).toContain('Handoff 路径：artifacts/browser-handoffs/weibo/acct-ops/inbox-reply-7.json');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).toBeNull();
    expect(collectText(container)).toContain('needs_reply');
    expect(collectText(container)).not.toContain('已将“Need lower latency in APAC”回写为 handled');
    const manualRequiredFeedback = findElement(
      container,
      (element) =>
        element.tagName === 'P' &&
        collectText(element).includes('Weibo reply requires the browser session to be refreshed before delivery.'),
    );
    expect(manualRequiredFeedback?.style.background).toBe('#fffbeb');
    expect(manualRequiredFeedback?.style.color).toBe('#92400e');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores a blocked persisted inbox reply handoff after reload and only allows queuing the required session action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'relogin',
        message: 'Browser relogin request queued for the restored inbox reply handoff.',
        artifactPath: 'artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'weibo',
                  status: 'needs_reply',
                  author: 'ops-user',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'weibo',
                  itemId: 7,
                  source: 'weibo',
                  title: 'Need lower latency in APAC',
                  author: 'ops-user',
                  accountKey: 'acct-ops',
                  channelAccountId: 12,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'relogin',
                  artifactPath: 'artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('等待刷新 Session 后继续回复接管。');
    expect(collectText(container)).toContain('Handoff 状态：blocked');
    expect(collectText(container)).toContain('Handoff 动作：relogin');
    expect(collectText(container)).toContain('Handoff 路径：artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).toBeNull();

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'),
    );
    expect(reloginButton).not.toBeNull();

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(12, {
      action: 'relogin',
    });
    expect(collectText(container)).toContain('Browser relogin request queued for the restored inbox reply handoff.');
    expect(collectText(container)).toContain('artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('reloads a blocked persisted inbox reply handoff after queuing the required session action and restores inline completion', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const inboxItem = {
      id: 7,
      source: 'weibo',
      status: 'needs_reply',
      author: 'ops-user',
      title: 'Need lower latency in APAC',
      excerpt: 'Can you share current response times?',
      createdAt: '2026-04-19T10:00:00.000Z',
    } as const;
    const loadInboxAction = vi.fn().mockResolvedValue({
      items: [inboxItem],
      total: 1,
      unread: 1,
    });
    const loadInboxReplyHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [
          {
            platform: 'weibo',
            itemId: 7,
            source: 'weibo',
            title: 'Need lower latency in APAC',
            author: 'ops-user',
            accountKey: 'acct-ops',
            channelAccountId: 12,
            status: 'pending',
            readiness: 'blocked',
            sessionAction: 'relogin',
            artifactPath: 'artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json',
            handoffAttempt: 1,
            createdAt: '2026-04-24T10:00:00.000Z',
            updatedAt: '2026-04-24T10:00:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        handoffs: [
          {
            platform: 'weibo',
            itemId: 7,
            source: 'weibo',
            title: 'Need lower latency in APAC',
            author: 'ops-user',
            accountKey: 'acct-ops',
            channelAccountId: 12,
            status: 'pending',
            readiness: 'ready',
            sessionAction: null,
            artifactPath: 'artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json',
            handoffAttempt: 2,
            createdAt: '2026-04-24T10:00:00.000Z',
            updatedAt: '2026-04-24T10:05:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      })
      .mockResolvedValue({
        handoffs: [],
        total: 0,
      });
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'relogin',
        message: 'Browser relogin request queued for the restored inbox reply handoff.',
        artifactPath: 'artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json',
      },
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'weibo',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://weibo.com/messages/7',
      externalId: null,
      message: 'reply sent manually after relogin reload',
      deliveredAt: '2026-04-24T10:10:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          loadInboxAction,
          loadInboxReplyHandoffsAction,
          requestChannelAccountSessionAction,
          completeInboxReplyHandoffAction,
          stateOverride: {
            status: 'success',
            data: {
              items: [inboxItem],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
      await flush();
      await flush();
    });

    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('等待刷新 Session 后继续回复接管。');
    expect(collectText(container)).toContain('Handoff 状态：blocked');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).toBeNull();

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'),
    );
    expect(reloginButton).not.toBeNull();

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(12, {
      action: 'relogin',
    });
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).toContain('Handoff 状态：ready');
    expect(collectText(container)).toContain('Handoff 路径：artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'))).toBeNull();

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(deliveryUrlInput as never, 'https://weibo.com/messages/7', window as never);
      updateFieldValue(messageInput as never, 'reply sent manually after relogin reload', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/weibo/acct-ops/weibo-item-7.json',
      handoffAttempt: 2,
      replyStatus: 'sent',
      deliveryUrl: 'https://weibo.com/messages/7',
      message: 'reply sent manually after relogin reload',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('queues the requested browser session action directly from the inbox manual-required feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const createBlockedWeiboReply = () => ({
      item: {
        id: 7,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Weibo reply requires the browser session to be refreshed before manual handoff.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'weibo',
            channelAccountId: 12,
            accountKey: 'acct-ops',
            readiness: 'blocked',
            sessionAction: 'relogin',
          },
        },
      },
    });
    const sendReplyAction = vi.fn().mockImplementation(async () => createBlockedWeiboReply());
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'relogin',
        message:
          'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
        artifactPath: 'artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'weibo',
                  status: 'needs_reply',
                  author: 'ops-user',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'),
    );
    expect(reloginButton).not.toBeNull();

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(12, {
      action: 'relogin',
    });
    expect(collectText(container)).toContain(
      'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
    );
    expect(collectText(container)).toContain(
      'artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('queues the requested browser session action for instagram inbox handoffs without relying on weibo-specific ui state', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const createBlockedInstagramReply = () => ({
      item: {
        id: 8,
        source: 'instagram',
        status: 'needs_review',
        author: 'creator-ops',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Instagram reply requires the browser session to be refreshed before manual handoff.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'instagram',
            channelAccountId: 18,
            accountKey: 'ig-ops',
            readiness: 'blocked',
            sessionAction: 'relogin',
          },
        },
      },
    });
    const sendReplyAction = vi.fn().mockImplementation(async () => createBlockedInstagramReply());
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'relogin',
        message: 'Browser relogin request queued for Instagram.',
        artifactPath: 'artifacts/browser-lane-requests/instagram/ig-ops/relogin-job-18.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 8,
                  source: 'instagram',
                  status: 'needs_review',
                  author: 'creator-ops',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain(
      'Instagram reply requires the browser session to be refreshed before manual handoff.',
    );
    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'),
    );
    expect(reloginButton).not.toBeNull();

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(18, {
      action: 'relogin',
    });
    expect(collectText(container)).toContain('Browser relogin request queued for Instagram.');
    expect(collectText(container)).toContain(
      'artifacts/browser-lane-requests/instagram/ig-ops/relogin-job-18.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale browser session request feedback when a new manual-required inbox reply result arrives', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const createBlockedWeiboReply = () => ({
      item: {
        id: 7,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Weibo reply requires the browser session to be refreshed before manual handoff.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'weibo',
            channelAccountId: 12,
            accountKey: 'acct-ops',
            readiness: 'blocked',
            sessionAction: 'relogin',
          },
        },
      },
    });
    const sendReplyAction = vi.fn().mockImplementation(async () => createBlockedWeiboReply());
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'relogin',
        message: 'Browser relogin request queued.',
        artifactPath: 'artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'weibo',
                  status: 'needs_reply',
                  author: 'ops-user',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'),
    );
    expect(reloginButton).not.toBeNull();

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Browser relogin request queued.');
    expect(collectText(container)).toContain('artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json');

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledTimes(2);
    expect(requestChannelAccountSessionAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).not.toContain('Browser relogin request queued.');
    expect(collectText(container)).not.toContain('artifacts/browser-lane-requests/weibo/acct-ops/relogin-job-17.json');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps request-session feedback scoped to the original inbox item when another blocked handoff is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'request_session',
        message: 'Browser session request queued for the X inbox handoff.',
        artifactPath: 'artifacts/browser-lane-requests/x/x-browser-main/request-session-job-17.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'x',
                  status: 'needs_reply',
                  author: 'routerwatch',
                  title: 'Project A inbox thread',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'weibo',
                  status: 'needs_reply',
                  author: 'ops-user',
                  title: 'Project B inbox thread',
                  excerpt: 'How do monthly usage caps work?',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'x',
                  itemId: 7,
                  source: 'x',
                  title: 'Project A inbox thread',
                  author: 'routerwatch',
                  accountKey: 'x-browser-main',
                  channelAccountId: 15,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'request_session',
                  artifactPath: 'artifacts/inbox-reply-handoffs/x/x-browser-main/x-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
                {
                  platform: 'weibo',
                  itemId: 8,
                  source: 'weibo',
                  title: 'Project B inbox thread',
                  author: 'ops-user',
                  accountKey: 'weibo-ops',
                  channelAccountId: 18,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'relogin',
                  artifactPath: 'artifacts/inbox-reply-handoffs/weibo/weibo-ops/weibo-item-8.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:05:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 2,
            },
          } satisfies ApiState<unknown>,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('等待补充 Session 后继续回复接管。');
    const requestSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('请求登录'),
    );
    expect(requestSessionButton).not.toBeNull();

    await act(async () => {
      requestSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(15, {
      action: 'request_session',
    });
    expect(collectText(container)).toContain('Browser session request queued for the X inbox handoff.');
    expect(collectText(container)).toContain(
      'artifacts/browser-lane-requests/x/x-browser-main/request-session-job-17.json',
    );

    const secondItem = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Project B inbox thread'),
    );
    expect(secondItem).not.toBeNull();

    await act(async () => {
      secondItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('等待刷新 Session 后继续回复接管。');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'))).not.toBeNull();
    expect(collectText(container)).not.toContain('Browser session request queued for the X inbox handoff.');
    expect(collectText(container)).not.toContain(
      'artifacts/browser-lane-requests/x/x-browser-main/request-session-job-17.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps a pending session-action result scoped to the original inbox item when another blocked handoff is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const pendingSessionAction = createDeferredPromise<{
      sessionAction: {
        action: 'relogin';
        message: string;
        artifactPath: string | null;
      };
    }>();
    const requestChannelAccountSessionAction = vi.fn().mockImplementation(() => pendingSessionAction.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'weibo',
                  status: 'needs_reply',
                  author: 'ops-user',
                  title: 'Project A inbox thread',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'x',
                  status: 'needs_reply',
                  author: 'routerwatch',
                  title: 'Project B inbox thread',
                  excerpt: 'How do monthly usage caps work?',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'weibo',
                  itemId: 7,
                  source: 'weibo',
                  title: 'Project A inbox thread',
                  author: 'ops-user',
                  accountKey: 'weibo-ops',
                  channelAccountId: 18,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'relogin',
                  artifactPath: 'artifacts/inbox-reply-handoffs/weibo/weibo-ops/weibo-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
                {
                  platform: 'x',
                  itemId: 8,
                  source: 'x',
                  title: 'Project B inbox thread',
                  author: 'routerwatch',
                  accountKey: 'x-browser-main',
                  channelAccountId: 15,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'request_session',
                  artifactPath: 'artifacts/inbox-reply-handoffs/x/x-browser-main/x-item-8.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:05:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 2,
            },
          } satisfies ApiState<unknown>,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('等待刷新 Session 后继续回复接管。');
    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'),
    );
    expect(reloginButton).not.toBeNull();

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(18, {
      action: 'relogin',
    });

    const secondItem = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Project B inbox thread'),
    );
    expect(secondItem).not.toBeNull();

    await act(async () => {
      secondItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('等待补充 Session 后继续回复接管。');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('请求登录'))).not.toBeNull();

    await act(async () => {
      pendingSessionAction.resolve({
        sessionAction: {
          action: 'relogin',
          message: 'Browser relogin request queued for Project A.',
          artifactPath: 'artifacts/browser-lane-requests/weibo/weibo-ops/relogin-job-17.json',
        },
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).not.toContain('Browser relogin request queued for Project A.');
    expect(collectText(container)).not.toContain('artifacts/browser-lane-requests/weibo/weibo-ops/relogin-job-17.json');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('请求登录'))).not.toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('hides browser handoff follow-up actions after the operator switches to another inbox item', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Weibo reply requires the browser session to be refreshed before manual handoff.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'weibo',
            channelAccountId: 12,
            accountKey: 'acct-ops',
            readiness: 'blocked',
            sessionAction: 'relogin',
            artifactPath: 'artifacts/browser-handoffs/weibo/acct-ops/inbox-reply-7.json',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'weibo',
                  status: 'needs_reply',
                  author: 'ops-user',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 8,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Billing caps answered',
                  excerpt: 'How do monthly usage caps work?',
                  createdAt: '2026-04-19T10:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Handoff 路径：artifacts/browser-handoffs/weibo/acct-ops/inbox-reply-7.json');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'))).not.toBeNull();

    const secondItem = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Billing caps answered'),
    );
    expect(secondItem).not.toBeNull();

    await act(async () => {
      secondItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Weibo reply requires the browser session to be refreshed before manual handoff.');
    expect(collectText(container)).not.toContain('Handoff 路径：artifacts/browser-handoffs/weibo/acct-ops/inbox-reply-7.json');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'))).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('completes a ready inbox reply handoff directly from the inbox feedback and updates the local item status', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt: 1,
          },
        },
      },
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
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
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'reply sent manually',
    });
    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');
    expect(collectText(container)).toContain('handled');
    expect(collectText(container)).not.toContain('needs_reply');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores a ready persisted inbox reply handoff after reload and allows completing it inline', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually after reload',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).toContain('Handoff 状态：ready');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
    );

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
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
      updateFieldValue(messageInput as never, 'reply sent manually after reload', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'reply sent manually after reload',
    });
    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually after reload');
    expect(collectText(container)).toContain('handled');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('loads persisted inbox reply handoffs live when only inbox items use a state override and clears them after reload', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const inboxItem = {
      id: 8,
      source: 'reddit',
      status: 'needs_reply',
      author: 'user456',
      title: 'Need publish ETA',
      excerpt: 'Can you share the publish ETA?',
      createdAt: '2026-04-19T10:00:00.000Z',
    } as const;
    const loadInboxAction = vi.fn().mockResolvedValue({
      items: [inboxItem],
      total: 1,
      unread: 1,
    });
    const loadInboxReplyHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [
          {
            platform: 'reddit',
            itemId: 8,
            source: 'reddit',
            title: 'Need publish ETA',
            author: 'user456',
            accountKey: 'reddit-main',
            channelAccountId: 9,
            status: 'pending',
            readiness: 'ready',
            sessionAction: null,
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-8.json',
            handoffAttempt: 1,
            createdAt: '2026-04-24T10:00:00.000Z',
            updatedAt: '2026-04-24T10:00:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      })
      .mockResolvedValue({
        handoffs: [],
        total: 0,
      });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-8.json',
      itemId: 8,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/eta-8',
      externalId: null,
      message: 'reply sent from the live reload path',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          loadInboxAction,
          loadInboxReplyHandoffsAction,
          completeInboxReplyHandoffAction,
          stateOverride: {
            status: 'success',
            data: {
              items: [inboxItem],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
      await flush();
      await flush();
    });

    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-8.json',
    );

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );

    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/eta-8',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent from the live reload path', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-8.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/eta-8',
      message: 'reply sent from the live reload path',
    });
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).not.toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).not.toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-8.json',
    );
    expect(collectText(container)).not.toContain('已结单 inbox reply item #8 (handled)');

    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('刷新收件箱'),
    );
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).not.toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).not.toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-8.json',
    );
    expect(collectText(container)).not.toContain('已结单 inbox reply item #8 (handled)');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).toBeNull();
    expect(collectText(container)).toContain('needs_reply');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('does not let an older blocked persisted inbox reply handoff hide a newer immediate ready attempt', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt: 2,
          },
        },
      },
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/new-attempt',
      externalId: null,
      message: 'reply sent from the newest attempt',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'relogin',
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-23T10:00:00.000Z',
                  updatedAt: '2026-04-23T10:00:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Reddit reply is ready for manual browser handoff with the saved session.');
    expect(collectText(container)).toContain('Handoff 状态：ready');
    expect(collectText(container)).not.toContain('Handoff 动作：relogin');

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/new-attempt',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent from the newest attempt', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      handoffAttempt: 2,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/new-attempt',
      message: 'reply sent from the newest attempt',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the local inbox reply handoff completion state when the same attempt is restored from persisted data', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt: 1,
          },
        },
      },
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    const baseProps = {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      sendReplyAction,
      completeInboxReplyHandoffAction,
    };

    await act(async () => {
      root.render(createElement(InboxPage as never, baseProps));
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');

    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          ...baseProps,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('prefers persisted inbox reply handoff truth when the same attempt is restored with a blocked readiness', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt: 1,
          },
        },
      },
    });

    const root = createRoot(container as never);
    const initialProps = {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      sendReplyAction,
    };

    await act(async () => {
      root.render(createElement(InboxPage as never, initialProps));
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Reddit reply is ready for manual browser handoff with the saved session.');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).not.toBeNull();

    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          ...initialProps,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'relogin',
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('等待刷新 Session 后继续回复接管。');
    expect(collectText(container)).toContain('Handoff 状态：blocked');
    expect(collectText(container)).toContain('Handoff 动作：relogin');
    expect(collectText(container)).not.toContain(
      'Reddit reply is ready for manual browser handoff with the saved session.',
    );
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).toBeNull();
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新登录'))).not.toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('completes a ready persisted inbox reply handoff without requiring a handoff attempt', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
    );
    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(deliveryUrlInput as never, 'https://reddit.com/message/messages/abc123', window as never);
      updateFieldValue(messageInput as never, 'reply sent manually', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      message: 'reply sent manually',
    });
    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('uses a numeric-string persisted handoff attempt when completing a ready inbox reply handoff', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/attempt-2',
      externalId: null,
      message: 'reply sent manually from numeric string attempt',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: '2',
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/attempt-2',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent manually from numeric string attempt', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      handoffAttempt: 2,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/attempt-2',
      message: 'reply sent manually from numeric string attempt',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale inbox reply handoff completion feedback when a new manual-required result arrives for the same item', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const createReadyRedditReply = (handoffAttempt: number) => ({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt,
          },
        },
      },
    });
    let nextHandoffAttempt = 0;
    const sendReplyAction = vi.fn().mockImplementation(async () => {
      nextHandoffAttempt += 1;
      return createReadyRedditReply(nextHandoffAttempt);
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
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
    });

    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const freshMarkSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(sendReplyAction).toHaveBeenCalledTimes(2);
    expect(completeInboxReplyHandoffAction).toHaveBeenCalledTimes(1);
    expect(freshMarkSentButton).not.toBeNull();
    expect(collectText(container)).not.toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).not.toContain('reply sent manually');
    expect(collectText(container)).toContain('needs_reply');

    await act(async () => {
      freshMarkSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenNthCalledWith(2, {
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      handoffAttempt: 2,
      replyStatus: 'sent',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale inbox reply handoff completion feedback when a new legacy manual-required result arrives for the same item', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const createReadyRedditReply = () => ({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
          },
        },
      },
    });
    const sendReplyAction = vi.fn().mockImplementation(async () => createReadyRedditReply());
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/legacy',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const freshMarkSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(sendReplyAction).toHaveBeenCalledTimes(2);
    expect(completeInboxReplyHandoffAction).toHaveBeenCalledTimes(1);
    expect(freshMarkSentButton).not.toBeNull();
    expect(collectText(container)).not.toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).not.toContain('reply sent manually');

    await act(async () => {
      freshMarkSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenNthCalledWith(2, {
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      replyStatus: 'sent',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores a new persisted inbox reply handoff attempt after local completion without keeping the old completion state', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt: 1,
          },
        },
      },
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    const baseProps = {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      sendReplyAction,
      completeInboxReplyHandoffAction,
    };

    await act(async () => {
      root.render(createElement(InboxPage as never, baseProps));
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(deliveryUrlInput as never, 'https://reddit.com/message/messages/abc123', window as never);
      updateFieldValue(messageInput as never, 'reply sent manually', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');

    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          ...baseProps,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: 2,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).not.toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).not.toContain('reply sent manually');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).not.toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores a new persisted legacy inbox reply handoff after local completion without keeping the old completion state', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
          },
        },
      },
    });
    const completeInboxReplyHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      itemId: 7,
      itemStatus: 'handled',
      platform: 'reddit',
      mode: 'browser',
      status: 'sent',
      success: true,
      deliveryUrl: 'https://reddit.com/message/messages/abc123',
      externalId: null,
      message: 'reply sent manually',
      deliveredAt: '2026-04-23T11:15:00.000Z',
    });

    const root = createRoot(container as never);
    const baseProps = {
      stateOverride: {
        status: 'success',
        data: {
          items: [
            {
              id: 7,
              source: 'reddit',
              status: 'needs_reply',
              author: 'user123',
              title: 'Need lower latency in APAC',
              excerpt: 'Can you share current response times?',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
          total: 1,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
      sendReplyAction,
      completeInboxReplyHandoffAction,
    };

    await act(async () => {
      root.render(createElement(InboxPage as never, baseProps));
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(deliveryUrlInput as never, 'https://reddit.com/message/messages/abc123', window as never);
      updateFieldValue(messageInput as never, 'reply sent manually', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).toContain('reply sent manually');

    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          ...baseProps,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Need lower latency in APAC',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          } satisfies ApiState<unknown>,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).not.toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).not.toContain('reply sent manually');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).not.toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores stale inbox reply handoff completion success when the operator retries before the first completion resolves', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const inboxItems = [
      {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
    ];
    const createReadyRedditReply = () => ({
      item: {
        ...inboxItems[0],
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'browser',
        message: 'Reddit reply is ready for manual browser handoff with the saved session.',
        reply: 'Manual follow-up reply.',
        details: {
          browserReplyHandoff: {
            platform: 'reddit',
            channelAccountId: 9,
            accountKey: 'reddit-main',
            readiness: 'ready',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
            handoffAttempt: 1,
          },
        },
      },
    });
    const loadInboxAction = vi.fn().mockResolvedValue({
      items: inboxItems,
      total: 1,
      unread: 1,
    });
    const pendingCompletion = createDeferredPromise<{
      ok: boolean;
      imported: boolean;
      artifactPath: string;
      itemId: number;
      itemStatus: string;
      platform: string;
      mode: string;
      status: string;
      success: boolean;
      deliveryUrl: string | null;
      externalId: string | null;
      message: string;
      deliveredAt: string | null;
    }>();
    const sendReplyAction = vi.fn().mockImplementation(async () => createReadyRedditReply());
    const completeInboxReplyHandoffAction = vi.fn().mockImplementation(() => pendingCompletion.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          loadInboxAction,
          stateOverride: {
            status: 'success',
            data: {
              items: inboxItems,
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(replyDraftField).not.toBeNull();
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledTimes(2);
    expect(completeInboxReplyHandoffAction).toHaveBeenCalledTimes(1);
    expect(
      findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送')),
    ).not.toBeNull();

    await act(async () => {
      pendingCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
        itemId: 7,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/abc123',
        externalId: null,
        message: 'reply sent manually',
        deliveredAt: '2026-04-23T11:15:00.000Z',
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).not.toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).not.toContain('reply sent manually');
    expect(collectText(container)).toContain('needs_reply');
    expect(
      findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送')),
    ).not.toBeNull();
    expect(loadInboxAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps a pending inbox reply handoff completion scoped to the original item when another ready handoff is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const inboxItems = [
      {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Project A inbox thread',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      {
        id: 8,
        source: 'reddit',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Project B inbox thread',
        excerpt: 'How do monthly usage caps work?',
        createdAt: '2026-04-19T10:05:00.000Z',
      },
    ];
    const pendingCompletion = createDeferredPromise<{
      ok: boolean;
      imported: boolean;
      artifactPath: string;
      itemId: number;
      itemStatus: string;
      platform: string;
      mode: string;
      status: string;
      success: boolean;
      deliveryUrl: string | null;
      externalId: string | null;
      message: string;
      deliveredAt: string | null;
    }>();
    const completeInboxReplyHandoffAction = vi.fn().mockImplementation(() => pendingCompletion.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: inboxItems,
              total: 2,
              unread: 2,
            },
          } satisfies ApiState<unknown>,
          replyHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'reddit',
                  itemId: 7,
                  source: 'reddit',
                  title: 'Project A inbox thread',
                  author: 'user123',
                  accountKey: 'reddit-main',
                  channelAccountId: 9,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:00:00.000Z',
                  updatedAt: '2026-04-24T10:00:00.000Z',
                  resolvedAt: null,
                },
                {
                  platform: 'reddit',
                  itemId: 8,
                  source: 'reddit',
                  title: 'Project B inbox thread',
                  author: 'ops-user',
                  accountKey: 'reddit-secondary',
                  channelAccountId: 11,
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-secondary/reddit-item-8.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-24T10:05:00.000Z',
                  updatedAt: '2026-04-24T10:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 2,
            },
          } satisfies ApiState<unknown>,
          completeInboxReplyHandoffAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 Inbox reply handoff，可以直接结单。');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
    );

    const deliveryUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'deliveryUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-inbox-reply-handoff-field') === 'message',
    );
    const markSentButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'),
    );
    expect(deliveryUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(markSentButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        deliveryUrlInput as never,
        'https://reddit.com/message/messages/project-a',
        window as never,
      );
      updateFieldValue(messageInput as never, 'reply sent manually for Project A', window as never);
      await flush();
    });

    await act(async () => {
      markSentButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(completeInboxReplyHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: 'https://reddit.com/message/messages/project-a',
      message: 'reply sent manually for Project A',
    });

    const secondItem = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Project B inbox thread'),
    );
    expect(secondItem).not.toBeNull();

    await act(async () => {
      secondItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/inbox-reply-handoffs/reddit/reddit-secondary/reddit-item-8.json',
    );
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).not.toBeNull();

    await act(async () => {
      pendingCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-7.json',
        itemId: 7,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/project-a',
        externalId: null,
        message: 'reply sent manually for Project A',
        deliveredAt: '2026-04-23T11:15:00.000Z',
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).not.toContain('已结单 inbox reply item #7 (handled)');
    expect(collectText(container)).not.toContain('reply sent manually for Project A');
    expect(collectText(container)).not.toContain('https://reddit.com/message/messages/project-a');
    expect(findElement(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已发送'))).not.toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows manual reply assistant actions for v2ex manual delivery follow-up', async () => {
    const { container, window } = installMinimalDom();
    const openWindow = vi.fn();
    window.open = openWindow as never;
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'alice',
        title: 'Cursor API follow-up',
        excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'manual',
        message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
        reply: 'Manual follow-up reply.',
        details: {
          manualReplyAssistant: {
            platform: 'v2ex',
            label: 'V2EX',
            copyText: 'Manual follow-up reply.',
            sourceUrl: 'https://www.v2ex.com/t/888888',
            openUrl: 'https://www.v2ex.com/t/888888',
            title: 'Cursor API follow-up',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'v2ex',
                  status: 'needs_reply',
                  author: 'alice',
                  title: 'Cursor API follow-up',
                  excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledWith(7, 'Manual follow-up reply.');
    expect(collectText(container)).toContain('V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.');
    expect(collectText(container)).toContain('手工回复辅助：V2EX');
    expect(collectText(container)).toContain('复制回复');
    expect(collectText(container)).toContain('打开原帖');
    expect(collectText(container)).toContain('needs_reply');
    expect(collectText(container)).not.toContain('已将“Cursor API follow-up”回写为 handled');

    const openPostButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('打开原帖'),
    );
    expect(openPostButton).not.toBeNull();

    await act(async () => {
      openPostButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(openWindow).toHaveBeenCalledWith('https://www.v2ex.com/t/888888', '_blank', 'noopener,noreferrer');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('drops unsafe manual reply assistant open URLs from send-reply feedback', async () => {
    const { container, window } = installMinimalDom();
    const openWindow = vi.fn();
    window.open = openWindow as never;
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'alice',
        title: 'Cursor API follow-up',
        excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'manual',
        message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
        reply: 'Manual follow-up reply.',
        details: {
          manualReplyAssistant: {
            platform: 'v2ex',
            label: 'V2EX',
            copyText: 'Manual follow-up reply.',
            openUrl: 'javascript:alert(1)',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'v2ex',
                  status: 'needs_reply',
                  author: 'alice',
                  title: 'Cursor API follow-up',
                  excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('手工回复辅助：V2EX');
    expect(collectText(container)).toContain('复制回复');
    expect(container.innerHTML ?? '').not.toContain('javascript:alert(1)');
    expect(
      findAllElements(container, (element) => element.tagName === 'BUTTON' && collectText(element).includes('打开原帖')),
    ).toHaveLength(0);
    expect(openWindow).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('falls back to a safe manual reply assistant sourceUrl when openUrl is unsafe', async () => {
    const { container, window } = installMinimalDom();
    const openWindow = vi.fn();
    window.open = openWindow as never;
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 8,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'bob',
        title: 'Fallback source URL should stay usable',
        excerpt: 'Please share the updated API latency numbers.',
        createdAt: '2026-04-19T10:01:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'manual',
        message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
        reply: 'Manual follow-up reply.',
        details: {
          manualReplyAssistant: {
            platform: 'v2ex',
            label: 'V2EX',
            copyText: 'Manual follow-up reply.',
            sourceUrl: 'https://www.v2ex.com/t/999999',
            openUrl: 'javascript:alert(1)',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 8,
                  source: 'v2ex',
                  status: 'needs_reply',
                  author: 'bob',
                  title: 'Fallback source URL should stay usable',
                  excerpt: 'Please share the updated API latency numbers.',
                  createdAt: '2026-04-19T10:01:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const openPostButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('打开原帖'),
    );
    expect(openPostButton).not.toBeNull();
    expect(container.innerHTML ?? '').not.toContain('javascript:alert(1)');

    await act(async () => {
      openPostButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(openWindow).toHaveBeenCalledWith('https://www.v2ex.com/t/999999', '_blank', 'noopener,noreferrer');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('copies the manual reply assistant text when the operator requests it', async () => {
    const { container, window } = installMinimalDom();
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    window.navigator.clipboard = { writeText: clipboardWriteText } as never;
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'alice',
        title: 'Cursor API follow-up',
        excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'manual',
        message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
        reply: 'Manual follow-up reply.',
        details: {
          manualReplyAssistant: {
            platform: 'v2ex',
            label: 'V2EX',
            copyText: 'Manual follow-up reply.',
            openUrl: 'https://www.v2ex.com/t/888888',
          },
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'v2ex',
                  status: 'needs_reply',
                  author: 'alice',
                  title: 'Cursor API follow-up',
                  excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const copyReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('复制回复'),
    );
    expect(copyReplyButton).not.toBeNull();

    await act(async () => {
      copyReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(clipboardWriteText).toHaveBeenCalledWith('Manual follow-up reply.');
    expect(collectText(container)).toContain('已复制回复内容');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('marks a manual reply assistant item handled directly from the inbox feedback and clears the stale manual-required prompt', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'v2ex',
        status: 'needs_reply',
        author: 'alice',
        title: 'Cursor API follow-up',
        excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'manual_required',
        mode: 'manual',
        message: 'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
        reply: 'Manual follow-up reply.',
        details: {
          manualReplyAssistant: {
            platform: 'v2ex',
            label: 'V2EX',
            copyText: 'Manual follow-up reply.',
            sourceUrl: 'https://www.v2ex.com/t/888888',
            openUrl: 'https://www.v2ex.com/t/888888',
            title: 'Cursor API follow-up',
          },
        },
      },
    });
    const updateInboxAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'v2ex',
        status: 'handled',
        author: 'alice',
        title: 'Cursor API follow-up',
        excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'v2ex',
                  status: 'needs_reply',
                  author: 'alice',
                  title: 'Cursor API follow-up',
                  excerpt: 'Can you share current response times?\n\nhttps://www.v2ex.com/t/888888',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
          updateInboxAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const markHandledButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );
    expect(markHandledButton).not.toBeNull();

    await act(async () => {
      markHandledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateInboxAction).toHaveBeenCalledWith(7, 'handled');
    expect(collectText(container)).toContain('已将“Cursor API follow-up”回写为 handled');
    expect(collectText(container)).toContain('handled');
    expect(collectText(container)).not.toContain('needs_reply');
    expect(collectText(container)).not.toContain(
      'V2EX reply is ready for assisted manual delivery. Copy the reply and open the topic.',
    );
    expect(collectText(container)).not.toContain('手工回复辅助：V2EX');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows failed delivery feedback without marking the inbox item handled when reply delivery fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'needs_reply',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: false,
        status: 'failed',
        mode: 'api',
        message: 'missing reddit credentials: configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD',
        reply: 'Manual follow-up reply.',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledWith(7, 'Manual follow-up reply.');
    expect(collectText(container)).toContain(
      'missing reddit credentials: configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD',
    );
    expect(collectText(container)).toContain('needs_reply');
    expect(collectText(container)).not.toContain('已将“Need lower latency in APAC”回写为 handled');
    const failedFeedback = findElement(
      container,
      (element) =>
        element.tagName === 'P' &&
        collectText(element).includes('missing reddit credentials: configure REDDIT_CLIENT_ID'),
    );
    expect(failedFeedback?.style.background).toBe('#fef2f2');
    expect(failedFeedback?.style.color).toBe('#b91c1c');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps reply delivery feedback visible when the active status filter hides the handled item', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockResolvedValue({
      item: {
        id: 7,
        source: 'reddit',
        status: 'handled',
        author: 'user123',
        title: 'Need lower latency in APAC',
        excerpt: 'Can you share current response times?',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      delivery: {
        success: true,
        status: 'sent',
        mode: 'api',
        message: 'Reddit reply sent to https://www.reddit.com/r/promobot/comments/abc123/need_lower_latency_in_apac/.',
        reply: 'Manual follow-up reply.',
        deliveryUrl: 'https://www.reddit.com/r/promobot/comments/abc123/need_lower_latency_in_apac/reply123/',
        externalId: 'reply123',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const needsReplyFilter = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-inbox-filter-status') === 'needs_reply',
    );
    expect(needsReplyFilter).not.toBeNull();

    await act(async () => {
      needsReplyFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledWith(7, 'Manual follow-up reply.');
    expect(collectText(container)).toContain(
      'Reddit reply sent to https://www.reddit.com/r/promobot/comments/abc123/need_lower_latency_in_apac/.',
    );
    expect(collectText(container)).toContain('已将“Need lower latency in APAC”回写为 handled');
    expect(collectText(container)).toContain('当前筛选下暂无命中内容');
    const sentFeedback = findElement(
      container,
      (element) =>
        element.tagName === 'P' &&
        collectText(element).includes('Reddit reply sent to https://www.reddit.com/r/promobot/comments/abc123/need_lower_latency_in_apac/.'),
    );
    expect(sentFeedback?.style.background).toBe('#ecfdf5');
    expect(sentFeedback?.style.color).toBe('#166534');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows transport errors when the reply request rejects', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const sendReplyAction = vi.fn().mockRejectedValue(new Error('network timeout'));

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(InboxPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'user123',
                  title: 'Need lower latency in APAC',
                  excerpt: 'Can you share current response times?',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            },
          } satisfies ApiState<unknown>,
          sendReplyAction,
        }),
      );
      await flush();
    });

    const replyDraftField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect(replyDraftField).not.toBeNull();

    await act(async () => {
      updateFieldValue(replyDraftField, 'Manual follow-up reply.', window);
      await flush();
    });

    const sendReplyButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发送回复'),
    );
    expect(sendReplyButton).not.toBeNull();

    await act(async () => {
      sendReplyButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendReplyAction).toHaveBeenCalledWith(7, 'Manual follow-up reply.');
    expect(collectText(container)).toContain('发送回复失败：network timeout');
    expect(collectText(container)).toContain('needs_reply');
    expect(collectText(container)).not.toContain('已将“Need lower latency in APAC”回写为 handled');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders inbox fetch feedback when available', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [],
          total: 0,
          unread: 0,
        },
      } satisfies ApiState<unknown>,
      fetchStateOverride: {
        status: 'success',
        data: {
          items: [],
          inserted: 2,
          total: 2,
          unread: 1,
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('已抓取 2 条收件箱命中，未读 1');
    expect(html).toContain('抓取新命中');
    expect(html).toContain('项目 ID（可选）');
  });

  it('renders inbox queue feedback when available', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [],
          total: 0,
          unread: 0,
        },
      } satisfies ApiState<unknown>,
      enqueueStateOverride: {
        status: 'success',
        data: {
          job: {
            id: 13,
            type: 'inbox_fetch',
            status: 'pending',
            runAt: '2026-04-20T09:15:00.000Z',
            attempts: 0,
          },
          runtime: {
            available: true,
          },
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('加入队列 / 定时抓取');
    expect(html).toContain('计划抓取时间（可选）');
    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('已将收件箱抓取加入队列，job #13');
    expect(html).toContain('2026-04-20T09:15:00.000Z');
  });

  it('renders inbox queue failure feedback when available', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    const html = renderPage(InboxPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [],
          total: 0,
          unread: 0,
        },
      } satisfies ApiState<unknown>,
      enqueueStateOverride: {
        status: 'error',
        error: 'scheduler runtime unavailable',
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('收件箱排程失败：scheduler runtime unavailable');
  });
});

describe('Reputation action wiring', () => {
  it('posts reputation fetch through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 4,
            source: 'x',
            sentiment: 'negative',
            status: 'escalate',
            title: 'Session expired complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
        inserted: 1,
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.fetchReputationRequest).toBe('function');

    const fetchReputationRequest = reputationModule.fetchReputationRequest as () => Promise<{ inserted: number; total: number }>;
    const result = await fetchReputationRequest();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reputation/fetch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.inserted).toBe(1);
    expect(result.total).toBe(1);
  });

  it('posts reputation fetch with projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [],
        inserted: 4,
        total: 9,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.fetchReputationRequest).toBe('function');

    const fetchReputationRequest = reputationModule.fetchReputationRequest as (projectId?: number) => Promise<{
      inserted: number;
      total: number;
    }>;
    const result = await fetchReputationRequest(7);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reputation/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 7 }),
      }),
    );
    expect(result.inserted).toBe(4);
    expect(result.total).toBe(9);
  });

  it('posts queued reputation fetch jobs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        job: {
          id: 17,
          type: 'reputation_fetch',
          status: 'pending',
          runAt: '2026-04-20T09:30:00.000Z',
          attempts: 0,
        },
        runtime: {
          available: true,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.enqueueReputationFetchJobRequest).toBe('function');

    const enqueueReputationFetchJobRequest = reputationModule.enqueueReputationFetchJobRequest as (
      runAt?: string,
    ) => Promise<{ job: { id: number; type: string; runAt: string } }>;

    const result = await enqueueReputationFetchJobRequest('2026-04-20T09:30:00.000Z');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reputation_fetch',
          payload: {},
          runAt: '2026-04-20T09:30:00.000Z',
        }),
      }),
    );
    expect(result.job.id).toBe(17);
    expect(result.job.type).toBe('reputation_fetch');
  });

  it('posts queued reputation fetch jobs with projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        job: {
          id: 18,
          type: 'reputation_fetch',
          status: 'pending',
          runAt: '2026-04-20T09:35:00.000Z',
          attempts: 0,
        },
        runtime: {
          available: true,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.enqueueReputationFetchJobRequest).toBe('function');

    const enqueueReputationFetchJobRequest = reputationModule.enqueueReputationFetchJobRequest as (
      runAt?: string,
      projectId?: number,
    ) => Promise<{ job: { id: number; type: string; runAt: string } }>;

    const result = await enqueueReputationFetchJobRequest('2026-04-20T09:35:00.000Z', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reputation_fetch',
          payload: { projectId: 7 },
          runAt: '2026-04-20T09:35:00.000Z',
        }),
      }),
    );
    expect(result.job.id).toBe(18);
    expect(result.job.type).toBe('reputation_fetch');
  });

  it.each(['handled', 'escalate'] as const)(
    'patches reputation item status as %s through the shared API helper',
    async (status) => {
    const responseBody =
      status === 'escalate'
        ? {
            item: {
              id: 4,
              source: 'x',
              sentiment: 'negative',
              status,
              title: 'Session expired complaint',
              detail: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
            inboxItem: {
              id: 9,
              source: 'x',
              status: 'needs_review',
              title: 'Session expired complaint',
              excerpt: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:05:00.000Z',
            },
          }
        : {
            item: {
              id: 4,
              source: 'x',
              sentiment: 'negative',
              status,
              title: 'Session expired complaint',
              detail: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(responseBody),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.updateReputationItemRequest).toBe('function');

    const updateReputationItemRequest = reputationModule.updateReputationItemRequest as (
      id: number,
      nextStatus: string,
    ) => Promise<{ item: { id: number; status: string }; inboxItem?: { id: number; status: string } }>;

    const result = await updateReputationItemRequest(4, status);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reputation/4',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    );
    expect(result.item.status).toBe(status);
    if (status === 'escalate') {
      expect(result.inboxItem).toEqual(
        expect.objectContaining({
          id: 9,
          status: 'needs_review',
        }),
      );
    }
    },
  );

  it('renders reputation action success and error feedback', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 1,
          positive: 0,
          neutral: 0,
          negative: 1,
          trend: [
            { label: '正向', value: 0 },
            { label: '中性', value: 0 },
            { label: '负向', value: 1 },
          ],
          items: [
            {
              id: 4,
              source: 'x',
              sentiment: 'negative',
              status: 'escalate',
              title: 'Session expired complaint',
              detail: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
        },
      } satisfies ApiState<unknown>,
      reputationUpdateStateOverride: {
        status: 'error',
        error: 'reputation item not found',
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('口碑状态更新失败：reputation item not found');

    for (const status of ['handled', 'escalate'] as const) {
      const successResponse =
        status === 'escalate'
          ? {
              item: {
                id: 4,
                source: 'x',
                sentiment: 'negative',
                status,
                title: 'Session expired complaint',
                detail: 'Users report being logged out unexpectedly.',
                createdAt: '2026-04-19T10:00:00.000Z',
              },
              inboxItem: {
                id: 9,
                source: 'x',
                status: 'needs_review',
                title: 'Session expired complaint',
                excerpt: 'Users report being logged out unexpectedly.',
                createdAt: '2026-04-19T10:05:00.000Z',
              },
            }
          : {
              item: {
                id: 4,
                source: 'x',
                sentiment: 'negative',
                status,
                title: 'Session expired complaint',
                detail: 'Users report being logged out unexpectedly.',
                createdAt: '2026-04-19T10:00:00.000Z',
              },
            };
      const successHtml = renderPage(ReputationPage, {
        stateOverride: {
          status: 'success',
          data: {
            total: 1,
            positive: 0,
            neutral: 0,
            negative: 1,
            trend: [
              { label: '正向', value: 0 },
              { label: '中性', value: 0 },
              { label: '负向', value: 1 },
            ],
            items: [
              {
                id: 4,
                source: 'x',
                sentiment: 'negative',
                status: 'new',
                title: 'Session expired complaint',
                detail: 'Users report being logged out unexpectedly.',
                createdAt: '2026-04-19T10:00:00.000Z',
              },
            ],
          },
        } satisfies ApiState<unknown>,
        reputationUpdateStateOverride: {
          status: 'success',
          data: successResponse,
        } satisfies ApiState<unknown>,
      });

      expect(successHtml).toContain(`已将“Session expired complaint”回写为 ${status}`);
      expect(successHtml).toContain(`x · ${status} · 2026-04-19T10:00:00.000Z`);
      if (status === 'escalate') {
        expect(successHtml).toContain('已转入 Social Inbox');
        expect(successHtml).toContain('inbox #9');
        expect(successHtml).toContain('needs_review');
      }
    }
  });

  it('keeps reputation loading feedback bound to the original item when another item is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const pendingUpdate = createDeferredPromise<{
      item: {
        id: number;
        source: string;
        sentiment: 'negative';
        status: string;
        title: string;
        detail: string;
        createdAt: string;
      };
    }>();
    const updateReputationAction = vi.fn().mockReturnValue(pendingUpdate.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReputationPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              total: 2,
              positive: 0,
              neutral: 0,
              negative: 2,
              trend: [
                { label: '正向', value: 0 },
                { label: '中性', value: 0 },
                { label: '负向', value: 2 },
              ],
              items: [
                {
                  id: 4,
                  source: 'x',
                  sentiment: 'negative',
                  status: 'new',
                  title: 'Session expired complaint',
                  detail: 'Users report being logged out unexpectedly.',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 5,
                  source: 'reddit',
                  sentiment: 'negative',
                  status: 'new',
                  title: 'Pricing feedback thread',
                  detail: 'Prospects think the pricing page is unclear.',
                  createdAt: '2026-04-19T10:30:00.000Z',
                },
              ],
            },
          } satisfies ApiState<unknown>,
          updateReputationAction,
        }),
      );
      await flush();
    });

    const headerHandledButton =
      findAllElements(
        container,
        (element) =>
          element.tagName === 'BUTTON' &&
          collectText(element).includes('标记已处理') &&
          !hasAncestorTag(element, 'ARTICLE'),
      )[0] ?? null;
    const firstArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Session expired complaint'),
    );
    const secondArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Pricing feedback thread'),
    );

    expect(headerHandledButton).not.toBeNull();
    expect(firstArticle).not.toBeNull();
    expect(secondArticle).not.toBeNull();

    await act(async () => {
      headerHandledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstArticleAfterStart = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Session expired complaint'),
    );
    const secondArticleAfterStart = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Pricing feedback thread'),
    );

    expect(updateReputationAction).toHaveBeenCalledWith(4, 'handled');
    expect(collectText(firstArticleAfterStart as never)).toContain('正在回写状态...');
    expect(collectText(secondArticleAfterStart as never)).not.toContain('正在回写状态...');

    await act(async () => {
      secondArticle?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstArticleAfterSwitch = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Session expired complaint'),
    );
    const secondArticleAfterSwitch = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Pricing feedback thread'),
    );

    expect(collectText(firstArticleAfterSwitch as never)).toContain('正在回写状态...');
    expect(collectText(secondArticleAfterSwitch as never)).not.toContain('正在回写状态...');

    await act(async () => {
      pendingUpdate.resolve({
        item: {
          id: 4,
          source: 'x',
          sentiment: 'negative',
          status: 'handled',
          title: 'Session expired complaint',
          detail: 'Users report being logged out unexpectedly.',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).not.toContain('已将“Session expired complaint”回写为 handled');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps reputation article loading feedback scoped per item when multiple updates overlap', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const firstPendingUpdate = createDeferredPromise<{
      item: {
        id: number;
        source: string;
        sentiment: 'negative';
        status: string;
        title: string;
        detail: string;
        createdAt: string;
      };
    }>();
    const secondPendingUpdate = createDeferredPromise<{
      item: {
        id: number;
        source: string;
        sentiment: 'negative';
        status: string;
        title: string;
        detail: string;
        createdAt: string;
      };
    }>();
    const updateReputationAction = vi
      .fn()
      .mockReturnValueOnce(firstPendingUpdate.promise)
      .mockReturnValueOnce(secondPendingUpdate.promise);
    const reputationState = {
      total: 2,
      positive: 0,
      neutral: 0,
      negative: 2,
      trend: [
        { label: '正向', value: 0 },
        { label: '中性', value: 0 },
        { label: '负向', value: 2 },
      ],
      items: [
        {
          id: 4,
          source: 'x',
          sentiment: 'negative' as const,
          status: 'new',
          title: 'Session expired complaint',
          detail: 'Users report being logged out unexpectedly.',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
        {
          id: 5,
          source: 'reddit',
          sentiment: 'negative' as const,
          status: 'new',
          title: 'Pricing feedback thread',
          detail: 'Prospects think the pricing page is unclear.',
          createdAt: '2026-04-19T10:30:00.000Z',
        },
      ],
    };

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReputationPage as never, {
          loadReputationAction: async () => reputationState,
          stateOverride: {
            status: 'success',
            data: reputationState,
          } satisfies ApiState<unknown>,
          updateReputationAction,
        }),
      );
      await flush();
    });

    const firstArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Session expired complaint'),
    );
    const secondArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Pricing feedback thread'),
    );
    const firstHandledButton = findElement(
      firstArticle,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );
    const secondHandledButton = findElement(
      secondArticle,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );

    expect(firstArticle).not.toBeNull();
    expect(secondArticle).not.toBeNull();
    expect(firstHandledButton).not.toBeNull();
    expect(secondHandledButton).not.toBeNull();

    await act(async () => {
      firstHandledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateReputationAction).toHaveBeenNthCalledWith(1, 4, 'handled');
    expect(collectText(firstArticle as never)).toContain('正在回写状态...');
    expect(collectText(secondArticle as never)).not.toContain('正在回写状态...');

    await act(async () => {
      secondHandledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstArticleDuringOverlap = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Session expired complaint'),
    );
    const secondArticleDuringOverlap = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Pricing feedback thread'),
    );

    expect(updateReputationAction).toHaveBeenNthCalledWith(2, 5, 'handled');
    expect(collectText(firstArticleDuringOverlap as never)).toContain('正在回写状态...');
    expect(collectText(secondArticleDuringOverlap as never)).toContain('正在回写状态...');

    await act(async () => {
      firstPendingUpdate.resolve({
        item: {
          id: 4,
          source: 'x',
          sentiment: 'negative',
          status: 'handled',
          title: 'Session expired complaint',
          detail: 'Users report being logged out unexpectedly.',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      });
      secondPendingUpdate.resolve({
        item: {
          id: 5,
          source: 'reddit',
          sentiment: 'negative',
          status: 'handled',
          title: 'Pricing feedback thread',
          detail: 'Prospects think the pricing page is unclear.',
          createdAt: '2026-04-19T10:30:00.000Z',
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the reputation header action scoped to the selected item while another item is updating', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const pendingUpdate = createDeferredPromise<{
      item: {
        id: number;
        source: string;
        sentiment: 'negative';
        status: string;
        title: string;
        detail: string;
        createdAt: string;
      };
    }>();
    const updateReputationAction = vi.fn().mockReturnValue(pendingUpdate.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReputationPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              total: 2,
              positive: 0,
              neutral: 0,
              negative: 2,
              trend: [
                { label: '正向', value: 0 },
                { label: '中性', value: 0 },
                { label: '负向', value: 2 },
              ],
              items: [
                {
                  id: 4,
                  source: 'x',
                  sentiment: 'negative',
                  status: 'new',
                  title: 'Session expired complaint',
                  detail: 'Users report being logged out unexpectedly.',
                  createdAt: '2026-04-19T10:00:00.000Z',
                },
                {
                  id: 5,
                  source: 'reddit',
                  sentiment: 'negative',
                  status: 'new',
                  title: 'Pricing feedback thread',
                  detail: 'Prospects think the pricing page is unclear.',
                  createdAt: '2026-04-19T10:30:00.000Z',
                },
              ],
            },
          } satisfies ApiState<unknown>,
          updateReputationAction,
        }),
      );
      await flush();
    });

    const headerHandledButton =
      findAllElements(
        container,
        (element) =>
          element.tagName === 'BUTTON' &&
          collectText(element).includes('标记已处理') &&
          !hasAncestorTag(element, 'ARTICLE'),
      )[0] ?? null;
    const secondArticle = findElement(
      container,
      (element) => element.tagName === 'ARTICLE' && collectText(element).includes('Pricing feedback thread'),
    );

    expect(headerHandledButton).not.toBeNull();
    expect(secondArticle).not.toBeNull();

    await act(async () => {
      headerHandledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const headerHandledButtonAfterStart = findAllElements(container, (element) =>
      element.tagName === 'BUTTON' &&
      collectText(element).includes('正在回写状态...') &&
      !hasAncestorTag(element, 'ARTICLE'),
    )[0] ?? null;
    expect(headerHandledButtonAfterStart).not.toBeNull();
    expect(collectText(headerHandledButtonAfterStart as HTMLElement)).toContain('正在回写状态...');

    await act(async () => {
      secondArticle?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const headerHandledButtonAfterSwitch = findAllElements(container, (element) => {
      const text = collectText(element);
      return (
        element.tagName === 'BUTTON' &&
        (text.includes('标记已处理') || text.includes('正在回写状态...')) &&
        !hasAncestorTag(element, 'ARTICLE')
      );
    })[0] ?? null;

    expect(headerHandledButtonAfterSwitch).not.toBeNull();
    expect(collectText(headerHandledButtonAfterSwitch as HTMLElement)).toContain('标记已处理');

    await act(async () => {
      pendingUpdate.resolve({
        item: {
          id: 4,
          source: 'x',
          sentiment: 'negative',
          status: 'handled',
          title: 'Session expired complaint',
          detail: 'Users report being logged out unexpectedly.',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live reputation context visible while a reload is pending after a successful status update', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const pendingReload = createDeferredPromise<{
      total: number;
      positive: number;
      neutral: number;
      negative: number;
      trend: Array<{ label: string; value: number }>;
      items: Array<{
        id: number;
        source: string;
        sentiment: 'negative';
        status: string;
        title: string;
        detail: string;
        createdAt: string;
      }>;
    }>();
    const loadReputationAction = vi
      .fn()
      .mockResolvedValueOnce({
        total: 1,
        positive: 0,
        neutral: 0,
        negative: 1,
        trend: [
          { label: '正向', value: 0 },
          { label: '中性', value: 0 },
          { label: '负向', value: 1 },
        ],
        items: [
          {
            id: 4,
            source: 'x',
            sentiment: 'negative',
            status: 'new',
            title: 'Session expired complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
      })
      .mockImplementationOnce(() => pendingReload.promise);
    const updateReputationAction = vi.fn().mockResolvedValue({
      item: {
        id: 4,
        source: 'x',
        sentiment: 'negative',
        status: 'handled',
        title: 'Session expired complaint',
        detail: 'Users report being logged out unexpectedly.',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReputationPage as never, {
          loadReputationAction,
          updateReputationAction,
        }),
      );
      await flush();
      await flush();
    });

    const handledButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );

    expect(handledButton).not.toBeNull();
    expect(collectText(container)).toContain('Session expired complaint');

    await act(async () => {
      handledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateReputationAction).toHaveBeenCalledWith(4, 'handled');
    expect(loadReputationAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('Session expired complaint');
    expect(collectText(container)).toContain('已将“Session expired complaint”回写为 handled');
    expect(collectText(container)).not.toContain('预览数据不可回写口碑状态或转入 Social Inbox。');

    await act(async () => {
      pendingReload.resolve({
        total: 1,
        positive: 0,
        neutral: 0,
        negative: 1,
        trend: [
          { label: '正向', value: 0 },
          { label: '中性', value: 0 },
          { label: '负向', value: 1 },
        ],
        items: [
          {
            id: 4,
            source: 'x',
            sentiment: 'negative',
            status: 'handled',
            title: 'Session expired complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale reputation feedback after switching project scope with the same item id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const loadReputationAction = vi
      .fn()
      .mockResolvedValueOnce({
        total: 1,
        positive: 0,
        neutral: 0,
        negative: 1,
        trend: [
          { label: '正向', value: 0 },
          { label: '中性', value: 0 },
          { label: '负向', value: 1 },
        ],
        items: [
          {
            id: 4,
            source: 'x',
            sentiment: 'negative' as const,
            status: 'new',
            title: 'Project A complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 1,
        positive: 0,
        neutral: 0,
        negative: 1,
        trend: [
          { label: '正向', value: 0 },
          { label: '中性', value: 0 },
          { label: '负向', value: 1 },
        ],
        items: [
          {
            id: 4,
            source: 'x',
            sentiment: 'negative' as const,
            status: 'handled',
            title: 'Project A complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 1,
        positive: 0,
        neutral: 0,
        negative: 1,
        trend: [
          { label: '正向', value: 0 },
          { label: '中性', value: 0 },
          { label: '负向', value: 1 },
        ],
        items: [
          {
            id: 4,
            source: 'reddit',
            sentiment: 'negative' as const,
            status: 'new',
            title: 'Project B complaint',
            detail: 'Prospects think the pricing page is unclear.',
            createdAt: '2026-04-19T10:30:00.000Z',
          },
        ],
      });
    const updateReputationAction = vi.fn().mockResolvedValue({
      item: {
        id: 4,
        source: 'x',
        sentiment: 'negative',
        status: 'handled',
        title: 'Project A complaint',
        detail: 'Users report being logged out unexpectedly.',
        createdAt: '2026-04-19T10:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReputationPage as never, {
          loadReputationAction,
          updateReputationAction,
        }),
      );
      await flush();
      await flush();
    });

    const handledButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );
    expect(handledButton).not.toBeNull();

    await act(async () => {
      handledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updateReputationAction).toHaveBeenCalledWith(4, 'handled');
    expect(collectText(container)).toContain('已将“Project A complaint”回写为 handled');

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
      await flush();
    });

    expect(loadReputationAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B complaint');
    expect(collectText(container)).not.toContain('已将“Project A complaint”回写为 handled');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders reputation preview data as read-only when live data has not loaded yet', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'idle',
      } satisfies ApiState<unknown>,
    });

    expectDisabledButton(html, '标记已处理');
    expectDisabledButton(html, '转入 Social Inbox');
    expect(html).toContain('预览数据不可回写口碑状态或转入 Social Inbox。');
    expect(html).not.toContain('当前重点跟进项');
    expect(html).toContain('预览数据不可设为重点项');
  });

  it('renders setup guidance when the reputation workspace has no live mentions yet', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          trend: [],
          items: [],
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('这里还没有真实口碑提及');
    expect(html).toContain('前往 Settings 配置监控源');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('前往 Projects 配置 Source Config');
    expect(html).toContain('href="/projects"');
  });

  it('keeps the priority-empty reputation message when live mentions exist but none are negative', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 2,
          positive: 1,
          neutral: 1,
          negative: 0,
          trend: [
            { label: '正向', value: 1 },
            { label: '中性', value: 1 },
            { label: '负向', value: 0 },
          ],
          items: [
            {
              id: 18,
              source: 'reddit',
              sentiment: 'positive',
              status: 'handled',
              title: 'Praise for onboarding',
              detail: 'Users liked the new onboarding flow.',
              createdAt: '2026-04-19T11:00:00.000Z',
            },
            {
              id: 19,
              source: 'x',
              sentiment: 'neutral',
              status: 'new',
              title: 'Question about rollout timing',
              detail: 'No clear sentiment, mostly asking for dates.',
              createdAt: '2026-04-19T12:00:00.000Z',
            },
          ],
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('暂无重点负面提及');
    expect(html).not.toContain('这里还没有真实口碑提及');
  });

  it('normalizes reputation sentiment bars against total mentions before rendering percentages', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 5,
          positive: 2,
          neutral: 1,
          negative: 2,
          trend: [
            { label: '正向', value: 2 },
            { label: '中性', value: 1 },
            { label: '负向', value: 2 },
          ],
          items: [
            {
              id: 4,
              source: 'x',
              sentiment: 'negative',
              status: 'new',
              title: 'Session expired complaint',
              detail: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          ],
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('<strong>40%</strong>');
    expect(html).toContain('<strong>20%</strong>');
    expect(html).toContain('width:40%');
    expect(html).toContain('width:20%');
    expect(html).not.toContain('<strong>2%</strong>');
    expect(html).not.toContain('<strong>1%</strong>');
  });

  it('renders only negative mentions in the priority list and labels them as negative', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 3,
          positive: 1,
          neutral: 0,
          negative: 1,
          trend: [
            { label: '正向', value: 1 },
            { label: '中性', value: 0 },
            { label: '负向', value: 1 },
          ],
          items: [
            {
              id: 4,
              source: 'x',
              sentiment: 'negative',
              status: 'escalate',
              title: 'Session expired complaint',
              detail: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
            {
              id: 5,
              source: 'reddit',
              sentiment: 'mixed',
              status: 'new',
              title: 'Pricing feedback thread',
              detail: 'Some users like the new plan, others are confused by limits.',
              createdAt: '2026-04-19T12:00:00.000Z',
            },
          ],
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('Session expired complaint');
    expect(html).toContain('>负面<');
    expect(html).not.toContain('Pricing feedback thread');
    expect(html).not.toContain('>mixed<');
    expect(html).not.toContain('background:#fef3c7;color:#92400e');
  });

  it('renders reputation fetch feedback when available', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          trend: [],
          items: [],
        },
      } satisfies ApiState<unknown>,
      fetchStateOverride: {
        status: 'success',
        data: {
          items: [],
          inserted: 3,
          total: 5,
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('已抓取 3 条口碑提及，当前总数 5');
    expect(html).toContain('抓取新口碑');
    expect(html).toContain('项目 ID（可选）');
  });

  it('renders reputation queue feedback when available', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          trend: [],
          items: [],
        },
      } satisfies ApiState<unknown>,
      enqueueStateOverride: {
        status: 'success',
        data: {
          job: {
            id: 17,
            type: 'reputation_fetch',
            status: 'pending',
            runAt: '2026-04-20T09:30:00.000Z',
            attempts: 0,
          },
          runtime: {
            available: true,
          },
        },
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('加入队列 / 定时抓取');
    expect(html).toContain('计划抓取时间（可选）');
    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('已将口碑抓取加入队列，job #17');
    expect(html).toContain('2026-04-20T09:30:00.000Z');
  });

  it('renders reputation queue failure feedback when available', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    const html = renderPage(ReputationPage, {
      stateOverride: {
        status: 'success',
        data: {
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          trend: [],
          items: [],
        },
      } satisfies ApiState<unknown>,
      enqueueStateOverride: {
        status: 'error',
        error: 'scheduler runtime unavailable',
      } satisfies ApiState<unknown>,
    });

    expect(html).toContain('口碑排程失败：scheduler runtime unavailable');
  });
});
