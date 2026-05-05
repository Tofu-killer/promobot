import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import {
  createStorageArea,
  installAuthStorage,
  installBrowserHistory,
  jsonResponse,
  settleLazyRouteRender,
} from './app-shell-test-helpers';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

function updateFieldValue(element: { value?: string } | null, value: string, window: { Event: typeof Event }) {
  if (!element) {
    throw new Error('expected input element');
  }

  (element as { value?: string }).value = value;

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

function dispatchStorageEvent(
  window: {
    Event: typeof Event;
    dispatchEvent: (event: Event) => boolean;
  },
  input: {
    key: string | null;
    newValue: string | null;
  },
) {
  const storageEvent = new window.Event('storage');
  Object.defineProperties(storageEvent, {
    key: {
      configurable: true,
      value: input.key,
    },
    newValue: {
      configurable: true,
      value: input.newValue,
    },
  });
  window.dispatchEvent(storageEvent);
}

function findGeneratePlatformCheckbox(container: Parameters<typeof findElement>[0], platformValue: string) {
  const platformLabel = findElement(
    container,
    (element) => element.getAttribute('data-generate-platform') === platformValue,
  );

  return platformLabel
    ? findElement(
        platformLabel,
        (element) => element.tagName === 'INPUT' && (element as { type?: string }).type === 'checkbox',
      )
    : null;
}

async function settleAppRender() {
  await settleLazyRouteRender();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App shell', () => {
  it('renders the PromoBot navigation shell when admin auth is satisfied', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        if (url.includes('/api/monitor/dashboard')) {
          return Promise.resolve(
            jsonResponse({
              monitor: {
                total: 0,
                new: 0,
                followUpDrafts: 0,
              },
              drafts: {
                total: 0,
                review: 0,
              },
              totals: {
                items: 0,
                followUps: 0,
              },
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const renderedText = collectText(container);
    expect(renderedText).toContain('PromoBot');
    expect(renderedText).toContain('Dashboard');
    expect(renderedText).toContain('System Queue');
    expect(renderedText).toContain('Projects');
    expect(renderedText).toContain('Discovery Pool');
    expect(renderedText).toContain('Generate Center');
    expect(renderedText).toContain('Social Inbox');
    expect(renderedText).toContain('Competitor Monitor');
    expect(renderedText).toContain('Channel Accounts');
    expect(renderedText).toContain('Settings');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders the admin login page when no admin password is present', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        ),
      ),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).not.toContain('Dashboard');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the shared raw projectId draft when switching between dashboard, generate, and monitor', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url.includes('/api/monitor/dashboard')) {
          return Promise.resolve(
            jsonResponse({
              monitor: {
                total: 1,
                new: 1,
                followUpDrafts: 0,
              },
              drafts: {
                total: 1,
                review: 0,
              },
              totals: {
                items: 1,
                followUps: 0,
              },
            }),
          );
        }

        if (url.includes('/api/monitor/feed')) {
          return Promise.resolve(
            jsonResponse({
              items: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const dashboardProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(dashboardProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(dashboardProjectInput as never, ' 0012 ', window as never);
      await flush();
      await flush();
    });

    const generateNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Generate Center'),
    );

    expect(generateNavButton).not.toBeNull();

    await act(async () => {
      generateNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('话题输入');

    const generateProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((generateProjectInput as { value?: string } | null)?.value).toBe(' 0012 ');

    await act(async () => {
      updateFieldValue(generateProjectInput as never, ' 0042 ', window as never);
      await flush();
    });

    const monitorNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Competitor Monitor'),
    );

    expect(monitorNavButton).not.toBeNull();

    await act(async () => {
      monitorNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('抓取排程');

    const monitorProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((monitorProjectInput as { value?: string } | null)?.value).toBe(' 0042 ');

    const dashboardNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Dashboard'),
    );

    expect(dashboardNavButton).not.toBeNull();

    await act(async () => {
      dashboardNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('先看今天的内容运营节奏');

    const rerenderedDashboardProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((rerenderedDashboardProjectInput as { value?: string } | null)?.value).toBe(' 0042 ');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the shared raw projectId draft when switching between dashboard, drafts, review, and calendar', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url.includes('/api/monitor/dashboard')) {
          return Promise.resolve(
            jsonResponse({
              monitor: {
                total: 1,
                new: 1,
                followUpDrafts: 0,
              },
              drafts: {
                total: 1,
                review: 0,
              },
              totals: {
                items: 1,
                followUps: 0,
              },
            }),
          );
        }

        if (url.startsWith('/api/drafts')) {
          return Promise.resolve(
            jsonResponse({
              drafts: [],
            }),
          );
        }

        if (url.startsWith('/api/system/browser-handoffs')) {
          return Promise.resolve(
            jsonResponse({
              handoffs: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const dashboardProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(dashboardProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(dashboardProjectInput as never, ' 0012 ', window as never);
      await flush();
      await flush();
    });

    const draftsNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Drafts'),
    );

    expect(draftsNavButton).not.toBeNull();

    await act(async () => {
      draftsNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('草稿列表');

    const draftsProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((draftsProjectInput as { value?: string } | null)?.value).toBe(' 0012 ');

    await act(async () => {
      updateFieldValue(draftsProjectInput as never, ' 0042 ', window as never);
      await flush();
      await flush();
    });

    const reviewNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Review Queue'),
    );

    expect(reviewNavButton).not.toBeNull();

    await act(async () => {
      reviewNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('待审核草稿');

    const reviewProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((reviewProjectInput as { value?: string } | null)?.value).toBe(' 0042 ');

    await act(async () => {
      updateFieldValue(reviewProjectInput as never, ' 0099 ', window as never);
      await flush();
      await flush();
    });

    const calendarNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Publish Calendar'),
    );

    expect(calendarNavButton).not.toBeNull();

    await act(async () => {
      calendarNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect(collectText(container)).toContain('发布状态');

    const calendarProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((calendarProjectInput as { value?: string } | null)?.value).toBe(' 0099 ');

    const dashboardNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Dashboard'),
    );

    expect(dashboardNavButton).not.toBeNull();

    await act(async () => {
      dashboardNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    const rerenderedDashboardProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect((rerenderedDashboardProjectInput as { value?: string } | null)?.value).toBe(' 0099 ');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders the route from window.location.pathname on first client render', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/monitor');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url.includes('/api/monitor/dashboard')) {
          return Promise.resolve(
            jsonResponse({
              monitor: {
                total: 1,
                new: 1,
                followUpDrafts: 0,
              },
              drafts: {
                total: 1,
                review: 0,
              },
              totals: {
                items: 1,
                followUps: 0,
              },
            }),
          );
        }

        if (url.includes('/api/monitor/feed')) {
          return Promise.resolve(
            jsonResponse({
              items: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/monitor');
    expect(collectText(container)).toContain('Competitor Monitor');
    expect(collectText(container)).toContain('抓取排程');
    expect(collectText(container)).not.toContain('先看今天的内容运营节奏');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('prefills Generate Center from a discovery manual handoff and keeps the shared projectId draft', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/discovery');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/discovery') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 701,
                  type: 'monitor',
                  source: 'Product Hunt',
                  title: 'Manual discovery follow-up',
                  summary: '适合走人工平台的后续内容整理。',
                  status: 'triaged',
                  score: 79,
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
              total: 1,
              stats: {
                sources: 1,
                averageScore: 79,
              },
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const discoveryProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(discoveryProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(discoveryProjectInput as never, '12', window as never);
      await flush();
      await flush();
    });

    const manualHandoffButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-manual-generate-id') === 'monitor-701',
    );
    expect(manualHandoffButton).not.toBeNull();

    await act(async () => {
      manualHandoffButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/generate');
    expect(collectText(container)).toContain('Generate Center');

    const topicField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect((topicField as { value?: string } | null)?.value).toBe(
      'Manual discovery follow-up\n\n适合走人工平台的后续内容整理。',
    );
    expect((findGeneratePlatformCheckbox(container, 'facebook-group') as { checked?: boolean } | null)?.checked).toBe(
      true,
    );
    expect((findGeneratePlatformCheckbox(container, 'instagram') as { checked?: boolean } | null)?.checked).toBe(true);
    expect((findGeneratePlatformCheckbox(container, 'x') as { checked?: boolean } | null)?.checked).toBe(false);

    const generateProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((generateProjectInput as { value?: string } | null)?.value).toBe('12');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores generate handoff payload after popstate forward', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/discovery');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/discovery') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 701,
                  type: 'monitor',
                  source: 'Product Hunt',
                  title: 'Manual discovery follow-up',
                  summary: '适合走人工平台的后续内容整理。',
                  status: 'triaged',
                  score: 79,
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
              total: 1,
              stats: {
                sources: 1,
                averageScore: 79,
              },
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const discoveryProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(discoveryProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(discoveryProjectInput as never, '12', window as never);
      await flush();
      await flush();
    });

    const manualHandoffButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-manual-generate-id') === 'monitor-701',
    );
    expect(manualHandoffButton).not.toBeNull();

    await act(async () => {
      manualHandoffButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    const topicField = () => findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect((window.location as { pathname?: string }).pathname).toBe('/generate');
    expect((topicField() as { value?: string } | null)?.value).toBe(
      'Manual discovery follow-up\n\n适合走人工平台的后续内容整理。',
    );

    await act(async () => {
      (window.history as { back: () => void }).back();
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/discovery');
    expect(collectText(container)).toContain('Discovery Pool');
    const restoredDiscoveryProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    await act(async () => {
      updateFieldValue(restoredDiscoveryProjectInput as never, '37', window as never);
      await flush();
      await flush();
    });

    await act(async () => {
      (window.history as { forward: () => void }).forward();
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/generate');
    expect((topicField() as { value?: string } | null)?.value).toBe(
      'Manual discovery follow-up\n\n适合走人工平台的后续内容整理。',
    );
    const restoredGenerateProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((restoredGenerateProjectInput as { value?: string } | null)?.value).toBe('12');
    expect((findGeneratePlatformCheckbox(container, 'facebook-group') as { checked?: boolean } | null)?.checked).toBe(
      true,
    );
    expect((findGeneratePlatformCheckbox(container, 'instagram') as { checked?: boolean } | null)?.checked).toBe(true);
    expect((findGeneratePlatformCheckbox(container, 'x') as { checked?: boolean } | null)?.checked).toBe(false);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('prefills Generate Center from an inbox handoff and keeps the shared projectId draft', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/inbox');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/inbox') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 801,
                  source: 'V2EX',
                  status: 'needs_reply',
                  author: 'founder',
                  title: 'Community thread worth a broader follow-up',
                  excerpt: 'Route this into a multi-platform content draft.',
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            }),
          );
        }

        if (url === '/api/system/inbox-reply-handoffs?limit=100') {
          return Promise.resolve(
            jsonResponse({
              handoffs: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const inboxProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(inboxProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(inboxProjectInput as never, '12', window as never);
      await flush();
      await flush();
    });

    const handoffButton = findElement(
      container,
      (element) => element.getAttribute('data-inbox-generate-center-id') === '801',
    );
    expect(handoffButton).not.toBeNull();

    await act(async () => {
      handoffButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/generate');
    expect(collectText(container)).toContain('Generate Center');

    const topicField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect((topicField as { value?: string } | null)?.value).toBe(
      'Community thread worth a broader follow-up\n\nRoute this into a multi-platform content draft.',
    );
    expect((findGeneratePlatformCheckbox(container, 'facebook-group') as { checked?: boolean } | null)?.checked).toBe(
      true,
    );
    expect((findGeneratePlatformCheckbox(container, 'instagram') as { checked?: boolean } | null)?.checked).toBe(true);
    expect((findGeneratePlatformCheckbox(container, 'x') as { checked?: boolean } | null)?.checked).toBe(false);

    const generateProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((generateProjectInput as { value?: string } | null)?.value).toBe('12');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('opens the escalated inbox item from reputation and keeps the shared project scope', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/reputation');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/reputation/stats' || url === '/api/reputation/stats?projectId=12') {
          return Promise.resolve(
            jsonResponse({
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
                  title: 'Escalate this conversation',
                  detail: 'Carry this into the shared inbox queue.',
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
            }),
          );
        }

        if (url === '/api/reputation/4') {
          expect(init?.method).toBe('PATCH');
          return Promise.resolve(
            jsonResponse({
              item: {
                id: 4,
                source: 'x',
                sentiment: 'negative',
                status: 'escalate',
                title: 'Escalate this conversation',
                detail: 'Carry this into the shared inbox queue.',
                createdAt: '2026-04-19T12:00:00.000Z',
              },
              inboxItem: {
                id: 9,
                projectId: 12,
                source: 'x',
                status: 'needs_review',
                title: 'Escalated inbox thread',
                excerpt: 'The inbox should focus this newly created conversation.',
                createdAt: '2026-04-19T12:05:00.000Z',
              },
            }),
          );
        }

        if (url === '/api/inbox?projectId=12') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'builder',
                  title: 'Older inbox thread',
                  excerpt: 'This was already waiting in the queue.',
                  createdAt: '2026-04-19T11:30:00.000Z',
                },
                {
                  id: 9,
                  source: 'x',
                  status: 'needs_review',
                  author: 'support-lead',
                  title: 'Escalated inbox thread',
                  excerpt: 'The inbox should focus this newly created conversation.',
                  createdAt: '2026-04-19T12:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            }),
          );
        }

        if (url === '/api/system/inbox-reply-handoffs?limit=100') {
          return Promise.resolve(
            jsonResponse({
              handoffs: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/reputation');
    expect(collectText(container)).toContain('Brand Signals');

    const reputationProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(reputationProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(reputationProjectInput as never, '12', window as never);
      await flush();
      await flush();
    });

    const escalateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('转入 Social Inbox'),
    );
    expect(escalateButton).not.toBeNull();

    await act(async () => {
      escalateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/inbox');
    expect(collectText(container)).toContain('Social Inbox');

    const inboxProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((inboxProjectInput as { value?: string } | null)?.value).toBe('12');
    expect(collectText(container)).toContain('Older inbox thread');
    expect(collectText(container)).toContain('Escalated inbox thread');
    expect(collectText(container)).toContain('当前会话：x · support-lead');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores inbox focus handoff after popstate forward', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/reputation');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/reputation/stats' || url === '/api/reputation/stats?projectId=12') {
          return Promise.resolve(
            jsonResponse({
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
                  title: 'Escalate this conversation',
                  detail: 'Carry this into the shared inbox queue.',
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
            }),
          );
        }

        if (url === '/api/reputation/4') {
          expect(init?.method).toBe('PATCH');
          return Promise.resolve(
            jsonResponse({
              item: {
                id: 4,
                source: 'x',
                sentiment: 'negative',
                status: 'escalate',
                title: 'Escalate this conversation',
                detail: 'Carry this into the shared inbox queue.',
                createdAt: '2026-04-19T12:00:00.000Z',
              },
              inboxItem: {
                id: 9,
                projectId: 12,
                source: 'x',
                status: 'needs_review',
                title: 'Escalated inbox thread',
                excerpt: 'The inbox should focus this newly created conversation.',
                createdAt: '2026-04-19T12:05:00.000Z',
              },
            }),
          );
        }

        if (url === '/api/inbox?projectId=12') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 7,
                  source: 'reddit',
                  status: 'needs_reply',
                  author: 'builder',
                  title: 'Older inbox thread',
                  excerpt: 'This was already waiting in the queue.',
                  createdAt: '2026-04-19T11:30:00.000Z',
                },
                {
                  id: 9,
                  source: 'x',
                  status: 'needs_review',
                  author: 'support-lead',
                  title: 'Escalated inbox thread',
                  excerpt: 'The inbox should focus this newly created conversation.',
                  createdAt: '2026-04-19T12:05:00.000Z',
                },
              ],
              total: 2,
              unread: 2,
            }),
          );
        }

        if (url === '/api/system/inbox-reply-handoffs?limit=100') {
          return Promise.resolve(
            jsonResponse({
              handoffs: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const reputationProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(reputationProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(reputationProjectInput as never, '12', window as never);
      await flush();
      await flush();
    });

    const escalateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('转入 Social Inbox'),
    );
    expect(escalateButton).not.toBeNull();

    await act(async () => {
      escalateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/inbox');
    expect(collectText(container)).toContain('当前会话：x · support-lead');
    expect(collectText(container)).not.toContain('当前会话：reddit · builder');

    await act(async () => {
      (window.history as { back: () => void }).back();
      await flush();
      await flush();
      await flush();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/reputation');
    expect(collectText(container)).toContain('Brand Signals');
    const restoredReputationProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    await act(async () => {
      updateFieldValue(restoredReputationProjectInput as never, '37', window as never);
      await flush();
      await flush();
      await flush();
    });

    await act(async () => {
      (window.history as { forward: () => void }).forward();
      await flush();
      await flush();
      await flush();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/inbox');
    const restoredInboxProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((restoredInboxProjectInput as { value?: string } | null)?.value).toBe('12');
    expect(collectText(container)).toContain('当前会话：x · support-lead');
    expect(collectText(container)).not.toContain('当前会话：reddit · builder');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('falls back to the escalated inbox project when the reputation project draft is invalid', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/reputation');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/reputation/stats') {
          return Promise.resolve(
            jsonResponse({
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
                  title: 'Escalate this conversation',
                  detail: 'Carry this into the shared inbox queue.',
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
            }),
          );
        }

        if (url === '/api/reputation/4') {
          expect(init?.method).toBe('PATCH');
          return Promise.resolve(
            jsonResponse({
              item: {
                id: 4,
                source: 'x',
                sentiment: 'negative',
                status: 'escalate',
                title: 'Escalate this conversation',
                detail: 'Carry this into the shared inbox queue.',
                createdAt: '2026-04-19T12:00:00.000Z',
              },
              inboxItem: {
                id: 9,
                projectId: 12,
                source: 'x',
                status: 'needs_review',
                title: 'Escalated inbox thread',
                excerpt: 'The inbox should focus this newly created conversation.',
                createdAt: '2026-04-19T12:05:00.000Z',
              },
            }),
          );
        }

        if (url === '/api/inbox?projectId=12') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 9,
                  source: 'x',
                  status: 'needs_review',
                  author: 'support-lead',
                  title: 'Escalated inbox thread',
                  excerpt: 'The inbox should focus this newly created conversation.',
                  createdAt: '2026-04-19T12:05:00.000Z',
                },
              ],
              total: 1,
              unread: 1,
            }),
          );
        }

        if (url === '/api/system/inbox-reply-handoffs?limit=100') {
          return Promise.resolve(
            jsonResponse({
              handoffs: [],
              total: 0,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await settleAppRender();
    });

    const reputationProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(reputationProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(reputationProjectInput as never, '12x', window as never);
      await flush();
      await flush();
    });

    const escalateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('转入 Social Inbox'),
    );
    expect(escalateButton).not.toBeNull();

    await act(async () => {
      escalateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/inbox');

    const inboxProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((inboxProjectInput as { value?: string } | null)?.value).toBe('12');
    expect(collectText(container)).toContain('当前会话：x · support-lead');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the current route when popstate lands on an unknown path', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/projects');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await flush();
      await flush();
      await flush();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/projects');
    expect(collectText(container)).toContain('Projects');
    expect(collectText(container)).toContain('Project Context');

    await act(async () => {
      (window.history as { pushState: (state: unknown, unused: string, url?: string) => void }).pushState(
        null,
        '',
        '/legacy-route',
      );
      await flush();
      await flush();
    });

    await act(async () => {
      (window.history as { back: () => void }).back();
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/projects');
    expect(collectText(container)).toContain('Projects');
    expect(collectText(container)).toContain('Project Context');

    await act(async () => {
      (window.history as { forward: () => void }).forward();
      await settleAppRender();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/legacy-route');
    expect(collectText(container)).toContain('Projects');
    expect(collectText(container)).toContain('Project Context');
    expect(collectText(container)).not.toContain('OverviewDashboard');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('prefills Generate Center from a monitor handoff and keeps the shared projectId draft', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/monitor');

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/auth/probe') {
          return Promise.resolve(
            new Response(null, {
              status: 204,
            }),
          );
        }

        if (url === '/api/monitor/feed') {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 901,
                  source: 'Product Hunt',
                  title: 'Launch note worth expanding',
                  detail: 'Turn this competitive launch into a broader outbound explainer.',
                  status: 'new',
                  createdAt: '2026-04-19T12:00:00.000Z',
                },
              ],
              total: 1,
            }),
          );
        }

        throw new Error(`unexpected fetch request: ${url}`);
      }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await flush();
      await flush();
      await flush();
    });

    const monitorProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect(monitorProjectInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(monitorProjectInput as never, '12', window as never);
      await flush();
      await flush();
    });

    const monitorItem = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '901',
    );
    expect(monitorItem).not.toBeNull();

    await act(async () => {
      monitorItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const handoffButton = findElement(
      container,
      (element) => element.getAttribute('data-monitor-generate-center') === 'true',
    );
    expect(handoffButton).not.toBeNull();

    await act(async () => {
      handoffButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect((window.location as { pathname?: string }).pathname).toBe('/generate');
    expect(collectText(container)).toContain('Generate Center');

    const topicField = findElement(container, (element) => element.tagName === 'TEXTAREA');
    expect((topicField as { value?: string } | null)?.value).toBe(
      'Launch note worth expanding\n\nTurn this competitive launch into a broader outbound explainer.',
    );
    expect((findGeneratePlatformCheckbox(container, 'facebook-group') as { checked?: boolean } | null)?.checked).toBe(
      true,
    );
    expect((findGeneratePlatformCheckbox(container, 'instagram') as { checked?: boolean } | null)?.checked).toBe(true);
    expect((findGeneratePlatformCheckbox(container, 'x') as { checked?: boolean } | null)?.checked).toBe(false);

    const generateProjectInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    expect((generateProjectInput as { value?: string } | null)?.value).toBe('12');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the login page when the current admin session probe fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/probe',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).not.toContain('Dashboard');
    expect(collectText(container)).not.toContain('登录失败：');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('logs in through the session api before entering the shell', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { localStorage, sessionStorage } = installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea(),
    });

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/probe') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        );
      }

      if (String(input) === '/api/auth/login') {
        expect(init).toEqual({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            password: 'secret',
            remember: false,
          }),
        });

        return Promise.resolve(
          new Response(null, {
            status: 204,
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
    });

    const passwordInput = findElement(
      container,
      (element) => element.tagName === 'INPUT',
    );
    const submitButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('进入控制台'),
    );

    expect(passwordInput).not.toBeNull();
    expect(submitButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(passwordInput as never, 'secret', window as never);
      await flush();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'promobot_auth_sync',
      expect.stringContaining('"type":"login"'),
    );
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('PromoBot');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('enters the shell when an existing cookie-backed session probe succeeds and clears legacy password storage', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { localStorage, sessionStorage } = installAuthStorage(window, {
      localStorage: createStorageArea('legacy-secret'),
      sessionStorage: createStorageArea('legacy-secret'),
    });

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/probe') {
        return Promise.resolve(
          new Response(null, {
            status: 204,
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/probe',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('promobot_admin_password');
    expect(localStorage.removeItem).toHaveBeenCalledWith('promobot_admin_password');
    expect(localStorage.removeItem).toHaveBeenCalledWith('promobot_admin_password_mode');
    expect(localStorage.setItem).not.toHaveBeenCalledWith('promobot_auth_sync', expect.any(String));
    expect(collectText(container)).toContain('PromoBot');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('passes remember=true into the login request when remember this browser is enabled', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/probe') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        );
      }

      if (String(input) === '/api/auth/login') {
        expect(init).toEqual({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            password: 'secret',
            remember: true,
          }),
        });

        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
    });

    const passwordInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && (element as { type?: string }).type === 'password',
    );
    const rememberCheckbox = findElement(
      container,
      (element) => element.tagName === 'INPUT' && (element as { type?: string }).type === 'checkbox',
    );
    const submitButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('进入控制台'),
    );

    await act(async () => {
      updateFieldValue(passwordInput as never, 'secret', window as never);
      await flush();
    });

    await act(async () => {
      (rememberCheckbox as { checked?: boolean; dispatchEvent: (event: Event) => void }).checked = true;
      rememberCheckbox?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('returns to the login page when a later auth error event fires', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/probe') {
        return Promise.resolve(
          new Response(null, {
            status: 204,
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/probe',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(collectText(container)).toContain('PromoBot');
    expect(collectText(container)).not.toContain('Admin Login');

    await act(async () => {
      const authErrorEvent = new window.Event('promobot-auth-error');
      Object.defineProperty(authErrorEvent, 'detail', {
        configurable: true,
        value: { message: '管理员登录已过期' },
      });
      window.dispatchEvent(
        authErrorEvent,
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).toContain('登录失败：管理员登录已过期');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('logs out through the session api and returns to the login page', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { localStorage } = installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/probe') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (String(input) === '/api/auth/logout') {
        expect(init).toEqual({
          method: 'POST',
        });

        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('PromoBot');

    const logoutButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('退出登录'),
    );

    expect(logoutButton).not.toBeNull();

    await act(async () => {
      logoutButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'promobot_auth_sync',
      expect.stringContaining('"type":"logout"'),
    );
    expect(collectText(container)).toContain('Admin Login');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('returns to the login page when another tab broadcasts a logout storage event', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/probe') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('PromoBot');

    await act(async () => {
      dispatchStorageEvent(window as never, {
        key: 'promobot_auth_sync',
        newValue: JSON.stringify({
          type: 'logout',
          message: '已在其他标签页退出登录',
          at: '2026-05-02T04:00:00.000Z',
        }),
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).toContain('登录失败：已在其他标签页退出登录');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores a stale auth probe success after another tab broadcasts logout', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');

    let resolveProbe: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/probe') {
        return new Promise<Response>((resolve) => {
          resolveProbe = resolve;
        });
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
    });

    await act(async () => {
      dispatchStorageEvent(window as never, {
        key: 'promobot_auth_sync',
        newValue: JSON.stringify({
          type: 'logout',
          message: '已在其他标签页退出登录',
          at: '2026-05-02T04:03:00.000Z',
        }),
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).toContain('登录失败：已在其他标签页退出登录');

    await act(async () => {
      resolveProbe?.(new Response(null, { status: 204 }));
      await flush();
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).not.toContain('Dashboard');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('re-probes the admin session when another tab broadcasts a login storage event', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');

    let probeCount = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/probe') {
        probeCount += 1;

        if (probeCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'unauthorized' }), {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            }),
          );
        }

        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(
        jsonResponse({
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: null }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).not.toContain('退出登录');

    await act(async () => {
      dispatchStorageEvent(window as never, {
        key: 'promobot_auth_sync',
        newValue: JSON.stringify({
          type: 'login',
          at: '2026-05-02T04:05:00.000Z',
        }),
      });
      await flush();
      await flush();
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/probe',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(probeCount).toBe(2);
    expect(collectText(container)).toContain('PromoBot');
    expect(collectText(container)).not.toContain('Admin Login');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
