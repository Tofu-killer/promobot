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

function createStorageArea(initialValue: string | null = null) {
  let storedValue = initialValue;

  return {
    getItem: vi.fn((_key: string) => storedValue),
    setItem: vi.fn((_key: string, value: string) => {
      storedValue = value;
    }),
    removeItem: vi.fn((_key: string) => {
      storedValue = null;
    }),
    peek: () => storedValue,
  };
}

function installAuthStorage<
  TStorage extends {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  },
>(
  window: unknown,
  storage: {
    localStorage: TStorage;
    sessionStorage: TStorage;
  },
) {
  const storageWindow = window as {
    localStorage: TStorage;
    sessionStorage: TStorage;
  };

  storageWindow.localStorage = storage.localStorage;
  storageWindow.sessionStorage = storage.sessionStorage;

  return storage;
}

function installBrowserHistory(
  window: {
    Event: typeof Event;
    dispatchEvent: (event: Event) => boolean;
    location: { href: string; pathname?: string };
    history?: unknown;
  },
  initialPathname: string,
) {
  const location = window.location;

  const syncLocation = (pathname: string) => {
    location.pathname = pathname;
    location.href = `http://localhost${pathname}`;
    vi.stubGlobal('location', location);
  };

  const history = {
    pushState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
      const nextPathname =
        typeof url === 'string'
          ? new URL(url, location.href).pathname
          : url instanceof URL
            ? url.pathname
            : location.pathname ?? '/';
      syncLocation(nextPathname);
    }),
  };

  window.history = history;
  vi.stubGlobal('history', history);
  syncLocation(initialPathname);

  return history;
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
      await flush();
      await flush();
      await flush();
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
      await flush();
      await flush();
      await flush();
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
      (element) => element.getAttribute('data-discovery-manual-generate-id') === '701',
    );
    expect(manualHandoffButton).not.toBeNull();

    await act(async () => {
      manualHandoffButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
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
      await flush();
      await flush();
      await flush();
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
      await flush();
      await flush();
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
    expect(collectText(container)).toContain('Admin Login');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
