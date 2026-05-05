import {
  Component,
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Layout } from './components/Layout';
import {
  clearStoredAdminPassword,
  getAuthErrorEventName,
  getAuthSyncStorageKey,
  loginAdminSession,
  logoutAdminSession,
  probeAdminSession,
} from './lib/api';
import type { AppRoute, NavItem } from './lib/types';
import { LoginPage } from './pages/Login';

const loadDashboardPageModule = () => import('./pages/Dashboard');
const loadDiscoveryPageModule = () => import('./pages/Discovery');
const loadDraftsPageModule = () => import('./pages/Drafts');
const loadGeneratePageModule = () => import('./pages/Generate');
const loadInboxPageModule = () => import('./pages/Inbox');
const loadMonitorPageModule = () => import('./pages/Monitor');
const loadProjectsPageModule = () => import('./pages/Projects');
const loadPublishCalendarPageModule = () => import('./pages/PublishCalendar');
const loadReputationPageModule = () => import('./pages/Reputation');
const loadReviewQueuePageModule = () => import('./pages/ReviewQueue');
const loadSettingsPageModule = () => import('./pages/Settings');
const loadChannelAccountsPageModule = () => import('./pages/ChannelAccounts');
const loadSystemQueuePageModule = () => import('./pages/SystemQueue');

const DashboardPage = lazy(async () => ({
  default: (await loadDashboardPageModule()).DashboardPage,
}));
const DiscoveryPage = lazy(async () => ({
  default: (await loadDiscoveryPageModule()).DiscoveryPage,
}));
const DraftsPage = lazy(async () => ({
  default: (await loadDraftsPageModule()).DraftsPage,
}));
const GeneratePage = lazy(async () => ({
  default: (await loadGeneratePageModule()).GeneratePage,
}));
const InboxPage = lazy(async () => ({
  default: (await loadInboxPageModule()).InboxPage,
}));
const MonitorPage = lazy(async () => ({
  default: (await loadMonitorPageModule()).MonitorPage,
}));
const ProjectsPage = lazy(async () => ({
  default: (await loadProjectsPageModule()).ProjectsPage,
}));
const PublishCalendarPage = lazy(async () => ({
  default: (await loadPublishCalendarPageModule()).PublishCalendarPage,
}));
const ReputationPage = lazy(async () => ({
  default: (await loadReputationPageModule()).ReputationPage,
}));
const ReviewQueuePage = lazy(async () => ({
  default: (await loadReviewQueuePageModule()).ReviewQueuePage,
}));
const SettingsPage = lazy(async () => ({
  default: (await loadSettingsPageModule()).SettingsPage,
}));
const ChannelAccountsPage = lazy(async () => ({
  default: (await loadChannelAccountsPageModule()).ChannelAccountsPage,
}));
const SystemQueuePage = lazy(async () => ({
  default: (await loadSystemQueuePageModule()).SystemQueuePage,
}));

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

const routeModuleLoaders: Record<AppRoute, () => Promise<unknown>> = {
  dashboard: loadDashboardPageModule,
  queue: loadSystemQueuePageModule,
  projects: loadProjectsPageModule,
  discovery: loadDiscoveryPageModule,
  generate: loadGeneratePageModule,
  drafts: loadDraftsPageModule,
  review: loadReviewQueuePageModule,
  calendar: loadPublishCalendarPageModule,
  inbox: loadInboxPageModule,
  monitor: loadMonitorPageModule,
  reputation: loadReputationPageModule,
  channels: loadChannelAccountsPageModule,
  settings: loadSettingsPageModule,
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

function getInitialRoute(initialRoute: AppRoute) {
  return typeof window === 'undefined' ? initialRoute : getRouteFromPathname(window.location.pathname, initialRoute);
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

interface AppRouteHistoryState {
  sharedProjectIdDraft?: string;
  generatePrefillState?: GeneratePrefillState;
  inboxFocusState?: InboxFocusState;
}

function readGeneratePrefillState(value: unknown): GeneratePrefillState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as {
    token?: unknown;
    topic?: unknown;
    preferredPlatforms?: unknown;
  };
  return typeof candidate.token === 'number' &&
    Number.isFinite(candidate.token) &&
    typeof candidate.topic === 'string' &&
    Array.isArray(candidate.preferredPlatforms) &&
    candidate.preferredPlatforms.every((platform) => typeof platform === 'string')
    ? {
        token: candidate.token,
        topic: candidate.topic,
        preferredPlatforms: candidate.preferredPlatforms,
      }
    : null;
}

function readInboxFocusState(value: unknown): InboxFocusState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as {
    token?: unknown;
    itemId?: unknown;
  };
  return typeof candidate.token === 'number' &&
    Number.isFinite(candidate.token) &&
    typeof candidate.itemId === 'number' &&
    Number.isInteger(candidate.itemId)
    ? {
        token: candidate.token,
        itemId: candidate.itemId,
      }
    : null;
}

function readAppRouteHistoryState(value: unknown): AppRouteHistoryState {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const candidate = value as {
    sharedProjectIdDraft?: unknown;
    generatePrefillState?: unknown;
    inboxFocusState?: unknown;
  };
  const sharedProjectIdDraft =
    typeof candidate.sharedProjectIdDraft === 'string' ? candidate.sharedProjectIdDraft : undefined;
  const generatePrefillState = readGeneratePrefillState(candidate.generatePrefillState);
  const inboxFocusState = readInboxFocusState(candidate.inboxFocusState);

  return {
    ...(sharedProjectIdDraft !== undefined ? { sharedProjectIdDraft } : {}),
    ...(generatePrefillState ? { generatePrefillState } : {}),
    ...(inboxFocusState ? { inboxFocusState } : {}),
  };
}

function createAppRouteHistoryState(
  route: AppRoute,
  input: {
    sharedProjectIdDraft?: string;
    generatePrefillState?: GeneratePrefillState | null;
    inboxFocusState?: InboxFocusState | null;
  } = {},
  existingState: unknown = null,
) {
  const previousState = readAppRouteHistoryState(existingState);
  const baseState = {
    sharedProjectIdDraft: input.sharedProjectIdDraft ?? previousState.sharedProjectIdDraft ?? '',
  } satisfies AppRouteHistoryState;

  if (route === 'generate') {
    const generatePrefillState = input.generatePrefillState ?? previousState.generatePrefillState;
    return generatePrefillState
      ? ({
          ...baseState,
          generatePrefillState,
        } satisfies AppRouteHistoryState)
      : baseState;
  }

  if (route === 'inbox') {
    const inboxFocusState = input.inboxFocusState ?? previousState.inboxFocusState;
    return inboxFocusState
      ? ({
          ...baseState,
          inboxFocusState,
        } satisfies AppRouteHistoryState)
      : baseState;
  }

  return baseState;
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

function RouteLoadingFallback() {
  return (
    <section
      style={{
        borderRadius: '18px',
        border: '1px solid #dbeafe',
        background: '#eff6ff',
        padding: '20px 22px',
      }}
    >
      <div style={{ color: '#1d4ed8', fontWeight: 700 }}>正在加载页面...</div>
      <p style={{ margin: '8px 0 0', color: '#1e3a8a' }}>保留当前导航与路由状态，待页面模块完成加载后再渲染内容。</p>
    </section>
  );
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (this.state.hasError && previousProps.children !== this.props.children) {
      this.setState({
        hasError: false,
      });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #fecaca',
            background: '#fef2f2',
            padding: '20px 22px',
          }}
        >
          <div style={{ color: '#b91c1c', fontWeight: 700 }}>页面加载失败</div>
          <p style={{ margin: '8px 0 0', color: '#7f1d1d' }}>当前页面模块加载异常，请刷新后重试，或先切换到其他页面继续操作。</p>
        </section>
      );
    }

    return this.props.children;
  }
}

interface AppProps {
  initialRoute?: AppRoute;
  initialAdminPassword?: string | null;
}

type AuthStatus = 'booting' | 'checking' | 'authenticated' | 'anonymous';

export default function App({ initialRoute = 'dashboard', initialAdminPassword = null }: AppProps) {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => getInitialRoute(initialRoute));
  const [renderedRoute, setRenderedRoute] = useState<AppRoute>(() => getInitialRoute(initialRoute));
  const [sharedProjectIdDraft, setSharedProjectIdDraft] = useState('');
  const [generatePrefillState, setGeneratePrefillState] = useState<GeneratePrefillState | null>(null);
  const [inboxFocusState, setInboxFocusState] = useState<InboxFocusState | null>(null);
  const authSyncVersionRef = useRef(0);
  const renderedRouteSyncVersionRef = useRef(0);
  const activeRouteRef = useRef(activeRoute);
  const renderedRouteRef = useRef(renderedRoute);
  activeRouteRef.current = activeRoute;
  renderedRouteRef.current = renderedRoute;
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    typeof window === 'undefined'
      ? initialAdminPassword
        ? 'authenticated'
        : 'anonymous'
      : 'booting',
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const cancelPendingAuthSync = () => {
    authSyncVersionRef.current += 1;
  };

  const commitRenderedRouteState = (nextRoute: AppRoute, routeHistoryState: AppRouteHistoryState) => {
    setRenderedRoute(nextRoute);
    if ('sharedProjectIdDraft' in routeHistoryState) {
      setSharedProjectIdDraft(routeHistoryState.sharedProjectIdDraft ?? '');
    }
    setGeneratePrefillState(nextRoute === 'generate' ? routeHistoryState.generatePrefillState ?? null : null);
    setInboxFocusState(nextRoute === 'inbox' ? routeHistoryState.inboxFocusState ?? null : null);
  };

  const scheduleRenderedRouteState = (nextRoute: AppRoute, routeHistoryState: AppRouteHistoryState) => {
    const syncVersion = ++renderedRouteSyncVersionRef.current;
    const commitRouteState = () => {
      if (renderedRouteSyncVersionRef.current !== syncVersion) {
        return;
      }

      startTransition(() => {
        commitRenderedRouteState(nextRoute, routeHistoryState);
      });
    };

    if (nextRoute === renderedRouteRef.current) {
      commitRouteState();
      return;
    }

    void routeModuleLoaders[nextRoute]()
      .catch(() => undefined)
      .finally(commitRouteState);
  };

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
      cancelPendingAuthSync();
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
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorage = (event: Event) => {
      const storageEvent = event as StorageEvent;
      if (storageEvent.key !== getAuthSyncStorageKey() || typeof storageEvent.newValue !== 'string') {
        return;
      }

      let detail: { type?: string; message?: string } | null = null;

      try {
        const parsed = JSON.parse(storageEvent.newValue) as unknown;
        detail = typeof parsed === 'object' && parsed !== null ? (parsed as { type?: string; message?: string }) : null;
      } catch {
        return;
      }

      if (!detail?.type) {
        return;
      }

      if (detail.type === 'login') {
        syncAdminSession();
        return;
      }

      cancelPendingAuthSync();
      clearStoredAdminPassword();
      setAuthError(detail.message ?? (detail.type === 'logout' ? '已在其他标签页退出登录' : '管理员登录已过期'));
      setAuthStatus('anonymous');
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    const syncRouteFromLocation = (fallbackRoute: AppRoute, nextHistoryState: unknown = window.history?.state) => {
      const nextRoute = getRouteFromPathname(window.location.pathname, fallbackRoute);
      const routeHistoryState = readAppRouteHistoryState(nextHistoryState);

      setActiveRoute(nextRoute);
      scheduleRenderedRouteState(nextRoute, routeHistoryState);
    };

    syncRouteFromLocation(activeRouteRef.current);
    const handlePopState = (event: Event) => {
      const popStateEvent = event as PopStateEvent & { state?: unknown };
      syncRouteFromLocation(activeRouteRef.current, popStateEvent.state);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
      return;
    }

    const pathname = normalizeRoutePath(window.location.pathname) || routePathById[activeRoute];
    const nextHistoryState =
      activeRoute === renderedRoute
        ? createAppRouteHistoryState(
            activeRoute,
            {
              sharedProjectIdDraft,
              generatePrefillState,
              inboxFocusState,
            },
            window.history.state,
          )
        : window.history.state;
    window.history.replaceState(
      nextHistoryState,
      '',
      pathname,
    );
  }, [activeRoute, renderedRoute, generatePrefillState, inboxFocusState, sharedProjectIdDraft]);

  const handleNavigate = (
    route: AppRoute,
    input: {
      sharedProjectIdDraft?: string;
      generatePrefillState?: GeneratePrefillState | null;
      inboxFocusState?: InboxFocusState | null;
    } = {},
  ) => {
    const nextHistoryState = createAppRouteHistoryState(route, {
      sharedProjectIdDraft: input.sharedProjectIdDraft ?? sharedProjectIdDraft,
      generatePrefillState: input.generatePrefillState,
      inboxFocusState: input.inboxFocusState,
    }, window.history?.state);
    if (typeof window.history?.pushState === 'function') {
      const nextPath = routePathById[route];
      if (normalizeRoutePath(window.location.pathname) !== nextPath) {
        window.history.pushState(nextHistoryState, '', nextPath);
      } else if (typeof window.history.replaceState === 'function') {
        window.history.replaceState(nextHistoryState, '', nextPath);
      }
    }

    const routeHistoryState = readAppRouteHistoryState(nextHistoryState);
    setActiveRoute(route);
    scheduleRenderedRouteState(route, routeHistoryState);
  };

  const handleOpenGenerateCenter = (input: { topic: string; preferredPlatforms: string[] }) => {
    const nextState = {
      token: (generatePrefillState?.token ?? 0) + 1,
      topic: input.topic,
      preferredPlatforms: input.preferredPlatforms,
    } satisfies GeneratePrefillState;

    handleNavigate('generate', {
      generatePrefillState: nextState,
    });
  };

  const handleOpenInboxItem = (input: { itemId: number; projectIdDraft: string; projectId?: number }) => {
    const requestedProjectId = parseProjectIdDraft(input.projectIdDraft);
    const nextProjectIdDraft =
      requestedProjectId !== null
        ? input.projectIdDraft
        : input.projectId !== undefined
          ? String(input.projectId)
          : '';
    const nextState = {
      token: (inboxFocusState?.token ?? 0) + 1,
      itemId: input.itemId,
    } satisfies InboxFocusState;

    handleNavigate('inbox', {
      sharedProjectIdDraft: nextProjectIdDraft,
      inboxFocusState: nextState,
    });
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
        cancelPendingAuthSync();
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
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          {renderRoute(
            renderedRoute,
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
        </Suspense>
      </RouteErrorBoundary>
    </Layout>
  );
}
