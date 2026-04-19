import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { MonitorFeed } from '../components/MonitorFeed';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';

export interface MonitorItem {
  id: number;
  source: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
}

export interface MonitorFeedResponse {
  items: MonitorItem[];
  total: number;
}

export async function loadMonitorFeedRequest(): Promise<MonitorFeedResponse> {
  return apiRequest<MonitorFeedResponse>('/api/monitor/feed');
}

interface MonitorPageProps {
  loadMonitorAction?: () => Promise<MonitorFeedResponse>;
  stateOverride?: AsyncState<MonitorFeedResponse>;
}

const sourceFilters = ['全部来源', 'X / Twitter', 'RSS', 'Reddit', 'Product Hunt'];

export function MonitorPage({ loadMonitorAction = loadMonitorFeedRequest, stateOverride }: MonitorPageProps) {
  const { state, reload } = useAsyncQuery(loadMonitorAction, [loadMonitorAction]);
  const displayState = stateOverride ?? state;
  const fallbackData: MonitorFeedResponse = {
    items: [
      {
        id: 1,
        source: 'X / Twitter',
        title: 'Competitor added a cheaper tier',
        detail: 'Entry-tier pricing is now lower than our trial plan.',
        status: 'new',
        createdAt: 'preview',
      },
    ],
    total: 1,
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  return (
    <section>
      <PageHeader
        eyebrow="Tracking"
        title="Competitor Monitor"
        description="把竞品动态、关键词搜索结果和 RSS 更新放到一个时间线里，支持快速生成跟进草稿。"
        actions={
          <>
            <ActionButton label="刷新监控" onClick={reload} />
            <ActionButton label="生成跟进草稿" tone="primary" />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载监控动态...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>监控动态加载失败：{displayState.error}</p> : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="监控源" value={String(new Set(viewData.items.map((item) => item.source)).size)} detail="按当前返回数据聚合来源数" />
            <StatCard label="新动态" value={String(viewData.total)} detail={`已抓取 ${viewData.total} 条监控动态`} />
            <StatCard
              label="待跟进"
              value={String(viewData.items.filter((item) => item.status === 'new').length)}
              detail="适合进入 Generate Center 的竞品动态"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(260px, 0.7fr) minmax(340px, 1.3fr)' }}>
            <SectionCard title="来源筛选" description="先缩小到一个来源簇，再决定要不要把动态推到内容生成流程。">
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {sourceFilters.map((filter, index) => (
                  <button
                    key={filter}
                    type="button"
                    style={{
                      borderRadius: '999px',
                      border: '1px solid #cbd5e1',
                      background: index === 0 ? '#dbeafe' : '#ffffff',
                      color: index === 0 ? '#1d4ed8' : '#334155',
                      padding: '8px 12px',
                      fontWeight: 700,
                    }}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="最新动态" description={`已抓取 ${viewData.total} 条监控动态`}>
              <MonitorFeed items={viewData.items} />
            </SectionCard>
          </div>
        </>
      ) : null}
    </section>
  );
}
