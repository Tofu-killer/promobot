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
      channelAccounts: Array<{ displayName: string; status: string }>;
    }>;

    const result = await loadChannelAccountsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/channel-accounts', undefined);
    expect(result.channelAccounts).toHaveLength(2);
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
  });

  it('loads settings through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        settings: {
          schedulerIntervalMinutes: 15,
          allowlist: ['127.0.0.1'],
          rssDefaults: ['OpenAI blog'],
        },
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
    }>;

    const result = await loadSettingsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', undefined);
    expect(result.settings.schedulerIntervalMinutes).toBe(15);
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
        },
      },
    });

    expect(html).toContain('已加载当前设置');
    expect(html).toContain('schedulerIntervalMinutes');
    expect(html).toContain('127.0.0.1');
  });
});
