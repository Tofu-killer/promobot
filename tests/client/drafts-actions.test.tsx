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
});
