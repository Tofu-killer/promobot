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
});
