import { vi } from 'vitest';
import { flush } from './settings-test-helpers';

let preloadRouteModulesPromise: Promise<void> | null = null;

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export function createStorageArea(initialValue: string | null = null) {
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

export function installAuthStorage<
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

export function installBrowserHistory(
  window: {
    Event: typeof Event;
    dispatchEvent: (event: Event) => boolean;
    location: { href: string; pathname?: string };
    history?: unknown;
  },
  initialPathname: string,
) {
  const location = window.location;
  const entries: Array<{
    pathname: string;
    state: unknown;
  }> = [
    {
      pathname: initialPathname,
      state: null,
    },
  ];
  let currentIndex = 0;

  const syncLocation = (pathname: string) => {
    location.pathname = pathname;
    location.href = `http://localhost${pathname}`;
    vi.stubGlobal('location', location);
  };

  const resolvePathname = (url?: string | URL | null) =>
    typeof url === 'string'
      ? new URL(url, location.href).pathname
      : url instanceof URL
        ? url.pathname
        : entries[currentIndex]?.pathname ?? location.pathname ?? '/';

  const dispatchPopState = (state: unknown) => {
    const popStateEvent = new window.Event('popstate');
    Object.defineProperty(popStateEvent, 'state', {
      configurable: true,
      value: state,
    });
    window.dispatchEvent(popStateEvent);
  };

  const history = {
    get state() {
      return entries[currentIndex]?.state ?? null;
    },
    pushState: vi.fn((state: unknown, _unused: string, url?: string | URL | null) => {
      const nextPathname = resolvePathname(url);
      entries.splice(currentIndex + 1);
      entries.push({
        pathname: nextPathname,
        state,
      });
      currentIndex = entries.length - 1;
      syncLocation(nextPathname);
    }),
    replaceState: vi.fn((state: unknown, _unused: string, url?: string | URL | null) => {
      const nextPathname = resolvePathname(url);
      entries[currentIndex] = {
        pathname: nextPathname,
        state,
      };
      syncLocation(nextPathname);
    }),
    back: vi.fn(() => {
      if (currentIndex === 0) {
        return;
      }

      currentIndex -= 1;
      syncLocation(entries[currentIndex]?.pathname ?? '/');
      dispatchPopState(entries[currentIndex]?.state ?? null);
    }),
    forward: vi.fn(() => {
      if (currentIndex >= entries.length - 1) {
        return;
      }

      currentIndex += 1;
      syncLocation(entries[currentIndex]?.pathname ?? '/');
      dispatchPopState(entries[currentIndex]?.state ?? null);
    }),
  };

  window.history = history;
  vi.stubGlobal('history', history);
  syncLocation(entries[currentIndex]?.pathname ?? initialPathname);

  return history;
}

export function preloadAppRouteModules() {
  if (!preloadRouteModulesPromise) {
    preloadRouteModulesPromise = Promise.all([
      import('../../src/client/pages/Dashboard'),
      import('../../src/client/pages/Discovery'),
      import('../../src/client/pages/Drafts'),
      import('../../src/client/pages/Generate'),
      import('../../src/client/pages/Inbox'),
      import('../../src/client/pages/Monitor'),
      import('../../src/client/pages/Projects'),
      import('../../src/client/pages/PublishCalendar'),
      import('../../src/client/pages/Reputation'),
      import('../../src/client/pages/ReviewQueue'),
      import('../../src/client/pages/Settings'),
      import('../../src/client/pages/ChannelAccounts'),
      import('../../src/client/pages/SystemQueue'),
    ]).then(() => undefined);
  }

  return preloadRouteModulesPromise;
}

export async function settleLazyRouteRender(cycles = 6) {
  await preloadAppRouteModules();
  for (let index = 0; index < cycles; index += 1) {
    await flush();
  }
}
