import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectText, findElement, flush, installMinimalDom } from './settings-test-helpers';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

type ApiState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: unknown;
  error?: string | null;
};

function renderPage(Component: unknown, props: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(Component as (properties: typeof props) => React.JSX.Element, props),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('channel account follow-up actions', () => {
  it('posts a real channel account connection test through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        test: {
          checkedAt: '2026-04-19T00:00:00.000Z',
          status: 'healthy',
        },
        channelAccount: {
          id: 3,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'api-key',
          status: 'healthy',
          metadata: {
            team: 'growth',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.testChannelAccountConnectionRequest).toBe('function');

    const testChannelAccountConnectionRequest = channelsModule.testChannelAccountConnectionRequest as (
      accountId: number,
    ) => Promise<{
      ok: boolean;
      test: {
        checkedAt: string;
        status: string;
      };
      channelAccount: {
        id: number;
        displayName: string;
      };
    }>;

    const result = await testChannelAccountConnectionRequest(3);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/channel-accounts/3/test',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.channelAccount.displayName).toBe('X Secondary');
    expect(result.test.status).toBe('healthy');
  });

  it('runs the connection test follow-up for the latest created account and refreshes the list', async () => {
    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.runChannelAccountConnectionTest).toBe('function');

    const runChannelAccountConnectionTest = channelsModule.runChannelAccountConnectionTest as (
      accountId: number,
      action: (targetAccountId: number) => Promise<unknown>,
      onSuccess: () => void,
    ) => Promise<{ ok: boolean }>;

    const testAction = vi.fn().mockResolvedValue({
      ok: true,
    });
    const reload = vi.fn();

    const result = await runChannelAccountConnectionTest(7, testAction, reload);

    expect(testAction).toHaveBeenCalledWith(7);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('renders visible create feedback and connection test feedback on the channel accounts page', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, {
      stateOverride: {
        status: 'success',
        data: {
          channelAccounts: [
            {
              id: 3,
              platform: 'x',
              accountKey: 'acct-x-2',
              displayName: 'X Secondary',
              authType: 'api-key',
              status: 'healthy',
              metadata: {
                team: 'growth',
              },
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      } satisfies ApiState,
      createStateOverride: {
        status: 'success',
        data: {
          channelAccount: {
            id: 3,
            platform: 'x',
            accountKey: 'acct-x-2',
            displayName: 'X Secondary',
            authType: 'api-key',
            status: 'healthy',
            metadata: {
              team: 'growth',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      } satisfies ApiState,
      testConnectionStateOverride: {
        status: 'success',
        data: {
          ok: true,
          test: {
            checkedAt: '2026-04-19T00:00:00.000Z',
            status: 'healthy',
          },
          channelAccount: {
            id: 3,
            platform: 'x',
            accountKey: 'acct-x-2',
            displayName: 'X Secondary',
            authType: 'api-key',
            status: 'healthy',
            metadata: {
              team: 'growth',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      } satisfies ApiState,
    });

    expect(html).toContain('最近创建结果');
    expect(html).toContain('X Secondary');
    expect(html).toContain('账号已创建，可继续测试连接');
    expect(html).toContain('最近一次连接测试');
    expect(html).toContain('healthy');
  });

  it('renders channel account create errors visibly', async () => {
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const html = renderPage(ChannelAccountsPage, {
      createStateOverride: {
        status: 'error',
        error: 'duplicate account key',
      } satisfies ApiState,
    });

    expect(html).toContain('创建失败：duplicate account key');
  });
});

describe('settings save validation and feedback', () => {
  it('blocks invalid settings submissions before the save request is sent', async () => {
    const settingsModule = (await import('../../src/client/pages/Settings')) as Record<string, unknown>;

    expect(typeof settingsModule.submitSettingsForm).toBe('function');

    const submitSettingsForm = settingsModule.submitSettingsForm as (
      formValues: {
        allowlist: string;
        schedulerIntervalMinutes: string;
        rssDefaults: string;
      },
      action: (payload: {
        allowlist: string[];
        schedulerIntervalMinutes: number;
        rssDefaults: string[];
      }) => Promise<unknown>,
    ) => Promise<{ ok: boolean; error?: string; payload?: unknown }>;

    const saveAction = vi.fn().mockResolvedValue({
      settings: {
        allowlist: ['127.0.0.1', '::1'],
        schedulerIntervalMinutes: 15,
        rssDefaults: ['OpenAI blog', 'Anthropic news'],
      },
    });

    const invalid = await submitSettingsForm(
      {
        allowlist: '127.0.0.1, ::1',
        schedulerIntervalMinutes: '0',
        rssDefaults: 'OpenAI blog, Anthropic news',
      },
      saveAction,
    );

    expect(invalid).toEqual({
      ok: false,
      error: 'schedulerIntervalMinutes 必须是大于 0 的整数',
    });
    expect(saveAction).not.toHaveBeenCalled();

    const valid = await submitSettingsForm(
      {
        allowlist: '127.0.0.1, ::1',
        schedulerIntervalMinutes: '15',
        rssDefaults: 'OpenAI blog, Anthropic news',
      },
      saveAction,
    );

    expect(saveAction).toHaveBeenCalledWith({
      allowlist: ['127.0.0.1', '::1'],
      schedulerIntervalMinutes: 15,
      rssDefaults: ['OpenAI blog', 'Anthropic news'],
    });
    expect(valid).toEqual({
      ok: true,
      payload: {
        allowlist: ['127.0.0.1', '::1'],
        schedulerIntervalMinutes: 15,
        rssDefaults: ['OpenAI blog', 'Anthropic news'],
      },
    });
  });

  it('renders save success, failure, and validation feedback on the settings page', async () => {
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const successHtml = renderPage(SettingsPage, {
      stateOverride: {
        status: 'success',
        data: {
          settings: {
            allowlist: ['127.0.0.1'],
            schedulerIntervalMinutes: 15,
            rssDefaults: ['OpenAI blog'],
          },
          scheduler: {
            enabled: true,
            status: 'healthy',
            runtime: {
              mode: 'worker',
              queueDepth: 2,
            },
          },
          runtime: {
            queue: {
              pending: 2,
              running: 1,
              failed: 0,
              duePending: 1,
            },
            recentJobs: [
              {
                id: 12,
                type: 'publish',
                status: 'pending',
                runAt: '2026-04-19T09:15:00.000Z',
                attempts: 1,
                updatedAt: '2026-04-19T09:00:00.000Z',
              },
            ],
          },
          ai: {
            provider: 'OpenAI',
            model: 'gpt-4.1-mini',
          },
          platformReadiness: [
            {
              platform: 'x',
              ready: true,
              status: 'ready',
              mode: 'api',
              message: 'X API token 已配置，可直接尝试发布。',
            },
            {
              platform: 'facebookGroup',
              ready: false,
              status: 'needs_session',
              mode: 'browser',
              message: 'Facebook Group 需要先保存浏览器 session，发布时再手动接管。',
              action: 'request_session',
            },
          ],
        },
      } satisfies ApiState,
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
      } satisfies ApiState,
      updateStateOverride: {
        status: 'success',
        data: {
          settings: {
            allowlist: ['127.0.0.1'],
            schedulerIntervalMinutes: 15,
            rssDefaults: ['OpenAI blog'],
          },
        },
      } satisfies ApiState,
    });

    expect(successHtml).toContain('最近保存结果');
    expect(successHtml).toContain('设置已保存');
    expect(successHtml).toContain('127.0.0.1');
    expect(successHtml).toContain('AI 配置');
    expect(successHtml).toContain('调度与运行态');
    expect(successHtml).toContain('worker');
    expect(successHtml).toContain('运行控制台');
    expect(successHtml).toContain('Pending Jobs');
    expect(successHtml).toContain('最近作业');
    expect(successHtml).toContain('作业控制');
    expect(successHtml).toContain('重试');
    expect(successHtml).toContain('排程新作业');
    expect(successHtml).toContain('排程 Monitor Fetch');
    expect(successHtml).toContain('平台就绪度');
    expect(successHtml).toContain('发布就绪：已就绪');
    expect(successHtml).toContain('发布就绪：需要登录会话');
    expect(successHtml).toContain('建议动作：请求登录');
    expect(successHtml).toContain('X API token 已配置，可直接尝试发布。');

    const errorHtml = renderPage(SettingsPage, {
      updateStateOverride: {
        status: 'error',
        error: 'permission denied',
      } satisfies ApiState,
    });

    expect(errorHtml).toContain('保存失败：permission denied');

    const validationHtml = renderPage(SettingsPage, {
      validationMessageOverride: 'schedulerIntervalMinutes 必须是大于 0 的整数',
    });

    expect(validationHtml).toContain('保存前校验失败：schedulerIntervalMinutes 必须是大于 0 的整数');
  });

  it('backfills the form after current settings finish loading', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const loadSettingsAction = vi.fn().mockResolvedValue({
      settings: {
        allowlist: ['10.0.0.1', '10.0.0.2'],
        schedulerIntervalMinutes: 45,
        rssDefaults: ['OpenAI blog', 'TechCrunch'],
      },
      scheduler: {
        enabled: true,
        status: 'running',
        lastRunAt: '2026-04-19T09:00:00.000Z',
      },
      runtime: {
        environment: 'staging',
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
    });
    const loadSystemJobsAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        failed: 0,
      },
      recentJobs: [],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
        }),
      );
      await flush();
      await flush();
    });

    const allowlistField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'allowlist',
    );
    const schedulerField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'schedulerIntervalMinutes',
    );
    const rssField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'rssDefaults',
    );

    expect(loadSettingsAction).toHaveBeenCalledTimes(1);
    expect(loadSystemJobsAction).toHaveBeenCalledTimes(1);
    expect(allowlistField?.value).toBe('10.0.0.1, 10.0.0.2');
    expect(schedulerField?.value).toBe('45');
    expect(rssField?.value).toBe('OpenAI blog, TechCrunch');
    expect(collectText(container)).toContain('运行中');
    expect(collectText(container)).toContain('staging');
    expect(collectText(container)).toContain('平台就绪度');
    expect(collectText(container)).toContain('Facebook Group');
    expect(collectText(container)).toContain('请求登录');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
