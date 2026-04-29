import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('dashboard enhanced metrics page', () => {
  it('renders the new inbox and channel-account metrics alongside loading and error feedback', async () => {
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

    expect(renderPage(DashboardPage, { stateOverride: { status: 'loading' } })).toContain('正在加载仪表盘');
    expect(renderPage(DashboardPage, { stateOverride: { status: 'idle' } })).toContain('当前展示的是预览说明');
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
          monitorConfig: {
            directFeeds: 1,
            directQueries: 3,
            enabledSourceConfigs: 2,
            totalInputs: 6,
          },
          drafts: {
            total: 5,
            review: 2,
          },
          totals: {
            items: 8,
            followUps: 1,
          },
          inbox: {
            total: 4,
            unread: 3,
          },
          channelAccounts: {
            total: 2,
            connected: 1,
            healthy: 1,
            needsSession: 1,
            needsRelogin: 0,
            otherUnhealthy: 0,
          },
          browserLaneRequests: {
            total: 2,
            pending: 1,
            resolved: 1,
          },
          browserHandoffs: {
            total: 2,
            pending: 1,
            resolved: 0,
            obsolete: 1,
            unmatched: 11,
          },
          inboxReplyHandoffs: {
            total: 3,
            pending: 1,
            resolved: 1,
            obsolete: 1,
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

    expect(html).toContain('未 handled 会话');
    expect(html).toContain('今日重点待办');
    expect(html).toContain('待处理登录工单');
    expect(html).toContain('待完成发布接管');
    expect(html).toContain('待完成回复接管');
    expect(html).toContain('未处理会话积压');
    expect(html).toContain('前往 System Queue');
    expect(html).toContain('前往 Social Inbox');
    expect(html).toContain('监控总条目');
    expect(html).toContain('累计线索');
    expect(html).toContain('累计 Follow-up');
    expect(html).toContain('监控直配源');
    expect(html).toContain('监控查询词');
    expect(html).toContain('项目源配置');
    expect(html).toContain('监控总输入');
    expect(html).toContain('收件箱总会话');
    expect(html).toContain('账号总数');
    expect(html).toContain('status=healthy 账号');
    expect(html).toContain('待补 session 账号');
    expect(html).toContain('待重新登录账号');
    expect(html).toContain('其他异常账号');
    expect(html).toContain('Browser Lane 总工单');
    expect(html).toContain('Browser Lane 待处理');
    expect(html).toContain('Browser Lane 已结单');
    expect(html).toContain('Browser Handoff 总工单');
    expect(html).toContain('Browser Handoff 待处理');
    expect(html).toContain('Browser Handoff 已完成');
    expect(html).toContain('Browser Handoff 已作废');
    expect(html).toContain('Browser Handoff 未归属');
    expect(html).toContain('Inbox Reply Handoff 总工单');
    expect(html).toContain('Inbox Reply Handoff 待处理');
    expect(html).toContain('Inbox Reply Handoff 已完成');
    expect(html).toContain('已导入 sent 或 failed 结果、artifact 已结单的 inbox reply handoff 数量');
    expect(html).toContain('Inbox Reply Handoff 已作废');
    expect(html).toContain('>11<');
    expect(html).toContain('>3<');
    expect(html).toContain('>1<');
    expect(html).toContain('队列待执行');
    expect(html).toContain('队列运行中');
    expect(html).toContain('队列已完成');
    expect(html).toContain('到期待执行（pending 子集）');
    expect(html).toContain('队列已取消');
    expect(html).toContain('失败发布日志');
    expect(html).toContain('首发运营范围');
    expect(html).toContain('X、Reddit');
    expect(html).toContain('人工接管：Facebook Group、Instagram、TikTok、小红书、微博');
    expect(html).toContain('项目 ID（可选）');
  });

  it('shows a calm dashboard message when there are no urgent operational items', async () => {
    const { DashboardPage } = await import('../../src/client/pages/Dashboard');

    const html = renderPage(DashboardPage, {
      stateOverride: {
        status: 'success',
        data: {
          monitor: {
            total: 0,
            new: 0,
            followUpDrafts: 0,
          },
          drafts: {
            total: 0,
            review: 0,
            scheduled: 0,
            published: 0,
          },
          totals: {
            items: 0,
            followUps: 0,
          },
          publishLogs: {
            failedCount: 0,
          },
          inbox: {
            total: 0,
            unread: 0,
          },
          channelAccounts: {
            total: 2,
            connected: 2,
            healthy: 2,
            needsSession: 0,
            needsRelogin: 0,
            otherUnhealthy: 0,
          },
          browserLaneRequests: {
            total: 0,
            pending: 0,
            resolved: 0,
          },
          browserHandoffs: {
            total: 0,
            pending: 0,
            resolved: 0,
            obsolete: 0,
            unmatched: 0,
          },
          inboxReplyHandoffs: {
            total: 0,
            pending: 0,
            resolved: 0,
            obsolete: 0,
          },
        },
      },
    });

    expect(html).toContain('今日重点待办');
    expect(html).toContain('当前没有高优先级待办');
    expect(html).toContain('可以继续生成内容，或回看项目与监控配置');
  });
});
