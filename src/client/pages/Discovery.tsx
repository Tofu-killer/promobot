import { loadDiscoveryRequest, type DiscoveryResponse } from '../lib/discovery';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';

interface DiscoveryPageProps {
  loadDiscoveryAction?: () => Promise<DiscoveryResponse>;
  stateOverride?: AsyncState<DiscoveryResponse>;
}

export function DiscoveryPage({ loadDiscoveryAction = loadDiscoveryRequest, stateOverride }: DiscoveryPageProps) {
  const { state, reload } = useAsyncQuery(loadDiscoveryAction, [loadDiscoveryAction]);
  const displayState = stateOverride ?? state;
  const fallbackData: DiscoveryResponse = {
    items: [
      {
        id: 'preview-1',
        source: 'Reddit',
        title: 'AI 短视频脚本切题',
        summary: '近 24 小时讨论增长明显，适合做教程向内容。',
        status: 'new',
        score: 92,
        createdAt: 'preview',
      },
    ],
    total: 1,
    stats: {
      sources: 1,
      averageScore: 92,
    },
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  return (
    <section>
      <PageHeader
        eyebrow="Signals"
        title="Discovery Pool"
        description="发现池会汇总趋势、竞品动态和候选选题，并把不同来源统一成一套可操作条目。"
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载发现池...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>发现池加载失败：{displayState.error}</p> : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="候选条目" value={String(viewData.total)} detail="当前统一发现池中的条目数" />
            <StatCard
              label="数据源"
              value={String(viewData.stats.sources)}
              detail="聚合后的来源渠道数"
            />
            <StatCard
              label="平均评分"
              value={viewData.stats.averageScore === null ? 'N/A' : String(viewData.stats.averageScore)}
              detail="基于发现池数据估算的平均优先级"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '16px' }}>
            {viewData.items.map((item) => (
              <SectionCard
                key={item.id}
                title={item.title}
                description={`${item.source} · ${item.status} · ${item.createdAt ?? 'unknown'}`}
              >
                <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{item.summary}</p>
              </SectionCard>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
