import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

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
