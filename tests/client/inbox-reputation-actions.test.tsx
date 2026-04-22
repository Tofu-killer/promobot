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
  });

  it('renders the original-post CTA as a disabled manual handoff placeholder', async () => {
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
    });

    expectDisabledButton(html, '打开原帖（人工处理）');
    expect(html).toContain('原帖跳转暂未接入，请在源站手动打开。');
  });

  it('renders the apply-suggestion CTA as a disabled manual copy placeholder', async () => {
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

    expectDisabledButton(html, '应用建议（人工复制）');
    expect(html).toContain('当前仅提供 AI 草稿预览；应用建议和发送回复仍需人工处理。');
  });

  it('renders the send-reply CTA as a disabled not-wired placeholder', async () => {
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

    expectDisabledButton(html, '发送回复（暂未接线）');
    expect(html).toContain('当前仅提供 AI 草稿预览；应用建议和发送回复仍需人工处理。');
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

    const headerHandledButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('标记已处理'),
    );
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
