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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Inbox action wiring', () => {
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
});

describe('Reputation action wiring', () => {
  it.each(['handled', 'escalate'] as const)(
    'patches reputation item status as %s through the shared API helper',
    async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        item: {
          id: 4,
          source: 'x',
          sentiment: 'negative',
          status,
          title: 'Session expired complaint',
          detail: 'Users report being logged out unexpectedly.',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.updateReputationItemRequest).toBe('function');

    const updateReputationItemRequest = reputationModule.updateReputationItemRequest as (
      id: number,
      nextStatus: string,
    ) => Promise<{ item: { id: number; status: string } }>;

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
          data: {
            item: {
              id: 4,
              source: 'x',
              sentiment: 'negative',
              status,
              title: 'Session expired complaint',
              detail: 'Users report being logged out unexpectedly.',
              createdAt: '2026-04-19T10:00:00.000Z',
            },
          },
        } satisfies ApiState<unknown>,
      });

      expect(successHtml).toContain(`已将“Session expired complaint”回写为 ${status}`);
      expect(successHtml).toContain(`x · ${status} · 2026-04-19T10:00:00.000Z`);
    }
  });
});
