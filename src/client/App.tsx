import { useEffect, useRef, useState } from 'react';
import { Layout } from './components/Layout';
import {
  clearStoredAdminPassword,
  getAuthErrorEventName,
  loginAdminSession,
  logoutAdminSession,
  probeAdminSession,
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

const knownRoutes = new Set<AppRoute>(navItems.map((item) => item.id));

function normalizeRoutePath(pathname: string | null | undefined) {
  if (!pathname) {
    return '/';
  }

  const normalizedPath = pathname.replace(/\/+$/, '');
  return normalizedPath === '' ? '/' : normalizedPath;
}

function getRouteFromPathname(pathname: string | null | undefined, fallback: AppRoute) {
  const normalizedPath = normalizeRoutePath(pathname);

  if (normalizedPath === '/' || normalizedPath === '/dashboard') {
    return 'dashboard';
  }

  const candidate = normalizedPath.slice(1) as AppRoute;
  return knownRoutes.has(candidate) ? candidate : fallback;
}

function parseProjectIdDraft(value: string) {
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  const projectId = Number(normalizedValue);
  return Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null;
}

interface GeneratePrefillState {
  token: number;
  topic: string;
  preferredPlatforms: string[];
}

interface InboxFocusState {
  token: number;
  itemId: number;
}

function renderRoute(
  route: AppRoute,
  sharedProjectIdDraft: string,
  onProjectIdDraftChange: (value: string) => void,
  onNavigateToRoute: (route: AppRoute) => void,
  generatePrefillState: GeneratePrefillState | null,
  onOpenGenerateCenter: (input: { topic: string; preferredPlatforms: string[] }) => void,
  onGeneratePrefillApplied: () => void,
  inboxFocusState: InboxFocusState | null,
  onOpenInboxItem: (input: { itemId: number; projectIdDraft: string; projectId?: number }) => void,
  onInboxFocusApplied: () => void,
) {
  switch (route) {
    case 'dashboard':
      return (
        <DashboardPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          onNavigateToRoute={onNavigateToRoute}
        />
      );
    case 'queue':
      return <SystemQueuePage />;
    case 'projects':
      return <ProjectsPage />;
    case 'discovery':
      return (
        <DiscoveryPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          onOpenGenerateCenter={onOpenGenerateCenter}
        />
      );
    case 'generate':
      return (
        <GeneratePage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          prefilledTopic={generatePrefillState?.topic}
          preferredPlatforms={generatePrefillState?.preferredPlatforms}
          prefillToken={generatePrefillState?.token}
          onPrefillApplied={onGeneratePrefillApplied}
        />
      );
    case 'drafts':
      return <DraftsPage projectIdDraft={sharedProjectIdDraft} onProjectIdDraftChange={onProjectIdDraftChange} />;
    case 'review':
      return (
        <ReviewQueuePage projectIdDraft={sharedProjectIdDraft} onProjectIdDraftChange={onProjectIdDraftChange} />
      );
    case 'calendar':
      return (
        <PublishCalendarPage projectIdDraft={sharedProjectIdDraft} onProjectIdDraftChange={onProjectIdDraftChange} />
      );
    case 'inbox':
      return (
        <InboxPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          onOpenGenerateCenter={onOpenGenerateCenter}
          focusInboxItem={inboxFocusState}
          onInboxItemFocusApplied={onInboxFocusApplied}
        />
      );
    case 'monitor':
      return (
        <MonitorPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          onOpenGenerateCenter={onOpenGenerateCenter}
        />
      );
    case 'reputation':
      return (
        <ReputationPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          onOpenInboxItem={onOpenInboxItem}
        />
      );
    case 'channels':
      return <ChannelAccountsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return (
        <DashboardPage
          projectIdDraft={sharedProjectIdDraft}
          onProjectIdDraftChange={onProjectIdDraftChange}
          onNavigateToRoute={onNavigateToRoute}
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
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() =>
    typeof window === 'undefined'
      ? initialRoute
      : getRouteFromPathname(window.location.pathname, initialRoute),
  );
  const [sharedProjectIdDraft, setSharedProjectIdDraft] = useState('');
  const [generatePrefillState, setGeneratePrefillState] = useState<GeneratePrefillState | null>(null);
  const [inboxFocusState, setInboxFocusState] = useState<InboxFocusState | null>(null);
  const authSyncVersionRef = useRef(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    typeof window === 'undefined'
      ? initialAdminPassword
        ? 'authenticated'
        : 'anonymous'
      : 'booting',
  );
  const [authError, setAuthError] = useState<string | null>(null);

  const syncAdminSession = (nextAuthError: string | null = null) => {
    const authSyncVersion = ++authSyncVersionRef.current;
    setAuthStatus('checking');

    void probeAdminSession()
      .then(() => {
        if (authSyncVersionRef.current !== authSyncVersion) {
          return;
        }

        setAuthError(null);
        setAuthStatus('authenticated');
      })
      .catch((error) => {
        if (authSyncVersionRef.current !== authSyncVersion) {
          return;
        }

        clearStoredAdminPassword();
        void error;
        setAuthError(nextAuthError);
        setAuthStatus('anonymous');
      });
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    syncAdminSession();
  }, [initialAdminPassword]);

  useEffect(() => {
    const handleAuthError = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail?.message === 'string'
          ? event.detail.message
          : '管理员登录已过期';
      clearStoredAdminPassword();
      setAuthError(detail);
      setAuthStatus('anonymous');
    };

    window.addEventListener(getAuthErrorEventName(), handleAuthError);
    return () => {
      window.removeEventListener(getAuthErrorEventName(), handleAuthError);
    };
  }, []);

  useEffect(() => {
    const syncRouteFromLocation = () => {
      setActiveRoute((currentRoute) => getRouteFromPathname(window.location.pathname, currentRoute));
    };

    syncRouteFromLocation();
    window.addEventListener('popstate', syncRouteFromLocation);
    return () => {
      window.removeEventListener('popstate', syncRouteFromLocation);
    };
  }, []);

  const handleNavigate = (route: AppRoute) => {
    setActiveRoute(route);

    if (typeof window.history?.pushState !== 'function') {
      return;
    }

    const nextPath = routePathById[route];
    if (normalizeRoutePath(window.location.pathname) !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
  };

  const handleOpenGenerateCenter = (input: { topic: string; preferredPlatforms: string[] }) => {
    setGeneratePrefillState((currentState) => ({
      token: (currentState?.token ?? 0) + 1,
      topic: input.topic,
      preferredPlatforms: input.preferredPlatforms,
    }));
    handleNavigate('generate');
  };

  const handleOpenInboxItem = (input: { itemId: number; projectIdDraft: string; projectId?: number }) => {
    const requestedProjectId = parseProjectIdDraft(input.projectIdDraft);
    const nextProjectIdDraft =
      requestedProjectId !== null
        ? input.projectIdDraft
        : input.projectId !== undefined
          ? String(input.projectId)
          : '';

    setSharedProjectIdDraft(nextProjectIdDraft);
    setInboxFocusState((currentState) => ({
      token: (currentState?.token ?? 0) + 1,
      itemId: input.itemId,
    }));
    handleNavigate('inbox');
  };

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

  if (authStatus !== 'authenticated') {
    return (
      <LoginPage
        error={authError}
        onSubmit={async (password, options) => {
          const trimmed = password.trim();
          if (!trimmed) {
            setAuthError('管理员密码不能为空');
            return;
          }

          setAuthError(null);
          setAuthStatus('checking');

          try {
            await loginAdminSession(trimmed, { remember: options?.remember === true });
            setAuthStatus('authenticated');
            setAuthError(null);
          } catch (error) {
            clearStoredAdminPassword();
            setAuthError(error instanceof Error ? error.message : '管理员密码无效');
            setAuthStatus('anonymous');
          }
        }}
      />
    );
  }

  return (
    <Layout
      activeRoute={activeRoute}
      navItems={navItems}
      onNavigate={handleNavigate}
      onLogout={() => {
        setAuthStatus('checking');

        void logoutAdminSession()
          .catch(() => {
            // Ignore logout transport failures and fall back to a local sign-out.
          })
          .finally(() => {
            clearStoredAdminPassword();
            setAuthError(null);
            setAuthStatus('anonymous');
          });
      }}
    >
      {renderRoute(
        activeRoute,
        sharedProjectIdDraft,
        setSharedProjectIdDraft,
        handleNavigate,
        generatePrefillState,
        handleOpenGenerateCenter,
        () => setGeneratePrefillState(null),
        inboxFocusState,
        handleOpenInboxItem,
        () => setInboxFocusState(null),
      )}
    </Layout>
  );
}
