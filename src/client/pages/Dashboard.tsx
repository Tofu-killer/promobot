import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { StatCard } from '../components/StatCard';
import type { AppRoute } from '../lib/types';

export interface DashboardResponse {
  monitor: {
    total: number;
    new: number;
    followUpDrafts: number;
  };
  drafts: {
    total: number;
    review: number;
    scheduled?: number;
    published?: number;
  };
  totals: {
    items: number;
    followUps: number;
  };
  publishLogs?: {
    failedCount?: number;
  };
  monitorConfig?: {
    directFeeds: number;
    directQueries: number;
    enabledSourceConfigs: number;
    totalInputs: number;
  };
  inbox?: {
    total: number;
    unread: number;
  };
  channelAccounts?: {
    total: number;
    connected: number;
    healthy?: number;
    needsSession?: number;
    needsRelogin?: number;
    otherUnhealthy?: number;
  };
  browserLaneRequests?: {
    total: number;
    pending: number;
    resolved: number;
  };
  browserHandoffs?: {
    total: number;
    pending: number;
    resolved: number;
    obsolete: number;
    unmatched: number;
  };
  inboxReplyHandoffs?: {
    total: number;
    pending: number;
    resolved: number;
    obsolete: number;
  };
  jobQueue?: {
    pending: number;
    running: number;
    done: number;
    failed: number;
    canceled?: number;
    duePending: number;
  };
}

function parseProjectId(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function getProjectIdValidationError(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return null;
  }

  return parseProjectId(value) === undefined ? '项目 ID 必须是大于 0 的整数' : null;
}

function buildProjectScopedPath(path: string, projectId?: number) {
  return projectId === undefined ? path : `${path}?projectId=${projectId}`;
}

const projectInputStyle = {
  width: '100%',
  maxWidth: '240px',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export async function loadDashboardRequest(projectId?: number): Promise<DashboardResponse> {
  return apiRequest<DashboardResponse>(buildProjectScopedPath('/api/monitor/dashboard', projectId));
}

interface DashboardPageProps {
  loadDashboardAction?: (projectId?: number) => Promise<DashboardResponse>;
  stateOverride?: AsyncState<DashboardResponse>;
  projectIdDraft?: string;
  onProjectIdDraftChange?: (value: string) => void;
  onNavigateToRoute?: (route: AppRoute) => void;
}

export function DashboardPage({
  loadDashboardAction = loadDashboardRequest,
  stateOverride,
  projectIdDraft,
  onProjectIdDraftChange,
  onNavigateToRoute,
}: DashboardPageProps) {
  const [localProjectIdDraft, setLocalProjectIdDraft] = useState('');
  const activeProjectIdDraft = projectIdDraft ?? localProjectIdDraft;
  const projectId = parseProjectId(activeProjectIdDraft);
  const projectIdValidationError = getProjectIdValidationError(activeProjectIdDraft);
  const { state } = useAsyncQuery(
    () => {
      if (projectIdValidationError) {
        return Promise.reject(new Error(projectIdValidationError));
      }

      return projectId === undefined ? loadDashboardAction() : loadDashboardAction(projectId);
    },
    [loadDashboardAction, projectId, projectIdValidationError],
  );
  const displayState = stateOverride ?? state;
  const showLoadError =
    displayState.status === 'error' && displayState.error !== projectIdValidationError;
  const hasLiveDashboardData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    typeof (displayState.data as DashboardResponse).drafts === 'object' &&
    (displayState.data as DashboardResponse).drafts !== null;
  const viewData = hasLiveDashboardData ? (displayState.data as DashboardResponse) : null;
  const inboxMetrics = viewData?.inbox ?? null;
  const channelAccountMetrics = viewData?.channelAccounts ?? null;
  const browserLaneMetrics = viewData?.browserLaneRequests ?? null;
  const browserHandoffMetrics = viewData?.browserHandoffs ?? null;
  const inboxReplyHandoffMetrics = viewData?.inboxReplyHandoffs ?? null;
  const draftLifecycleMetrics = {
    scheduled: viewData?.drafts.scheduled,
    published: viewData?.drafts.published,
  };
  const monitorConfigMetrics = viewData?.monitorConfig ?? null;
  const publishLogMetrics = {
    failedCount: viewData?.publishLogs?.failedCount,
  };
  const jobQueueMetrics = viewData?.jobQueue ?? null;
  const priorityItems = viewData ? buildPriorityItems(viewData) : [];

  return (
    <section>
      <header style={{ marginBottom: '24px' }}>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>Overview</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>Dashboard</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px' }}>
          先看今天的内容运营节奏，再决定是去生成新内容，还是处理待审核与待发布任务。
        </p>
      </header>

      <label style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
        <input
          value={activeProjectIdDraft}
          onChange={(event) => {
            if (projectIdDraft === undefined) {
              setLocalProjectIdDraft(event.target.value);
            }
            onProjectIdDraftChange?.(event.target.value);
          }}
          placeholder="例如 12"
          style={projectInputStyle}
        />
        {projectIdValidationError ? (
          <span style={{ color: '#b91c1c', fontWeight: 700 }}>{projectIdValidationError}</span>
        ) : null}
      </label>

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载仪表盘...</p> : null}
      {showLoadError ? <p style={{ color: '#b91c1c' }}>仪表盘加载失败：{displayState.error}</p> : null}
      {displayState.status === 'idle' ? (
        <p style={{ color: '#92400e', fontWeight: 700 }}>
          当前展示的是预览说明，真实仪表盘加载完成后会替换。
        </p>
      ) : null}

      {hasLiveDashboardData && viewData ? (
        <div style={{ display: 'grid', gap: '16px' }}>
          <section
            style={{
              borderRadius: '18px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ display: 'grid', gap: '4px' }}>
              <div style={{ fontWeight: 700, color: '#1d4ed8' }}>今日重点待办</div>
              <div style={{ color: '#1e3a8a' }}>按当前积压和最短处理路径整理，优先把会阻塞发布和回复的工单先清掉。</div>
            </div>

            {priorityItems.length === 0 ? (
              <div
                style={{
                  borderRadius: '16px',
                  background: '#ffffff',
                  border: '1px dashed #93c5fd',
                  padding: '16px',
                  display: 'grid',
                  gap: '6px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#166534' }}>当前没有高优先级待办</div>
                <div style={{ color: '#475569' }}>可以继续生成内容，或回看项目与监控配置</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {priorityItems.map((item) => {
                  const isNavigationAvailable = typeof onNavigateToRoute === 'function';

                  return (
                    <article
                      key={item.key}
                      style={{
                        borderRadius: '16px',
                        background: '#ffffff',
                        border: '1px solid #dbeafe',
                        padding: '16px',
                        display: 'grid',
                        gap: '14px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: '16px',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '6px', minWidth: '220px', flex: '1 1 320px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.title}</div>
                          <div style={{ color: '#475569' }}>{item.detail}</div>
                        </div>
                        <div
                          style={{
                            minWidth: '68px',
                            borderRadius: '999px',
                            padding: '8px 14px',
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            fontWeight: 700,
                            textAlign: 'center',
                          }}
                        >
                          {item.count}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <button
                          type="button"
                          data-dashboard-priority-key={item.key}
                          data-dashboard-priority-route={item.route}
                          disabled={!isNavigationAvailable}
                          aria-disabled={isNavigationAvailable ? undefined : 'true'}
                          onClick={() => {
                            if (!isNavigationAvailable) {
                              return;
                            }

                            onNavigateToRoute(item.route);
                          }}
                          style={{
                            borderRadius: '999px',
                            border: '1px solid #2563eb',
                            background: isNavigationAvailable ? '#2563eb' : '#bfdbfe',
                            color: '#ffffff',
                            padding: '10px 16px',
                            font: 'inherit',
                            fontWeight: 700,
                            cursor: isNavigationAvailable ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {item.actionLabel}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section
            style={{
              borderRadius: '18px',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              padding: '16px 18px',
              display: 'grid',
              gap: '6px',
            }}
          >
            <div style={{ fontWeight: 700, color: '#9a3412' }}>首发运营范围</div>
            <div style={{ color: '#7c2d12' }}>自动发布：X、Reddit</div>
            <div style={{ color: '#7c2d12' }}>人工接管：Facebook Group、Instagram、TikTok、小红书、微博</div>
            <div style={{ color: '#166534' }}>本地文件发布：Blog</div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="草稿总量" value={String(viewData.drafts.total)} detail="当前已入库的草稿总数" />
            <StatCard label="待审核" value={String(viewData.drafts.review)} detail="status=review 的草稿数量" />
            <StatCard label="Follow-up 草稿" value={String(viewData.monitor.followUpDrafts)} detail="标题命中 follow-up 的草稿数" />
            <StatCard label="新线索" value={String(viewData.monitor.new)} detail="当前 monitor 中 status=new 的条目数" />
            <StatCard label="监控总条目" value={String(viewData.monitor.total)} detail="monitor 表中当前累计的条目数" />
            <StatCard label="累计线索" value={String(viewData.totals.items)} detail="当前项目累计沉淀的线索总数" />
            <StatCard label="累计 Follow-up" value={String(viewData.totals.followUps)} detail="当前项目累计 follow-up 数量" />
            <StatCard
              label="监控直配源"
              value={formatOptionalMetricValue(monitorConfigMetrics?.directFeeds)}
              detail="Settings 中直接配置的 RSS feeds 数量"
            />
            <StatCard
              label="监控查询词"
              value={formatOptionalMetricValue(monitorConfigMetrics?.directQueries)}
              detail="Settings 中直接配置的 X / Reddit / V2EX 查询总数"
            />
            <StatCard
              label="项目源配置"
              value={formatOptionalMetricValue(monitorConfigMetrics?.enabledSourceConfigs)}
              detail="已启用 source configs 的数量"
            />
            <StatCard
              label="监控总输入"
              value={formatOptionalMetricValue(monitorConfigMetrics?.totalInputs)}
              detail="直配源、查询词和项目 source configs 合并后的总输入数"
            />
            <StatCard label="收件箱总会话" value={formatOptionalMetricValue(inboxMetrics?.total)} detail="当前 inbox 已收录的总会话数" />
            <StatCard label="未 handled 会话" value={formatOptionalMetricValue(inboxMetrics?.unread)} detail="收件箱中 status != handled 的会话数" />
            <StatCard
              label="账号总数"
              value={formatOptionalMetricValue(channelAccountMetrics?.total)}
              detail="当前已登记的 channel accounts 总数"
            />
            <StatCard
              label="status=healthy 账号"
              value={formatOptionalMetricValue(getHealthyChannelAccountCount(channelAccountMetrics))}
              detail="当前账号状态已经回到 healthy 的数量，仍建议结合平台 readiness 继续确认"
            />
            <StatCard
              label="待补 session 账号"
              value={formatOptionalMetricValue(channelAccountMetrics?.needsSession)}
              detail="status=needs_session 的账号数量，通常还没有可用浏览器会话"
            />
            <StatCard
              label="待重新登录账号"
              value={formatOptionalMetricValue(channelAccountMetrics?.needsRelogin)}
              detail="status=needs_relogin 的账号数量，现有浏览器会话已失效或过期"
            />
            <StatCard
              label="其他异常账号"
              value={formatOptionalMetricValue(channelAccountMetrics?.otherUnhealthy)}
              detail="除 healthy / needs_session / needs_relogin 外的异常账号数量"
            />
            <StatCard
              label="Browser Lane 总工单"
              value={formatOptionalMetricValue(browserLaneMetrics?.total)}
              detail="browser lane artifact 总数，包含待处理与已结单"
            />
            <StatCard
              label="Browser Lane 待处理"
              value={formatOptionalMetricValue(browserLaneMetrics?.pending)}
              detail="尚未结单的 browser lane request 工单数量"
            />
            <StatCard
              label="Browser Lane 已结单"
              value={formatOptionalMetricValue(browserLaneMetrics?.resolved)}
              detail="已经被 session 保存动作回写为 resolved 的工单数量"
            />
            <StatCard
              label="Browser Handoff 总工单"
              value={formatOptionalMetricValue(browserHandoffMetrics?.total)}
              detail="browser manual handoff artifact 总数"
            />
            <StatCard
              label="Browser Handoff 待处理"
              value={formatOptionalMetricValue(browserHandoffMetrics?.pending)}
              detail="仍在等待人工浏览器接管的 handoff 数量"
            />
            <StatCard
              label="Browser Handoff 已完成"
              value={formatOptionalMetricValue(browserHandoffMetrics?.resolved)}
              detail="后续 publish 已完成、artifact 已结单的 handoff 数量"
            />
            <StatCard
              label="Browser Handoff 已作废"
              value={formatOptionalMetricValue(browserHandoffMetrics?.obsolete)}
              detail="因 session 缺失或过期而作废的 handoff 数量"
            />
            <StatCard
              label="Browser Handoff 未归属"
              value={formatOptionalMetricValue(browserHandoffMetrics?.unmatched)}
              detail="缺少明确账号归属、仍依赖历史推断或未匹配的 handoff 数量"
            />
            <StatCard
              label="Inbox Reply Handoff 总工单"
              value={formatOptionalMetricValue(inboxReplyHandoffMetrics?.total)}
              detail="inbox reply browser/manual handoff artifact 总数"
            />
            <StatCard
              label="Inbox Reply Handoff 待处理"
              value={formatOptionalMetricValue(inboxReplyHandoffMetrics?.pending)}
              detail="仍在等待人工完成回复并回填结果的 handoff 数量"
            />
            <StatCard
              label="Inbox Reply Handoff 已完成"
              value={formatOptionalMetricValue(inboxReplyHandoffMetrics?.resolved)}
              detail="已导入 sent 或 failed 结果、artifact 已结单的 inbox reply handoff 数量"
            />
            <StatCard
              label="Inbox Reply Handoff 已作废"
              value={formatOptionalMetricValue(inboxReplyHandoffMetrics?.obsolete)}
              detail="因重新请求 session 或 relogin 而作废的 inbox reply handoff 数量"
            />
            <StatCard
              label="待发布"
              value={formatOptionalMetricValue(draftLifecycleMetrics.scheduled)}
              detail="已排期但尚未完成发布的草稿数量"
            />
            <StatCard
              label="已发布"
              value={formatOptionalMetricValue(draftLifecycleMetrics.published)}
              detail="已完成发布的草稿数量"
            />
            <StatCard
              label="失败发布日志"
              value={formatOptionalMetricValue(publishLogMetrics.failedCount)}
              detail="发布流水中 status=failed 的记录数"
            />
            <StatCard
              label="队列待执行"
              value={formatOptionalMetricValue(jobQueueMetrics?.pending)}
              detail="job_queue 中 pending 的任务数量"
            />
            <StatCard
              label="队列运行中"
              value={formatOptionalMetricValue(jobQueueMetrics?.running)}
              detail="当前被 scheduler 占用的任务数量"
            />
            <StatCard
              label="队列已完成"
              value={formatOptionalMetricValue(jobQueueMetrics?.done)}
              detail="job_queue 中 done 的任务数量"
            />
            <StatCard
              label="到期待执行（pending 子集）"
              value={formatOptionalMetricValue(jobQueueMetrics?.duePending)}
              detail="已经到执行时间、等待本轮 tick 处理的 pending 子集"
            />
            <StatCard
              label="队列失败"
              value={formatOptionalMetricValue(jobQueueMetrics?.failed)}
              detail="job_queue 中 failed 的任务数量"
            />
            <StatCard
              label="队列已取消"
              value={formatOptionalMetricValue(jobQueueMetrics?.canceled)}
              detail="job_queue 中 canceled 的任务数量"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatOptionalMetricValue(value: number | undefined) {
  return typeof value === 'number' ? String(value) : '未提供';
}

interface DashboardPriorityItem {
  key: string;
  title: string;
  detail: string;
  count: number;
  priority: number;
  route: AppRoute;
  actionLabel: string;
}

function buildPriorityItems(data: DashboardResponse) {
  const items: DashboardPriorityItem[] = [];

  pushPriorityItem(
    items,
    {
      key: 'browser-lane-requests',
      title: '待处理登录工单',
      detail: '还有待导入 session 的 request_session 或 relogin 工单，需要先恢复账号登录态。',
      priority: 1,
      route: 'queue',
      actionLabel: '前往 System Queue',
    },
    data.browserLaneRequests?.pending,
  );
  pushPriorityItem(
    items,
    {
      key: 'browser-handoffs',
      title: '待完成发布接管',
      detail: '还有 browser handoff 等待回填 published 或 failed，发布闭环还没走完。',
      priority: 2,
      route: 'queue',
      actionLabel: '前往 System Queue',
    },
    data.browserHandoffs?.pending,
  );
  pushPriorityItem(
    items,
    {
      key: 'inbox-reply-handoffs',
      title: '待完成回复接管',
      detail: '还有 inbox reply handoff 等待导入 sent 或 failed，回复结果还没结单。',
      priority: 3,
      route: 'inbox',
      actionLabel: '前往 Social Inbox',
    },
    data.inboxReplyHandoffs?.pending,
  );
  pushPriorityItem(
    items,
    {
      key: 'inbox-unread',
      title: '未处理会话积压',
      detail: '收件箱里还有未 handled 的会话，容易拖慢首响和跟进节奏。',
      priority: 4,
      route: 'inbox',
      actionLabel: '前往 Social Inbox',
    },
    data.inbox?.unread,
  );
  pushPriorityItem(
    items,
    {
      key: 'drafts-review',
      title: '待审核草稿积压',
      detail: '高风险或需人工确认的草稿还留在 review 队列，会阻塞后续排程。',
      priority: 5,
      route: 'review',
      actionLabel: '前往 Review Queue',
    },
    data.drafts.review,
  );
  pushPriorityItem(
    items,
    {
      key: 'publish-failures',
      title: '失败发布待复盘',
      detail: '失败发布日志需要尽快回看并决定重试、改稿，或转人工接管。',
      priority: 6,
      route: 'calendar',
      actionLabel: '前往 Publish Calendar',
    },
    data.publishLogs?.failedCount,
  );
  pushPriorityItem(
    items,
    {
      key: 'drafts-scheduled',
      title: '待发布排程',
      detail: '已经排程的草稿还没完成发布，需要确认是否按节奏出队。',
      priority: 7,
      route: 'calendar',
      actionLabel: '前往 Publish Calendar',
    },
    data.drafts.scheduled,
  );
  pushPriorityItem(
    items,
    {
      key: 'channel-accounts-unhealthy',
      title: '账号登录态待补齐',
      detail: buildChannelAccountPriorityDetail(data.channelAccounts),
      priority: 8,
      route: 'channels',
      actionLabel: '前往 Channel Accounts',
    },
    countUnhealthyChannelAccounts(data.channelAccounts),
  );
  pushPriorityItem(
    items,
    {
      key: 'monitor-new',
      title: '新线索待筛选',
      detail: '新抓到的监控线索还没转成选题、回复动作，容易错过时效。',
      priority: 9,
      route: 'monitor',
      actionLabel: '前往 Competitor Monitor',
    },
    data.monitor.new,
  );

  return items.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return right.count - left.count;
  });
}

function pushPriorityItem(
  items: DashboardPriorityItem[],
  item: Omit<DashboardPriorityItem, 'count'>,
  count: number | undefined,
) {
  if (!isPositiveMetric(count)) {
    return;
  }

  items.push({
    ...item,
    count,
  });
}

function countUnhealthyChannelAccounts(metrics: DashboardResponse['channelAccounts']) {
  if (!metrics || typeof metrics.total !== 'number') {
    return undefined;
  }

  if (
    typeof metrics.needsSession === 'number' &&
    typeof metrics.needsRelogin === 'number' &&
    typeof metrics.otherUnhealthy === 'number'
  ) {
    return Math.max(metrics.needsSession + metrics.needsRelogin + metrics.otherUnhealthy, 0);
  }

  const healthyCount = getHealthyChannelAccountCount(metrics);
  if (typeof healthyCount !== 'number') {
    return undefined;
  }

  return Math.max(metrics.total - healthyCount, 0);
}

function getHealthyChannelAccountCount(metrics: DashboardResponse['channelAccounts']) {
  if (!metrics) {
    return undefined;
  }

  if (typeof metrics.healthy === 'number') {
    return metrics.healthy;
  }

  return typeof metrics.connected === 'number' ? metrics.connected : undefined;
}

function buildChannelAccountPriorityDetail(metrics: DashboardResponse['channelAccounts']) {
  const defaultDetail = '部分 channel accounts 还不在 healthy 状态，后续发布和回复会受阻。';

  if (!metrics) {
    return defaultDetail;
  }

  const detailParts: string[] = [];

  if (isPositiveMetric(metrics.needsRelogin)) {
    detailParts.push(`${metrics.needsRelogin} 个需要重新登录`);
  }

  if (isPositiveMetric(metrics.needsSession)) {
    detailParts.push(`${metrics.needsSession} 个需要补导 session`);
  }

  if (isPositiveMetric(metrics.otherUnhealthy)) {
    detailParts.push(`${metrics.otherUnhealthy} 个处于其他异常状态`);
  }

  if (detailParts.length === 0) {
    return defaultDetail;
  }

  return `部分 channel accounts 还不在 healthy 状态，其中 ${detailParts.join('，')}，后续发布和回复会受阻。`;
}

function isPositiveMetric(value: number | undefined): value is number {
  return typeof value === 'number' && value > 0;
}
