import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { StatCard } from '../components/StatCard';

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
}

export function DashboardPage({
  loadDashboardAction = loadDashboardRequest,
  stateOverride,
  projectIdDraft,
  onProjectIdDraftChange,
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
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : null;
  const inboxMetrics = viewData?.inbox ?? null;
  const channelAccountMetrics = viewData?.channelAccounts ?? null;
  const browserLaneMetrics = viewData?.browserLaneRequests ?? null;
  const browserHandoffMetrics = viewData?.browserHandoffs ?? null;
  const draftLifecycleMetrics = {
    scheduled: viewData?.drafts.scheduled,
    published: viewData?.drafts.published,
  };
  const monitorConfigMetrics = viewData?.monitorConfig ?? null;
  const publishLogMetrics = {
    failedCount: viewData?.publishLogs?.failedCount,
  };
  const jobQueueMetrics = viewData?.jobQueue ?? null;

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
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>仪表盘加载失败：{displayState.error}</p> : null}
      {displayState.status === 'idle' ? (
        <p style={{ color: '#92400e', fontWeight: 700 }}>
          当前展示的是预览说明，真实仪表盘加载完成后会替换。
        </p>
      ) : null}

      {displayState.status === 'success' && viewData ? (
        <div style={{ display: 'grid', gap: '16px' }}>
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
            <div style={{ color: '#7c2d12' }}>人工接管：Facebook Group、小红书、微博</div>
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
              value={formatOptionalMetricValue(channelAccountMetrics?.connected)}
              detail="仅统计账号状态为 healthy 的数量，不等于发布就绪"
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
