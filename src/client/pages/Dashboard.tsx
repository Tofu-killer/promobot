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
  inbox?: {
    total: number;
    unread: number;
  };
  channelAccounts?: {
    total: number;
    connected: number;
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
}

export function DashboardPage({
  loadDashboardAction = loadDashboardRequest,
  stateOverride,
}: DashboardPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state } = useAsyncQuery(
    () => (projectId === undefined ? loadDashboardAction() : loadDashboardAction(projectId)),
    [loadDashboardAction, projectId],
  );
  const displayState = stateOverride ?? state;
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : null;
  const inboxMetrics = viewData?.inbox ?? null;
  const channelAccountMetrics = viewData?.channelAccounts ?? null;
  const draftLifecycleMetrics = {
    scheduled: viewData?.drafts.scheduled,
    published: viewData?.drafts.published,
  };
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
          value={projectIdDraft}
          onChange={(event) => setProjectIdDraft(event.target.value)}
          placeholder="例如 12"
          style={projectInputStyle}
        />
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
            <div style={{ color: '#7c2d12' }}>人工接管：Facebook Group（人工接管）</div>
            <div style={{ color: '#9a3412' }}>暂缓首发：小红书、微博、Blog</div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="草稿总量" value={String(viewData.drafts.total)} detail="当前已入库的草稿总数" />
            <StatCard label="待审核" value={String(viewData.drafts.review)} detail="status=review 的草稿数量" />
            <StatCard label="Follow-up 草稿" value={String(viewData.monitor.followUpDrafts)} detail="标题命中 follow-up 的草稿数" />
            <StatCard label="新线索" value={String(viewData.monitor.new)} detail="当前 monitor 中 status=new 的条目数" />
            <StatCard label="未 handled 会话" value={formatOptionalMetricValue(inboxMetrics?.unread)} detail="收件箱中 status != handled 的会话数" />
            <StatCard
              label="status=healthy 账号"
              value={formatOptionalMetricValue(channelAccountMetrics?.connected)}
              detail="仅统计账号状态为 healthy 的数量，不等于发布就绪"
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
              label="到期待执行（pending 子集）"
              value={formatOptionalMetricValue(jobQueueMetrics?.duePending)}
              detail="已经到执行时间、等待本轮 tick 处理的 pending 子集"
            />
            <StatCard
              label="队列失败"
              value={formatOptionalMetricValue(jobQueueMetrics?.failed)}
              detail="job_queue 中 failed 的任务数量"
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
