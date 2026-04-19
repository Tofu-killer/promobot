import { useState } from 'react';
import { Layout } from './components/Layout';
import type { AppRoute, NavItem } from './lib/types';
import { DashboardPage } from './pages/Dashboard';
import { DiscoveryPage } from './pages/Discovery';
import { DraftsPage } from './pages/Drafts';
import { GeneratePage } from './pages/Generate';
import { ProjectsPage } from './pages/Projects';
import { PublishCalendarPage } from './pages/PublishCalendar';
import { ReviewQueuePage } from './pages/ReviewQueue';

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

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section>
      <h2 style={{ margin: 0, fontSize: '32px' }}>{title}</h2>
      <p style={{ marginTop: '12px', color: '#475569', maxWidth: '760px' }}>{description}</p>
    </section>
  );
}

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
      return <PlaceholderPage title="Social Inbox" description="统一查看命中关键词的帖子、AI 回复建议和人工接管入口。" />;
    case 'monitor':
      return <PlaceholderPage title="Competitor Monitor" description="竞品动态、RSS 与关键词搜索结果会汇总在这里。" />;
    case 'reputation':
      return <PlaceholderPage title="Reputation" description="口碑追踪会展示正负面趋势、关键词情绪和处理状态。" />;
    case 'channels':
      return <PlaceholderPage title="Channel Accounts" description="管理各平台 API 凭证、Playwright session 与重新登录入口。" />;
    case 'settings':
      return <PlaceholderPage title="Settings" description="系统参数、访问控制和任务调度开关会放在这里。" />;
    default:
      return <DashboardPage />;
  }
}

export default function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>('dashboard');

  return (
    <Layout activeRoute={activeRoute} navItems={navItems} onNavigate={setActiveRoute}>
      {renderRoute(activeRoute)}
    </Layout>
  );
}
