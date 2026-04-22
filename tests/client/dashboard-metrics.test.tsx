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
    expect(html).toContain('Browser Lane 总工单');
    expect(html).toContain('Browser Lane 待处理');
    expect(html).toContain('Browser Lane 已结单');
    expect(html).toContain('Browser Handoff 总工单');
    expect(html).toContain('Browser Handoff 待处理');
    expect(html).toContain('Browser Handoff 已完成');
    expect(html).toContain('Browser Handoff 已作废');
    expect(html).toContain('Browser Handoff 未归属');
    expect(html).toContain('>11<');
    expect(html).toContain('队列待执行');
    expect(html).toContain('队列运行中');
    expect(html).toContain('队列已完成');
    expect(html).toContain('到期待执行（pending 子集）');
    expect(html).toContain('队列已取消');
    expect(html).toContain('失败发布日志');
    expect(html).toContain('首发运营范围');
    expect(html).toContain('X、Reddit');
    expect(html).toContain('人工接管：Facebook Group、小红书、微博');
    expect(html).toContain('项目 ID（可选）');
  });
});
