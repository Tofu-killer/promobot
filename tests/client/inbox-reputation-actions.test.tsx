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
