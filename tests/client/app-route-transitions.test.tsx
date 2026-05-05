import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStorageArea,
  installAuthStorage,
  installBrowserHistory,
  jsonResponse,
} from './app-shell-test-helpers';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

function createDeferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve: () => resolve?.(),
  };
}

function createAppFetchStub() {
  return vi.fn((input: RequestInfo | URL) => {
    const requestUrl = new URL(String(input), 'http://localhost');

    if (requestUrl.pathname === '/api/auth/probe') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (requestUrl.pathname === '/api/monitor/dashboard') {
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

    if (requestUrl.pathname === '/api/system/browser-handoffs') {
      return Promise.resolve(
        jsonResponse({
          handoffs: [],
          total: 0,
        }),
      );
    }

    throw new Error(`unexpected fetch request: ${requestUrl.pathname}${requestUrl.search}`);
  });
}

async function flushRender(cycles = 6) {
  for (let index = 0; index < cycles; index += 1) {
    await flush();
  }
}

afterEach(() => {
  vi.doUnmock('../../src/client/pages/Generate');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App route transitions', () => {
  it('keeps the current page content visible while the next lazy route chunk is still loading', async () => {
    const generateModuleDeferred = createDeferred();
    vi.resetModules();
    await import('../../src/client/pages/Dashboard');
    vi.doMock('../../src/client/pages/Generate', async () => {
      await generateModuleDeferred.promise;
      return {
        GeneratePage: () =>
          createElement(
            'section',
            null,
            createElement('p', null, '从一个话题同时生成多平台草稿'),
          ),
      };
    });

    const { default: App } = await import('../../src/client/App');
    const { createRoot } = await import('react-dom/client');
    const { container, window } = installMinimalDom();
    installAuthStorage(window, {
      localStorage: createStorageArea(),
      sessionStorage: createStorageArea('secret'),
    });
    installBrowserHistory(window as never, '/');
    vi.stubGlobal('fetch', createAppFetchStub());

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(App as never, { initialAdminPassword: 'secret' }));
      await flushRender();
    });

    expect(collectText(container)).toContain('先看今天的内容运营节奏');

    const generateNavButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('Generate Center'),
    );
    expect(generateNavButton).not.toBeNull();

    await act(async () => {
      generateNavButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const transitionText = collectText(container);
    expect((window.location as { pathname?: string }).pathname).toBe('/generate');
    expect(transitionText).toContain('先看今天的内容运营节奏');
    expect(transitionText).not.toContain('正在加载页面...');

    await act(async () => {
      generateModuleDeferred.resolve();
      await flushRender();
    });

    expect(collectText(container)).toContain('从一个话题同时生成多平台草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
