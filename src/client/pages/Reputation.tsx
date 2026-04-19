import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { SentimentChart } from '../components/SentimentChart';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

export interface ReputationItem {
  id: number;
  source: string;
  sentiment: string;
  status: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface ReputationStatsResponse {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  trend: Array<{ label: string; value: number }>;
  items: ReputationItem[];
}

export async function loadReputationRequest(): Promise<ReputationStatsResponse> {
  return apiRequest<ReputationStatsResponse>('/api/reputation/stats');
}

interface ReputationPageProps {
  loadReputationAction?: () => Promise<ReputationStatsResponse>;
  stateOverride?: AsyncState<ReputationStatsResponse>;
}

export function ReputationPage({
  loadReputationAction = loadReputationRequest,
  stateOverride,
}: ReputationPageProps) {
  const { state, reload } = useAsyncQuery(loadReputationAction, [loadReputationAction]);
  const displayState = stateOverride ?? state;
  const fallbackData: ReputationStatsResponse = {
    total: 1,
    positive: 0,
    neutral: 0,
    negative: 1,
    trend: [
      { label: '正向', value: 0 },
      { label: '中性', value: 0 },
      { label: '负向', value: 1 },
    ],
    items: [
      {
        id: 1,
        source: 'facebook-group',
        sentiment: 'negative',
        status: 'escalate',
        title: 'Session expired complaint',
        detail: 'Users report being logged out unexpectedly.',
        createdAt: 'preview',
      },
    ],
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  return (
    <section>
      <PageHeader
        eyebrow="Brand Signals"
        title="Reputation"
        description="追踪品牌口碑与情绪变化，优先暴露负面提及，并把已处理状态回写到运营视图。"
        actions={
          <>
            <ActionButton label="刷新口碑数据" onClick={reload} />
            <ActionButton label="标记已处理" tone="primary" />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载口碑数据...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>口碑数据加载失败：{displayState.error}</p> : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="正向提及" value={String(viewData.positive)} detail={`已加载 ${viewData.total} 条口碑提及`} />
            <StatCard label="负面提及" value={String(viewData.negative)} detail="优先处理潜在风险项" />
            <StatCard
              label="已处理"
              value={String(viewData.items.filter((item) => item.status === 'handled').length)}
              detail="人工确认后已回写 handled 状态"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
            <SectionCard title="情绪分布" description={`已加载 ${viewData.total} 条口碑提及`}>
              <SentimentChart
                bars={viewData.trend.map((bar) => ({
                  ...bar,
                  color:
                    bar.label === '正向'
                      ? '#16a34a'
                      : bar.label === '负向'
                        ? '#dc2626'
                        : '#64748b',
                }))}
              />
            </SectionCard>

            <SectionCard title="重点负面提及" description="高风险条目需要优先回应，避免在多个渠道重复扩散。">
              <div style={{ display: 'grid', gap: '12px' }}>
                {viewData.items.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>暂无口碑记录</p>
                ) : (
                  viewData.items.map((item) => (
                    <article
                      key={item.id}
                      style={{
                        borderRadius: '16px',
                        border: item.sentiment === 'negative' ? '1px solid #fecaca' : '1px solid #dbe4f0',
                        background: item.sentiment === 'negative' ? '#fef2f2' : '#f8fafc',
                        padding: '18px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700 }}>{item.title}</div>
                        <StatusBadge tone="review" label={item.sentiment} />
                      </div>
                      <p style={{ margin: '12px 0 0', color: item.sentiment === 'negative' ? '#7f1d1d' : '#475569', lineHeight: 1.5 }}>
                        {item.detail}
                      </p>
                      <div style={{ marginTop: '10px', color: '#64748b', fontSize: '13px' }}>
                        {item.source} · {item.status} · {item.createdAt}
                      </div>
                      <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <ActionButton label="标记已处理" tone="primary" />
                        <ActionButton label="转入 Social Inbox" />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </>
      ) : null}
    </section>
  );
}
