import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { SentimentChart } from '../components/SentimentChart';
import { StatCard } from '../components/StatCard';

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

export interface EnqueueReputationFetchJobResponse {
  job: {
    id: number;
    type: string;
    status: string;
    runAt: string;
    attempts?: number;
  };
  runtime: Record<string, unknown>;
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

function createProjectIdBody(projectId?: number) {
  return projectId === undefined ? undefined : JSON.stringify({ projectId });
}

function createProjectPayload(projectId?: number) {
  return projectId === undefined ? {} : { projectId };
}

function toSentimentPercentage(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

export async function loadReputationRequest(projectId?: number): Promise<ReputationStatsResponse> {
  return apiRequest<ReputationStatsResponse>(buildProjectScopedPath('/api/reputation/stats', projectId));
}

export async function fetchReputationRequest(projectId?: number): Promise<FetchReputationResponse> {
  return apiRequest<FetchReputationResponse>('/api/reputation/fetch', {
    method: 'POST',
    ...(projectId === undefined
      ? {}
      : {
          headers: {
            'Content-Type': 'application/json',
          },
          body: createProjectIdBody(projectId),
        }),
  });
}

export async function enqueueReputationFetchJobRequest(
  runAt?: string,
  projectId?: number,
): Promise<EnqueueReputationFetchJobResponse> {
  return apiRequest<EnqueueReputationFetchJobResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'reputation_fetch',
      payload: createProjectPayload(projectId),
      ...(runAt ? { runAt } : {}),
    }),
  });
}

export interface UpdateReputationItemResponse {
  item: ReputationItem;
  inboxItem?: {
    id: number;
    source: string;
    status: string;
    title: string;
    excerpt: string;
    createdAt: string;
  };
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
  loadReputationAction?: (projectId?: number) => Promise<ReputationStatsResponse>;
  fetchReputationAction?: (projectId?: number) => Promise<FetchReputationResponse>;
  enqueueFetchJobAction?: (runAt?: string, projectId?: number) => Promise<EnqueueReputationFetchJobResponse>;
  updateReputationAction?: (id: number, status: string) => Promise<UpdateReputationItemResponse>;
  stateOverride?: AsyncState<ReputationStatsResponse>;
  fetchStateOverride?: AsyncState<FetchReputationResponse>;
  enqueueStateOverride?: AsyncState<EnqueueReputationFetchJobResponse>;
  reputationUpdateStateOverride?: AsyncState<UpdateReputationItemResponse>;
}

type ReputationMutationStatus = 'handled' | 'escalate';

interface ReputationItemMutationState extends AsyncState<UpdateReputationItemResponse> {
  nextStatus: ReputationMutationStatus | null;
}

function createIdleReputationItemMutationState(): ReputationItemMutationState {
  return {
    status: 'idle',
    data: undefined,
    error: null,
    nextStatus: null,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

const feedbackStyle = {
  borderRadius: '16px',
  padding: '14px 16px',
  fontWeight: 600,
} as const;
const queueInputStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;
const negativeSentimentBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  padding: '4px 10px',
  fontSize: '12px',
  fontWeight: 700,
  background: '#fee2e2',
  color: '#991b1b',
} as const;

export function ReputationPage({
  loadReputationAction = loadReputationRequest,
  fetchReputationAction = fetchReputationRequest,
  enqueueFetchJobAction = enqueueReputationFetchJobRequest,
  updateReputationAction = updateReputationItemRequest,
  stateOverride,
  fetchStateOverride,
  enqueueStateOverride,
  reputationUpdateStateOverride,
}: ReputationPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadReputationAction() : loadReputationAction(projectId)),
    [loadReputationAction, projectId],
  );
  const { state: fetchState, run: runFetchReputation } = useAsyncAction((nextProjectId?: number) =>
    nextProjectId === undefined ? fetchReputationAction() : fetchReputationAction(nextProjectId),
  );
  const { state: enqueueState, run: runEnqueueFetchJob } = useAsyncAction(
    ({ runAt, projectId: nextProjectId }: { runAt?: string; projectId?: number }) =>
      nextProjectId === undefined ? enqueueFetchJobAction(runAt) : enqueueFetchJobAction(runAt, nextProjectId),
  );
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [reputationUpdateStateById, setReputationUpdateStateById] = useState<Record<number, ReputationItemMutationState>>(
    {},
  );
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState('');
  const reputationMutationScopeVersionRef = useRef(0);
  const pendingReputationMutationKeysRef = useRef<Set<string>>(new Set());
  const displayState = stateOverride ?? state;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayEnqueueState = enqueueStateOverride ?? enqueueState;
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
        source: 'x',
        sentiment: 'negative',
        status: 'escalate',
        title: 'Billing confusion mention',
        detail: 'Agency buyers asked whether billing and usage caps are transparent enough.',
        createdAt: 'preview',
      },
    ],
  };
  const hasLiveData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as ReputationStatsResponse).items);
  const isPreview = !hasLiveData;
  const viewData = hasLiveData ? (displayState.data as ReputationStatsResponse) : fallbackData;
  const displayItems = viewData.items.map((item) => {
    const localMutationState = reputationUpdateStateById[item.id];

    if (localMutationState?.status === 'success' && localMutationState.data) {
      return localMutationState.data.item;
    }

    if (
      reputationUpdateStateOverride?.status === 'success' &&
      reputationUpdateStateOverride.data &&
      reputationUpdateStateOverride.data.item.id === item.id
    ) {
      return reputationUpdateStateOverride.data.item;
    }

    return item;
  });
  const priorityItems = displayItems.filter((item) => item.sentiment === 'negative');
  const selectedItem = isPreview ? null : priorityItems.find((item) => item.id === selectedItemId) ?? priorityItems[0] ?? null;
  const selectedReputationMutationState = reputationUpdateStateOverride
    ? reputationUpdateStateOverride
    : selectedItem
      ? (reputationUpdateStateById[selectedItem.id] ?? createIdleReputationItemMutationState())
      : createIdleReputationItemMutationState();
  const sentimentBars = viewData.trend.map((bar) => ({
    label: bar.label,
    value: toSentimentPercentage(bar.value, viewData.total),
    color: bar.label === '正向' ? '#16a34a' : bar.label === '负向' ? '#dc2626' : '#64748b',
  }));
  const reputationFeedback =
    selectedItem !== null &&
    selectedReputationMutationState.status === 'success' &&
    selectedReputationMutationState.data
      ? selectedReputationMutationState.data.inboxItem
        ? `已将“${selectedReputationMutationState.data.item.title}”回写为 ${selectedReputationMutationState.data.item.status}，并已转入 Social Inbox（inbox #${selectedReputationMutationState.data.inboxItem.id}，状态 ${selectedReputationMutationState.data.inboxItem.status}）`
        : `已将“${selectedReputationMutationState.data.item.title}”回写为 ${selectedReputationMutationState.data.item.status}`
      : selectedItem !== null && selectedReputationMutationState.status === 'error'
        ? `口碑状态更新失败：${selectedReputationMutationState.error}`
        : null;

  useEffect(() => {
    reputationMutationScopeVersionRef.current += 1;
    pendingReputationMutationKeysRef.current.clear();
    setSelectedItemId(null);
    setReputationUpdateStateById({});
  }, [projectId]);

  async function handleReputationStatus(item: ReputationItem | null, status: ReputationMutationStatus) {
    if (!item) {
      return;
    }

    const scopeVersionAtStart = reputationMutationScopeVersionRef.current;
    const mutationKey = `${scopeVersionAtStart}:${item.id}`;

    if (pendingReputationMutationKeysRef.current.has(mutationKey)) {
      return;
    }

    pendingReputationMutationKeysRef.current.add(mutationKey);
    setSelectedItemId(item.id);
    setReputationUpdateStateById((currentState) => ({
      ...currentState,
      [item.id]: {
        status: 'loading',
        data: undefined,
        error: null,
        nextStatus: status,
      },
    }));

    try {
      const response = await updateReputationAction(item.id, status);

      if (scopeVersionAtStart !== reputationMutationScopeVersionRef.current) {
        return;
      }

      setReputationUpdateStateById((currentState) => ({
        ...currentState,
        [item.id]: {
          status: 'success',
          data: response,
          error: null,
          nextStatus: status,
        },
      }));
      reload();
    } catch (error) {
      if (scopeVersionAtStart !== reputationMutationScopeVersionRef.current) {
        return;
      }

      setReputationUpdateStateById((currentState) => ({
        ...currentState,
        [item.id]: {
          status: 'error',
          data: undefined,
          error: getErrorMessage(error),
          nextStatus: status,
        },
      }));
    } finally {
      pendingReputationMutationKeysRef.current.delete(mutationKey);
    }
  }

  function handleFetchReputation() {
    void runFetchReputation(projectId)
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleEnqueueReputationFetch() {
    const runAt = enqueueRunAtDraft.trim().length > 0 ? enqueueRunAtDraft.trim() : undefined;

    void runEnqueueFetchJob({ runAt, projectId })
      .then(() => {
        setEnqueueRunAtDraft('');
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
              label={displayEnqueueState.status === 'loading' ? '正在提交抓取队列...' : '加入队列 / 定时抓取'}
              onClick={handleEnqueueReputationFetch}
            />
            <ActionButton
              label={
                selectedReputationMutationState.status === 'loading'
                  ? '正在回写状态...'
                  : '标记已处理'
              }
              tone="primary"
              disabled={isPreview || selectedReputationMutationState.status === 'loading'}
              onClick={() => {
                void handleReputationStatus(selectedItem, 'handled');
              }}
            />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载口碑数据...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>口碑数据加载失败：{displayState.error}</p> : null}
      {displayState.status === 'idle' ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#fffbeb', color: '#92400e' }}>
          当前展示的是预览数据，真实口碑数据加载完成后会自动替换。
        </p>
      ) : null}
      {isPreview ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#fff7ed', color: '#9a3412' }}>
          预览数据不可回写口碑状态或转入 Social Inbox。
        </p>
      ) : null}
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
      {displayEnqueueState.status === 'success' && displayEnqueueState.data ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#eff6ff', color: '#1d4ed8' }}>
          已将口碑抓取加入队列，job #{displayEnqueueState.data.job.id}，执行时间 {displayEnqueueState.data.job.runAt}
        </p>
      ) : null}
      {displayEnqueueState.status === 'error' ? (
        <p
          style={{
            ...feedbackStyle,
            margin: '0 0 16px',
            background: '#fef2f2',
            color: '#b91c1c',
          }}
        >
          口碑排程失败：{displayEnqueueState.error}
        </p>
      ) : null}
          {reputationFeedback ? (
        <p
          style={{
            ...feedbackStyle,
            margin: '0 0 16px',
            background: selectedReputationMutationState.status === 'error' ? '#fef2f2' : '#ecfdf5',
            color: selectedReputationMutationState.status === 'error' ? '#b91c1c' : '#166534',
          }}
        >
          {reputationFeedback}
        </p>
      ) : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <SectionCard title="抓取排程" description="留空表示立即入队，也可以填写 ISO 时间，让口碑抓取按计划执行。">
            <div style={{ display: 'grid', gap: '16px' }}>
              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
                <input
                  value={projectIdDraft}
                  onChange={(event) => setProjectIdDraft(event.target.value)}
                  placeholder="例如 12"
                  style={queueInputStyle}
                />
              </label>

              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>计划抓取时间（可选）</span>
                <input
                  value={enqueueRunAtDraft}
                  onChange={(event) => setEnqueueRunAtDraft(event.target.value)}
                  placeholder="例如 2026-04-20T09:30:00.000Z"
                  style={queueInputStyle}
                />
              </label>
            </div>
          </SectionCard>

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
              <SentimentChart bars={sentimentBars} />
            </SectionCard>

            <SectionCard title="重点负面提及" description="高风险条目需要优先回应，避免在多个渠道重复扩散。">
              <div style={{ display: 'grid', gap: '12px' }}>
                {priorityItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>暂无重点负面提及</p>
                ) : (
                  priorityItems.map((item) => {
                    const itemMutationState = reputationUpdateStateOverride
                      ? selectedItem?.id === item.id
                        ? reputationUpdateStateOverride
                        : createIdleReputationItemMutationState()
                      : (reputationUpdateStateById[item.id] ?? createIdleReputationItemMutationState());

                    return (
                      <article
                        key={item.id}
                        onClick={() => {
                          if (!isPreview) {
                            setSelectedItemId(item.id);
                          }
                        }}
                        style={{
                          borderRadius: '16px',
                          border:
                            item.id === selectedItem?.id
                              ? '1px solid #fca5a5'
                              : item.sentiment === 'negative'
                                ? '1px solid #fecaca'
                                : '1px solid #dbe4f0',
                          background:
                            item.id === selectedItem?.id ? '#fff1f2' : item.sentiment === 'negative' ? '#fef2f2' : '#f8fafc',
                          padding: '18px',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <div style={{ fontWeight: 700 }}>{item.title}</div>
                          <span style={negativeSentimentBadgeStyle}>负面</span>
                        </div>
                        <p
                          style={{ margin: '12px 0 0', color: item.sentiment === 'negative' ? '#7f1d1d' : '#475569', lineHeight: 1.5 }}
                        >
                          {item.detail}
                        </p>
                        <div style={{ marginTop: '10px', color: '#64748b', fontSize: '13px' }}>
                          {item.source} · {item.status} · {item.createdAt}
                        </div>
                        <div style={{ marginTop: '10px', color: '#475569', lineHeight: 1.5 }}>
                          {isPreview
                            ? '预览数据不可设为重点项'
                            : item.id === selectedItem?.id
                              ? '当前重点跟进项'
                              : '点击卡片可将其设为当前重点项'}
                        </div>
                        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <ActionButton
                            label={itemMutationState.status === 'loading' ? '正在回写状态...' : '标记已处理'}
                            tone="primary"
                            disabled={isPreview || itemMutationState.status === 'loading'}
                            onClick={() => {
                              void handleReputationStatus(item, 'handled');
                            }}
                          />
                          <ActionButton
                            label={itemMutationState.status === 'loading' ? '正在回写状态...' : '转入 Social Inbox'}
                            disabled={isPreview || itemMutationState.status === 'loading'}
                            onClick={() => {
                              void handleReputationStatus(item, 'escalate');
                            }}
                          />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </SectionCard>
          </div>
        </>
      ) : null}
    </section>
  );
}
