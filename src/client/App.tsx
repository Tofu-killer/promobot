import { useState } from 'react';
import { Layout } from './components/Layout';
import type { AppRoute, NavItem } from './lib/types';
import { DashboardPage } from './pages/Dashboard';
import { DiscoveryPage } from './pages/Discovery';
import { DraftsPage } from './pages/Drafts';
import { GeneratePage } from './pages/Generate';
import { InboxPage } from './pages/Inbox';
import { MonitorPage } from './pages/Monitor';
import { ProjectsPage } from './pages/Projects';
import { PublishCalendarPage } from './pages/PublishCalendar';
import { ReputationPage } from './pages/Reputation';
import { ReviewQueuePage } from './pages/ReviewQueue';
import { SettingsPage } from './pages/Settings';
import { ChannelAccountsPage } from './pages/ChannelAccounts';

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', description: '总览今日运营节奏' },
  { id: 'projects', label: 'Projects', description: '多品牌与站点上下文' },
  { id: 'discovery', label: 'Discovery Pool', description: '选题与趋势来源' },
  { id: 'generate', label: 'Generate Center', description: '一键生成多平台草稿' },
  { id: 'drafts', label: 'Drafts', description: '候选内容与编辑' },
  { id: 'review', label: 'Review Queue', description: '高风险内容审核' },
  { id: 'calendar', label: 'Publish Calendar', description: '排程与发布时间' },
  { id: 'inbox', label: 'Social Inbox', description: '统一收件箱与回复' },
  { id: 'monitor', label: 'Competitor Monitor', description: '竞品与趋势追踪' },
  { id: 'reputation', label: 'Reputation', description: '口碑与情感分析' },
  { id: 'channels', label: 'Channel Accounts', description: '平台账号与登录态' },
  { id: 'settings', label: 'Settings', description: '系统配置与安全策略' }
];

function renderRoute(route: AppRoute) {
  switch (route) {
    case 'dashboard':
      return <DashboardPage />;
    case 'projects':
      return <ProjectsPage />;
    case 'discovery':
      return <DiscoveryPage />;
    case 'generate':
      return <GeneratePage />;
    case 'drafts':
      return <DraftsPage />;
    case 'review':
      return <ReviewQueuePage />;
    case 'calendar':
      return <PublishCalendarPage />;
    case 'inbox':
      return <InboxPage />;
    case 'monitor':
      return <MonitorPage />;
    case 'reputation':
      return <ReputationPage />;
    case 'channels':
      return <ChannelAccountsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

interface AppProps {
  initialRoute?: AppRoute;
}

export default function App({ initialRoute = 'dashboard' }: AppProps) {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(initialRoute);

  return (
    <Layout activeRoute={activeRoute} navItems={navItems} onNavigate={setActiveRoute}>
      {renderRoute(activeRoute)}
    </Layout>
  );
}
