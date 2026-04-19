import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

function renderPage(
  Component: unknown,
  props: {
    stateOverride: {
      status: 'idle' | 'loading' | 'success' | 'error';
      data?: unknown;
      error?: string | null;
    };
  },
) {
  return renderToStaticMarkup(
    createElement(Component as (properties: typeof props) => React.JSX.Element, props),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dashboard enhanced metrics page', () => {
  it('renders the new inbox and channel-account metrics alongside loading and error feedback', async () => {
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

    expect(renderPage(DashboardPage, { stateOverride: { status: 'loading' } })).toContain('正在加载仪表盘');
    expect(
      renderPage(DashboardPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('仪表盘加载失败');

    const html = renderPage(DashboardPage, {
      stateOverride: {
        status: 'success',
        data: {
          monitor: {
            total: 3,
            new: 2,
            followUpDrafts: 1,
          },
          drafts: {
            total: 5,
            review: 2,
          },
          totals: {
            items: 8,
            followUps: 1,
          },
          inbox: {
            total: 4,
            unread: 3,
          },
          channelAccounts: {
            total: 2,
            connected: 1,
          },
        },
      },
    });

    expect(html).toContain('待处理私信');
    expect(html).toContain('健康账号');
  });
});
