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
  };
  totals: {
    items: number;
    followUps: number;
  };
}

export async function loadDashboardRequest(): Promise<DashboardResponse> {
  return apiRequest<DashboardResponse>('/api/monitor/dashboard');
}

interface DashboardPageProps {
  loadDashboardAction?: () => Promise<DashboardResponse>;
  stateOverride?: AsyncState<DashboardResponse>;
}

export function DashboardPage({
  loadDashboardAction = loadDashboardRequest,
  stateOverride,
}: DashboardPageProps) {
  const { state } = useAsyncQuery(loadDashboardAction, [loadDashboardAction]);
  const displayState = stateOverride ?? state;
  const fallbackData: DashboardResponse = {
    monitor: { total: 1, new: 1, followUpDrafts: 1 },
    drafts: { total: 1, review: 1 },
    totals: { items: 2, followUps: 1 },
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  return (
    <section>
      <header style={{ marginBottom: '24px' }}>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>Overview</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>Dashboard</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px' }}>
          先看今天的内容运营节奏，再决定是去生成新内容，还是处理待审核与待发布任务。
        </p>
      </header>

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载仪表盘...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>仪表盘加载失败：{displayState.error}</p> : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <StatCard label="今日生成" value={String(viewData.drafts.total)} detail="当前已入库的草稿总数" />
          <StatCard label="待审核" value={String(viewData.drafts.review)} detail="status=review 的草稿数量" />
          <StatCard label="已跟进" value={String(viewData.monitor.followUpDrafts)} detail="由监控项生成的 follow-up 草稿" />
          <StatCard label="新线索" value={String(viewData.monitor.new)} detail="当前 monitor 中 status=new 的条目数" />
        </div>
      ) : null}
    </section>
  );
}
