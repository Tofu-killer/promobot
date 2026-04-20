import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App shell', () => {
  it('renders the PromoBot navigation shell when admin auth is satisfied', () => {
    const html = renderToStaticMarkup(<App initialAdminPassword="secret" />);

    expect(html).toContain('PromoBot');
    expect(html).toContain('Dashboard');
    expect(html).toContain('System Queue');
    expect(html).toContain('Projects');
    expect(html).toContain('Discovery Pool');
    expect(html).toContain('Generate Center');
    expect(html).toContain('Social Inbox');
    expect(html).toContain('Competitor Monitor');
    expect(html).toContain('Channel Accounts');
    expect(html).toContain('Settings');
  });

  it('renders the admin login page when no admin password is present', () => {
    const html = renderToStaticMarkup(<App initialAdminPassword={null} />);

    expect(html).toContain('Admin Login');
    expect(html).not.toContain('Dashboard');
  });

  it('keeps the shared raw projectId draft when switching between dashboard, generate, and monitor', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const localStorage = {
      getItem: () => 'secret',
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    (window as unknown as { localStorage: typeof localStorage }).localStorage = localStorage;
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
      await flush();
      await flush();
      await flush();
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
      await flush();
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
      await flush();
      await flush();
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
      await flush();
      await flush();
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

  it('keeps the login page when a stored admin password fails probe validation', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const localStorage = {
      getItem: () => 'wrong-secret',
      setItem: () => undefined,
      removeItem: vi.fn(),
    };
    (window as unknown as { localStorage: typeof localStorage }).localStorage = localStorage;

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
        headers: expect.any(Headers),
      }),
    );
    expect(collectText(container)).toContain('Admin Login');
    expect(collectText(container)).not.toContain('Dashboard');
    expect(collectText(container)).toContain('登录失败：管理员密码无效');
    expect(localStorage.removeItem).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('validates the submitted admin password before entering the shell', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const localStorage = {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: () => undefined,
    };
    (window as unknown as { localStorage: typeof localStorage }).localStorage = localStorage;

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
      '/api/auth/probe',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith('promobot_admin_password', 'secret');
    expect(collectText(container)).toContain('PromoBot');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
