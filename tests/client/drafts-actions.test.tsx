import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Drafts publish actions', () => {
  it('filters drafts by status and keeps the visible count aligned with the filter', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 8,
          platform: 'x',
          title: 'Draft A',
          content: 'Draft body A',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
        {
          id: 9,
          platform: 'reddit',
          title: 'Review B',
          content: 'Draft body B',
          hashtags: ['#review'],
          status: 'review',
          createdAt: '2026-04-19T00:10:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      ],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
        }),
      );
      await flush();
      await flush();
    });

    const reviewFilter = findElement(
      container,
      (element) => element.getAttribute('data-drafts-status-filter') === 'review',
    );

    expect(reviewFilter).not.toBeNull();

    await act(async () => {
      reviewFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(reviewFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('当前筛选下 1 条 / 总计 2 条草稿');
    expect(collectText(container)).toContain('Review B');
    expect(collectText(container)).not.toContain('Draft A');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('batch publishes the selected drafts through the existing single-draft publish action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 8,
          platform: 'x',
          title: 'Draft A',
          content: 'Draft body A',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
        {
          id: 9,
          platform: 'reddit',
          title: 'Draft B',
          content: 'Draft body B',
          hashtags: ['#review'],
          status: 'draft',
          createdAt: '2026-04-19T00:10:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      ],
    });
    const publishDraftAction = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        status: 'published',
        publishUrl: 'https://x.com/promobot/status/8',
        message: 'Draft A published',
      })
      .mockResolvedValueOnce({
        success: false,
        status: 'queued',
        publishUrl: null,
        message: 'Queued for publishing',
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const selectFirst = findElement(
      container,
      (element) => element.getAttribute('data-drafts-select-id') === '8',
    );
    const selectSecond = findElement(
      container,
      (element) => element.getAttribute('data-drafts-select-id') === '9',
    );
    const batchPublishButton = findElement(
      container,
      (element) => element.getAttribute('data-drafts-batch-publish') === 'true',
    );

    expect(selectFirst).not.toBeNull();
    expect(selectSecond).not.toBeNull();
    expect(batchPublishButton).not.toBeNull();

    await act(async () => {
      selectFirst?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      selectSecond?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(selectFirst?.getAttribute('aria-pressed')).toBe('true');
    expect(selectSecond?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('已选 2 条草稿');

    await act(async () => {
      batchPublishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(publishDraftAction).toHaveBeenNthCalledWith(1, 8);
    expect(publishDraftAction).toHaveBeenNthCalledWith(2, 9);
    expect(collectText(container)).toContain('已批量处理 2 条草稿');
    expect(collectText(container)).toContain('Draft A published');
    expect(collectText(container)).toContain('Queued for publishing');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('batch moves the selected drafts into review through the existing single-draft update action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 18,
          platform: 'x',
          title: 'Draft A',
          content: 'Draft body A',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
        {
          id: 19,
          platform: 'reddit',
          title: 'Draft B',
          content: 'Draft body B',
          hashtags: ['#review'],
          status: 'draft',
          createdAt: '2026-04-19T00:10:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      ],
    });
    const updateDraftAction = vi
      .fn()
      .mockResolvedValueOnce({
        draft: {
          id: 18,
          platform: 'x',
          title: 'Draft A',
          content: 'Draft body A',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:20:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        draft: {
          id: 19,
          platform: 'reddit',
          title: 'Draft B',
          content: 'Draft body B',
          hashtags: ['#review'],
          status: 'review',
          createdAt: '2026-04-19T00:10:00.000Z',
          updatedAt: '2026-04-19T00:21:00.000Z',
        },
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          updateDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const selectFirst = findElement(
      container,
      (element) => element.getAttribute('data-drafts-select-id') === '18',
    );
    const selectSecond = findElement(
      container,
      (element) => element.getAttribute('data-drafts-select-id') === '19',
    );
    const batchReviewButton = findElement(
      container,
      (element) => element.getAttribute('data-drafts-batch-review') === 'true',
    );

    expect(selectFirst).not.toBeNull();
    expect(selectSecond).not.toBeNull();
    expect(batchReviewButton).not.toBeNull();

    await act(async () => {
      selectFirst?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      selectSecond?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      batchReviewButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updateDraftAction).toHaveBeenNthCalledWith(
      1,
      18,
      expect.objectContaining({
        title: 'Draft A',
        content: 'Draft body A',
        status: 'review',
      }),
    );
    expect(updateDraftAction).toHaveBeenNthCalledWith(
      2,
      19,
      expect.objectContaining({
        title: 'Draft B',
        content: 'Draft body B',
        status: 'review',
      }),
    );
    expect(collectText(container)).toContain('已批量处理 2 条草稿');
    expect(collectText(container)).toContain('已送审：Draft A');
    expect(collectText(container)).toContain('已送审：Draft B');
    expect(collectText(container)).toContain('review');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('reloads drafts after a queued publish result so the visible status matches the server state', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Queued launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Queued launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'queued',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:05:00.000Z',
          },
        ],
      });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'queued',
      publishUrl: null,
      message: 'Queued for publishing',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('触发发布'),
    );

    expect(publishButton).not.toBeNull();
    expect(collectText(container)).toContain('draft');

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(publishDraftAction).toHaveBeenCalledWith(8);
    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已入队等待发布：Queued launch thread');
    expect(collectText(container)).toContain('queued');
    expect(collectText(container)).toContain('当前状态已脱离 Draft 编辑流转，Drafts 页面仅展示服务器返回结果。');
    const statusBadge = findElement(
      container,
      (element) => element.tagName === 'SPAN' && collectText(element) === 'queued',
    );
    expect(statusBadge).not.toBeNull();
    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存修改'),
    );
    const titleInput = findElement(container, (element) => element.tagName === 'INPUT' && element.value === 'Queued launch thread');

    expect(saveButton).toBeNull();
    expect(titleInput).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale draft form values and publish feedback after switching project scope', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Project A launch thread',
            content: 'Draft body A',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Project A launch thread',
            content: 'Draft body A',
            hashtags: ['#launch'],
            status: 'queued',
            createdAt: '2026-04-19T01:00:00.000Z',
            updatedAt: '2026-04-19T01:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Project B launch thread',
            content: 'Draft body B',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T02:00:00.000Z',
            updatedAt: '2026-04-19T02:00:00.000Z',
          },
        ],
      });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'queued',
      publishUrl: null,
      message: 'Queued for publishing',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('触发发布'),
    );
    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(publishButton).not.toBeNull();
    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('已入队等待发布：Project A launch thread');
    expect(collectText(container)).toContain('Project A launch thread');

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B launch thread');
    expect(collectText(container)).not.toContain('已入队等待发布：Project A launch thread');
    expect(collectText(container)).not.toContain('Project A launch thread');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores stale save feedback after switching project scope with the same draft id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const pendingSave = createDeferredPromise<{
      draft: {
        id: number;
        platform: string;
        title: string;
        content: string;
        hashtags: string[];
        status: string;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Project A launch thread',
            content: 'Draft body A',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Project B launch thread',
            content: 'Draft body B',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T02:00:00.000Z',
            updatedAt: '2026-04-19T02:00:00.000Z',
          },
        ],
      });
    const updateDraftAction = vi.fn().mockReturnValue(pendingSave.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          updateDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存修改'),
    );
    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(saveButton).not.toBeNull();
    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftAction).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        title: 'Project A launch thread',
      }),
    );

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B launch thread');
    expect(collectText(container)).not.toContain('Project A launch thread');

    await act(async () => {
      pendingSave.resolve({
        draft: {
          id: 8,
          platform: 'x',
          title: 'Project A launch thread saved',
          content: 'Draft body A',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Project B launch thread');
    expect(collectText(container)).not.toContain('Project A launch thread saved');
    expect(collectText(container)).not.toContain('草稿已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('refreshes draft form values from a later successful reload for the same draft id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Launch thread v1',
            content: 'Draft body v1',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Launch thread v2',
            content: 'Draft body v2',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T01:00:00.000Z',
          },
        ],
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
        }),
      );
      await flush();
      await flush();
    });

    const titleInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.value === 'Launch thread v1',
    );
    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    expect(titleInput).not.toBeNull();
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const updatedTitleInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.value === 'Launch thread v2',
    );
    const updatedContentField = findElement(
      container,
      (element) => element.tagName === 'TEXTAREA' && element.value === 'Draft body v2',
    );

    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('Launch thread v2');
    expect(collectText(container)).not.toContain('Launch thread v1');
    expect(collectText(container)).not.toContain('Draft body v1');
    expect(updatedTitleInput).not.toBeNull();
    expect(updatedContentField).not.toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live drafts visible while a reload is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const pendingReload = createDeferredPromise<{
      drafts: Array<{
        id: number;
        platform: string;
        title: string;
        content: string;
        hashtags: string[];
        status: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>();
    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 8,
            platform: 'x',
            title: 'Queued launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      })
      .mockImplementationOnce(() => pendingReload.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
        }),
      );
      await flush();
      await flush();
    });

    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    expect(reloadButton).not.toBeNull();
    expect(collectText(container)).toContain('Queued launch thread');

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('正在加载草稿...');
    expect(collectText(container)).toContain('Queued launch thread');
    expect(collectText(container)).not.toContain('初始化后会自动加载真实草稿列表。');

    await act(async () => {
      pendingReload.resolve({
        drafts: [
          {
            id: 9,
            platform: 'reddit',
            title: 'Scoped draft after reload',
            content: 'Reloaded draft body',
            hashtags: ['#scope'],
            status: 'draft',
            createdAt: '2026-04-19T01:00:00.000Z',
            updatedAt: '2026-04-19T01:00:00.000Z',
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

  it('shows blog published drafts as read-only summary instead of editable or manual-handoff controls', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
        drafts: [
          {
            id: 15,
            platform: 'blog',
            title: 'Published blog launch post',
            content: 'Published body',
            hashtags: ['#launch'],
            status: 'published',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:05:00.000Z',
          publishedAt: '2026-04-19T00:05:00.000Z',
        },
      ],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('published');
    expect(collectText(container)).toContain('当前状态已脱离 Draft 编辑流转，Drafts 页面仅展示服务器返回结果。');
    expect(collectText(container)).toContain('发布时间');
    expect(collectText(container)).toContain('2026-04-19T00:05:00.000Z');

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存修改'),
    );
    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('触发发布'),
    );
    const manualHandoffButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );
    const titleInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.value === 'Published blog launch post',
    );
    const contentTextarea = findElement(
      container,
      (element) => element.tagName === 'TEXTAREA' && element.value === 'Published body',
    );

    expect(saveButton).toBeNull();
    expect(publishButton).toBeNull();
    expect(manualHandoffButton).toBeNull();
    expect(titleInput).toBeNull();
    expect(contentTextarea).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows browser handoff details when publish returns manual_required', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 31,
          platform: 'facebook-group',
          title: 'Community handoff',
          content: 'Draft body',
          hashtags: ['#community'],
          status: 'draft',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'facebookGroup draft 31 is ready for manual browser handoff with the saved session.',
      details: {
        browserHandoff: {
          readiness: 'ready',
          sessionAction: null,
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-31.json',
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    expect(publishButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(publishDraftAction).toHaveBeenCalledWith(31);
    expect(collectText(container)).toContain('已转入人工接管：Community handoff');
    expect(collectText(container)).toContain(
      'facebookGroup draft 31 is ready for manual browser handoff with the saved session.',
    );
    expect(collectText(container)).toContain('Handoff 状态：ready');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-31.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('treats tiktok drafts as manual handoff platforms', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 32,
          platform: 'tiktok',
          title: 'TikTok launch clip',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'tiktok draft 32 is ready for manual browser handoff with the saved session.',
      details: {
        browserHandoff: {
          readiness: 'ready',
          sessionAction: null,
          artifactPath: 'artifacts/browser-handoffs/tiktok/launch-campaign/tiktok-draft-32.json',
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    expect(publishButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(publishDraftAction).toHaveBeenCalledWith(32);
    expect(collectText(container)).toContain('已转入人工接管：TikTok launch clip');
    expect(collectText(container)).toContain(
      'tiktok draft 32 is ready for manual browser handoff with the saved session.',
    );
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/browser-handoffs/tiktok/launch-campaign/tiktok-draft-32.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows browser handoff session actions when manual_required still needs login work', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 41,
          platform: 'facebook-group',
          title: 'Blocked handoff',
          content: 'Draft body',
          hashtags: ['#community'],
          status: 'draft',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'facebookGroup draft 41 requires a saved browser session before manual handoff.',
      details: {
        browserHandoff: {
          readiness: 'blocked',
          sessionAction: 'request_session',
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Handoff 状态：blocked');
    expect(collectText(container)).toContain('Handoff 动作：request_session');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('filters drafts by status and batch-updates selected drafts through the existing patch action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const drafts = [
      {
        id: 51,
        platform: 'x',
        title: 'Draft backlog',
        content: 'Draft backlog body',
        hashtags: ['#launch'],
        status: 'draft' as const,
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
      {
        id: 52,
        platform: 'reddit',
        title: 'Review candidate',
        content: 'Review body',
        hashtags: ['#review'],
        status: 'review' as const,
        createdAt: '2026-04-19T00:05:00.000Z',
        updatedAt: '2026-04-19T00:05:00.000Z',
      },
      {
        id: 53,
        platform: 'x',
        title: 'Already queued',
        content: 'Queued body',
        hashtags: ['#queued'],
        status: 'queued' as const,
        createdAt: '2026-04-19T00:10:00.000Z',
        updatedAt: '2026-04-19T00:10:00.000Z',
      },
    ];
    const loadDraftsAction = vi.fn().mockResolvedValue({ drafts });
    const updateDraftAction = vi.fn().mockImplementation((id: number, input: { title: string; content: string; status: string }) =>
      Promise.resolve({
        draft: {
          ...(drafts.find((draft) => draft.id === id) ?? drafts[0]),
          title: input.title,
          content: input.content,
          status: input.status,
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          updateDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const reviewFilter = findElement(
      container,
      (element) => element.getAttribute('data-drafts-status-filter') === 'review',
    );
    const allFilter = findElement(
      container,
      (element) => element.getAttribute('data-drafts-status-filter') === 'all',
    );

    expect(reviewFilter).not.toBeNull();
    expect(allFilter).not.toBeNull();
    expect(collectText(container)).toContain('Draft backlog');
    expect(collectText(container)).toContain('Review candidate');
    expect(collectText(container)).toContain('Already queued');

    await act(async () => {
      reviewFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Review candidate');
    expect(collectText(container)).not.toContain('Draft backlog');
    expect(collectText(container)).not.toContain('Already queued');
    expect(collectText(container)).toContain('已筛选 1 / 3 条草稿');

    await act(async () => {
      allFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstSelect = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '51',
    );
    const secondSelect = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '52',
    );
    const queuedSelect = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '53',
    );
    const batchApprovedButton = findElement(
      container,
      (element) => element.getAttribute('data-drafts-batch-status') === 'approved',
    );
    const batchScheduledButton = findElement(
      container,
      (element) => element.getAttribute('data-drafts-batch-status') === 'scheduled',
    );

    expect(firstSelect).not.toBeNull();
    expect(secondSelect).not.toBeNull();
    expect(queuedSelect).toBeNull();
    expect(batchApprovedButton).not.toBeNull();
    expect(batchScheduledButton).not.toBeNull();

    await act(async () => {
      firstSelect?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSelect?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已选择 2 条草稿');

    await act(async () => {
      batchApprovedButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updateDraftAction).toHaveBeenNthCalledWith(
      1,
      51,
      expect.objectContaining({
        title: 'Draft backlog',
        content: 'Draft backlog body',
        status: 'approved',
      }),
    );
    expect(updateDraftAction).toHaveBeenNthCalledWith(
      2,
      52,
      expect.objectContaining({
        title: 'Review candidate',
        content: 'Review body',
        status: 'approved',
      }),
    );
    expect(collectText(container)).toContain('已批量处理 2 条草稿，目标状态 approved');
    expect(collectText(container)).toContain('approved');
    expect(collectText(container)).toContain('已选择 0 条草稿');

    const firstSelectAfterApprove = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '51',
    );
    const secondSelectAfterApprove = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '52',
    );

    await act(async () => {
      firstSelectAfterApprove?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSelectAfterApprove?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      batchScheduledButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updateDraftAction).toHaveBeenNthCalledWith(
      3,
      51,
      expect.objectContaining({
        status: 'scheduled',
      }),
    );
    expect(updateDraftAction).toHaveBeenNthCalledWith(
      4,
      52,
      expect.objectContaining({
        status: 'scheduled',
      }),
    );
    expect(collectText(container)).toContain('已批量处理 2 条草稿，目标状态 scheduled');
    expect(collectText(container)).toContain('当前状态已脱离 Draft 编辑流转，Drafts 页面仅展示服务器返回结果。');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('batch-publishes the selected drafts through the existing publish action and reloads once', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const initialDrafts = [
      {
        id: 61,
        platform: 'x',
        title: 'Approved launch thread',
        content: 'Draft body A',
        hashtags: ['#launch'],
        status: 'approved' as const,
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
      {
        id: 62,
        platform: 'reddit',
        title: 'Approved reddit post',
        content: 'Draft body B',
        hashtags: ['#reddit'],
        status: 'approved' as const,
        createdAt: '2026-04-19T00:05:00.000Z',
        updatedAt: '2026-04-19T00:05:00.000Z',
      },
    ];
    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({ drafts: initialDrafts })
      .mockResolvedValue({
        drafts: [
          {
            ...initialDrafts[0],
            status: 'published',
            publishedAt: '2026-04-19T01:00:00.000Z',
            updatedAt: '2026-04-19T01:00:00.000Z',
          },
          {
            ...initialDrafts[1],
            status: 'queued',
            updatedAt: '2026-04-19T01:05:00.000Z',
          },
        ],
      });
    const publishDraftAction = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        status: 'published',
        publishUrl: 'https://x.example.test/post/61',
        message: 'Published immediately',
      })
      .mockResolvedValueOnce({
        success: false,
        status: 'queued',
        publishUrl: null,
        message: 'Queued for publishing',
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstSelect = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '61',
    );
    const secondSelect = findElement(
      container,
      (element) => element.getAttribute('data-draft-select-item') === '62',
    );
    const batchPublishButton = findElement(
      container,
      (element) => element.getAttribute('data-drafts-batch-publish') === 'true',
    );

    expect(firstSelect).not.toBeNull();
    expect(secondSelect).not.toBeNull();
    expect(batchPublishButton).not.toBeNull();

    await act(async () => {
      firstSelect?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSelect?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已选择 2 条草稿');

    await act(async () => {
      batchPublishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(publishDraftAction).toHaveBeenNthCalledWith(1, 61);
    expect(publishDraftAction).toHaveBeenNthCalledWith(2, 62);
    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已批量处理 2 条草稿发布');
    expect(collectText(container)).toContain('Published immediately');
    expect(collectText(container)).toContain('已入队等待发布：Approved reddit post');
    expect(collectText(container)).toContain('published');
    expect(collectText(container)).toContain('queued');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('requests browser session actions directly from manual-required draft feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 71,
          platform: 'instagram',
          title: 'Instagram launch reel',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'instagram draft 71 requires a saved browser session before manual handoff.',
      details: {
        browserHandoff: {
          platform: 'instagram',
          channelAccountId: 88,
          readiness: 'blocked',
          sessionAction: 'request_session',
          artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-71.json',
        },
      },
    });
    const requestChannelAccountSessionActionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'request_session',
        message: 'Instagram session request queued for operator pickup.',
        artifactPath: 'artifacts/browser-lane-requests/instagram/relaunch/session-request-71.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
          requestChannelAccountSessionActionAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const sessionActionButton = findElement(
      container,
      (element) => element.getAttribute('data-draft-session-action') === 'request_session',
    );

    expect(sessionActionButton).not.toBeNull();

    await act(async () => {
      sessionActionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(requestChannelAccountSessionActionAction).toHaveBeenCalledWith(88, {
      action: 'request_session',
    });
    expect(collectText(container)).toContain('Instagram session request queued for operator pickup.');
    expect(collectText(container)).toContain(
      'Session 请求路径：artifacts/browser-lane-requests/instagram/relaunch/session-request-71.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('completes browser handoffs directly from manual-required draft feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 72,
            platform: 'tiktok',
            title: 'TikTok launch clip',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 72,
            platform: 'tiktok',
            title: 'TikTok launch clip',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 72,
            platform: 'tiktok',
            title: 'TikTok launch clip',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'published',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T01:00:00.000Z',
            publishedAt: '2026-04-27T01:00:00.000Z',
          },
        ],
      });
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'tiktok draft 72 is ready for manual browser handoff with the saved session.',
      details: {
        browserHandoff: {
          platform: 'tiktok',
          readiness: 'ready',
          artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-72.json',
        },
      },
    });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-72.json',
      draftId: 72,
      draftStatus: 'published',
      platform: 'tiktok',
      mode: 'browser_handoff',
      status: 'published',
      success: true,
      publishUrl: 'https://www.tiktok.com/@promobot/video/72',
      externalId: null,
      message: 'TikTok browser handoff completed.',
      publishedAt: '2026-04-27T01:00:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const publishUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-draft-browser-handoff-field') === 'publishUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-draft-browser-handoff-field') === 'message',
    );
    const completeButton = findElement(
      container,
      (element) => element.getAttribute('data-draft-browser-handoff-complete') === 'published',
    );

    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(completeButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://www.tiktok.com/@promobot/video/72',
        window as never,
      );
      updateFieldValue(messageInput as never, 'Posted from browser lane.', window as never);
      await flush();
    });

    await act(async () => {
      completeButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-72.json',
      publishStatus: 'published',
      publishUrl: 'https://www.tiktok.com/@promobot/video/72',
      message: 'Posted from browser lane.',
    });
    expect(loadDraftsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).not.toContain('Draft browser handoff 结单');
    expect(collectText(container)).toContain('发布时间');
    expect(collectText(container)).toContain('2026-04-27T01:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('preserves unsaved edits on other draft cards after a browser handoff completion reload', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const initialDrafts = {
      drafts: [
        {
          id: 74,
          platform: 'instagram',
          title: 'Instagram handoff draft',
          content: 'Needs manual publish',
          hashtags: ['#launch'],
          status: 'draft' as const,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z',
        },
        {
          id: 75,
          platform: 'tiktok',
          title: 'TikTok queued idea',
          content: 'Original secondary draft body',
          hashtags: ['#idea'],
          status: 'draft' as const,
          createdAt: '2026-04-27T00:05:00.000Z',
          updatedAt: '2026-04-27T00:05:00.000Z',
        },
      ],
    };
    const loadDraftsAction = vi.fn().mockResolvedValue(initialDrafts);
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'instagram draft 74 is ready for manual browser handoff with the saved session.',
      details: {
        browserHandoff: {
          platform: 'instagram',
          readiness: 'ready',
          artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-74.json',
        },
      },
    });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-74.json',
      draftId: 74,
      draftStatus: 'published',
      platform: 'instagram',
      mode: 'browser_handoff',
      status: 'published',
      success: true,
      publishUrl: 'https://www.instagram.com/p/promobot74/',
      externalId: null,
      message: 'Instagram browser handoff completed.',
      publishedAt: '2026-04-27T01:00:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const secondaryTitleInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && (element as { value?: string }).value === 'TikTok queued idea',
    );
    const secondaryContentInput = findElement(
      container,
      (element) =>
        element.tagName === 'TEXTAREA' && (element as { value?: string }).value === 'Original secondary draft body',
    );

    expect(secondaryTitleInput).not.toBeNull();
    expect(secondaryContentInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(secondaryTitleInput as never, 'Unsaved TikTok replacement title', window as never);
      updateFieldValue(secondaryContentInput as never, 'Unsaved secondary draft body', window as never);
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const completeButton = findElement(
      container,
      (element) => element.getAttribute('data-draft-browser-handoff-complete') === 'published',
    );

    expect(completeButton).not.toBeNull();

    loadDraftsAction.mockResolvedValueOnce({
      drafts: [
        {
          id: 74,
          platform: 'instagram',
          title: 'Instagram handoff draft',
          content: 'Needs manual publish',
          hashtags: ['#launch'],
          status: 'published',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T01:00:00.000Z',
          publishedAt: '2026-04-27T01:00:00.000Z',
        },
        {
          id: 75,
          platform: 'tiktok',
          title: 'TikTok queued idea',
          content: 'Original secondary draft body',
          hashtags: ['#idea'],
          status: 'draft',
          createdAt: '2026-04-27T00:05:00.000Z',
          updatedAt: '2026-04-27T00:05:00.000Z',
        },
      ],
    });

    await act(async () => {
      completeButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    const refreshedSecondaryTitleInput = findElement(
      container,
      (element) =>
        element.tagName === 'INPUT' && (element as { value?: string }).value === 'Unsaved TikTok replacement title',
    ) as { value?: string } | null;
    const refreshedSecondaryContentInput = findElement(
      container,
      (element) =>
        element.tagName === 'TEXTAREA' &&
        (element as { value?: string }).value === 'Unsaved secondary draft body',
    ) as { value?: string } | null;

    expect(loadDraftsAction).toHaveBeenCalledTimes(3);
    expect(refreshedSecondaryTitleInput).not.toBeNull();
    expect(refreshedSecondaryContentInput).not.toBeNull();
    expect(refreshedSecondaryTitleInput?.value).toBe('Unsaved TikTok replacement title');
    expect(refreshedSecondaryContentInput?.value).toBe('Unsaved secondary draft body');
    expect(collectText(container)).toContain('发布时间');
    expect(collectText(container)).toContain('2026-04-27T01:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('drops stale manual-required draft follow-up actions after a live reload shows the draft resolved', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const initialDrafts = {
      drafts: [
        {
          id: 76,
          platform: 'instagram',
          title: 'Instagram resolved elsewhere',
          content: 'Manual handoff candidate',
          hashtags: ['#handoff'],
          status: 'draft' as const,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    };
    const loadDraftsAction = vi.fn().mockResolvedValue(initialDrafts);
    const publishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'instagram draft 76 requires a saved browser session before manual handoff.',
      details: {
        browserHandoff: {
          platform: 'instagram',
          channelAccountId: 96,
          readiness: 'blocked',
          sessionAction: 'request_session',
          artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-76.json',
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(
      findElement(
        container,
        (element) => element.getAttribute('data-draft-session-action') === 'request_session',
      ),
    ).not.toBeNull();
    expect(
      findElement(
        container,
        (element) => element.getAttribute('data-draft-browser-handoff-complete') === 'published',
      ),
    ).not.toBeNull();

    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    loadDraftsAction.mockResolvedValueOnce({
      drafts: [
        {
          id: 76,
          platform: 'instagram',
          title: 'Instagram resolved elsewhere',
          content: 'Manual handoff candidate',
          hashtags: ['#handoff'],
          status: 'published',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T02:00:00.000Z',
          publishedAt: '2026-04-27T02:00:00.000Z',
        },
      ],
    });

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenCalledTimes(3);
    expect(
      findElement(
        container,
        (element) => element.getAttribute('data-draft-session-action') === 'request_session',
      ),
    ).toBeNull();
    expect(
      findElement(
        container,
        (element) => element.getAttribute('data-draft-browser-handoff-complete') === 'published',
      ),
    ).toBeNull();
    expect(collectText(container)).toContain('published');
    expect(collectText(container)).toContain('2026-04-27T02:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores stale browser handoff completions after the operator republishes the draft', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const pendingCompletion = createDeferredPromise<{
      ok: boolean;
      imported: boolean;
      artifactPath: string;
      draftId: number;
      draftStatus: string;
      platform: string;
      mode: string;
      status: string;
      success: boolean;
      publishUrl: string | null;
      externalId: string | null;
      message: string;
      publishedAt: string | null;
    }>();
    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 73,
            platform: 'instagram',
            title: 'Instagram relaunch reel',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({
        drafts: [
          {
            id: 73,
            platform: 'instagram',
            title: 'Instagram relaunch reel',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        ],
      });
    const publishDraftAction = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        status: 'manual_required',
        publishUrl: null,
        message: 'instagram draft 73 is ready for manual browser handoff with the saved session.',
        details: {
          browserHandoff: {
            platform: 'instagram',
            readiness: 'ready',
            artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-73-v1.json',
          },
        },
      })
      .mockResolvedValueOnce({
        success: false,
        status: 'manual_required',
        publishUrl: null,
        message: 'instagram draft 73 requires relogin before manual handoff.',
        details: {
          browserHandoff: {
            platform: 'instagram',
            channelAccountId: 93,
            readiness: 'blocked',
            sessionAction: 'relogin',
            artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-73-v2.json',
          },
        },
      });
    const completeBrowserHandoffAction = vi.fn().mockImplementation(() => pendingCompletion.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DraftsPage as never, {
          loadDraftsAction,
          publishDraftAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('发起人工接管'),
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const firstCompleteButton = findElement(
      container,
      (element) => element.getAttribute('data-draft-browser-handoff-complete') === 'published',
    );

    expect(firstCompleteButton).not.toBeNull();

    await act(async () => {
      firstCompleteButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/browser-handoffs/instagram/relaunch/instagram-draft-73-v2.json',
    );
    expect(collectText(container)).toContain('Handoff 动作：relogin');

    await act(async () => {
      pendingCompletion.resolve({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-73-v1.json',
        draftId: 73,
        draftStatus: 'published',
        platform: 'instagram',
        mode: 'browser_handoff',
        status: 'published',
        success: true,
        publishUrl: 'https://www.instagram.com/p/stale73/',
        externalId: null,
        message: 'Stale browser handoff should be ignored.',
        publishedAt: '2026-04-27T01:30:00.000Z',
      });
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-73-v1.json',
      publishStatus: 'published',
    });
    expect(loadDraftsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).not.toContain('已结单 draft #73 (published)');
    expect(collectText(container)).not.toContain('Stale browser handoff should be ignored.');
    expect(collectText(container)).not.toContain('https://www.instagram.com/p/stale73/');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/browser-handoffs/instagram/relaunch/instagram-draft-73-v2.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
