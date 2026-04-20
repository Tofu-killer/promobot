import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import {
  clearStoredAdminPassword,
  getAuthErrorEventName,
  getStoredAdminPassword,
  storeAdminPassword,
  validateAdminPassword,
} from './lib/api';
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
import { SystemQueuePage } from './pages/SystemQueue';
import { LoginPage } from './pages/Login';

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', description: '总览今日运营节奏' },
  { id: 'queue', label: 'System Queue', description: '调度队列与作业控制' },
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

function renderRoute(
  route: AppRoute,
  sharedProjectIdDraft: string,
  onProjectIdDraftChange: (value: string) => void,
) {
  switch (route) {
    case 'dashboard':
      return (
        <DashboardPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
        />
      );
    case 'queue':
      return <SystemQueuePage />;
    case 'projects':
      return <ProjectsPage />;
    case 'discovery':
      return <DiscoveryPage />;
    case 'generate':
      return (
        <GeneratePage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
        />
      );
    case 'drafts':
      return <DraftsPage />;
    case 'review':
      return <ReviewQueuePage />;
    case 'calendar':
      return <PublishCalendarPage />;
    case 'inbox':
      return <InboxPage />;
    case 'monitor':
      return (
        <MonitorPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
        />
      );
    case 'reputation':
      return <ReputationPage />;
    case 'channels':
      return <ChannelAccountsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return (
        <DashboardPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
        />
      );
  }
}

interface AppProps {
  initialRoute?: AppRoute;
  initialAdminPassword?: string | null;
}

type AuthStatus = 'booting' | 'checking' | 'authenticated' | 'anonymous';

export default function App({ initialRoute = 'dashboard', initialAdminPassword = null }: AppProps) {
  const initialCandidatePassword =
    typeof window === 'undefined'
      ? initialAdminPassword
      : getStoredAdminPassword() ?? initialAdminPassword;
  const [activeRoute, setActiveRoute] = useState<AppRoute>(initialRoute);
  const [sharedProjectIdDraft, setSharedProjectIdDraft] = useState('');
  const [adminPassword, setAdminPassword] = useState<string | null>(initialCandidatePassword);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    typeof window === 'undefined'
      ? initialCandidatePassword
        ? 'authenticated'
        : 'anonymous'
      : initialCandidatePassword
        ? 'booting'
        : 'anonymous',
  );
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const candidatePassword = getStoredAdminPassword() ?? initialAdminPassword;

    if (!candidatePassword) {
      setAdminPassword(null);
      setAuthStatus('anonymous');
      return;
    }

    setAuthStatus('checking');

    void validateAdminPassword(candidatePassword)
      .then(() => {
        setAdminPassword(candidatePassword);
        setAuthError(null);
        setAuthStatus('authenticated');
      })
      .catch((error) => {
        clearStoredAdminPassword();
        setAdminPassword(null);
        setAuthError(error instanceof Error ? error.message : '管理员密码无效');
        setAuthStatus('anonymous');
      });
  }, [initialAdminPassword]);

  useEffect(() => {
    const handleAuthError = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail?.message === 'string'
          ? event.detail.message
          : '管理员密码无效';
      clearStoredAdminPassword();
      setAdminPassword(null);
      setAuthStatus('anonymous');
      setAuthError(detail);
    };

    window.addEventListener(getAuthErrorEventName(), handleAuthError);
    return () => {
      window.removeEventListener(getAuthErrorEventName(), handleAuthError);
    };
  }, []);

  if (authStatus === 'booting' || authStatus === 'checking') {
    return (
      <section
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f5f7fb',
          padding: '32px',
        }}
      >
        <div style={{ color: '#334155', fontWeight: 700 }}>正在验证管理员权限...</div>
      </section>
    );
  }

  if (authStatus !== 'authenticated' || !adminPassword) {
    return (
      <LoginPage
        error={authError}
        onSubmit={async (password) => {
          const trimmed = password.trim();
          if (!trimmed) {
            setAuthError('管理员密码不能为空');
            return;
          }

          setAuthError(null);
          setAuthStatus('checking');

          try {
            await validateAdminPassword(trimmed);
            storeAdminPassword(trimmed);
            setAdminPassword(trimmed);
            setAuthStatus('authenticated');
          } catch (error) {
            clearStoredAdminPassword();
            setAdminPassword(null);
            setAuthError(error instanceof Error ? error.message : '管理员密码无效');
            setAuthStatus('anonymous');
          }
        }}
      />
    );
  }

  return (
    <Layout activeRoute={activeRoute} navItems={navItems} onNavigate={setActiveRoute}>
      {renderRoute(activeRoute, sharedProjectIdDraft, setSharedProjectIdDraft)}
    </Layout>
  );
}
