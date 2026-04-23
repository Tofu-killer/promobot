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

  it('loads project source configs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword',
            platform: 'reddit',
            label: 'Acme mentions',
            configJson: { queries: ['acme'] },
            enabled: true,
            pollIntervalMinutes: 30,
            createdAt: '2026-04-19T08:00:00.000Z',
            updatedAt: '2026-04-19T08:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.loadSourceConfigsRequest).toBe('function');

    const loadSourceConfigsRequest = projectsModule.loadSourceConfigsRequest as (projectId: number) => Promise<{
      sourceConfigs: Array<{
        id: number;
        projectId: number;
        label: string;
        configJson: Record<string, unknown>;
      }>;
    }>;

    const result = await loadSourceConfigsRequest(7);

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/source-configs', undefined);
    expect(result.sourceConfigs).toHaveLength(1);
    expect(result.sourceConfigs[0]?.projectId).toBe(7);
    expect(result.sourceConfigs[0]?.label).toBe('Acme mentions');
    expect(result.sourceConfigs[0]?.configJson).toEqual({ queries: ['acme'] });
  });

  it('posts source config creation through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceConfig: {
          id: 3,
          projectId: 7,
          sourceType: 'keyword',
          platform: 'reddit',
          label: 'Acme mentions',
          configJson: { queries: ['acme'] },
          enabled: true,
          pollIntervalMinutes: 30,
          createdAt: '2026-04-19T08:00:00.000Z',
          updatedAt: '2026-04-19T08:00:00.000Z',
        },
      }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.createSourceConfigRequest).toBe('function');

    const createSourceConfigRequest = projectsModule.createSourceConfigRequest as (
      projectId: number,
      input: {
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      },
    ) => Promise<{ sourceConfig: { id: number; label: string; enabled: boolean } }>;

    const payload = {
      projectId: 7,
      sourceType: 'keyword',
      platform: 'reddit',
      label: 'Acme mentions',
      configJson: { queries: ['acme'] },
      enabled: true,
      pollIntervalMinutes: 30,
    };

    const result = await createSourceConfigRequest(7, payload);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/7/source-configs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(result.sourceConfig.label).toBe('Acme mentions');
    expect(result.sourceConfig.enabled).toBe(true);
  });

  it('patches source config updates through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceConfig: {
          id: 3,
          projectId: 7,
          sourceType: 'keyword',
          platform: 'reddit',
          label: 'Acme mentions updated',
          configJson: { queries: ['acme', 'launch'] },
          enabled: false,
          pollIntervalMinutes: 15,
          createdAt: '2026-04-19T08:00:00.000Z',
          updatedAt: '2026-04-19T09:15:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.updateSourceConfigRequest).toBe('function');

    const updateSourceConfigRequest = projectsModule.updateSourceConfigRequest as (
      projectId: number,
      sourceConfigId: number,
      input: {
        projectId?: number;
        sourceType?: string;
        platform?: string;
        label?: string;
        configJson?: Record<string, unknown>;
        enabled?: boolean;
        pollIntervalMinutes?: number;
      },
    ) => Promise<{ sourceConfig: { id: number; label: string; pollIntervalMinutes: number } }>;

    const payload = {
      projectId: 7,
      label: 'Acme mentions updated',
      configJson: { queries: ['acme', 'launch'] },
      enabled: false,
      pollIntervalMinutes: 15,
    };

    const result = await updateSourceConfigRequest(7, 3, payload);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/7/source-configs/3',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(result.sourceConfig.label).toBe('Acme mentions updated');
    expect(result.sourceConfig.pollIntervalMinutes).toBe(15);
  });

  it('loads and mutates project source configs through the shared API helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          sourceConfigs: [
            {
              id: 3,
              projectId: 7,
              sourceType: 'keyword+reddit',
              platform: 'reddit',
              label: 'Reddit mentions',
              configJson: { keywords: ['claude latency australia'] },
              enabled: true,
              pollIntervalMinutes: 30,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            sourceConfig: {
              id: 4,
              projectId: 7,
              sourceType: 'v2ex_search',
              platform: 'v2ex',
              label: 'V2EX mentions',
              configJson: { query: 'cursor api' },
              enabled: true,
              pollIntervalMinutes: 45,
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sourceConfig: {
            id: 4,
            projectId: 7,
            sourceType: 'v2ex_search',
            platform: 'v2ex',
            label: 'V2EX mentions updated',
            configJson: { query: 'cursor api' },
            enabled: false,
            pollIntervalMinutes: 60,
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.loadSourceConfigsRequest).toBe('function');
    expect(typeof projectsModule.createSourceConfigRequest).toBe('function');
    expect(typeof projectsModule.updateSourceConfigRequest).toBe('function');

    const loadSourceConfigsRequest = projectsModule.loadSourceConfigsRequest as (
      projectId: number,
    ) => Promise<{ sourceConfigs: Array<{ id: number; label: string }> }>;
    const createSourceConfigRequest = projectsModule.createSourceConfigRequest as (
      projectId: number,
      input: {
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      },
    ) => Promise<{ sourceConfig: { id: number; label: string } }>;
    const updateSourceConfigRequest = projectsModule.updateSourceConfigRequest as (
      projectId: number,
      sourceConfigId: number,
      input: {
        label?: string;
        configJson?: Record<string, unknown>;
        enabled?: boolean;
        pollIntervalMinutes?: number;
      },
    ) => Promise<{ sourceConfig: { id: number; label: string; enabled: boolean } }>;

    const loaded = await loadSourceConfigsRequest(7);
    const created = await createSourceConfigRequest(7, {
      projectId: 7,
      sourceType: 'v2ex_search',
      platform: 'v2ex',
      label: 'V2EX mentions',
      configJson: { query: 'cursor api' },
      enabled: true,
      pollIntervalMinutes: 45,
    });
    const updated = await updateSourceConfigRequest(7, 4, {
      label: 'V2EX mentions updated',
      enabled: false,
      pollIntervalMinutes: 60,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/projects/7/source-configs', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/projects/7/source-configs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/projects/7/source-configs/4',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(loaded.sourceConfigs[0]?.id).toBe(3);
    expect(created.sourceConfig.label).toBe('V2EX mentions');
    expect(updated.sourceConfig.enabled).toBe(false);
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

  it('loads dashboard stats with a projectId filter through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        monitor: {
          total: 1,
          new: 1,
          followUpDrafts: 0,
        },
        drafts: {
          total: 2,
          review: 1,
        },
        totals: {
          items: 3,
          followUps: 0,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const dashboardModule = (await import('../../src/client/pages/Dashboard')) as Record<string, unknown>;

    expect(typeof dashboardModule.loadDashboardRequest).toBe('function');

    const loadDashboardRequest = dashboardModule.loadDashboardRequest as (projectId?: number) => Promise<{
      monitor: { total: number; new: number; followUpDrafts: number };
      drafts: { total: number; review: number };
    }>;

    const result = await loadDashboardRequest(12);

    expect(fetchMock).toHaveBeenCalledWith('/api/monitor/dashboard?projectId=12', undefined);
    expect(result.monitor.total).toBe(1);
    expect(result.drafts.total).toBe(2);
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

    expect(html).toContain('草稿总量');
    expect(html).toContain('待审核');
    expect(html).toContain('Follow-up 草稿');
    expect(html).toContain('新线索');
    expect(html).toContain('监控总条目');
    expect(html).toContain('累计线索');
    expect(html).toContain('累计 Follow-up');
    expect(html).toContain('监控总输入');
    expect(html).toContain('未 handled 会话');
    expect(html).toContain('收件箱总会话');
    expect(html).toContain('账号总数');
    expect(html).toContain('status=healthy 账号');
    expect(html).toContain('Browser Lane 总工单');
    expect(html).toContain('首发运营范围');
    expect(html).toContain('X、Reddit');
    expect(html).toContain('人工接管：Facebook Group、小红书、微博');
    expect(html).toContain('队列待执行');
    expect(html).toContain('队列已完成');
    expect(html).toContain('到期待执行（pending 子集）');
    expect(html).toContain('队列已取消');
    expect(html).toContain('失败发布日志');
    expect(html).toContain('项目 ID（可选）');
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
            brandVoice: 'Direct, calm, proof-first',
            ctas: ['Start free', 'Book a demo'],
          },
        },
      },
    });

    expect(html).toContain('最近创建结果');
    expect(html).toContain('Acme Launch');
    expect(html).toContain('https://acme.test');
    expect(html).toContain('Direct, calm, proof-first');
    expect(html).toContain('Start free, Book a demo');
  });

  it('posts project archiving through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        project: {
          id: 7,
          name: 'Archive Me',
          siteName: 'Archive Demo',
          siteUrl: 'https://archive.test',
          siteDescription: 'Archive coverage',
          sellingPoints: ['Quiet sunset'],
          archivedAt: '2026-04-23T10:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.archiveProjectRequest).toBe('function');

    const archiveProjectRequest = projectsModule.archiveProjectRequest as (
      id: number,
    ) => Promise<{ project: { id: number; archivedAt?: string } }>;

    const result = await archiveProjectRequest(7);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/7/archive',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.project.id).toBe(7);
    expect(result.project.archivedAt).toBe('2026-04-23T10:00:00.000Z');
  });

  it('does not show archived projects in the default project list', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const html = renderToStaticMarkup(
      createElement(ProjectsPage, {
        projectsStateOverride: {
          status: 'success',
          data: {
            projects: [
              {
                id: 1,
                name: 'Active Project',
                siteName: 'Active Site',
                siteUrl: 'https://active.test',
                siteDescription: 'Still live',
                sellingPoints: ['Fast'],
              },
              {
                id: 2,
                name: 'Archived Project',
                siteName: 'Archive Site',
                siteUrl: 'https://archived.test',
                siteDescription: 'No longer active',
                sellingPoints: ['Quiet'],
                archivedAt: '2026-04-23T10:00:00.000Z',
              },
            ],
          },
          error: null,
        },
        sourceConfigsStateOverride: {
          status: 'success',
          data: {
            sourceConfigsByProject: {},
          },
          error: null,
        },
      }),
    );

    expect(html).toContain('Active Project');
    expect(html).not.toContain('Archived Project');
    expect(html).toContain('已加载 1 个项目');
  });

  it('renders editable brand voice and ctas fields for project forms', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const html = renderToStaticMarkup(
      createElement(ProjectsPage, {
        projectsStateOverride: {
          status: 'success',
          data: {
            projects: [
              {
                id: 1,
                name: 'Voice Demo',
                siteName: 'Voice Site',
                siteUrl: 'https://voice.test',
                siteDescription: 'Brand landing page',
                sellingPoints: ['Fast setup'],
                brandVoice: 'Warm, punchy, confidence-building',
                ctas: ['Get started', 'Watch demo'],
              },
            ],
          },
          error: null,
        },
        sourceConfigsStateOverride: {
          status: 'success',
          data: {
            sourceConfigsByProject: {},
          },
          error: null,
        },
      }),
    );

    expect(html).toContain('Brand Voice');
    expect(html).toContain('CTAs');
    expect(html).toContain('Warm, punchy, confidence-building');
    expect(html).toContain('Get started, Watch demo');
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
      projectId?: number;
    }) => Promise<{ results: Array<{ platform: string; title?: string; content: string }> }>;

    const payload = {
      topic: 'Cheaper Claude-compatible endpoint',
      tone: 'professional',
      platforms: ['x'],
    };

    const result = await generateDraftsRequest(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/content/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(result.results[0]?.platform).toBe('x');
  });

  it('posts content generation with an optional projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            platform: 'reddit',
            title: 'Launch post',
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
      projectId?: number;
    }) => Promise<{ results: Array<{ platform: string; title?: string; content: string }> }>;

    const payload = {
      topic: 'Cheaper Claude-compatible endpoint',
      tone: 'professional',
      platforms: ['reddit'],
      saveAsDraft: true,
      projectId: 12,
    };

    const result = await generateDraftsRequest(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/content/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    expect(result.results[0]?.platform).toBe('reddit');
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

    const loadDraftsRequest = draftsModule.loadDraftsRequest as (projectId?: number) => Promise<{
      drafts: Array<{ id: number; title?: string; status: string }>;
    }>;

    const result = await loadDraftsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.title).toBe('Launch thread');
  });

  it('loads drafts with a projectId filter through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drafts: [
          {
            id: 2,
            platform: 'reddit',
            title: 'Project launch post',
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

    const loadDraftsRequest = draftsModule.loadDraftsRequest as (projectId?: number) => Promise<{
      drafts: Array<{ id: number; title?: string; status: string }>;
    }>;

    const result = await loadDraftsRequest(12);

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts?projectId=12', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.title).toBe('Project launch post');
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

  it('maps review discard to failed through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        draft: {
          id: 11,
          platform: 'x',
          title: 'Discarded review draft',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'failed',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reviewQueueModule = (await import('../../src/client/pages/ReviewQueue')) as Record<string, unknown>;

    expect(typeof reviewQueueModule.discardReviewDraftRequest).toBe('function');

    const discardReviewDraftRequest = reviewQueueModule.discardReviewDraftRequest as (id: number) => Promise<{
      draft: { id: number; title?: string; status: string };
    }>;

    const result = await discardReviewDraftRequest(11);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/11',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed' }),
      }),
    );
    expect(result.draft.title).toBe('Discarded review draft');
    expect(result.draft.status).toBe('failed');
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

  it('retries publish calendar failed drafts through POST /api/drafts/:id/publish', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        status: 'published',
        publishUrl: 'https://x.com/promobot/status/9',
        message: 'retry accepted',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const publishCalendarModule = (await import('../../src/client/pages/PublishCalendar')) as Record<string, unknown>;

    expect(typeof publishCalendarModule.retryPublishCalendarDraftRequest).toBe('function');

    const retryPublishCalendarDraftRequest =
      publishCalendarModule.retryPublishCalendarDraftRequest as (id: number) => Promise<{
        success: boolean;
        status?: string;
        publishUrl: string | null;
        message: string;
      }>;

    const result = await retryPublishCalendarDraftRequest(9);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/9/publish',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.status).toBe('published');
    expect(result.publishUrl).toBe('https://x.com/promobot/status/9');
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

    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('已加载 1 条草稿');
    expect(html).toContain('Launch thread');
    expect(html).toContain('draft');
    expect(html).toContain('集中展示不同项目和渠道的候选内容，并支持审核与人工接管前的内容整理。');
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
    expect(html).not.toContain('<option value="scheduled">');
    expect(html).not.toContain('<option value="published">');
    expect(html).not.toContain('<option value="failed">');
  });

  it('renders draft status filters and batch action controls for loaded drafts', async () => {
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
            {
              id: 2,
              platform: 'reddit',
              title: 'Review thread',
              content: 'Review body',
              hashtags: ['#review'],
              status: 'review',
              createdAt: '2026-04-19T00:10:00.000Z',
              updatedAt: '2026-04-19T00:10:00.000Z',
            },
          ],
        },
      },
    });

    expect(html).toContain('按状态筛选');
    expect(html).toContain('data-drafts-status-filter="all"');
    expect(html).toContain('data-drafts-status-filter="draft"');
    expect(html).toContain('data-drafts-status-filter="review"');
    expect(html).toContain('已加载 2 条草稿');
    expect(html).toContain('当前筛选下 2 条 / 总计 2 条草稿');
    expect(html).toContain('data-drafts-batch-review="true"');
    expect(html).toContain('data-drafts-batch-status="approved"');
    expect(html).toContain('data-drafts-batch-status="scheduled"');
    expect(html).toContain('data-drafts-batch-publish="true"');
    expect(html).toContain('已选 0 条草稿');
  });

  it('shows manual handoff feedback for draft publish contracts', async () => {
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const html = renderPage(DraftsPage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 7,
              platform: 'facebook-group',
              title: 'Community handoff',
              content: 'Draft body',
              hashtags: ['#community'],
              status: 'draft',
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
      draftInteractionStateOverride: {
        publishStateById: {
          7: {
            status: 'success',
            message: '已转入人工接管：Community handoff',
          },
        },
      },
    });

    expect(html).toContain('已转入人工接管：Community handoff');
    expect(html).toContain('发起人工接管');
  });

  it('shows queued publish feedback for draft publish contracts', async () => {
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const html = renderPage(DraftsPage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 8,
              platform: 'x',
              title: 'Queued launch thread',
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
        publishStateById: {
          8: {
            status: 'success',
            message: '已入队等待发布：Queued launch thread',
          },
        },
      },
    });

    expect(html).toContain('已入队等待发布：Queued launch thread');
  });

  it('renders queued drafts as read-only state summaries instead of editable controls', async () => {
    const { DraftsPage } = await import('../../src/client/pages/Drafts');

    const html = renderPage(DraftsPage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 9,
              platform: 'x',
              title: 'Queued launch thread',
              content: 'Draft body',
              hashtags: ['#launch'],
              status: 'queued',
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:05:00.000Z',
            },
          ],
        },
      },
      draftInteractionStateOverride: {
        publishStateById: {
          9: {
            status: 'success',
            message: '已入队等待发布：Queued launch thread',
          },
        },
      },
    });

    expect(html).toContain('queued');
    expect(html).toContain('当前状态已脱离 Draft 编辑流转，Drafts 页面仅展示服务器返回结果。');
    expect(html).toContain('已入队等待发布：Queued launch thread');
    expect(html).toContain('最新内容</span><p');
    expect(html).not.toContain('保存修改');
    expect(html).not.toContain('触发发布');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<select');
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
              id: 'x:acct-x',
              status: 'active',
              validatedAt: '2026-04-19T01:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/acct-x.json',
              notes: 'imported from headed browser',
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
        session?: {
          id?: string;
          notes?: string;
        };
        publishReadiness?: {
          ready: boolean;
          mode: string;
        };
      }>;
    }>;

    const result = await loadChannelAccountsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/channel-accounts', undefined);
    expect(result.channelAccounts).toHaveLength(2);
    expect(result.channelAccounts[0]?.session?.id).toBe('x:acct-x');
    expect(result.channelAccounts[0]?.session?.notes).toBe('imported from headed browser');
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
    ) => Promise<{
      ok: boolean;
      session: { hasSession: boolean; id?: string; status: string; notes?: string };
      channelAccount: {
        id: number;
        session?: {
          id?: string;
          notes?: string;
          storageStatePath?: string | null;
        };
      };
    }>;

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
    expect(result.session.id).toBe('x:acct-x');
    expect(result.session.status).toBe('active');
    expect(result.session.notes).toBe('manual relogin completed');
    expect(result.channelAccount.session?.id).toBe('x:acct-x');
    expect(result.channelAccount.session?.notes).toBe('manual relogin completed');
    expect(result.channelAccount.session?.storageStatePath).toBe(
      'artifacts/browser-sessions/acct-x.json',
    );
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
            message:
              'Browser session request queued. Complete login manually and attach session metadata after the browser lane picks up the job.',
            nextStep: '/api/channel-accounts/3/session',
            jobId: 11,
            jobStatus: 'pending',
            artifactPath: 'artifacts/browser-lane-requests/x/acct-x-2/request-session-job-11.json',
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
            message:
              'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
            nextStep: '/api/channel-accounts/3/session',
            jobId: 12,
            jobStatus: 'pending',
            artifactPath: 'artifacts/browser-lane-requests/x/acct-x-2/relogin-job-12.json',
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          channelAccount: {
            id: 3,
            projectId: 7,
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
      )
      .mockResolvedValueOnce(
        jsonResponse({
          channelAccount: {
            id: 3,
            projectId: null,
            platform: 'x',
            accountKey: 'acct-x-2',
            displayName: 'X Secondary Ops',
            authType: 'api-key',
            status: 'healthy',
            metadata: {},
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:05:00.000Z',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.createChannelAccountRequest).toBe('function');
    expect(typeof channelsModule.updateChannelAccountRequest).toBe('function');

    const createChannelAccountRequest = channelsModule.createChannelAccountRequest as (input: {
      projectId?: number | null;
      platform: string;
      accountKey: string;
      displayName: string;
      authType: string;
      status?: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ channelAccount: { id: number; projectId?: number | null; displayName: string } }>;
    const updateChannelAccountRequest = channelsModule.updateChannelAccountRequest as (
      accountId: number,
      input: {
        projectId?: number | null;
        displayName?: string;
      },
    ) => Promise<{ channelAccount: { id: number; projectId?: number | null; displayName: string } }>;

    const result = await createChannelAccountRequest({
      projectId: 7,
      platform: 'x',
      accountKey: 'acct-x-2',
      displayName: 'X Secondary',
      authType: 'api-key',
      status: 'healthy',
      metadata: { team: 'growth' },
    });
    const updated = await updateChannelAccountRequest(3, {
      projectId: null,
      displayName: 'X Secondary Ops',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/channel-accounts',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 7,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'api-key',
          status: 'healthy',
          metadata: { team: 'growth' },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/channel-accounts/3',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: null,
          displayName: 'X Secondary Ops',
        }),
      }),
    );
    expect(result.channelAccount.projectId).toBe(7);
    expect(result.channelAccount.displayName).toBe('X Secondary');
    expect(updated.channelAccount.projectId).toBeNull();
    expect(updated.channelAccount.displayName).toBe('X Secondary Ops');
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
                id: 'x:acct-x',
                status: 'active',
                validatedAt: '2026-04-19T01:00:00.000Z',
                storageStatePath: 'artifacts/browser-sessions/acct-x.json',
                notes: 'imported from headed browser',
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
              latestBrowserHandoffArtifact: {
                accountDisplayName: 'Reddit Ops',
                ownership: 'unmatched',
                platform: 'reddit',
                draftId: '31',
                title: 'Stale handoff',
                accountKey: 'acct-reddit',
                status: 'obsolete',
                artifactPath:
                  'artifacts/browser-handoffs/reddit/acct-reddit/reddit-draft-31.json',
                createdAt: '2026-04-19T00:20:00.000Z',
                updatedAt: '2026-04-19T00:25:00.000Z',
                resolvedAt: '2026-04-19T00:25:00.000Z',
                resolution: {
                  status: 'obsolete',
                  reason: 'relogin',
                },
              },
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
    expect(html).toContain('Session 备注：imported from headed browser');
    expect(html).toContain('发布就绪：已就绪');
    expect(html).toContain('发布方式：API');
    expect(html).toContain('建议动作：配置凭证');
    expect(html).toContain('编辑 Session 元数据');
    expect(html).toContain('最近 Handoff：draft #31 · obsolete');
    expect(html).toContain('Handoff 归属：未归属');
    expect(html).toContain('Handoff 账号：Reddit Ops');
    expect(html).toContain('Handoff 时间：2026-04-19T00:25:00.000Z');
    expect(html).toContain('Handoff 结单：2026-04-19T00:25:00.000Z');
    expect(html).toContain('Handoff 结果：obsolete');
    expect(html).toContain('Handoff 详情：relogin');
    expect(html).toContain(
      'Handoff 路径：artifacts/browser-handoffs/reddit/acct-reddit/reddit-draft-31.json',
    );
    expect(html).toContain('请求登录');
    expect(html).toContain('当前目标账号：X / Twitter');
    expect(html).toContain('动作目标账号');
    expect(html).toContain('自动选择最近目标');
    expect(html).toContain('>X / Twitter<');
    expect(html).toContain('>Reddit<');

    const fallbackHtml = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [
            {
              id: 3,
              platform: 'facebookGroup',
              accountKey: 'acct-facebook',
              displayName: 'Facebook Group',
              authType: 'browser',
              status: 'healthy',
              metadata: {},
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
              latestBrowserHandoffArtifact: {
                accountDisplayName: '',
                ownership: 'direct',
                platform: 'facebookGroup',
                draftId: '77',
                title: 'Manual handoff',
                accountKey: 'acct-facebook',
                status: 'pending',
                artifactPath:
                  'artifacts/browser-handoffs/facebookGroup/acct-facebook/facebookGroup-draft-77.json',
                createdAt: '2026-04-19T00:20:00.000Z',
                updatedAt: '2026-04-19T00:25:00.000Z',
                resolvedAt: null,
              },
            },
          ],
        },
      },
    });
    expect(fallbackHtml).toContain('Handoff 账号：未提供');

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

    const headerActionHtml = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [
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
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
            {
              id: 1,
              platform: 'x',
              accountKey: 'acct-x',
              displayName: 'X / Twitter',
              authType: 'browser',
              status: 'healthy',
              metadata: {},
              session: {
                hasSession: true,
                status: 'active',
                validatedAt: '2026-04-19T01:00:00.000Z',
                storageStatePath: 'artifacts/browser-sessions/acct-x.json',
              },
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
    } as never);

    expect(headerActionHtml).toContain('data-header-session-action="true"');
    expect(headerActionHtml).toContain('请求登录');
    expect(headerActionHtml).toContain('当前目标账号：Reddit');
  });

  it('renders the header session CTA as disabled when there is no target account', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [],
        },
      },
    } as never);

    expect(html).toContain('data-header-session-action="true"');
    expect(html).toContain('暂无登录目标');
    expect(html).toContain('disabled=""');
    expect(html).toContain('当前目标账号：未选定');
  });

  it('renders placeholder session action success copy without implying a live login request', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [],
        },
      },
      sessionActionStateOverride: {
        status: 'success',
        data: {
          ok: true,
          sessionAction: {
            action: 'request_session',
            accountId: 7,
            status: 'pending',
            requestedAt: '2026-04-19T03:10:00.000Z',
            message:
              'Browser session request queued. Complete login manually and attach session metadata after the browser lane picks up the job.',
            nextStep: '/api/channel-accounts/7/session',
            jobId: 17,
            jobStatus: 'pending',
            artifactPath: 'artifacts/browser-lane-requests/reddit/acct-reddit/request-session-job-17.json',
          },
          channelAccount: {
            id: 7,
            platform: 'reddit',
            accountKey: 'acct-reddit',
            displayName: 'Reddit Ops',
            authType: 'oauth',
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
        },
      },
    } as never);

    expect(html).toContain('请求登录占位已记录');
    expect(html).not.toContain('请求登录请求已发送');
    expect(html).toContain('Browser session request queued.');
    expect(html).toContain('请求时间：2026-04-19T03:10:00.000Z');
    expect(html).toContain('工单状态：pending');
    expect(html).toContain('下一步：/api/channel-accounts/7/session');
    expect(html).toContain(
      'Artifact Path：artifacts/browser-lane-requests/reddit/acct-reddit/request-session-job-17.json',
    );
  });

  it('shows manual handoff next steps for newly created browser-only channel accounts', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [],
        },
      },
      createStateOverride: {
        status: 'success',
        data: {
          channelAccount: {
            id: 9,
            platform: 'facebookGroup',
            accountKey: 'facebook-group-main',
            displayName: 'Facebook Group Manual',
            authType: 'browser',
            status: 'unknown',
            metadata: {},
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      },
    } as never);

    expect(html).toContain('账号已创建，下一步请准备人工接管');
    expect(html).toContain('继续准备人工接管');
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
    expect(html).toContain('X / Twitter（首发可用）');
    expect(html).toContain('Reddit（首发可用）');
    expect(html).toContain('Facebook Group（人工接管）');
    expect(html).toContain('小红书（人工接管）');
    expect(html).toContain('首发可用');
    expect(html).toContain('人工接管');
    expect(html).toContain('Blog（本地文件发布）');
    expect(html).toContain('value="x-main"');
    expect(html).toContain('value="X Primary"');
    expect(html).toContain('value="api"');
    expect(html).toContain('value="unknown"');
    expect(html).toContain('测试连接');
    expect(html).toContain('重新登录');
  });

  it('renders honest disabled no-target connection test CTAs for channel accounts', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, { stateOverride: { status: 'idle', error: null } });

    expect(html).toMatch(/data-header-test-connection-action="true"[^>]*disabled=""/);
    expect(html).toMatch(/data-recovery-test-connection-action="true"[^>]*disabled=""/);
    expect(html).toContain('暂无测试目标');
    expect(html).toContain('没有目标账号时，“测试连接”会禁用；先创建账号或选择动作目标账号。');
    expect(html).not.toContain('如果当前没有目标账号，则会先刷新列表。');
  });

  it('loads settings through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        settings: {
          schedulerIntervalMinutes: 15,
          allowlist: ['127.0.0.1'],
          rssDefaults: ['OpenAI blog'],
          monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['claude api latency'],
          monitorV2exQueries: ['llm api'],
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
        monitorRssFeeds?: string[];
        monitorXQueries?: string[];
        monitorRedditQueries?: string[];
        monitorV2exQueries?: string[];
      };
      platformReadiness?: Array<{
        platform: string;
        ready: boolean;
      }>;
    }>;

    const result = await loadSettingsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', undefined);
    expect(result.settings.schedulerIntervalMinutes).toBe(15);
    expect(result.settings.monitorRssFeeds?.[0]).toBe('https://openai.com/blog/rss.xml');
    expect(result.settings.monitorXQueries).toEqual(['openrouter failover']);
    expect(result.settings.monitorRedditQueries).toEqual(['claude api latency']);
    expect(result.platformReadiness?.[1]?.platform).toBe('facebookGroup');
  });

  it('patches settings through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        settings: {
          schedulerIntervalMinutes: 30,
          allowlist: ['10.0.0.1'],
          rssDefaults: ['TechCrunch'],
          monitorRssFeeds: ['https://rss.techcrunch.com/feed'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['model routing'],
          monitorV2exQueries: ['cursor'],
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
      monitorRssFeeds: string[];
      monitorXQueries: string[];
      monitorRedditQueries: string[];
      monitorV2exQueries: string[];
    }) => Promise<{ settings: { schedulerIntervalMinutes: number; monitorXQueries?: string[]; monitorV2exQueries?: string[] } }>;

    const result = await updateSettingsRequest({
      allowlist: ['10.0.0.1'],
      schedulerIntervalMinutes: 30,
      rssDefaults: ['TechCrunch'],
      monitorRssFeeds: ['https://rss.techcrunch.com/feed'],
      monitorXQueries: ['openrouter failover'],
      monitorRedditQueries: ['model routing'],
      monitorV2exQueries: ['cursor'],
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
          monitorRssFeeds: ['https://rss.techcrunch.com/feed'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['model routing'],
          monitorV2exQueries: ['cursor'],
        }),
      }),
    );
    expect(result.settings.schedulerIntervalMinutes).toBe(30);
    expect(result.settings.monitorXQueries).toEqual(['openrouter failover']);
    expect(result.settings.monitorV2exQueries).toEqual(['cursor']);
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

  it('loads browser lane requests through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        requests: [
          {
            channelAccountId: 7,
            platform: 'x',
            accountKey: 'acct-browser',
            action: 'request_session',
            jobStatus: 'pending',
            requestedAt: '2026-04-21T09:00:00.000Z',
            artifactPath:
              'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.loadBrowserLaneRequestsRequest).toBe('function');

    const loadBrowserLaneRequestsRequest = settingsModule.loadBrowserLaneRequestsRequest as (
      limit?: number,
    ) => Promise<{ requests: Array<{ platform: string; action: string }>; total: number }>;

    const result = await loadBrowserLaneRequestsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/browser-lane-requests?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.requests[0]).toEqual(
      expect.objectContaining({
        platform: 'x',
        action: 'request_session',
      }),
    );
  });

  it('loads browser handoffs through the settings shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          {
            platform: 'facebookGroup',
            draftId: '33',
            title: 'Community update',
            accountKey: 'launch-campaign',
            status: 'pending',
            artifactPath:
              'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-33.json',
            createdAt: '2026-04-21T09:10:00.000Z',
            updatedAt: '2026-04-21T09:10:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.loadBrowserHandoffsRequest).toBe('function');

    const loadBrowserHandoffsRequest = settingsModule.loadBrowserHandoffsRequest as (
      limit?: number,
    ) => Promise<{ handoffs: Array<{ platform: string; draftId: string }>; total: number }>;

    const result = await loadBrowserHandoffsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/browser-handoffs?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.handoffs[0]).toEqual(
      expect.objectContaining({
        platform: 'facebookGroup',
        draftId: '33',
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
            monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
            monitorXQueries: ['openrouter failover'],
            monitorRedditQueries: ['claude api latency'],
            monitorV2exQueries: ['llm api', 'cursor'],
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
            done: 5,
            failed: 1,
            canceled: 1,
          },
          recentJobs: [
            {
              id: 19,
              type: 'monitor_fetch',
              status: 'done',
              runAt: '2026-04-19T12:45:00.000Z',
              attempts: 1,
            },
          ],
        },
      },
      browserLaneStateOverride: {
        status: 'success',
        data: {
          requests: [
            {
              channelAccountId: 7,
              platform: 'x',
              accountKey: 'acct-browser',
              action: 'request_session',
              jobStatus: 'pending',
              requestedAt: '2026-04-21T09:00:00.000Z',
              artifactPath:
                'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
              resolvedAt: null,
            },
          ],
          total: 1,
        },
      },
      browserHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              platform: 'facebookGroup',
              draftId: '33',
              title: 'Community update',
              accountKey: 'launch-campaign',
              status: 'pending',
              artifactPath:
                'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-33.json',
              createdAt: '2026-04-21T09:10:00.000Z',
              updatedAt: '2026-04-21T09:10:00.000Z',
              resolvedAt: null,
            },
          ],
          total: 1,
        },
      },
    });

    expect(html).toContain('当前加载值');
    expect(html).toContain('最近保存返回');
    expect(html).toContain('调度与运行态');
    expect(html).toContain('AI 配置');
    expect(html).toContain('平台就绪度');
    expect(html).toContain('allowlist 保存后会立即影响当前进程的访问控制');
    expect(html).toContain('发布就绪：已就绪');
    expect(html).toContain('发布就绪：人工接管待准备');
    expect(html).toContain('建议动作：准备人工接管');
    expect(html).toContain('RSS 默认源');
    expect(html).toContain('监控来源配置');
    expect(html).toContain('Monitor RSS 源');
    expect(html).toContain('V2EX 关键词');
    expect(html).toContain('https://openai.com/blog/rss.xml');
    expect(html).toContain('llm api, cursor');
    expect(html).toContain('运行环境');
    expect(html).toContain('gpt-4.1-mini');
    expect(html).toContain('127.0.0.1');
    expect(html).toContain('运行控制台');
    expect(html).toContain('Done Jobs');
    expect(html).toContain('Canceled Jobs');
    expect(html).toContain('最近作业');
    expect(html).toContain('#19 · monitor_fetch · done');
    expect(html).toContain('Browser Lane 工单');
    expect(html).toContain('Browser Handoff 工单');
    expect(html).toContain('request_session');
    expect(html).toContain('artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json');
    expect(html).toContain(
      'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-33.json',
    );
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
    expect(html).toContain('监控来源配置');
    expect(html).toContain('运行控制台');
    expect(html).toContain('保存设置');
  });

  it('renders settings fields and save action as disabled until live settings load', async () => {
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const idleHtml = renderPage(SettingsPage, { stateOverride: { status: 'idle', error: null } });
    const loadingHtml = renderPage(SettingsPage, { stateOverride: { status: 'loading', error: null } });

    expect(idleHtml).toMatch(/data-settings-field="allowlist"[^>]*disabled=""/);
    expect(idleHtml).toMatch(/data-settings-field="schedulerIntervalMinutes"[^>]*disabled=""/);
    expect(idleHtml).toMatch(/>保存设置<\/button>/);
    expect(idleHtml).toMatch(/disabled=""/);
    expect(loadingHtml).toMatch(/data-settings-field="allowlist"[^>]*disabled=""/);
    expect(loadingHtml).toMatch(/data-settings-field="schedulerIntervalMinutes"[^>]*disabled=""/);
    expect(loadingHtml).toMatch(/>保存设置<\/button>/);
    expect(loadingHtml).toMatch(/disabled=""/);
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

  it('loads inbox items with a projectId filter through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'inbox-12',
            source: 'reddit',
            status: 'needs_reply',
            author: 'user456',
            title: 'Need project-scoped inbox',
            excerpt: 'Only show one project.',
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

    const loadInboxRequest = inboxModule.loadInboxRequest as (projectId?: number) => Promise<{
      items: Array<{ id: string; source: string; status: string }>;
      total: number;
      unread: number;
    }>;

    const result = await loadInboxRequest(7);

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox?projectId=7', undefined);
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe('inbox-12');
  });

  it('shows inbox loading, error, and success states', async () => {
    const { InboxPage } = await import('../../src/client/pages/Inbox');

    expect(renderApiPage(InboxPage, { status: 'loading' })).toContain('正在加载收件箱');
    expect(renderApiPage(InboxPage, { status: 'idle' })).toContain('当前展示的是预览数据');
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

    expect(html).toContain('当前筛选下 1 条 / 总计 1 条收件箱记录');
    expect(html).toContain('needs_reply');
    expect(html).toContain('Need lower latency in APAC');
    expect(html).toContain('项目 ID（可选）');
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

  it('loads monitor feed entries with a projectId filter through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'monitor-7',
            source: 'x',
            title: 'Project monitor entry',
            detail: 'Only scoped entries should appear.',
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

    const loadMonitorFeedRequest = monitorModule.loadMonitorFeedRequest as (projectId?: number) => Promise<{
      items: Array<{ id: string; source: string; title: string; status: string }>;
      total: number;
    }>;

    const result = await loadMonitorFeedRequest(7);

    expect(fetchMock).toHaveBeenCalledWith('/api/monitor/feed?projectId=7', undefined);
    expect(result.total).toBe(1);
    expect(result.items[0]?.title).toBe('Project monitor entry');
  });

  it('shows monitor loading, error, and success states', async () => {
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    expect(renderApiPage(MonitorPage, { status: 'loading' })).toContain('正在加载监控动态');
    expect(renderApiPage(MonitorPage, { status: 'idle' })).toContain('当前展示的是预览数据');
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
    expect(html).toContain('项目 ID（可选）');
  });

  it('shows discovery loading, error, and actionable success states', async () => {
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    expect(renderApiPage(DiscoveryPage, { status: 'loading' })).toContain('正在加载发现池');
    expect(renderApiPage(DiscoveryPage, { status: 'idle' })).toContain('当前展示的是预览数据');
    expect(
      renderApiPage(DiscoveryPage, {
        status: 'error',
        error: 'Request failed with status 500',
      }),
    ).toContain('发现池加载失败');

    const html = renderApiPage(DiscoveryPage, {
      status: 'success',
      data: {
        items: [
          {
            id: 'monitor-1',
            source: 'X / Twitter',
            title: 'Competitor onboarding teardown',
            summary: '值得保留为后续拆解选题。',
            status: 'new',
            score: 91,
            createdAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 'inbox-1',
            source: 'Reddit',
            title: 'Prospect asking for APAC latency proof',
            summary: '需要回复，但不支持 Discovery save/ignore。',
            status: 'needs_review',
            score: 73,
            createdAt: '2026-04-19T00:05:00.000Z',
          },
        ],
        total: 2,
        stats: {
          sources: 2,
          averageScore: 82,
        },
      },
    });

    expect(html).toContain('当前筛选下 2 条 / 总计 2 条发现条目');
    expect(html).toContain('Competitor onboarding teardown');
    expect(html).toContain('data-discovery-save-id="monitor-1"');
    expect(html).toContain('data-discovery-ignore-id="monitor-1"');
    expect(html).not.toContain('data-discovery-save-id="inbox-1"');
    expect(html).toContain('项目 ID（可选）');
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

  it('loads reputation stats with a projectId filter through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        total: 1,
        positive: 1,
        neutral: 0,
        negative: 0,
        trend: [
          {
            label: '正向',
            value: 1,
          },
        ],
        items: [
          {
            id: 'rep-7',
            source: 'x',
            sentiment: 'positive',
            status: 'handled',
            title: 'Scoped reputation mention',
            detail: 'Only one project mention.',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reputationModule = (await import('../../src/client/pages/Reputation')) as Record<string, unknown>;

    expect(typeof reputationModule.loadReputationRequest).toBe('function');

    const loadReputationRequest = reputationModule.loadReputationRequest as (projectId?: number) => Promise<{
      total: number;
      positive: number;
      neutral: number;
      negative: number;
      items: Array<{ id: string; sentiment: string; status: string }>;
    }>;

    const result = await loadReputationRequest(7);

    expect(fetchMock).toHaveBeenCalledWith('/api/reputation/stats?projectId=7', undefined);
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('handled');
  });

  it('shows reputation loading, error, and success states', async () => {
    const { ReputationPage } = await import('../../src/client/pages/Reputation');

    expect(renderApiPage(ReputationPage, { status: 'loading' })).toContain('正在加载口碑数据');
    expect(renderApiPage(ReputationPage, { status: 'idle' })).toContain('当前展示的是预览数据');
    expect(renderApiPage(ReputationPage, { status: 'idle' })).toContain('Billing confusion mention');
    expect(renderApiPage(ReputationPage, { status: 'idle' })).toContain('x');
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
    expect(html).toContain('负面');
    expect(html).toContain('Session expired complaint');
    expect(html).toContain('项目 ID（可选）');
  });
});
