import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system/inbox-reply-handoffs')) {
        return Promise.resolve(jsonResponse({ handoffs: [], total: 0 }));
      }

      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  );
});

describe('channel account follow-up actions', () => {
  it('posts a real channel account connection test through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        test: {
          checkedAt: '2026-04-19T00:00:00.000Z',
          status: 'needs_relogin',
          summary: '需要重新登录',
          message: '检测到 X 浏览器 session 已过期，请重新登录后重新保存 session 元数据。',
          action: 'relogin',
          nextStep: '/api/channel-accounts/3/session',
        },
        channelAccount: {
          id: 3,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'browser',
          status: 'healthy',
          metadata: {
            team: 'growth',
          },
          session: {
            hasSession: true,
            status: 'expired',
            validatedAt: '2026-04-19T00:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/x-secondary.json',
          },
          publishReadiness: {
            platform: 'x',
            ready: false,
            mode: 'browser',
            status: 'needs_relogin',
            message: '已有 X 浏览器 session，但需要重新登录刷新。',
            action: 'relogin',
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
        summary?: string;
        message?: string;
        action?: string;
        nextStep?: string;
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
    expect(result.test.status).toBe('needs_relogin');
    expect(result.test.summary).toBe('需要重新登录');
    expect(result.test.action).toBe('relogin');
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
              authType: 'browser',
              status: 'healthy',
              metadata: {
                team: 'growth',
              },
              session: {
                hasSession: true,
                status: 'expired',
                validatedAt: '2026-04-19T00:00:00.000Z',
                storageStatePath: 'artifacts/browser-sessions/x-secondary.json',
              },
              publishReadiness: {
                platform: 'x',
                ready: false,
                mode: 'browser',
                status: 'needs_relogin',
                message: '已有 X 浏览器 session，但需要重新登录刷新。',
                action: 'relogin',
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
            authType: 'browser',
            status: 'healthy',
            metadata: {
              team: 'growth',
            },
            session: {
              hasSession: true,
              status: 'expired',
              validatedAt: '2026-04-19T00:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/x-secondary.json',
            },
            publishReadiness: {
              platform: 'x',
              ready: false,
              mode: 'browser',
              status: 'needs_relogin',
              message: '已有 X 浏览器 session，但需要重新登录刷新。',
              action: 'relogin',
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
            status: 'needs_relogin',
            result: {
              label: '需要重新登录',
            },
            feedback: {
              message: '检测到 X 浏览器 session 已过期，请重新登录后重新保存 session 元数据。',
            },
            recommendedAction: {
              action: 'relogin',
              label: '重新登录',
            },
            nextStep: {
              path: '/api/channel-accounts/3/session',
            },
            details: {
              ready: false,
              mode: 'browser',
              authType: 'browser',
              session: {
                hasSession: true,
                status: 'expired',
                validatedAt: '2026-04-19T00:00:00.000Z',
                storageStatePath: 'artifacts/browser-sessions/x-secondary.json',
              },
            },
          },
          channelAccount: {
            id: 3,
            platform: 'x',
            accountKey: 'acct-x-2',
            displayName: 'X Secondary',
            authType: 'browser',
            status: 'healthy',
            metadata: {
              team: 'growth',
            },
            session: {
              hasSession: true,
              status: 'expired',
              validatedAt: '2026-04-19T00:00:00.000Z',
              storageStatePath: 'artifacts/browser-sessions/x-secondary.json',
            },
            publishReadiness: {
              platform: 'x',
              ready: false,
              mode: 'browser',
              status: 'needs_relogin',
              message: '已有 X 浏览器 session，但需要重新登录刷新。',
              action: 'relogin',
            },
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      } satisfies ApiState,
    });

    expect(html).toContain('最近创建结果');
    expect(html).toContain('X Secondary');
    expect(html).toContain('账号已创建，下一步请准备人工接管');
    expect(html).toContain('最近一次连接测试');
    expect(html).toContain('连接结果：</strong>需要重新登录');
    expect(html).toContain('反馈：</strong>检测到 X 浏览器 session 已过期，请重新登录后重新保存 session 元数据。');
    expect(html).toContain('建议动作：</strong>重新登录');
    expect(html).toContain('下一步：</strong>/api/channel-accounts/3/session');
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
        monitorRssFeeds: string;
        monitorXQueries: string;
        monitorRedditQueries: string;
        monitorV2exQueries: string;
      },
      action: (payload: {
        allowlist: string[];
        schedulerIntervalMinutes: number;
        rssDefaults: string[];
        monitorRssFeeds: string[];
        monitorXQueries: string[];
        monitorRedditQueries: string[];
        monitorV2exQueries: string[];
      }) => Promise<unknown>,
    ) => Promise<{ ok: boolean; error?: string; payload?: unknown }>;

    const saveAction = vi.fn().mockResolvedValue({
      settings: {
        allowlist: ['127.0.0.1', '::1'],
        schedulerIntervalMinutes: 15,
        rssDefaults: ['OpenAI blog', 'Anthropic news'],
        monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude api latency'],
        monitorV2exQueries: ['llm api', 'cursor'],
      },
    });

    const invalid = await submitSettingsForm(
      {
        allowlist: '127.0.0.1, ::1',
        schedulerIntervalMinutes: '0',
        rssDefaults: 'OpenAI blog, Anthropic news',
        monitorRssFeeds: 'https://openai.com/blog/rss.xml',
        monitorXQueries: 'openrouter failover',
        monitorRedditQueries: 'claude api latency',
        monitorV2exQueries: 'llm api, cursor',
      },
      saveAction,
    );

    expect(invalid).toEqual({
      ok: false,
      error: 'schedulerIntervalMinutes 必须是大于 0 的整数',
    });
    expect(saveAction).not.toHaveBeenCalled();

    const invalidAllowlist = await submitSettingsForm(
      {
        allowlist: '127.0.0.1, 10.0.0.0/33',
        schedulerIntervalMinutes: '15',
        rssDefaults: 'OpenAI blog, Anthropic news',
        monitorRssFeeds: 'https://openai.com/blog/rss.xml',
        monitorXQueries: 'openrouter failover',
        monitorRedditQueries: 'claude api latency',
        monitorV2exQueries: 'llm api, cursor',
      },
      saveAction,
    );

    expect(invalidAllowlist).toEqual({
      ok: false,
      error: 'allowlist 只支持精确 IP、CIDR 子网或 *',
    });
    expect(saveAction).not.toHaveBeenCalled();

    const valid = await submitSettingsForm(
      {
        allowlist: '127.0.0.1, ::1',
        schedulerIntervalMinutes: '15',
        rssDefaults: 'OpenAI blog, Anthropic news',
        monitorRssFeeds: 'https://openai.com/blog/rss.xml\nhttps://hnrss.org/frontpage',
        monitorXQueries: 'openrouter failover,\nclaude latency',
        monitorRedditQueries: 'claude api latency,\nmodel routing',
        monitorV2exQueries: 'llm api,\ncursor',
      },
      saveAction,
    );

    expect(saveAction).toHaveBeenCalledWith({
      allowlist: ['127.0.0.1', '::1'],
      schedulerIntervalMinutes: 15,
      rssDefaults: ['OpenAI blog', 'Anthropic news'],
      monitorRssFeeds: ['https://openai.com/blog/rss.xml', 'https://hnrss.org/frontpage'],
      monitorXQueries: ['openrouter failover', 'claude latency'],
      monitorRedditQueries: ['claude api latency', 'model routing'],
      monitorV2exQueries: ['llm api', 'cursor'],
    });
    expect(valid).toEqual({
      ok: true,
      payload: {
        allowlist: ['127.0.0.1', '::1'],
        schedulerIntervalMinutes: 15,
        rssDefaults: ['OpenAI blog', 'Anthropic news'],
        monitorRssFeeds: ['https://openai.com/blog/rss.xml', 'https://hnrss.org/frontpage'],
        monitorXQueries: ['openrouter failover', 'claude latency'],
        monitorRedditQueries: ['claude api latency', 'model routing'],
        monitorV2exQueries: ['llm api', 'cursor'],
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
            monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
            monitorXQueries: ['openrouter failover'],
            monitorRedditQueries: ['claude api latency'],
            monitorV2exQueries: ['llm api'],
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
      } satisfies ApiState,
      browserHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              channelAccountId: 9,
              accountDisplayName: 'FB Group Manual',
              platform: 'facebookGroup',
              draftId: '33',
              title: 'Community update',
              accountKey: 'launch-campaign',
              ownership: 'direct',
              status: 'pending',
              artifactPath:
                'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-33.json',
              createdAt: '2026-04-21T09:10:00.000Z',
              updatedAt: '2026-04-21T09:10:00.000Z',
              resolvedAt: null,
              resolution: null,
            },
            {
              channelAccountId: 10,
              accountDisplayName: 'Weibo Manual',
              platform: 'weibo',
              draftId: '34',
              title: 'Published handoff',
              accountKey: 'launch-campaign',
              ownership: 'direct',
              status: 'resolved',
              artifactPath:
                'artifacts/browser-handoffs/weibo/launch-campaign/weibo-draft-34.json',
              createdAt: '2026-04-21T09:20:00.000Z',
              updatedAt: '2026-04-21T09:30:00.000Z',
              resolvedAt: '2026-04-21T09:30:00.000Z',
              resolution: {
                status: 'resolved',
                publishStatus: 'published',
              },
            },
          ],
          total: 2,
        },
      } satisfies ApiState,
      inboxReplyHandoffStateOverride: {
        status: 'success',
        data: {
          handoffs: [
            {
              channelAccountId: 12,
              platform: 'reddit',
              itemId: '88',
              source: 'reddit',
              title: 'Need lower latency in APAC',
              author: 'user123',
              accountKey: 'reddit-main',
              status: 'resolved',
              artifactPath:
                'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
              createdAt: '2026-04-23T09:10:00.000Z',
              updatedAt: '2026-04-23T11:15:00.000Z',
              resolvedAt: '2026-04-23T11:15:00.000Z',
              resolution: {
                status: 'resolved',
                replyStatus: 'sent',
                deliveryUrl: 'https://reddit.com/message/messages/abc123',
                message: 'reply sent manually',
                deliveredAt: '2026-04-23T11:15:00.000Z',
              },
            },
          ],
          total: 1,
        },
      } satisfies ApiState,
      updateStateOverride: {
        status: 'success',
        data: {
          settings: {
            allowlist: ['127.0.0.1'],
            schedulerIntervalMinutes: 15,
            rssDefaults: ['OpenAI blog'],
            monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
            monitorXQueries: ['openrouter failover'],
            monitorRedditQueries: ['claude api latency'],
            monitorV2exQueries: ['llm api'],
          },
        },
      } satisfies ApiState,
    });

    expect(successHtml).toContain('最近保存结果');
    expect(successHtml).toContain('设置已保存；allowlist 已生效，其它运行参数请结合 runtime 结果确认');
    expect(successHtml).toContain('127.0.0.1');
    expect(successHtml).toContain('AI 配置');
    expect(successHtml).toContain('调度与运行态');
    expect(successHtml).toContain('worker');
    expect(successHtml).toContain('运行控制台');
    expect(successHtml).toContain('Pending Jobs');
    expect(successHtml).toContain('Done Jobs');
    expect(successHtml).toContain('Canceled Jobs');
    expect(successHtml).toContain('最近作业');
    expect(successHtml).toContain('#19 · monitor_fetch · done');
    expect(successHtml).toContain('作业控制');
    expect(successHtml).toContain('Browser Handoff 工单');
    expect(successHtml).toContain('Inbox Reply Handoff 工单');
    expect(successHtml).toContain('account #9');
    expect(successHtml).toContain('account: FB Group Manual');
    expect(successHtml).toContain('ownership: direct');
    expect(successHtml).toContain(
      'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-33.json',
    );
    expect(successHtml).toContain('item #88');
    expect(successHtml).toContain('source: reddit');
    expect(successHtml).toContain('author: user123');
    expect(successHtml).toContain(
      'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
    );
    expect(successHtml).toContain('resolution: 未提供');
    expect(successHtml).toContain('resolution detail: published');
    expect(successHtml).toContain('resolution detail: sent');
    expect(successHtml).toContain('deliveryUrl: https://reddit.com/message/messages/abc123');
    expect(successHtml).toContain('deliveredAt: 2026-04-23T11:15:00.000Z');
    expect(successHtml).toContain('allowlist 保存后会立即影响当前进程的访问控制');
    expect(successHtml).toContain('重试');
    expect(successHtml).toContain('排程新作业');
    expect(successHtml).toContain('排程 Monitor Fetch');
    expect(successHtml).toContain('平台就绪度');
    expect(successHtml).toContain('发布就绪：已就绪');
    expect(successHtml).toContain('发布就绪：人工接管待准备');
    expect(successHtml).toContain('建议动作：准备人工接管');
    expect(successHtml).toContain('X API token 已配置，可直接尝试发布。');
    expect(successHtml).toContain('监控来源配置');
    expect(successHtml).toContain('https://openai.com/blog/rss.xml');
    expect(successHtml).toContain('llm api');
    expect(successHtml).toContain('monitorRssFeeds：https://openai.com/blog/rss.xml');
    expect(successHtml).toContain('monitorXQueries：openrouter failover');
    expect(successHtml).toContain('monitorRedditQueries：claude api latency');
    expect(successHtml).toContain('monitorV2exQueries：llm api');

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

    const validationAfterSuccessHtml = renderPage(SettingsPage, {
      validationMessageOverride: 'schedulerIntervalMinutes 必须是大于 0 的整数',
      updateStateOverride: {
        status: 'success',
        data: {
          settings: {
            allowlist: ['127.0.0.1'],
            schedulerIntervalMinutes: 15,
            rssDefaults: ['OpenAI blog'],
            monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
            monitorXQueries: ['openrouter failover'],
            monitorRedditQueries: ['claude api latency'],
            monitorV2exQueries: ['llm api'],
          },
        },
      } satisfies ApiState,
    });

    expect(validationAfterSuccessHtml).toContain(
      '保存前校验失败：schedulerIntervalMinutes 必须是大于 0 的整数',
    );
    expect(validationAfterSuccessHtml).toContain('保存状态：校验失败');
    expect(validationAfterSuccessHtml).not.toContain('设置已保存；allowlist 已生效，其它运行参数请结合 runtime 结果确认');
    expect(validationAfterSuccessHtml).not.toContain(
      'allowlist 已立即同步到当前进程；其它运行参数请结合当前 runtime / reload 结果确认是否已生效。',
    );
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
        monitorRssFeeds: ['https://openai.com/blog/rss.xml', 'https://hnrss.org/frontpage'],
        monitorXQueries: ['openrouter failover', 'claude latency'],
        monitorRedditQueries: ['claude api latency', 'model routing'],
        monitorV2exQueries: ['llm api', 'cursor'],
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
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
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
    const monitorRssFeedsField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'monitorRssFeeds',
    );
    const monitorXQueriesField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'monitorXQueries',
    );
    const monitorRedditQueriesField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'monitorRedditQueries',
    );
    const monitorV2exQueriesField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'monitorV2exQueries',
    );

    expect(loadSettingsAction).toHaveBeenCalledTimes(1);
    expect(loadSystemJobsAction).toHaveBeenCalledTimes(1);
    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(1);
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(1);
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(1);
    expect(allowlistField?.value).toBe('10.0.0.1, 10.0.0.2');
    expect(schedulerField?.value).toBe('45');
    expect(rssField?.value).toBe('OpenAI blog, TechCrunch');
    expect(monitorRssFeedsField?.value).toBe('https://openai.com/blog/rss.xml\nhttps://hnrss.org/frontpage');
    expect(monitorXQueriesField?.value).toBe('openrouter failover\nclaude latency');
    expect(monitorRedditQueriesField?.value).toBe('claude api latency\nmodel routing');
    expect(monitorV2exQueriesField?.value).toBe('llm api\ncursor');
    expect(collectText(container)).toContain('运行中');
    expect(collectText(container)).toContain('staging');
    expect(collectText(container)).toContain('平台就绪度');
    expect(collectText(container)).toContain('Facebook Group');
    expect(collectText(container)).toContain('准备人工接管');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live settings values visible while a reload is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const pendingReload = createDeferredPromise<{
      settings: {
        allowlist: string[];
        schedulerIntervalMinutes: number;
        rssDefaults: string[];
        monitorRssFeeds: string[];
        monitorXQueries: string[];
        monitorRedditQueries: string[];
        monitorV2exQueries: string[];
      };
    }>();
    const loadSettingsAction = vi
      .fn()
      .mockResolvedValueOnce({
        settings: {
          allowlist: ['10.0.0.1'],
          schedulerIntervalMinutes: 45,
          rssDefaults: ['OpenAI blog'],
          monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['claude api latency'],
          monitorV2exQueries: ['llm api'],
        },
      })
      .mockImplementationOnce(() => pendingReload.promise);
    const loadSystemJobsAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        failed: 0,
      },
      recentJobs: [],
    });
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
        }),
      );
      await flush();
      await flush();
    });

    const allowlistField = findElement(
      container,
      (element) => element.getAttribute('data-settings-field') === 'allowlist',
    );
    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载默认源'),
    );

    expect(allowlistField).not.toBeNull();
    expect(reloadButton).not.toBeNull();
    expect((allowlistField as { value?: string } | null)?.value).toBe('10.0.0.1');

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadSettingsAction).toHaveBeenCalledTimes(2);
    expect((allowlistField as { value?: string } | null)?.value).toBe('10.0.0.1');
    expect(collectText(container)).toContain('正在加载设置...');
    expect(collectText(container)).toContain('当前加载：已同步');
    expect(collectText(container)).not.toContain('接口成功返回后，会在这里展示完整响应。');

    await act(async () => {
      pendingReload.resolve({
        settings: {
          allowlist: ['10.0.0.2'],
          schedulerIntervalMinutes: 30,
          rssDefaults: ['OpenAI blog'],
          monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
          monitorXQueries: ['claude latency'],
          monitorRedditQueries: ['model routing'],
          monitorV2exQueries: ['cursor'],
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live system jobs visible while a control-triggered jobs reload is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const pendingJobsReload = createDeferredPromise<{
      jobs: Array<{
        id: number;
        type: string;
        status: string;
        runAt: string;
        attempts: number;
        canRetry?: boolean;
        canCancel?: boolean;
      }>;
      queue: {
        pending: number;
        failed: number;
      };
      recentJobs: Array<{
        id: number;
        type: string;
        status: string;
        runAt: string;
        attempts: number;
      }>;
    }>();
    const loadSettingsAction = vi.fn().mockResolvedValue({
      settings: {
        allowlist: ['10.0.0.1'],
        schedulerIntervalMinutes: 45,
        rssDefaults: ['OpenAI blog'],
        monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude api latency'],
        monitorV2exQueries: ['llm api'],
      },
    });
    const loadSystemJobsAction = vi
      .fn()
      .mockResolvedValueOnce({
        jobs: [
          {
            id: 17,
            type: 'monitor_fetch',
            status: 'failed',
            runAt: '2026-04-19T12:45:00.000Z',
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
      })
      .mockImplementationOnce(() => pendingJobsReload.promise);
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const reloadSchedulerAction = vi.fn().mockResolvedValue({
      scheduler: {
        enabled: true,
      },
      runtime: {
        mode: 'worker',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          reloadSchedulerAction,
        }),
      );
      await flush();
      await flush();
    });

    const reloadSchedulerButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重载 Scheduler'),
    );

    expect(reloadSchedulerButton).not.toBeNull();
    expect(collectText(container)).toContain('#17 · monitor_fetch · failed');

    await act(async () => {
      reloadSchedulerButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(reloadSchedulerAction).toHaveBeenCalledTimes(1);
    expect(loadSystemJobsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('正在加载 system jobs...');
    expect(collectText(container)).toContain('#17 · monitor_fetch · failed');

    await act(async () => {
      pendingJobsReload.resolve({
        jobs: [
          {
            id: 18,
            type: 'publish',
            status: 'pending',
            runAt: '2026-04-19T13:00:00.000Z',
            attempts: 2,
            canRetry: false,
            canCancel: true,
          },
        ],
        queue: {
          pending: 1,
          failed: 0,
        },
        recentJobs: [],
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live browser lane, browser handoff, and inbox reply handoff entries visible while their reloads are pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const pendingBrowserLaneReload = createDeferredPromise<{
      requests: Array<{
        channelAccountId: number;
        platform: string;
        accountKey: string;
        action: string;
        jobStatus: string;
        requestedAt: string;
        artifactPath: string;
        resolvedAt: string | null;
      }>;
      total: number;
    }>();
    const pendingBrowserHandoffReload = createDeferredPromise<{
      handoffs: Array<{
        channelAccountId?: number;
        accountDisplayName?: string;
        ownership?: string;
        platform: string;
        draftId: string;
        title: string | null;
        accountKey: string;
        status: string;
        artifactPath: string;
        createdAt: string;
        updatedAt: string;
        resolvedAt: string | null;
        resolution?: unknown;
      }>;
      total: number;
    }>();
    const pendingInboxReplyHandoffReload = createDeferredPromise<{
      handoffs: Array<{
        channelAccountId?: number;
        platform: string;
        itemId: string;
        source: string;
        title?: string | null;
        author?: string | null;
        accountKey: string;
        status: string;
        artifactPath: string;
        createdAt: string;
        updatedAt: string;
        resolvedAt: string | null;
        resolution?: unknown;
      }>;
      total: number;
    }>();
    const loadSettingsAction = vi.fn().mockResolvedValue({
      settings: {
        allowlist: ['10.0.0.1'],
        schedulerIntervalMinutes: 45,
        rssDefaults: ['OpenAI blog'],
        monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude api latency'],
        monitorV2exQueries: ['llm api'],
      },
    });
    const loadSystemJobsAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        failed: 0,
      },
      recentJobs: [],
    });
    const loadBrowserLaneRequestsAction = vi
      .fn()
      .mockResolvedValueOnce({
        requests: [
          {
            channelAccountId: 7,
            platform: 'x',
            accountKey: 'acct-browser',
            action: 'request_session',
            jobStatus: 'pending',
            requestedAt: '2026-04-21T09:00:00.000Z',
            artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/request-session-job-17.json',
            resolvedAt: null,
          },
        ],
        total: 1,
      })
      .mockImplementationOnce(() => pendingBrowserLaneReload.promise);
    const loadBrowserHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [
          {
            channelAccountId: 7,
            accountDisplayName: 'FB Group Manual',
            platform: 'facebookGroup',
            draftId: '13',
            title: 'Community update',
            accountKey: 'launch-campaign',
            ownership: 'direct',
            status: 'resolved',
            artifactPath: 'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
            createdAt: '2026-04-21T09:10:00.000Z',
            updatedAt: '2026-04-21T09:20:00.000Z',
            resolvedAt: '2026-04-21T09:20:00.000Z',
            resolution: {
              status: 'resolved',
            },
          },
        ],
        total: 1,
      })
      .mockImplementationOnce(() => pendingBrowserHandoffReload.promise);
    const loadInboxReplyHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [
          {
            channelAccountId: 12,
            platform: 'reddit',
            itemId: '88',
            source: 'reddit',
            title: 'Need lower latency in APAC',
            author: 'user123',
            accountKey: 'reddit-main',
            status: 'resolved',
            artifactPath:
              'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
            createdAt: '2026-04-23T09:10:00.000Z',
            updatedAt: '2026-04-23T11:15:00.000Z',
            resolvedAt: '2026-04-23T11:15:00.000Z',
            resolution: {
              status: 'resolved',
              replyStatus: 'sent',
            },
          },
        ],
        total: 1,
      })
      .mockImplementationOnce(() => pendingInboxReplyHandoffReload.promise);
    const reloadSchedulerAction = vi.fn().mockResolvedValue({
      scheduler: {
        enabled: true,
      },
      runtime: {
        mode: 'worker',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
          reloadSchedulerAction,
        }),
      );
      await flush();
      await flush();
    });

    const reloadSchedulerButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重载 Scheduler'),
    );

    expect(reloadSchedulerButton).not.toBeNull();
    expect(collectText(container)).toContain('acct-browser');
    expect(collectText(container)).toContain('FB Group Manual');
    expect(collectText(container)).toContain('Need lower latency in APAC');

    await act(async () => {
      reloadSchedulerButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadBrowserLaneRequestsAction).toHaveBeenCalledTimes(2);
    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);
    expect(loadInboxReplyHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('正在加载 browser lane requests...');
    expect(collectText(container)).toContain('正在加载 browser handoffs...');
    expect(collectText(container)).toContain('正在加载 inbox reply handoffs...');
    expect(collectText(container)).toContain('acct-browser');
    expect(collectText(container)).toContain('FB Group Manual');
    expect(collectText(container)).toContain('Need lower latency in APAC');
    expect(collectText(container)).toContain('10.0.0.1');

    await act(async () => {
      pendingBrowserLaneReload.resolve({
        requests: [],
        total: 0,
      });
      pendingBrowserHandoffReload.resolve({
        handoffs: [],
        total: 0,
      });
      pendingInboxReplyHandoffReload.resolve({
        handoffs: [],
        total: 0,
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks overlapping runtime control actions while a prior control is still in flight', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    const pendingReload = createDeferredPromise<{
      scheduler: {
        enabled: boolean;
      };
      runtime: {
        mode: string;
      };
    }>();
    const loadSettingsAction = vi.fn().mockResolvedValue({
      settings: {
        allowlist: ['10.0.0.1'],
        schedulerIntervalMinutes: 45,
        rssDefaults: ['OpenAI blog'],
        monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
        monitorXQueries: ['openrouter failover'],
        monitorRedditQueries: ['claude api latency'],
        monitorV2exQueries: ['llm api'],
      },
    });
    const loadSystemJobsAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        failed: 0,
      },
      recentJobs: [],
    });
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const reloadSchedulerAction = vi.fn().mockReturnValue(pendingReload.promise);
    const tickSchedulerAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          reloadSchedulerAction,
          tickSchedulerAction,
        }),
      );
      await flush();
      await flush();
    });

    const reloadSchedulerButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重载 Scheduler'),
    );
    const tickButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('立即 Tick'),
    );

    expect(reloadSchedulerButton).not.toBeNull();
    expect(tickButton).not.toBeNull();

    await act(async () => {
      reloadSchedulerButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      tickButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(reloadSchedulerAction).toHaveBeenCalledTimes(1);
    expect(tickSchedulerAction).not.toHaveBeenCalled();
    expect(tickButton?.getAttribute('disabled')).toBe('');

    await act(async () => {
      pendingReload.resolve({
        scheduler: {
          enabled: true,
        },
        runtime: {
          mode: 'worker',
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps settings fields disabled until live settings finish loading and blocks premature saves', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { SettingsPage } = await import('../../src/client/pages/Settings');

    let resolveSettings: ((value: unknown) => void) | null = null;
    const loadSettingsAction = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        }),
    );
    const loadSystemJobsAction = vi.fn().mockResolvedValue({
      jobs: [],
      queue: {
        pending: 0,
        failed: 0,
      },
      recentJobs: [],
    });
    const loadBrowserLaneRequestsAction = vi.fn().mockResolvedValue({
      requests: [],
      total: 0,
    });
    const loadBrowserHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const loadInboxReplyHandoffsAction = vi.fn().mockResolvedValue({
      handoffs: [],
      total: 0,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(SettingsPage as never, {
          loadSettingsAction,
          loadSystemJobsAction,
          loadBrowserLaneRequestsAction,
          loadBrowserHandoffsAction,
          loadInboxReplyHandoffsAction,
        }),
      );
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
    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存设置'),
    );

    expect(allowlistField).not.toBeNull();
    expect(schedulerField).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(allowlistField?.getAttribute('disabled')).toBe('');
    expect(schedulerField?.getAttribute('disabled')).toBe('');
    expect(saveButton?.getAttribute('disabled')).toBe('');

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveSettings?.({
        settings: {
          allowlist: ['10.0.0.1'],
          schedulerIntervalMinutes: 45,
          rssDefaults: ['OpenAI blog'],
          monitorRssFeeds: ['https://openai.com/blog/rss.xml'],
          monitorXQueries: ['openrouter failover'],
          monitorRedditQueries: ['claude api latency'],
          monitorV2exQueries: ['llm api'],
        },
      });
      await flush();
      await flush();
    });

    expect(allowlistField?.getAttribute('disabled')).toBeNull();
    expect(schedulerField?.getAttribute('disabled')).toBeNull();
    expect(saveButton?.getAttribute('disabled')).toBeNull();
    expect((allowlistField as { value?: string } | null)?.value).toBe('10.0.0.1');
    expect((schedulerField as { value?: string } | null)?.value).toBe('45');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
