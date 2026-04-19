import {
  buildBrowserSessionResolution,
  createSessionStore,
  type BrowserSessionAction,
  type SessionMetadata,
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

export interface ChannelAccountConnectionCheck {
  status: 'ready' | 'needs_config' | 'needs_session' | 'needs_relogin';
  summary: '可用' | '缺少配置' | '需要登录会话' | '需要重新登录';
  message: string;
  action?: BrowserSessionAction | 'configure_credentials';
  nextStep?: string;
  details: Record<string, unknown>;
}

export function listPlatformReadiness(): PlatformReadiness[] {
  const sessionStore = createSessionStore();
  const facebookSessions = sessionStore
    .listSessions()
    .filter((session) => normalizePlatform(session.platform) === 'facebookGroup');

  return [
    getXReadiness(),
    getRedditReadiness(),
    getFacebookGroupReadiness(facebookSessions),
  ];
}

export function getChannelAccountPublishReadiness(account: {
  platform: string;
  accountKey: string;
  authType?: string;
}): PlatformReadiness {
  const platform = normalizePlatform(account.platform);
  const browserSessionAuth = isBrowserSessionAuth(account.authType);

  if (platform === 'x') {
    return browserSessionAuth
      ? getBrowserSessionReadiness('x', 'X', account.accountKey)
      : getXReadiness();
  }

  if (platform === 'reddit') {
    return browserSessionAuth
      ? getBrowserSessionReadiness('reddit', 'Reddit', account.accountKey)
      : getRedditReadiness();
  }

  if (platform === 'facebookGroup') {
    return getBrowserSessionReadiness('facebookGroup', 'Facebook Group', account.accountKey);
  }

  return {
    platform,
    ready: false,
    mode: 'manual',
    status: 'needs_config',
    message: `${platform} 尚未声明发布 readiness 规则。`,
  };
}

export function evaluateChannelAccountConnection(account: {
  id: number;
  platform: string;
  accountKey: string;
  authType: string;
}): ChannelAccountConnectionCheck {
  const platform = normalizePlatform(account.platform);
  const browserSessionAuth = isBrowserSessionAuth(account.authType);

  if (platform === 'x' && !browserSessionAuth) {
    const hasAccessToken = Boolean(process.env.X_ACCESS_TOKEN?.trim());
    const hasBearerToken = Boolean(process.env.X_BEARER_TOKEN?.trim());
    const ready = hasAccessToken || hasBearerToken;

    return {
      status: ready ? 'ready' : 'needs_config',
      summary: ready ? '可用' : '缺少配置',
      message: ready
        ? 'X API 账号已检测到可用凭证。'
        : 'X API 账号缺少可用凭证，请配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。',
      ...(ready
        ? {}
        : {
            action: 'configure_credentials' as const,
            nextStep: `/api/channel-accounts/${account.id}`,
          }),
      details: {
        ready,
        mode: 'api',
        authType: account.authType,
        credentials: {
          hasAccessToken,
          hasBearerToken,
        },
      },
    };
  }

  if (platform === 'reddit' && !browserSessionAuth) {
    const hasClientId = Boolean(process.env.REDDIT_CLIENT_ID?.trim());
    const hasClientSecret = Boolean(process.env.REDDIT_CLIENT_SECRET?.trim());
    const hasUsername = Boolean(process.env.REDDIT_USERNAME?.trim());
    const hasPassword = Boolean(process.env.REDDIT_PASSWORD?.trim());
    const ready = hasClientId && hasClientSecret && hasUsername && hasPassword;

    return {
      status: ready ? 'ready' : 'needs_config',
      summary: ready ? '可用' : '缺少配置',
      message: ready
        ? 'Reddit API 账号已检测到可用凭证。'
        : 'Reddit API 账号缺少完整 OAuth 凭证，请配置 client id/secret 和 username/password。',
      ...(ready
        ? {}
        : {
            action: 'configure_credentials' as const,
            nextStep: `/api/channel-accounts/${account.id}`,
          }),
      details: {
        ready,
        mode: 'api',
        authType: account.authType,
        credentials: {
          hasClientId,
          hasClientSecret,
          hasUsername,
          hasPassword,
        },
      },
    };
  }

  const label = formatPlatformLabel(platform);
  const resolution = buildBrowserSessionResolution(
    createSessionStore().getSession(platform, account.accountKey),
  );

  if (resolution.sessionAction === 'relogin') {
    return {
      status: 'needs_relogin',
      summary: '需要重新登录',
      message: `${label} 浏览器 session 已过期，需要重新登录并重新保存 session 元数据。`,
      action: 'relogin',
      nextStep: `/api/channel-accounts/${account.id}/session`,
      details: {
        ready: false,
        mode: 'browser',
        authType: account.authType,
        session: resolution.session,
      },
    };
  }

  if (resolution.sessionAction === 'request_session') {
    return {
      status: 'needs_session',
      summary: '需要登录会话',
      message: `${label} 浏览器 session 缺失，请先登录并保存 session 元数据。`,
      action: 'request_session',
      nextStep: `/api/channel-accounts/${account.id}/session`,
      details: {
        ready: false,
        mode: 'browser',
        authType: account.authType,
        session: resolution.session,
      },
    };
  }

  return {
    status: 'ready',
    summary: '可用',
    message: `${label} 浏览器 session 可用，可以继续发布流程。`,
    details: {
      ready: true,
      mode: 'browser',
      authType: account.authType,
      session: resolution.session,
    },
  };
}

function getXReadiness(): PlatformReadiness {
  const hasAccessToken = Boolean(process.env.X_ACCESS_TOKEN?.trim());
  const hasBearerToken = Boolean(process.env.X_BEARER_TOKEN?.trim());
  const hasToken = hasAccessToken || hasBearerToken;

  return {
    platform: 'x',
    ready: hasToken,
    mode: 'api',
    status: hasToken ? 'ready' : 'needs_config',
    message: hasToken ? 'X API token 已配置，可直接尝试发布。' : 'X 需要配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。',
    ...(hasToken ? {} : { action: 'configure_credentials' as const }),
    details: {
      credentials: {
        hasAccessToken,
        hasBearerToken,
      },
    },
  };
}

function getRedditReadiness(): PlatformReadiness {
  const credentials = {
    hasClientId: Boolean(process.env.REDDIT_CLIENT_ID?.trim()),
    hasClientSecret: Boolean(process.env.REDDIT_CLIENT_SECRET?.trim()),
    hasUsername: Boolean(process.env.REDDIT_USERNAME?.trim()),
    hasPassword: Boolean(process.env.REDDIT_PASSWORD?.trim()),
  };
  const hasCredentials =
    credentials.hasClientId &&
    credentials.hasClientSecret &&
    credentials.hasUsername &&
    credentials.hasPassword;

  return {
    platform: 'reddit',
    ready: hasCredentials,
    mode: 'api',
    status: hasCredentials ? 'ready' : 'needs_config',
    message: hasCredentials
      ? 'Reddit OAuth 凭证已配置，可直接尝试发布。'
      : 'Reddit 需要完整配置 client id/secret 和 username/password。',
    ...(hasCredentials ? {} : { action: 'configure_credentials' as const }),
    details: {
      credentials,
    },
  };
}

function getBrowserSessionReadiness(
  platform: 'x' | 'reddit' | 'facebookGroup',
  label: string,
  accountKey: string,
): PlatformReadiness {
  const sessionStore = createSessionStore();
  const resolution = buildBrowserSessionResolution(sessionStore.getSession(platform, accountKey));

  if (resolution.sessionAction === 'relogin') {
    return {
      platform,
      ready: false,
      mode: 'browser',
      status: 'needs_relogin',
      message: `已有 ${label} 浏览器 session，但需要重新登录刷新。`,
      action: 'relogin',
      details: {
        session: resolution.session,
      },
    };
  }

  if (resolution.sessionAction === 'request_session') {
    return {
      platform,
      ready: false,
      mode: 'browser',
      status: 'needs_session',
      message: `${label} 需要先保存一个可用的浏览器 session。`,
      action: 'request_session',
      details: {
        session: resolution.session,
      },
    };
  }

  return {
    platform,
    ready: true,
    mode: 'browser',
    status: 'ready',
    message: `${label} 已具备浏览器接管所需 session。`,
    details: {
      session: resolution.session,
    },
  };
}

function normalizePlatform(platform: string): string {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function isBrowserSessionAuth(authType?: string): boolean {
  return authType === 'browser';
}

function formatPlatformLabel(platform: string) {
  if (platform === 'x') return 'X';
  if (platform === 'reddit') return 'Reddit';
  if (platform === 'facebookGroup') return 'Facebook Group';
  return platform;
}

function getFacebookGroupReadiness(
  sessions: SessionMetadata[],
): PlatformReadiness {
  let activeSessionCount = 0;
  let expiredSessionCount = 0;
  let missingSessionCount = 0;

  for (const session of sessions) {
    const resolution = buildBrowserSessionResolution(session);

    if (resolution.sessionAction === null) {
      activeSessionCount += 1;
      continue;
    }

    if (resolution.sessionAction === 'relogin') {
      expiredSessionCount += 1;
      continue;
    }

    missingSessionCount += 1;
  }

  const sessionCount = sessions.length;

  if (activeSessionCount > 0) {
    return {
      platform: 'facebookGroup',
      ready: true,
      mode: 'browser',
      status: 'ready',
      message: `Facebook Group 已检测到 ${activeSessionCount} 个可用浏览器 session。`,
      details: {
        sessionCount,
        activeSessionCount,
        expiredSessionCount,
        missingSessionCount,
      },
    };
  }

  if (expiredSessionCount > 0) {
    return {
      platform: 'facebookGroup',
      ready: false,
      mode: 'browser',
      status: 'needs_relogin',
      message: '已有 Facebook Group 浏览器 session，但需要重新登录刷新。',
      action: 'relogin',
      details: {
        sessionCount,
        activeSessionCount,
        expiredSessionCount,
        missingSessionCount,
      },
    };
  }

  return {
    platform: 'facebookGroup',
    ready: false,
    mode: 'browser',
    status: 'needs_session',
    message: 'Facebook Group 需要先保存浏览器 session，发布时再手动接管。',
    action: 'request_session',
    details: {
      sessionCount,
      activeSessionCount,
      expiredSessionCount,
      missingSessionCount,
    },
  };
}
