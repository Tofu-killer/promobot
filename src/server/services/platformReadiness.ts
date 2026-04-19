import {
  buildBrowserSessionResolution,
  createSessionStore,
  type BrowserSessionAction,
} from './browser/sessionStore';

export interface PlatformReadiness {
  platform: string;
  ready: boolean;
  mode: 'api' | 'browser' | 'manual';
  status: 'ready' | 'needs_config' | 'needs_session' | 'needs_relogin';
  message: string;
  action?: BrowserSessionAction | 'configure_credentials';
  details?: Record<string, unknown>;
}

export function listPlatformReadiness(): PlatformReadiness[] {
  const sessionStore = createSessionStore();
  const facebookSessions = sessionStore
    .listSessions()
    .filter((session) => session.platform === 'facebookGroup');

  return [
    getXReadiness(),
    getRedditReadiness(),
    getFacebookGroupReadiness(facebookSessions.length),
  ];
}

export function getChannelAccountPublishReadiness(account: {
  platform: string;
  accountKey: string;
}): PlatformReadiness {
  if (account.platform === 'x') {
    return getXReadiness();
  }

  if (account.platform === 'reddit') {
    return getRedditReadiness();
  }

  if (account.platform === 'facebookGroup' || account.platform === 'facebook-group') {
    const sessionStore = createSessionStore();
    const resolution = buildBrowserSessionResolution(
      sessionStore.getSession('facebookGroup', account.accountKey),
    );

    if (resolution.sessionAction === 'relogin') {
      return {
        platform: 'facebookGroup',
        ready: false,
        mode: 'browser',
        status: 'needs_relogin',
        message: '已有 Facebook Group session，但需要重新登录刷新。',
        action: 'relogin',
        details: {
          session: resolution.session,
        },
      };
    }

    if (resolution.sessionAction === 'request_session') {
      return {
        platform: 'facebookGroup',
        ready: false,
        mode: 'browser',
        status: 'needs_session',
        message: 'Facebook Group 需要先保存一个可用的浏览器 session。',
        action: 'request_session',
        details: {
          session: resolution.session,
        },
      };
    }

    return {
      platform: 'facebookGroup',
      ready: true,
      mode: 'browser',
      status: 'ready',
      message: 'Facebook Group 已具备浏览器接管所需 session。',
      details: {
        session: resolution.session,
      },
    };
  }

  return {
    platform: account.platform,
    ready: false,
    mode: 'manual',
    status: 'needs_config',
    message: `${account.platform} 尚未声明发布 readiness 规则。`,
  };
}

function getXReadiness(): PlatformReadiness {
  const hasToken = Boolean(process.env.X_ACCESS_TOKEN?.trim() || process.env.X_BEARER_TOKEN?.trim());

  return {
    platform: 'x',
    ready: hasToken,
    mode: 'api',
    status: hasToken ? 'ready' : 'needs_config',
    message: hasToken ? 'X API token 已配置，可直接尝试发布。' : 'X 需要配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。',
    ...(hasToken ? {} : { action: 'configure_credentials' as const }),
  };
}

function getRedditReadiness(): PlatformReadiness {
  const hasCredentials = Boolean(
    process.env.REDDIT_CLIENT_ID?.trim() &&
      process.env.REDDIT_CLIENT_SECRET?.trim() &&
      process.env.REDDIT_USERNAME?.trim() &&
      process.env.REDDIT_PASSWORD?.trim(),
  );

  return {
    platform: 'reddit',
    ready: hasCredentials,
    mode: 'api',
    status: hasCredentials ? 'ready' : 'needs_config',
    message: hasCredentials
      ? 'Reddit OAuth 凭证已配置，可直接尝试发布。'
      : 'Reddit 需要完整配置 client id/secret 和 username/password。',
    ...(hasCredentials ? {} : { action: 'configure_credentials' as const }),
  };
}

function getFacebookGroupReadiness(sessionCount: number): PlatformReadiness {
  return {
    platform: 'facebookGroup',
    ready: sessionCount > 0,
    mode: 'browser',
    status: sessionCount > 0 ? 'ready' : 'needs_session',
    message:
      sessionCount > 0
        ? `Facebook Group 已检测到 ${sessionCount} 个浏览器 session。`
        : 'Facebook Group 需要先保存浏览器 session，发布时再手动接管。',
    ...(sessionCount > 0 ? {} : { action: 'request_session' as const }),
    details: {
      sessionCount,
    },
  };
}
