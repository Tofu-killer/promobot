import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../../src/client/App';
import type { AppRoute } from '../../src/client/lib/types';
import { ChannelAccountsPage } from '../../src/client/pages/ChannelAccounts';
import { InboxPage } from '../../src/client/pages/Inbox';
import { MonitorPage } from '../../src/client/pages/Monitor';
import { ReputationPage } from '../../src/client/pages/Reputation';
import { SettingsPage } from '../../src/client/pages/Settings';

function renderAppRoute(route: AppRoute) {
  return renderToStaticMarkup(
    createElement(App as unknown as (props: { initialRoute: AppRoute }) => React.JSX.Element, { initialRoute: route })
  );
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
});

describe('App route shell', () => {
  it.each([
    ['inbox', 'Social Inbox'],
    ['monitor', 'Competitor Monitor'],
    ['reputation', 'Reputation'],
    ['channels', 'Channel Accounts'],
    ['settings', 'Settings']
  ] as const)('renders %s through the navigation shell', (route, heading) => {
    const html = renderAppRoute(route);

    expect(html).toContain('PromoBot');
    expect(html).toContain(heading);
  });
});
