import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import type { AppRoute } from '../../src/client/lib/types';
import { ChannelAccountsPage } from '../../src/client/pages/ChannelAccounts';
import { InboxPage } from '../../src/client/pages/Inbox';
import { MonitorPage } from '../../src/client/pages/Monitor';
import { ReputationPage } from '../../src/client/pages/Reputation';
import { SettingsPage } from '../../src/client/pages/Settings';
import { SystemQueuePage } from '../../src/client/pages/SystemQueue';
import {
  createStorageArea,
  installAuthStorage,
  installBrowserHistory,
  jsonResponse,
  settleLazyRouteRender,
} from './app-shell-test-helpers';
import { collectText, flush, installMinimalDom } from './settings-test-helpers';

const routePathById: Record<AppRoute, string> = {
  dashboard: '/',
  queue: '/queue',
  projects: '/projects',
  discovery: '/discovery',
  generate: '/generate',
  drafts: '/drafts',
  review: '/review',
  calendar: '/calendar',
  inbox: '/inbox',
  monitor: '/monitor',
  reputation: '/reputation',
  channels: '/channels',
  settings: '/settings',
};

function createAppShellFetchStub() {
  return (input: RequestInfo | URL) => {
    const requestUrl = new URL(String(input), 'http://localhost');
    const { pathname, searchParams } = requestUrl;

    if (pathname === '/api/auth/probe') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (pathname === '/api/inbox') {
      return Promise.resolve(
        jsonResponse({
          items: [],
          total: 0,
          unread: 0,
        }),
      );
    }

    if (pathname === '/api/monitor/feed') {
      return Promise.resolve(
        jsonResponse({
          items: [],
          total: 0,
        }),
      );
    }

    if (pathname === '/api/reputation/stats') {
      return Promise.resolve(
        jsonResponse({
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          trend: [],
          items: [],
        }),
      );
    }

    if (pathname === '/api/channel-accounts') {
      return Promise.resolve(
        jsonResponse({
          channelAccounts: [],
        }),
      );
    }

    if (pathname === '/api/settings') {
      return Promise.resolve(
        jsonResponse({
          settings: {
            allowlist: ['127.0.0.1'],
            schedulerIntervalMinutes: 15,
            rssDefaults: [],
            monitorRssFeeds: [],
            monitorXQueries: [],
            monitorRedditQueries: [],
            monitorV2exQueries: [],
          },
        }),
      );
    }

    if (pathname === '/api/system/jobs' && searchParams.get('limit') === '20') {
      return Promise.resolve(
        jsonResponse({
          jobs: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        }),
      );
    }

    if (pathname === '/api/system/jobs' && searchParams.get('limit') === '50') {
      return Promise.resolve(
        jsonResponse({
          jobs: [],
          queue: {
            pending: 0,
            running: 0,
            done: 0,
            failed: 0,
            canceled: 0,
            duePending: 0,
          },
          recentJobs: [],
        }),
      );
    }

    if (pathname === '/api/system/browser-lane-requests' && searchParams.has('limit')) {
      return Promise.resolve(
        jsonResponse({
          requests: [],
          total: 0,
        }),
      );
    }

    if (pathname === '/api/system/browser-handoffs' && searchParams.has('limit')) {
      return Promise.resolve(
        jsonResponse({
          handoffs: [],
          total: 0,
        }),
      );
    }

    if (pathname === '/api/system/inbox-reply-handoffs') {
      return Promise.resolve(
        jsonResponse({
          handoffs: [],
          total: 0,
        }),
      );
    }

    throw new Error(`unexpected fetch request: ${url}`);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderAppRoute(route: AppRoute) {
  const { container, window } = installMinimalDom();
  const { createRoot } = await import('react-dom/client');
  installAuthStorage(window, {
    localStorage: createStorageArea(),
    sessionStorage: createStorageArea('secret'),
  });
  installBrowserHistory(window as never, routePathById[route]);
  vi.stubGlobal('fetch', vi.fn(createAppShellFetchStub()));

  const root = createRoot(container as never);
  await act(async () => {
    root.render(
      createElement(
        App as unknown as (props: { initialRoute: AppRoute; initialAdminPassword: string }) => React.JSX.Element,
        { initialRoute: route, initialAdminPassword: 'secret' },
      ),
    );
    await settleLazyRouteRender();
  });

  const renderedText = collectText(container);
  await act(async () => {
    root.unmount();
    await flush();
  });

  return renderedText;
}

describe('Operations pages', () => {
  it('renders the Social Inbox triage summary and reply actions', () => {
    const html = renderToStaticMarkup(<InboxPage />);

    expect(html).toContain('Social Inbox');
    expect(html).toContain('待处理会话');
    expect(html).toContain('AI 生成回复');
    expect(html).toContain('打开原帖');
  });

  it('renders the competitor monitor feed controls', () => {
    const html = renderToStaticMarkup(<MonitorPage />);

    expect(html).toContain('Competitor Monitor');
    expect(html).toContain('监控源');
    expect(html).toContain('生成跟进草稿');
    expect(html).toContain('来源筛选');
  });

  it('renders the reputation summary with escalation actions', () => {
    const html = renderToStaticMarkup(<ReputationPage />);

    expect(html).toContain('Reputation');
    expect(html).toContain('负面提及');
    expect(html).toContain('标记已处理');
    expect(html).toContain('情绪分布');
  });

  it('renders the channel accounts health view', () => {
    const html = renderToStaticMarkup(<ChannelAccountsPage />);

    expect(html).toContain('Channel Accounts');
    expect(html).toContain('连接状态');
    expect(html).toContain('测试连接');
    expect(html).toContain('重新登录');
  });

  it('renders the settings controls for scheduler and allowlist', () => {
    const html = renderToStaticMarkup(<SettingsPage />);

    expect(html).toContain('Settings');
    expect(html).toContain('调度间隔');
    expect(html).toContain('LAN allowlist');
    expect(html).toContain('保存设置');
  });

  it('renders the system queue controls and job workbench', () => {
    const html = renderToStaticMarkup(<SystemQueuePage />);

    expect(html).toContain('System Queue');
    expect(html).toContain('Pending Jobs');
    expect(html).toContain('创建作业');
    expect(html).toContain('队列作业');
  });
});

describe('App route shell', () => {
  it.each([
    ['inbox', 'Social Inbox'],
    ['monitor', 'Competitor Monitor'],
    ['reputation', 'Reputation'],
    ['channels', 'Channel Accounts'],
    ['settings', 'Settings'],
    ['queue', 'System Queue']
  ] as const)('renders %s through the navigation shell', async (route, heading) => {
    const html = await renderAppRoute(route);

    expect(html).toContain('PromoBot');
    expect(html).toContain(heading);
  });
});
