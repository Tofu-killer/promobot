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
  const fallbackData: DashboardResponse = {
    monitor: { total: 1, new: 1, followUpDrafts: 1 },
    drafts: { total: 1, review: 1, scheduled: 0, published: 0 },
    totals: { items: 2, followUps: 1 },
    publishLogs: { failedCount: 0 },
    inbox: { total: 1, unread: 1 },
    channelAccounts: { total: 1, connected: 1 },
    jobQueue: { pending: 0, running: 0, done: 0, failed: 0, canceled: 0, duePending: 0 },
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;
  const inboxMetrics = viewData.inbox ?? { total: 0, unread: 0 };
  const channelAccountMetrics = viewData.channelAccounts ?? { total: 0, connected: 0 };
  const draftLifecycleMetrics = {
    scheduled: viewData.drafts.scheduled ?? 0,
    published: viewData.drafts.published ?? 0,
  };
  const publishLogMetrics = {
    failedCount: viewData.publishLogs?.failedCount ?? 0,
  };
  const jobQueueMetrics = viewData.jobQueue ?? {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    canceled: 0,
    duePending: 0,
  };

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

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <StatCard label="今日生成" value={String(viewData.drafts.total)} detail="当前已入库的草稿总数" />
          <StatCard label="待审核" value={String(viewData.drafts.review)} detail="status=review 的草稿数量" />
          <StatCard label="已跟进" value={String(viewData.monitor.followUpDrafts)} detail="由监控项生成的 follow-up 草稿" />
          <StatCard label="新线索" value={String(viewData.monitor.new)} detail="当前 monitor 中 status=new 的条目数" />
          <StatCard label="待处理私信" value={String(inboxMetrics.unread)} detail="收件箱中尚未标记为 handled 的会话数" />
          <StatCard
            label="健康账号"
            value={String(channelAccountMetrics.connected)}
            detail="status=healthy 的渠道账号数量"
          />
          <StatCard
            label="待发布"
            value={String(draftLifecycleMetrics.scheduled)}
            detail="已排期但尚未完成发布的草稿数量"
          />
          <StatCard
            label="已发布"
            value={String(draftLifecycleMetrics.published)}
            detail="已完成发布的草稿数量"
          />
          <StatCard
            label="发布失败"
            value={String(publishLogMetrics.failedCount)}
            detail="最近发布流水中记录的失败次数"
          />
          <StatCard
            label="队列待执行"
            value={String(jobQueueMetrics.pending)}
            detail="job_queue 中 pending 的任务数量"
          />
          <StatCard
            label="队列运行中"
            value={String(jobQueueMetrics.running)}
            detail="当前被 scheduler 占用的任务数量"
          />
          <StatCard
            label="到期待执行"
            value={String(jobQueueMetrics.duePending)}
            detail="已经到执行时间、等待本轮 tick 处理的任务数量"
          />
          <StatCard
            label="队列失败"
            value={String(jobQueueMetrics.failed)}
            detail="job_queue 中 failed 的任务数量"
          />
        </div>
      ) : null}
    </section>
  );
}
