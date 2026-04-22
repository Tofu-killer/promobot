import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findElement, flush, installMinimalDom } from './settings-test-helpers';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
          monitorConfig: {
            directFeeds: 1,
            directQueries: 3,
            enabledSourceConfigs: 2,
            totalInputs: 6,
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
    expect(html).toContain('失败发布日志');
    expect(html).toContain('监控总输入');
    expect(html).toContain('累计线索');
    expect(html).toContain('4');
    expect(html).toContain('9');
    expect(html).toContain('2');
    expect(html).toContain('项目 ID（可选）');
  });

  it('surfaces missing lifecycle metrics as unavailable when the dashboard response is partial', async () => {
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
          monitorConfig: {
            directFeeds: 0,
            directQueries: 0,
            enabledSourceConfigs: 0,
            totalInputs: 0,
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
    expect(html).toContain('失败发布日志');
    expect(html).toContain('监控总输入');
    expect(html).toContain('累计线索');
    expect(html).toContain('>4<');
    expect(html).toContain('未提供');
    expect(html).toContain('项目 ID（可选）');
  });

  it('prefers a controlled projectId draft prop for scoped dashboard loads', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

    const loadDashboardAction = vi.fn().mockResolvedValue({
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
    });
    const onProjectIdDraftChange = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DashboardPage as never, {
          loadDashboardAction,
          projectIdDraft: ' 0012 ',
          onProjectIdDraftChange,
        }),
      );
      await flush();
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((projectIdInput as { value?: string } | null)?.value).toBe(' 0012 ');
    expect(loadDashboardAction).toHaveBeenLastCalledWith(12);

    await act(async () => {
      updateFieldValue(projectIdInput as never, ' 0042 ', window as never);
      await flush();
    });

    expect(onProjectIdDraftChange).toHaveBeenCalledWith(' 0042 ');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('does not fall back to an unscoped dashboard load when projectId is invalid', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

    const loadDashboardAction = vi.fn().mockResolvedValue({
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
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DashboardPage as never, {
          loadDashboardAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(loadDashboardAction).toHaveBeenCalledTimes(1);
    expect(loadDashboardAction).toHaveBeenLastCalledWith();

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    await act(async () => {
      updateFieldValue(projectIdInput as never, 'invalid-project-id', window as never);
      await flush();
      await flush();
    });

    expect(loadDashboardAction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('项目 ID 必须是大于 0 的整数');
    expect(container.textContent).not.toContain('仪表盘加载失败');

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
    });

    expect(loadDashboardAction).toHaveBeenCalledWith(12);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
