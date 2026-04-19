import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
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

export interface FetchReputationResponse {
  items: ReputationItem[];
  inserted: number;
  total: number;
}

export async function loadReputationRequest(): Promise<ReputationStatsResponse> {
  return apiRequest<ReputationStatsResponse>('/api/reputation/stats');
}

export async function fetchReputationRequest(): Promise<FetchReputationResponse> {
  return apiRequest<FetchReputationResponse>('/api/reputation/fetch', {
    method: 'POST',
  });
}

export interface UpdateReputationItemResponse {
  item: ReputationItem;
}

export async function updateReputationItemRequest(id: number, status: string): Promise<UpdateReputationItemResponse> {
  return apiRequest<UpdateReputationItemResponse>(`/api/reputation/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
}

interface ReputationPageProps {
  loadReputationAction?: () => Promise<ReputationStatsResponse>;
  fetchReputationAction?: () => Promise<FetchReputationResponse>;
  updateReputationAction?: (id: number, status: string) => Promise<UpdateReputationItemResponse>;
  stateOverride?: AsyncState<ReputationStatsResponse>;
  fetchStateOverride?: AsyncState<FetchReputationResponse>;
  reputationUpdateStateOverride?: AsyncState<UpdateReputationItemResponse>;
}

const feedbackStyle = {
  borderRadius: '16px',
  padding: '14px 16px',
  fontWeight: 600,
} as const;

export function ReputationPage({
  loadReputationAction = loadReputationRequest,
  fetchReputationAction = fetchReputationRequest,
  updateReputationAction = updateReputationItemRequest,
  stateOverride,
  fetchStateOverride,
  reputationUpdateStateOverride,
}: ReputationPageProps) {
  const { state, reload } = useAsyncQuery(loadReputationAction, [loadReputationAction]);
  const { state: fetchState, run: runFetchReputation } = useAsyncAction(fetchReputationAction);
  const { state: reputationUpdateState, run: runReputationUpdate } = useAsyncAction(
    ({ id, status }: { id: number; status: string }) => updateReputationAction(id, status),
  );
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const displayState = stateOverride ?? state;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayReputationUpdateState = reputationUpdateStateOverride ?? reputationUpdateState;
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
  const updatedReputationItem =
    displayReputationUpdateState.status === 'success' && displayReputationUpdateState.data
      ? displayReputationUpdateState.data.item
      : null;
  const displayItems = updatedReputationItem
    ? viewData.items.map((item) => (item.id === updatedReputationItem.id ? updatedReputationItem : item))
    : viewData.items;
  const selectedItem = displayItems.find((item) => item.id === selectedItemId) ?? displayItems[0] ?? null;
  const reputationFeedback =
    displayReputationUpdateState.status === 'success' && displayReputationUpdateState.data
      ? `已将“${displayReputationUpdateState.data.item.title}”回写为 ${displayReputationUpdateState.data.item.status}`
      : displayReputationUpdateState.status === 'error'
        ? `口碑状态更新失败：${displayReputationUpdateState.error}`
        : null;

  async function handleReputationStatus(item: ReputationItem | null, status: 'handled' | 'escalate') {
    if (!item) {
      return;
    }

    setSelectedItemId(item.id);

    try {
      await runReputationUpdate({ id: item.id, status });
      reload();
    } catch {}
  }

  function handleFetchReputation() {
    void runFetchReputation()
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Brand Signals"
        title="Reputation"
        description="追踪品牌口碑与情绪变化，优先暴露负面提及，并把已处理状态回写到运营视图。"
        actions={
          <>
            <ActionButton label="刷新口碑数据" onClick={reload} />
            <ActionButton
              label={displayFetchState.status === 'loading' ? '正在抓取口碑...' : '抓取新口碑'}
              onClick={handleFetchReputation}
            />
            <ActionButton
              label={displayReputationUpdateState.status === 'loading' ? '正在回写状态...' : '标记已处理'}
              tone="primary"
              onClick={() => {
                void handleReputationStatus(selectedItem, 'handled');
              }}
            />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载口碑数据...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>口碑数据加载失败：{displayState.error}</p> : null}
      {displayFetchState.status === 'success' && displayFetchState.data ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#eff6ff', color: '#1d4ed8' }}>
          已抓取 {displayFetchState.data.inserted} 条口碑提及，当前总数 {displayFetchState.data.total}
        </p>
      ) : null}
      {displayFetchState.status === 'error' ? (
        <p
          style={{
            ...feedbackStyle,
            margin: '0 0 16px',
            background: '#fef2f2',
            color: '#b91c1c',
          }}
        >
          口碑抓取失败：{displayFetchState.error}
        </p>
      ) : null}
      {reputationFeedback ? (
        <p
          style={{
            ...feedbackStyle,
            margin: '0 0 16px',
            background: displayReputationUpdateState.status === 'error' ? '#fef2f2' : '#ecfdf5',
            color: displayReputationUpdateState.status === 'error' ? '#b91c1c' : '#166534',
          }}
        >
          {reputationFeedback}
        </p>
      ) : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="正向提及" value={String(viewData.positive)} detail={`已加载 ${viewData.total} 条口碑提及`} />
            <StatCard label="负面提及" value={String(viewData.negative)} detail="优先处理潜在风险项" />
            <StatCard
              label="已处理"
              value={String(displayItems.filter((item) => item.status === 'handled').length)}
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
                {displayItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>暂无口碑记录</p>
                ) : (
                  displayItems.map((item) => (
                    <article
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      style={{
                        borderRadius: '16px',
                        border:
                          item.id === selectedItem?.id
                            ? '1px solid #fca5a5'
                            : item.sentiment === 'negative'
                              ? '1px solid #fecaca'
                              : '1px solid #dbe4f0',
                        background: item.id === selectedItem?.id ? '#fff1f2' : item.sentiment === 'negative' ? '#fef2f2' : '#f8fafc',
                        padding: '18px',
                        cursor: 'pointer',
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
                      <div style={{ marginTop: '10px', color: '#475569', lineHeight: 1.5 }}>
                        {item.id === selectedItem?.id ? '当前重点跟进项' : '点击卡片可将其设为当前重点项'}
                      </div>
                      <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <ActionButton
                          label={
                            displayReputationUpdateState.status === 'loading' && item.id === selectedItemId
                              ? '正在回写状态...'
                              : '标记已处理'
                          }
                          tone="primary"
                          onClick={() => {
                            void handleReputationStatus(item, 'handled');
                          }}
                        />
                        <ActionButton
                          label={displayReputationUpdateState.status === 'loading' && item.id === selectedItemId ? '正在回写状态...' : '转入 Social Inbox'}
                          onClick={() => {
                            void handleReputationStatus(item, 'escalate');
                          }}
                        />
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
