import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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

describe('dashboard lifecycle metrics', () => {
  it('renders lifecycle stat cards in success state while preserving loading and error feedback', async () => {
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
            scheduled: 4,
            published: 9,
          },
          totals: {
            items: 8,
            followUps: 1,
          },
          publishLogs: {
            failedCount: 2,
          },
        },
      },
    });

    expect(html).toContain('待发布');
    expect(html).toContain('已发布');
    expect(html).toContain('发布失败');
    expect(html).toContain('4');
    expect(html).toContain('9');
    expect(html).toContain('2');
    expect(html).toContain('项目 ID（可选）');
  });

  it('falls back missing lifecycle metrics to zero when the dashboard response is partial', async () => {
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

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
            scheduled: 4,
          },
          totals: {
            items: 8,
            followUps: 1,
          },
        },
      },
    });

    expect(html).toContain('待发布');
    expect(html).toContain('已发布');
    expect(html).toContain('发布失败');
    expect(html).toContain('>4<');
    expect(html).toContain('>0<');
    expect(html).toContain('项目 ID（可选）');
  });
});
