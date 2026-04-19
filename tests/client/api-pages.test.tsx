import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function renderPage(
  Component: unknown,
  props: {
    stateOverride: {
      status: 'idle' | 'loading' | 'success' | 'error';
      data?: unknown;
      error?: string | null;
    };
  },
) {
  return renderToStaticMarkup(
    createElement(Component as (properties: typeof props) => React.JSX.Element, props),
  );
}

type ApiState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: unknown;
  error?: string | null;
};

function renderApiPage(Component: unknown, stateOverride: ApiState) {
  return renderToStaticMarkup(
    createElement(Component as (properties: { stateOverride?: ApiState }) => React.JSX.Element, { stateOverride }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client API page wiring', () => {
  it('posts project creation through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        project: {
          id: 1,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
        },
      }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.createProjectRequest).toBe('function');

    const createProjectRequest = projectsModule.createProjectRequest as (input: {
      name: string;
      siteName: string;
      siteUrl: string;
      siteDescription: string;
      sellingPoints: string[];
    }) => Promise<{ project: { id: number; name: string; siteUrl: string } }>;

    const result = await createProjectRequest({
      name: 'Acme Launch',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      siteDescription: 'Launch week campaign',
      sellingPoints: ['Cheap', 'Fast'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(result.project.name).toBe('Acme Launch');
    expect(result.project.siteUrl).toBe('https://acme.test');
  });

  it('loads dashboard stats through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        monitor: {
          total: 3,
          new: 2,
          followUpDrafts: 1,
        },
        drafts: {
          total: 5,
          review: 2,
        },
        totals: {
          items: 8,
          followUps: 1,
        },
        jobQueue: {
          pending: 4,
          running: 1,
          done: 7,
          failed: 2,
          canceled: 0,
          duePending: 3,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const dashboardModule = (await import('../../src/client/pages/Dashboard')) as Record<string, unknown>;

    expect(typeof dashboardModule.loadDashboardRequest).toBe('function');

    const loadDashboardRequest = dashboardModule.loadDashboardRequest as () => Promise<{
      monitor: { total: number; new: number; followUpDrafts: number };
      drafts: { total: number; review: number };
      jobQueue?: { pending: number; duePending: number };
    }>;

    const result = await loadDashboardRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/monitor/dashboard', undefined);
    expect(result.monitor.new).toBe(2);
    expect(result.drafts.review).toBe(2);
    expect(result.jobQueue?.pending).toBe(4);
  });

  it('shows dashboard loading, error, and success states', async () => {
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

    expect(renderPage(DashboardPage, { stateOverride: { status: 'loading' } })).toContain('正在加载仪表盘');
    expect(
      renderPage(DashboardPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('仪表盘加载失败');

    const html = renderPage(DashboardPage, {
      stateOverride: {
        status: 'success',
        data: {
          monitor: {
            total: 3,
            new: 2,
            followUpDrafts: 1,
          },
          drafts: {
            total: 5,
            review: 2,
          },
          totals: {
            items: 8,
            followUps: 1,
          },
          jobQueue: {
            pending: 4,
            running: 1,
            done: 7,
            failed: 2,
            canceled: 0,
            duePending: 3,
          },
        },
      },
    });

    expect(html).toContain('今日生成');
    expect(html).toContain('待审核');
    expect(html).toContain('已跟进');
    expect(html).toContain('新线索');
    expect(html).toContain('队列待执行');
    expect(html).toContain('队列失败');
  });

  it('shows project loading, error, and success states', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    expect(renderPage(ProjectsPage, { stateOverride: { status: 'loading' } })).toContain('正在创建项目');
    expect(
      renderPage(ProjectsPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('创建失败');

    const html = renderPage(ProjectsPage, {
      stateOverride: {
        status: 'success',
        data: {
          project: {
            id: 1,
            name: 'Acme Launch',
            siteName: 'Acme',
            siteUrl: 'https://acme.test',
            siteDescription: 'Launch week campaign',
            sellingPoints: ['Cheap', 'Fast'],
          },
        },
      },
    });

    expect(html).toContain('最近创建结果');
    expect(html).toContain('Acme Launch');
    expect(html).toContain('https://acme.test');
  });

  it('posts content generation through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            platform: 'x',
            title: 'Launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const generateModule = (await import('../../src/client/pages/Generate')) as Record<string, unknown>;

    expect(typeof generateModule.generateDraftsRequest).toBe('function');

    const generateDraftsRequest = generateModule.generateDraftsRequest as (input: {
      topic: string;
      tone: string;
      platforms: string[];
      saveAsDraft?: boolean;
    }) => Promise<{ results: Array<{ platform: string; title?: string; content: string }> }>;

    const result = await generateDraftsRequest({
      topic: 'Cheaper Claude-compatible endpoint',
      tone: 'professional',
      platforms: ['x'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/content/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(result.results[0]?.platform).toBe('x');
  });

  it('shows generate loading, error, and success states', async () => {
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    expect(renderPage(GeneratePage, { stateOverride: { status: 'loading' } })).toContain('正在生成草稿');
    expect(
      renderPage(GeneratePage, {
        stateOverride: {
          status: 'error',
          error: 'topic and platforms are required',
        },
      }),
    ).toContain('生成失败');

    const html = renderPage(GeneratePage, {
      stateOverride: {
        status: 'success',
        data: {
          results: [
            {
              platform: 'x',
              title: 'Launch thread',
              content: 'Draft body',
              hashtags: ['#launch'],
            },
            {
              platform: 'reddit',
              title: 'Launch post',
              content: 'Longer draft',
              hashtags: ['#api'],
            },
          ],
        },
      },
    });

    expect(html).toContain('已返回 2 条生成结果');
    expect(html).toContain('Launch thread');
    expect(html).toContain('reddit');
  });

  it('loads drafts through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drafts: [
          {
            id: 1,
            platform: 'x',
            title: 'Launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'draft',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const draftsModule = (await import('../../src/client/pages/Drafts')) as Record<string, unknown>;

    expect(typeof draftsModule.loadDraftsRequest).toBe('function');

    const loadDraftsRequest = draftsModule.loadDraftsRequest as () => Promise<{
      drafts: Array<{ id: number; title?: string; status: string }>;
    }>;

    const result = await loadDraftsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.title).toBe('Launch thread');
  });

  it('patches draft updates through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        draft: {
          id: 1,
          platform: 'x',
          title: 'Updated launch thread',
          content: 'Updated draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const draftsModule = (await import('../../src/client/pages/Drafts')) as Record<string, unknown>;

    expect(typeof draftsModule.updateDraftRequest).toBe('function');

    const updateDraftRequest = draftsModule.updateDraftRequest as (
      id: number,
      input: { title: string; content: string; status: string },
    ) => Promise<{ draft: { id: number; title?: string; status: string } }>;

    const result = await updateDraftRequest(1, {
      title: 'Updated launch thread',
      content: 'Updated draft body',
      status: 'review',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/1',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated launch thread',
          content: 'Updated draft body',
          status: 'review',
        }),
      }),
    );
    expect(result.draft.title).toBe('Updated launch thread');
    expect(result.draft.status).toBe('review');
  });

  it('publishes drafts through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        publishUrl: 'https://x.com/promobot/status/1',
        message: 'x stub publisher accepted draft 1',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const draftsModule = (await import('../../src/client/pages/Drafts')) as Record<string, unknown>;

    expect(typeof draftsModule.publishDraftRequest).toBe('function');

    const publishDraftRequest = draftsModule.publishDraftRequest as (id: number) => Promise<{
      success: boolean;
      publishUrl: string | null;
      message: string;
    }>;

    const result = await publishDraftRequest(1);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/1/publish',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.publishUrl).toBe('https://x.com/promobot/status/1');
  });

  it('shows drafts loading, error, and success states', async () => {
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    expect(renderPage(DraftsPage, { stateOverride: { status: 'loading' } })).toContain('正在加载草稿');
    expect(
      renderPage(DraftsPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('草稿加载失败');

    const html = renderPage(DraftsPage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 1,
              platform: 'x',
              title: 'Launch thread',
              content: 'Draft body',
              hashtags: ['#launch'],
              status: 'draft',
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
    });

    expect(html).toContain('已加载 1 条草稿');
    expect(html).toContain('Launch thread');
    expect(html).toContain('draft');
  });

  it('shows actionable draft controls with save and publish feedback', async () => {
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const html = renderPage(DraftsPage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 1,
              platform: 'x',
              title: 'Launch thread',
              content: 'Draft body',
              hashtags: ['#launch'],
              status: 'draft',
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
      draftInteractionStateOverride: {
        formValuesById: {
          1: {
            title: 'Updated launch thread',
            content: 'Updated draft body',
            status: 'review',
          },
        },
        saveStateById: {
          1: {
            status: 'success',
            message: '草稿已保存',
          },
        },
        publishStateById: {
          1: {
            status: 'error',
            error: 'unsupported draft platform',
          },
        },
      },
    });

    expect(html).toContain('保存修改');
    expect(html).toContain('触发发布');
    expect(html).toContain('草稿已保存');
    expect(html).toContain('unsupported draft platform');
    expect(html).toContain('Updated launch thread');
    expect(html).toContain('Updated draft body');
  });

  it('loads channel accounts through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        channelAccounts: [
          {
            id: 1,
            platform: 'x',
            accountKey: 'acct-x',
            displayName: 'X / Twitter',
            authType: 'api-key',
            status: 'healthy',
            metadata: {},
            session: {
              hasSession: true,
              status: 'active',
              validatedAt: '2026-04-19T01:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/acct-x.json',
            },
            publishReadiness: {
              platform: 'x',
              ready: true,
              mode: 'api',
              status: 'ready',
              message: 'X API token 已配置，可直接尝试发布。',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 2,
            platform: 'reddit',
            accountKey: 'acct-reddit',
            displayName: 'Reddit',
            authType: 'oauth',
            status: 'healthy',
            metadata: {},
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
            publishReadiness: {
              platform: 'reddit',
              ready: false,
              mode: 'api',
              status: 'needs_config',
              message: 'Reddit 需要完整配置 client id/secret 和 username/password。',
              action: 'configure_credentials',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.loadChannelAccountsRequest).toBe('function');

    const loadChannelAccountsRequest = channelsModule.loadChannelAccountsRequest as () => Promise<{
      channelAccounts: Array<{
        displayName: string;
        status: string;
        publishReadiness?: {
          ready: boolean;
          mode: string;
        };
      }>;
    }>;

    const result = await loadChannelAccountsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/channel-accounts', undefined);
    expect(result.channelAccounts).toHaveLength(2);
    expect(result.channelAccounts[0]?.publishReadiness?.ready).toBe(true);
    expect(result.channelAccounts[1]?.publishReadiness?.mode).toBe('api');
  });

  it('posts channel account session metadata through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:acct-x',
          status: 'active',
          validatedAt: '2026-04-19T01:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/acct-x.json',
          notes: 'manual relogin completed',
        },
        channelAccount: {
          id: 3,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'browser',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'x:acct-x',
            status: 'active',
            validatedAt: '2026-04-19T01:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/acct-x.json',
            notes: 'manual relogin completed',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.saveChannelAccountSessionRequest).toBe('function');

    const saveChannelAccountSessionRequest = channelsModule.saveChannelAccountSessionRequest as (
      accountId: number,
      input: {
        storageStatePath: string;
        status: 'active' | 'expired' | 'missing';
        validatedAt?: string | null;
        notes?: string;
      },
    ) => Promise<{ ok: boolean; session: { hasSession: boolean; status: string } }>;

    const result = await saveChannelAccountSessionRequest(3, {
      storageStatePath: 'artifacts/browser-sessions/acct-x.json',
      status: 'active',
      validatedAt: '2026-04-19T01:00:00.000Z',
      notes: 'manual relogin completed',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/channel-accounts/3/session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageStatePath: 'artifacts/browser-sessions/acct-x.json',
          status: 'active',
          validatedAt: '2026-04-19T01:00:00.000Z',
          notes: 'manual relogin completed',
        }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.session.status).toBe('active');
  });

  it('posts request-session and relogin actions through the shared API helper', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          sessionAction: {
            action: 'request_session',
            accountId: 3,
            status: 'pending',
            requestedAt: '2026-04-19T01:10:00.000Z',
            message: 'Browser session capture is not wired yet.',
            nextStep: '/api/channel-accounts/3/session',
          },
          channelAccount: {
            id: 3,
            platform: 'x',
            accountKey: 'acct-x-2',
            displayName: 'X Secondary',
            authType: 'browser',
            status: 'healthy',
            metadata: {},
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          sessionAction: {
            action: 'relogin',
            accountId: 3,
            status: 'pending',
            requestedAt: '2026-04-19T01:20:00.000Z',
            message: 'Browser relogin is not wired yet.',
            nextStep: '/api/channel-accounts/3/session',
          },
          channelAccount: {
            id: 3,
            platform: 'x',
            accountKey: 'acct-x-2',
            displayName: 'X Secondary',
            authType: 'browser',
            status: 'healthy',
            metadata: {},
            session: {
              hasSession: true,
              status: 'expired',
              validatedAt: '2026-04-19T01:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/acct-x.json',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.requestChannelAccountSessionActionRequest).toBe('function');

    const requestChannelAccountSessionActionRequest =
      channelsModule.requestChannelAccountSessionActionRequest as (
        accountId: number,
        input?: { action?: 'request_session' | 'relogin' },
      ) => Promise<{ ok: boolean; sessionAction: { action: string; status: string } }>;

    const requestSessionResult = await requestChannelAccountSessionActionRequest(3);
    const reloginResult = await requestChannelAccountSessionActionRequest(3, {
      action: 'relogin',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/channel-accounts/3/session/request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/channel-accounts/3/session/request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'relogin' }),
      }),
    );
    expect(requestSessionResult.sessionAction.action).toBe('request_session');
    expect(reloginResult.sessionAction.action).toBe('relogin');
  });

  it('posts a new channel account through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        channelAccount: {
          id: 3,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'api-key',
          status: 'healthy',
          metadata: {},
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.createChannelAccountRequest).toBe('function');

    const createChannelAccountRequest = channelsModule.createChannelAccountRequest as (input: {
      platform: string;
      accountKey: string;
      displayName: string;
      authType: string;
      status?: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ channelAccount: { id: number; displayName: string } }>;

    const result = await createChannelAccountRequest({
      platform: 'x',
      accountKey: 'acct-x-2',
      displayName: 'X Secondary',
      authType: 'api-key',
      status: 'healthy',
      metadata: { team: 'growth' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/channel-accounts',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'api-key',
          status: 'healthy',
          metadata: { team: 'growth' },
        }),
      }),
    );
    expect(result.channelAccount.displayName).toBe('X Secondary');
  });

  it('shows channel account loading, error, and success states', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    expect(renderPage(ChannelAccountsPage, { stateOverride: { status: 'loading' } })).toContain('正在加载渠道账号');
    expect(
      renderPage(ChannelAccountsPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 404',
        },
      }),
    ).toContain('渠道账号加载失败');

    const html = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [
            {
              id: 1,
              platform: 'x',
              accountKey: 'acct-x',
              displayName: 'X / Twitter',
              authType: 'api-key',
              status: 'healthy',
              metadata: {},
              session: {
                hasSession: true,
                status: 'active',
                validatedAt: '2026-04-19T01:00:00.000Z',
                storageStatePath: 'artifacts/browser-sessions/acct-x.json',
              },
              publishReadiness: {
                platform: 'x',
                ready: true,
                mode: 'api',
                status: 'ready',
                message: 'X API token 已配置，可直接尝试发布。',
              },
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
            {
              id: 2,
              platform: 'reddit',
              accountKey: 'acct-reddit',
              displayName: 'Reddit',
              authType: 'oauth',
              status: 'healthy',
              metadata: {},
              session: {
                hasSession: false,
                status: 'missing',
                validatedAt: null,
                storageStatePath: null,
              },
              publishReadiness: {
                platform: 'reddit',
                ready: false,
                mode: 'api',
                status: 'needs_config',
                message: 'Reddit 需要完整配置 client id/secret 和 username/password。',
                action: 'configure_credentials',
              },
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
    });

    expect(html).toContain('接口返回 2 个账号');
    expect(html).toContain('X / Twitter');
    expect(html).toContain('healthy');
    expect(html).toContain('Session 已关联');
    expect(html).toContain('Session 状态：active');
    expect(html).toContain('最近验证：2026-04-19T01:00:00.000Z');
    expect(html).toContain('Storage Path：artifacts/browser-sessions/acct-x.json');
    expect(html).toContain('发布就绪：已就绪');
    expect(html).toContain('发布方式：API');
    expect(html).toContain('建议动作：配置凭证');
    expect(html).toContain('保存 Session 元数据');
    expect(html).toContain('请求登录');

    const connectionHtml = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [
            {
              id: 1,
              platform: 'x',
              accountKey: 'acct-x',
              displayName: 'X / Twitter',
              authType: 'api-key',
              status: 'healthy',
              metadata: {},
              session: {
                hasSession: true,
                status: 'active',
                validatedAt: '2026-04-19T01:00:00.000Z',
                storageStatePath: 'artifacts/browser-sessions/acct-x.json',
              },
              publishReadiness: {
                platform: 'x',
                ready: true,
                mode: 'api',
                status: 'ready',
                message: 'X API token 已配置，可直接尝试发布。',
              },
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
      testConnectionStateOverride: {
        status: 'success',
        data: {
          ok: true,
          test: {
            checkedAt: '2026-04-19T02:00:00.000Z',
            status: 'healthy',
          },
          channelAccount: {
            id: 1,
            platform: 'x',
            accountKey: 'acct-x',
            displayName: 'X / Twitter',
            authType: 'api-key',
            status: 'healthy',
            metadata: {},
            session: {
              hasSession: true,
              status: 'active',
              validatedAt: '2026-04-19T01:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/acct-x.json',
            },
            publishReadiness: {
              platform: 'x',
              ready: true,
              mode: 'api',
              status: 'ready',
              message: 'X API token 已配置，可直接尝试发布。',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      },
    });

    expect(connectionHtml).toContain('最近一次连接测试');
    expect(connectionHtml).toContain('连接结果：</strong>已就绪');
    expect(connectionHtml).toContain('反馈：</strong>X API token 已配置，可直接尝试发布。');
    expect(connectionHtml).toContain('检查时间：</strong>2026-04-19T02:00:00.000Z');
  });

  it('renders connection feedback from the richer channel account test contract', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [
            {
              id: 1,
              platform: 'x',
              accountKey: 'acct-x',
              displayName: 'X / Twitter',
              authType: 'api',
              status: 'healthy',
              metadata: {},
              session: {
                hasSession: false,
                status: 'missing',
                validatedAt: null,
                storageStatePath: null,
              },
              publishReadiness: {
                platform: 'x',
                ready: true,
                mode: 'api',
                status: 'ready',
                message: 'X API token 已配置，可直接尝试发布。',
              },
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
      testConnectionStateOverride: {
        status: 'success',
        data: {
          ok: true,
          test: {
            checkedAt: '2026-04-19T02:30:00.000Z',
            status: 'needs_config',
            result: {
              label: '待配置',
            },
            feedback: {
              message: 'X API 账号缺少可用凭证，请配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。',
            },
            recommendedAction: {
              action: 'configure_credentials',
              label: '配置凭证',
            },
            nextStep: {
              path: '/api/channel-accounts/1',
            },
            details: {
              ready: false,
              mode: 'api',
              authType: 'api',
              credentials: {
                hasAccessToken: false,
                hasBearerToken: false,
              },
            },
          },
          channelAccount: {
            id: 1,
            platform: 'x',
            accountKey: 'acct-x',
            displayName: 'X / Twitter',
            authType: 'api',
            status: 'healthy',
            metadata: {},
            session: {
              hasSession: false,
              status: 'missing',
              validatedAt: null,
              storageStatePath: null,
            },
            publishReadiness: {
              platform: 'x',
              ready: true,
              mode: 'api',
              status: 'ready',
              message: 'X API token 已配置，可直接尝试发布。',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      },
    });

    expect(html).toContain('最近一次连接测试');
    expect(html).toContain('连接结果：</strong>待配置');
    expect(html).toContain('反馈：</strong>X API 账号缺少可用凭证，请配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。');
    expect(html).toContain('建议动作：</strong>配置凭证');
    expect(html).toContain('下一步：</strong>/api/channel-accounts/1');
    expect(html).toContain('检查时间：</strong>2026-04-19T02:30:00.000Z');
  });

  it('renders the channel account create form and save action', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, { stateOverride: { status: 'idle', error: null } });

    expect(html).toContain('创建账号');
    expect(html).toContain('账号 Key');
    expect(html).toContain('metadata');
    expect(html).toContain('测试连接');
    expect(html).toContain('重新登录');
  });

  it('loads settings through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        settings: {
          schedulerIntervalMinutes: 15,
          allowlist: ['127.0.0.1'],
          rssDefaults: ['OpenAI blog'],
        },
        platformReadiness: [
          {
            platform: 'x',
            ready: true,
            mode: 'api',
            status: 'ready',
            message: 'X API token 已配置，可直接尝试发布。',
          },
          {
            platform: 'facebookGroup',
            ready: false,
            mode: 'browser',
            status: 'needs_session',
            message: 'Facebook Group 需要先保存浏览器 session，发布时再手动接管。',
            action: 'request_session',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.loadSettingsRequest).toBe('function');

    const loadSettingsRequest = settingsModule.loadSettingsRequest as () => Promise<{
      settings: {
        schedulerIntervalMinutes: number;
        allowlist: string[];
      };
      platformReadiness?: Array<{
        platform: string;
        ready: boolean;
      }>;
    }>;

    const result = await loadSettingsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', undefined);
    expect(result.settings.schedulerIntervalMinutes).toBe(15);
    expect(result.platformReadiness?.[1]?.platform).toBe('facebookGroup');
  });

  it('patches settings through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        settings: {
          schedulerIntervalMinutes: 30,
          allowlist: ['10.0.0.1'],
          rssDefaults: ['TechCrunch'],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.updateSettingsRequest).toBe('function');

    const updateSettingsRequest = settingsModule.updateSettingsRequest as (input: {
      allowlist: string[];
      schedulerIntervalMinutes: number;
      rssDefaults: string[];
    }) => Promise<{ settings: { schedulerIntervalMinutes: number } }>;

    const result = await updateSettingsRequest({
      allowlist: ['10.0.0.1'],
      schedulerIntervalMinutes: 30,
      rssDefaults: ['TechCrunch'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowlist: ['10.0.0.1'],
          schedulerIntervalMinutes: 30,
          rssDefaults: ['TechCrunch'],
        }),
      }),
    );
    expect(result.settings.schedulerIntervalMinutes).toBe(30);
  });

  it('posts runtime control actions through the shared API helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          runtime: {
            available: true,
            started: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          runtime: {
            available: true,
            started: true,
          },
          results: [{ jobId: 1, type: 'publish', outcome: 'completed' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 1, source: 'rss' }],
          inserted: 1,
          total: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 1, source: 'reddit' }],
          inserted: 1,
          total: 1,
          unread: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 1, source: 'reddit', sentiment: 'positive' }],
          inserted: 1,
          total: 1,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.reloadSchedulerRuntimeRequest).toBe('function');
    expect(typeof settingsModule.tickSchedulerRuntimeRequest).toBe('function');
    expect(typeof settingsModule.fetchMonitorSignalsRequest).toBe('function');
    expect(typeof settingsModule.fetchInboxSignalsRequest).toBe('function');
    expect(typeof settingsModule.fetchReputationSignalsRequest).toBe('function');

    const reloadSchedulerRuntimeRequest = settingsModule.reloadSchedulerRuntimeRequest as () => Promise<unknown>;
    const tickSchedulerRuntimeRequest = settingsModule.tickSchedulerRuntimeRequest as () => Promise<unknown>;
    const fetchMonitorSignalsRequest = settingsModule.fetchMonitorSignalsRequest as () => Promise<unknown>;
    const fetchInboxSignalsRequest = settingsModule.fetchInboxSignalsRequest as () => Promise<unknown>;
    const fetchReputationSignalsRequest = settingsModule.fetchReputationSignalsRequest as () => Promise<unknown>;

    await reloadSchedulerRuntimeRequest();
    await tickSchedulerRuntimeRequest();
    await fetchMonitorSignalsRequest();
    await fetchInboxSignalsRequest();
    await fetchReputationSignalsRequest();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/system/runtime/reload',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/system/runtime/tick',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/monitor/fetch',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/inbox/fetch',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/reputation/fetch',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('loads and mutates system jobs through the shared API helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          jobs: [
            {
              id: 11,
              type: 'publish',
              status: 'failed',
              runAt: '2026-04-19T12:15:00.000Z',
              attempts: 1,
              canRetry: true,
              canCancel: false,
            },
          ],
          queue: {
            pending: 1,
            failed: 1,
          },
          recentJobs: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: 11,
            type: 'publish',
            status: 'pending',
            runAt: '2026-04-19T12:20:00.000Z',
            attempts: 1,
            canRetry: false,
            canCancel: true,
          },
          runtime: {
            available: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: 12,
            type: 'monitor_fetch',
            status: 'canceled',
            runAt: '2026-04-19T12:25:00.000Z',
            attempts: 0,
            canRetry: true,
            canCancel: false,
          },
          runtime: {
            available: true,
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.loadSystemJobsRequest).toBe('function');
    expect(typeof settingsModule.retrySystemJobRequest).toBe('function');
    expect(typeof settingsModule.cancelSystemJobRequest).toBe('function');

    const loadSystemJobsRequest = settingsModule.loadSystemJobsRequest as (limit?: number) => Promise<unknown>;
    const retrySystemJobRequest = settingsModule.retrySystemJobRequest as (jobId: number, runAt?: string) => Promise<unknown>;
    const cancelSystemJobRequest = settingsModule.cancelSystemJobRequest as (jobId: number) => Promise<unknown>;

    await loadSystemJobsRequest(10);
    await retrySystemJobRequest(11, '2026-04-19T12:20:00.000Z');
    await cancelSystemJobRequest(12);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/system/jobs?limit=10', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/system/jobs/11/retry',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runAt: '2026-04-19T12:20:00.000Z' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/system/jobs/12/cancel',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('posts new system jobs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        job: {
          id: 21,
          type: 'monitor_fetch',
          status: 'pending',
          runAt: '2026-04-20T09:00',
          attempts: 0,
        },
        runtime: {
          available: true,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.enqueueSystemJobRequest).toBe('function');

    const enqueueSystemJobRequest = settingsModule.enqueueSystemJobRequest as (input: {
      type: string;
      payload?: Record<string, unknown>;
      runAt?: string;
    }) => Promise<unknown>;

    await enqueueSystemJobRequest({
      type: 'monitor_fetch',
      payload: {},
      runAt: '2026-04-20T09:00',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'monitor_fetch',
          payload: {},
          runAt: '2026-04-20T09:00',
        }),
      }),
    );
  });

  it('shows settings loading, error, and success states', async () => {
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    expect(renderPage(SettingsPage, { stateOverride: { status: 'loading' } })).toContain('正在加载设置');
    expect(
      renderPage(SettingsPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 404',
        },
      }),
    ).toContain('设置加载失败');

    const html = renderPage(SettingsPage, {
      stateOverride: {
        status: 'success',
        data: {
          settings: {
            schedulerIntervalMinutes: 15,
            allowlist: ['127.0.0.1'],
            rssDefaults: ['OpenAI blog'],
          },
          scheduler: {
            enabled: true,
            status: 'healthy',
            lastRunAt: '2026-04-19T09:00:00.000Z',
            nextRunAt: '2026-04-19T09:15:00.000Z',
          },
          runtime: {
            environment: 'production',
            queueDepth: 3,
            queue: {
              pending: 2,
              running: 1,
              failed: 1,
              duePending: 1,
            },
            recentJobs: [
              {
                id: 14,
                type: 'publish',
                status: 'pending',
                runAt: '2026-04-19T09:15:00.000Z',
                attempts: 1,
                updatedAt: '2026-04-19T09:05:00.000Z',
              },
            ],
          },
          ai: {
            provider: 'OpenAI',
            model: 'gpt-4.1-mini',
            moderationEnabled: true,
          },
          platformReadiness: [
            {
              platform: 'x',
              ready: true,
              mode: 'api',
              status: 'ready',
              message: 'X API token 已配置，可直接尝试发布。',
            },
            {
              platform: 'facebookGroup',
              ready: false,
              mode: 'browser',
              status: 'needs_session',
              message: 'Facebook Group 需要先保存浏览器 session，发布时再手动接管。',
              action: 'request_session',
            },
          ],
          rss: {
            fetchWindowMinutes: 30,
            dedupeMode: 'url',
          },
          platforms: [
            {
              platform: 'x',
              ready: true,
              status: 'ready',
              mode: 'api',
              message: 'X API token 已配置，可直接尝试发布。',
            },
            {
              platform: 'reddit',
              ready: true,
              status: 'ready',
              mode: 'api',
              message: 'Reddit OAuth 凭证已配置，可直接尝试发布。',
            },
          ],
        },
      },
      jobsStateOverride: {
        status: 'success',
        data: {
          jobs: [
            {
              id: 11,
              type: 'publish',
              status: 'failed',
              runAt: '2026-04-19T12:15:00.000Z',
              attempts: 1,
              lastError: 'boom',
              canRetry: true,
              canCancel: false,
            },
          ],
          queue: {
            pending: 2,
            failed: 1,
          },
          recentJobs: [],
        },
      },
    });

    expect(html).toContain('当前生效设置');
    expect(html).toContain('调度与运行态');
    expect(html).toContain('AI 配置');
    expect(html).toContain('平台就绪度');
    expect(html).toContain('发布就绪：已就绪');
    expect(html).toContain('发布就绪：需要登录会话');
    expect(html).toContain('建议动作：请求登录');
    expect(html).toContain('RSS 默认源');
    expect(html).toContain('运行环境');
    expect(html).toContain('gpt-4.1-mini');
    expect(html).toContain('127.0.0.1');
    expect(html).toContain('运行控制台');
    expect(html).toContain('最近作业');
    expect(html).toContain('重载 Scheduler');
    expect(html).toContain('抓取 Monitor');
    expect(html).toContain('作业控制');
    expect(html).toContain('重试');
    expect(html).toContain('排程新作业');
    expect(html).toContain('排程 Monitor Fetch');
    expect(html).toContain('平台就绪度');
    expect(html).toContain('Facebook Group 需要先保存浏览器 session，发布时再手动接管。');
  });

  it('renders the settings edit form and save action', async () => {
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const html = renderPage(SettingsPage, { stateOverride: { status: 'idle', error: null } });

    expect(html).toContain('设置总览');
    expect(html).toContain('AI 配置');
    expect(html).toContain('LAN allowlist');
    expect(html).toContain('RSS 默认源');
    expect(html).toContain('运行控制台');
    expect(html).toContain('保存设置');
  });

  it('loads inbox items through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'inbox-1',
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Need lower latency in APAC',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const inboxModule = (await import('../../src/client/pages/Inbox')) as Record<string, unknown>;

    expect(typeof inboxModule.loadInboxRequest).toBe('function');

    const loadInboxRequest = inboxModule.loadInboxRequest as () => Promise<{
      items: Array<{ id: string; source: string; status: string }>;
      total: number;
      unread: number;
    }>;

    const result = await loadInboxRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', undefined);
    expect(result.total).toBe(1);
    expect(result.items[0]?.source).toBe('reddit');
  });

  it('shows inbox loading, error, and success states', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    expect(renderApiPage(InboxPage, { status: 'loading' })).toContain('正在加载收件箱');
    expect(
      renderApiPage(InboxPage, {
        status: 'error',
        error: 'Request failed with status 500',
      }),
    ).toContain('收件箱加载失败');

    const html = renderApiPage(InboxPage, {
      status: 'success',
      data: {
        items: [
          {
            id: 'inbox-1',
            source: 'reddit',
            status: 'needs_reply',
            author: 'user123',
            title: 'Need lower latency in APAC',
            excerpt: 'Can you share current response times?',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
        total: 1,
        unread: 1,
      },
    });

    expect(html).toContain('已加载 1 条收件箱记录');
    expect(html).toContain('needs_reply');
    expect(html).toContain('Need lower latency in APAC');
  });

  it('loads monitor feed entries through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'monitor-1',
            source: 'x',
            title: 'Competitor added a cheaper tier',
            detail: 'Entry-tier pricing is now lower than our trial plan.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.loadMonitorFeedRequest).toBe('function');

    const loadMonitorFeedRequest = monitorModule.loadMonitorFeedRequest as () => Promise<{
      items: Array<{ id: string; source: string; title: string; status: string }>;
      total: number;
    }>;

    const result = await loadMonitorFeedRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/monitor/feed', undefined);
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('new');
  });

  it('shows monitor loading, error, and success states', async () => {
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    expect(renderApiPage(MonitorPage, { status: 'loading' })).toContain('正在加载监控动态');
    expect(
      renderApiPage(MonitorPage, {
        status: 'error',
        error: 'Request failed with status 502',
      }),
    ).toContain('监控动态加载失败');

    const html = renderApiPage(MonitorPage, {
      status: 'success',
      data: {
        items: [
          {
            id: 'monitor-1',
            source: 'x',
            title: 'Competitor added a cheaper tier',
            detail: 'Entry-tier pricing is now lower than our trial plan.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    });

    expect(html).toContain('已抓取 1 条监控动态');
    expect(html).toContain('new');
    expect(html).toContain('Competitor added a cheaper tier');
  });

  it('loads reputation stats through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        total: 3,
        positive: 2,
        neutral: 1,
        negative: 0,
        trend: [
          {
            label: '正向',
            value: 2,
          },
        ],
        items: [
          {
            id: 'rep-1',
            source: 'facebook-group',
            sentiment: 'negative',
            status: 'escalate',
            title: 'Session expired complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.loadReputationRequest).toBe('function');

    const loadReputationRequest = reputationModule.loadReputationRequest as () => Promise<{
      total: number;
      positive: number;
      neutral: number;
      negative: number;
      trend: Array<{ label: string; value: number }>;
      items: Array<{ id: string; sentiment: string; status: string }>;
    }>;

    const result = await loadReputationRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/reputation/stats', undefined);
    expect(result.negative).toBe(0);
    expect(result.items[0]?.sentiment).toBe('negative');
  });

  it('shows reputation loading, error, and success states', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    expect(renderApiPage(ReputationPage, { status: 'loading' })).toContain('正在加载口碑数据');
    expect(
      renderApiPage(ReputationPage, {
        status: 'error',
        error: 'Request failed with status 503',
      }),
    ).toContain('口碑数据加载失败');

    const html = renderApiPage(ReputationPage, {
      status: 'success',
      data: {
        total: 3,
        positive: 2,
        neutral: 1,
        negative: 0,
        trend: [
          {
            label: '正向',
            value: 2,
          },
        ],
        items: [
          {
            id: 'rep-1',
            source: 'facebook-group',
            sentiment: 'negative',
            status: 'escalate',
            title: 'Session expired complaint',
            detail: 'Users report being logged out unexpectedly.',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      },
    });

    expect(html).toContain('已加载 3 条口碑提及');
    expect(html).toContain('negative');
    expect(html).toContain('Session expired complaint');
  });
});
