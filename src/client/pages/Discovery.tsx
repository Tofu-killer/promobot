import { useEffect, useRef, useState } from 'react';
import { loadDiscoveryRequest, type DiscoveryItem, type DiscoveryResponse } from '../lib/discovery';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';
import {
  generateDraftsRequest,
  type GenerateDraftsPayload,
  type GenerateDraftsResponse,
} from './Generate';

interface DiscoveryPageProps {
  loadDiscoveryAction?: (projectId?: number) => Promise<DiscoveryResponse>;
  generateAction?: (input: GenerateDraftsPayload) => Promise<GenerateDraftsResponse>;
  fetchDiscoveryAction?: (projectId?: number) => Promise<FetchDiscoverySignalsResponse>;
  updateDiscoveryAction?: (
    id: string,
    action: 'save' | 'ignore',
    projectId?: number,
  ) => Promise<UpdateDiscoveryItemActionResponse>;
  updateDiscoveryItemAction?: (
    id: string,
    action: 'save' | 'ignore',
    projectId?: number,
  ) => Promise<UpdateDiscoveryItemActionResponse>;
  stateOverride?: AsyncState<DiscoveryResponse>;
}

interface DiscoveryDraftState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: GenerateDraftsResponse;
  error?: string | null;
}

interface DiscoveryBatchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: Array<{
    itemId: string;
    response: GenerateDraftsResponse;
  }>;
  error?: string | null;
}

interface DiscoveryItemActionState {
  status: 'idle' | 'loading' | 'success' | 'error';
  action?: 'save' | 'ignore';
  data?: UpdateDiscoveryItemActionResponse;
  error?: string | null;
}

function createIdleDraftState(): DiscoveryDraftState {
  return {
    status: 'idle',
    error: null,
  };
}

export interface FetchDiscoverySignalsResponse {
  monitorInserted: number;
  inboxInserted: number;
  totalInserted: number;
}

export interface UpdateDiscoveryItemActionResponse {
  item: {
    id: string;
    source: string;
    type: 'monitor' | 'inbox';
    title: string;
    detail: string;
    status: string;
    createdAt: string;
  };
}

function createIdleBatchState(): DiscoveryBatchState {
  return {
    status: 'idle',
    error: null,
  };
}

function createIdleDiscoveryItemActionState(): DiscoveryItemActionState {
  return {
    status: 'idle',
    error: null,
  };
}

function buildDraftTopic(item: DiscoveryItem) {
  return [item.title, item.summary].filter((value) => value.trim().length > 0).join('\n\n');
}

function resolveDraftPlatform(source: string) {
  const normalizedSource = source.trim().toLowerCase();

  if (normalizedSource.includes('reddit')) {
    return 'reddit';
  }

  if (normalizedSource === 'x' || normalizedSource.includes('twitter')) {
    return 'x';
  }

  return null;
}

function normalizeDiscoverySourceFilter(source: string) {
  const normalizedSource = source.trim().toLowerCase();

  if (normalizedSource === 'x / twitter' || normalizedSource === 'twitter') {
    return 'x';
  }

  if (normalizedSource === 'product hunt') {
    return 'product-hunt';
  }

  return normalizedSource;
}

function formatDiscoverySourceFilterLabel(filter: string) {
  if (filter === 'all') {
    return '全部来源';
  }

  if (filter === 'x') {
    return 'X';
  }

  if (filter === 'reddit') {
    return 'Reddit';
  }

  if (filter === 'product-hunt') {
    return 'Product Hunt';
  }

  return filter;
}

function formatDiscoveryPlatformFilterLabel(filter: string) {
  if (filter === 'all') {
    return '全部平台';
  }

  if (filter === 'x') {
    return 'X';
  }

  if (filter === 'reddit') {
    return 'Reddit';
  }

  if (filter === 'manual') {
    return '人工流程';
  }

  return filter;
}

function resolveDiscoveryPlatformFilter(source: string) {
  const platform = resolveDraftPlatform(source);
  return platform ?? 'manual';
}

function filterDiscoveryItems(items: DiscoveryItem[], activeSourceFilter: string, activePlatformFilter: string) {
  return items.filter((item) => {
    const matchesSource =
      activeSourceFilter === 'all' || normalizeDiscoverySourceFilter(item.source) === activeSourceFilter;
    const matchesPlatform =
      activePlatformFilter === 'all' || resolveDiscoveryPlatformFilter(item.source) === activePlatformFilter;

    return matchesSource && matchesPlatform;
  });
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

const projectInputStyle = {
  width: '100%',
  maxWidth: '240px',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export async function loadDiscoveryPageRequest(projectId?: number): Promise<DiscoveryResponse> {
  if (projectId === undefined) {
    return loadDiscoveryRequest();
  }

  return apiRequest<DiscoveryResponse>(buildProjectScopedPath('/api/discovery', projectId));
}

export async function fetchDiscoverySignalsRequest(projectId?: number): Promise<FetchDiscoverySignalsResponse> {
  const requestOptions =
    projectId === undefined
      ? { method: 'POST' as const }
      : {
          method: 'POST' as const,
          headers: {
            'Content-Type': 'application/json',
          },
          body: createProjectIdBody(projectId),
        };

  const [monitorResponse, inboxResponse] = await Promise.all([
    apiRequest<{ inserted?: number }>('/api/monitor/fetch', requestOptions),
    apiRequest<{ inserted?: number }>('/api/inbox/fetch', requestOptions),
  ]);

  const monitorInserted = typeof monitorResponse.inserted === 'number' ? monitorResponse.inserted : 0;
  const inboxInserted = typeof inboxResponse.inserted === 'number' ? inboxResponse.inserted : 0;

  return {
    monitorInserted,
    inboxInserted,
    totalInserted: monitorInserted + inboxInserted,
  };
}

export async function updateDiscoveryItemActionRequest(
  id: string,
  action: 'save' | 'ignore',
  projectId?: number,
): Promise<UpdateDiscoveryItemActionResponse> {
  return apiRequest<UpdateDiscoveryItemActionResponse>(`/api/discovery/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(projectId === undefined ? { action } : { action, projectId }),
  });
}

export function DiscoveryPage({
  loadDiscoveryAction = loadDiscoveryPageRequest,
  generateAction = generateDraftsRequest,
  fetchDiscoveryAction = fetchDiscoverySignalsRequest,
  updateDiscoveryAction,
  updateDiscoveryItemAction,
  stateOverride,
}: DiscoveryPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const [activeSourceFilter, setActiveSourceFilter] = useState('all');
  const [activePlatformFilter, setActivePlatformFilter] = useState('all');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const resolvedUpdateDiscoveryAction =
    updateDiscoveryItemAction ?? updateDiscoveryAction ?? updateDiscoveryItemActionRequest;
  const projectId = parseProjectId(projectIdDraft);
  const currentProjectIdRef = useRef<number | undefined>(projectId);
  currentProjectIdRef.current = projectId;
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadDiscoveryAction() : loadDiscoveryAction(projectId)),
    [loadDiscoveryAction, projectId],
  );
  const { state: fetchState, run: runFetchDiscovery } = useAsyncAction((nextProjectId?: number) =>
    nextProjectId === undefined ? fetchDiscoveryAction() : fetchDiscoveryAction(nextProjectId),
  );
  const [draftStateByItemId, setDraftStateByItemId] = useState<Record<string, DiscoveryDraftState>>({});
  const [batchState, setBatchState] = useState<DiscoveryBatchState>(createIdleBatchState());
  const [discoveryItemActionStateById, setDiscoveryItemActionStateById] = useState<
    Record<string, DiscoveryItemActionState>
  >({});
  const [discoveryItemOverrideById, setDiscoveryItemOverrideById] = useState<
    Record<string, UpdateDiscoveryItemActionResponse['item']>
  >({});
  const [latestDiscoveryActionFeedback, setLatestDiscoveryActionFeedback] = useState<{
    status: 'success' | 'error';
    action: 'save' | 'ignore';
    error?: string | null;
  } | null>(null);
  const displayState = stateOverride ?? state;
  const displayFetchState = fetchState;
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
  const hasLiveData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as DiscoveryResponse).items);
  const isPreview = !hasLiveData;
  const viewData = hasLiveData ? (displayState.data as DiscoveryResponse) : fallbackData;
  const mergedItems = viewData.items.map((item) => {
    const updatedDiscoveryItem = discoveryItemOverrideById[String(item.id)];

    return updatedDiscoveryItem
      ? {
          ...item,
          source: updatedDiscoveryItem.source,
          title: updatedDiscoveryItem.title,
          summary: updatedDiscoveryItem.detail,
          status: updatedDiscoveryItem.status,
          createdAt: updatedDiscoveryItem.createdAt,
        }
      : item;
  });
  const filteredItems = filterDiscoveryItems(mergedItems, activeSourceFilter, activePlatformFilter);
  const filteredAverageScore =
    filteredItems.filter((item) => item.score !== null).length > 0
      ? Math.round(
          filteredItems
            .filter((item): item is DiscoveryItem & { score: number } => item.score !== null)
            .reduce((sum, item) => sum + item.score, 0) /
            filteredItems.filter((item) => item.score !== null).length,
        )
      : null;
  const sourceFilters = [
    { id: 'all', label: formatDiscoverySourceFilterLabel('all') },
    ...Array.from(new Set(mergedItems.map((item) => normalizeDiscoverySourceFilter(item.source)))).map((filter) => ({
      id: filter,
      label: formatDiscoverySourceFilterLabel(filter),
    })),
  ];
  const platformFilters = [
    { id: 'all', label: formatDiscoveryPlatformFilterLabel('all') },
    ...Array.from(new Set(mergedItems.map((item) => resolveDiscoveryPlatformFilter(item.source)))).map((filter) => ({
      id: filter,
      label: formatDiscoveryPlatformFilterLabel(filter),
    })),
  ];
  const selectedBatchItems = mergedItems.filter(
    (item) => selectedItemIds.includes(String(item.id)) && resolveDraftPlatform(item.source) !== null,
  );

  useEffect(() => {
    setActiveSourceFilter('all');
    setActivePlatformFilter('all');
    setSelectedItemIds([]);
    setDraftStateByItemId({});
    setBatchState(createIdleBatchState());
    setDiscoveryItemActionStateById({});
    setDiscoveryItemOverrideById({});
    setLatestDiscoveryActionFeedback(null);
  }, [projectId]);

  function getDraftState(itemId: string | number) {
    return draftStateByItemId[String(itemId)] ?? createIdleDraftState();
  }

  function getDiscoveryItemActionState(itemId: string | number) {
    return discoveryItemActionStateById[String(itemId)] ?? createIdleDiscoveryItemActionState();
  }

  async function handleGenerateDraft(item: DiscoveryItem) {
    const itemKey = String(item.id);

    if (isPreview) {
      setDraftStateByItemId((currentState) => ({
        ...currentState,
        [itemKey]: {
          status: 'error',
          error: '预览数据不可直接生成草稿，请先加载真实发现池。',
        },
      }));
      return;
    }

    const platform = resolveDraftPlatform(item.source);

    if (!platform) {
      setDraftStateByItemId((currentState) => ({
        ...currentState,
        [itemKey]: {
          status: 'error',
          error: '当前来源不在首发平台范围内，请改走人工内容流程',
        },
      }));
      return;
    }

    setDraftStateByItemId((currentState) => ({
      ...currentState,
      [itemKey]: {
        status: 'loading',
        error: null,
      },
    }));

    try {
      const result = await generateAction({
        topic: buildDraftTopic(item),
        tone: 'professional',
        platforms: [platform],
        saveAsDraft: true,
        ...(projectId === undefined ? {} : { projectId }),
      });

      setDraftStateByItemId((currentState) => ({
        ...currentState,
        [itemKey]: {
          status: 'success',
          data: result,
          error: null,
        },
      }));
    } catch (error) {
      setDraftStateByItemId((currentState) => ({
        ...currentState,
        [itemKey]: {
          status: 'error',
          error: getErrorMessage(error),
        },
      }));
    }
  }

  function handleSelectSourceFilter(filter: string) {
    setActiveSourceFilter(filter);
  }

  function handleSelectPlatformFilter(filter: string) {
    setActivePlatformFilter(filter);
  }

  function handleProjectIdDraftChange(value: string) {
    setProjectIdDraft(value);
    currentProjectIdRef.current = parseProjectId(value);
  }

  function handleFetchDiscovery() {
    void runFetchDiscovery(projectId)
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleToggleBatchSelection(item: DiscoveryItem) {
    const itemKey = String(item.id);
    setSelectedItemIds((currentItems) =>
      currentItems.includes(itemKey)
        ? currentItems.filter((entry) => entry !== itemKey)
        : [...currentItems, itemKey],
    );
    setBatchState((currentState) => (currentState.status === 'idle' ? currentState : createIdleBatchState()));
  }

  async function handleBatchGenerate() {
    if (isPreview || selectedBatchItems.length === 0) {
      return;
    }

    setBatchState({
      status: 'loading',
      error: null,
    });

    try {
      const results: Array<{ itemId: string; response: GenerateDraftsResponse }> = [];

      for (const item of selectedBatchItems) {
        const platform = resolveDraftPlatform(item.source);
        if (!platform) {
          continue;
        }

        const response = await generateAction({
          topic: buildDraftTopic(item),
          tone: 'professional',
          platforms: [platform],
          saveAsDraft: true,
          ...(projectId === undefined ? {} : { projectId }),
        });

        results.push({
          itemId: String(item.id),
          response,
        });

        setDraftStateByItemId((currentState) => ({
          ...currentState,
          [String(item.id)]: {
            status: 'success',
            data: response,
            error: null,
          },
        }));
      }

      setBatchState({
        status: 'success',
        data: results,
        error: null,
      });
    } catch (error) {
      setBatchState({
        status: 'error',
        error: getErrorMessage(error),
      });
    }
  }

  function canMutateDiscoveryItem(item: DiscoveryItem) {
    return String(item.id).startsWith('monitor-');
  }

  async function handleDiscoveryItemAction(item: DiscoveryItem, action: 'save' | 'ignore') {
    if (!canMutateDiscoveryItem(item)) {
      return;
    }

    const itemId = String(item.id);
    setDiscoveryItemActionStateById((currentState) => ({
      ...currentState,
      [itemId]: {
        status: 'loading',
        action,
        error: null,
      },
    }));

    try {
      const currentProjectId = currentProjectIdRef.current;
      const result =
        currentProjectId === undefined
          ? await resolvedUpdateDiscoveryAction(itemId, action)
          : await resolvedUpdateDiscoveryAction(itemId, action, currentProjectId);

      setDiscoveryItemOverrideById((currentState) => ({
        ...currentState,
        [itemId]: result.item,
      }));
      setDiscoveryItemActionStateById((currentState) => ({
        ...currentState,
        [itemId]: {
          status: 'success',
          action,
          data: result,
          error: null,
        },
      }));
      setLatestDiscoveryActionFeedback({
        status: 'success',
        action,
      });
    } catch (error) {
      const message = getErrorMessage(error);

      setDiscoveryItemActionStateById((currentState) => ({
        ...currentState,
        [itemId]: {
          status: 'error',
          action,
          error: message,
        },
      }));
      setLatestDiscoveryActionFeedback({
        status: 'error',
        action,
        error: message,
      });
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Signals"
        title="Discovery Pool"
        description="发现池会汇总趋势、竞品动态和候选选题，并把不同来源统一成一套可操作条目。"
        actions={
          <button
            type="button"
            data-discovery-fetch-action="true"
            onClick={handleFetchDiscovery}
            style={{
              borderRadius: '12px',
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              padding: '12px 16px',
              fontWeight: 700,
              boxShadow: '0 12px 24px rgba(37, 99, 235, 0.18)',
              cursor: 'pointer',
            }}
          >
            {displayFetchState.status === 'loading' ? '正在同步发现信号...' : '立即抓取'}
          </button>
        }
      />

      <label style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
        <input
          value={projectIdDraft}
          onChange={(event) => handleProjectIdDraftChange(event.target.value)}
          placeholder="例如 12"
          style={projectInputStyle}
        />
      </label>

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载发现池...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>发现池加载失败：{displayState.error}</p> : null}
      {displayFetchState.status === 'success' && displayFetchState.data ? (
        <p style={{ color: '#1d4ed8', fontWeight: 700 }}>
          已同步发现信号：monitor {displayFetchState.data.monitorInserted} 条，inbox {displayFetchState.data.inboxInserted} 条
        </p>
      ) : null}
      {displayFetchState.status === 'error' ? (
        <p style={{ color: '#b91c1c', fontWeight: 700 }}>发现信号同步失败：{displayFetchState.error}</p>
      ) : null}
      {latestDiscoveryActionFeedback?.status === 'success' ? (
        <p style={{ color: '#166534', fontWeight: 700 }}>
          条目已{latestDiscoveryActionFeedback.action === 'save' ? '保存' : '忽略'}
        </p>
      ) : null}
      {latestDiscoveryActionFeedback?.status === 'error' ? (
        <p style={{ color: '#b91c1c', fontWeight: 700 }}>
          发现条目动作失败：{latestDiscoveryActionFeedback.error}
        </p>
      ) : null}
      {displayState.status === 'idle' ? (
        <p style={{ color: '#92400e', fontWeight: 700 }}>
          当前展示的是预览数据，真实发现池加载完成后会自动替换。
        </p>
      ) : null}

      {hasLiveData || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="候选条目" value={String(filteredItems.length)} detail="当前统一发现池中的条目数" />
            <StatCard
              label="数据源"
              value={String(new Set(filteredItems.map((item) => normalizeDiscoverySourceFilter(item.source))).size)}
              detail="聚合后的来源渠道数"
            />
            <StatCard
              label="平均评分"
              value={filteredAverageScore === null ? 'N/A' : String(filteredAverageScore)}
              detail="基于发现池数据估算的平均优先级"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(260px, 0.7fr) minmax(340px, 1.3fr)' }}>
            <SectionCard title="筛选" description="先缩小到一个来源或目标平台，再决定要不要生成首发草稿。">
              <div style={{ display: 'grid', gap: '14px' }}>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>来源筛选</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {sourceFilters.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        data-discovery-filter-source={filter.id}
                        aria-pressed={activeSourceFilter === filter.id ? 'true' : 'false'}
                        onClick={() => handleSelectSourceFilter(filter.id)}
                        style={{
                          borderRadius: '999px',
                          border: '1px solid #cbd5e1',
                          background: activeSourceFilter === filter.id ? '#dbeafe' : '#ffffff',
                          color: activeSourceFilter === filter.id ? '#1d4ed8' : '#334155',
                          padding: '8px 12px',
                          fontWeight: 700,
                        }}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>平台筛选</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {platformFilters.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        data-discovery-filter-platform={filter.id}
                        aria-pressed={activePlatformFilter === filter.id ? 'true' : 'false'}
                        onClick={() => handleSelectPlatformFilter(filter.id)}
                        style={{
                          borderRadius: '999px',
                          border: '1px solid #cbd5e1',
                          background: activePlatformFilter === filter.id ? '#dbeafe' : '#ffffff',
                          color: activePlatformFilter === filter.id ? '#1d4ed8' : '#334155',
                          padding: '8px 12px',
                          fontWeight: 700,
                        }}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    borderRadius: '14px',
                    border: '1px solid #dbe4f0',
                    background: '#f8fafc',
                    padding: '14px',
                    display: 'grid',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>
                    已选 {selectedBatchItems.length} 条可批量生成的发现条目
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <button
                      type="button"
                      data-discovery-batch-generate="true"
                      disabled={isPreview || selectedBatchItems.length === 0}
                      onClick={() => {
                        void handleBatchGenerate();
                      }}
                      style={{
                        borderRadius: '12px',
                        border: 'none',
                        background:
                          isPreview || selectedBatchItems.length === 0
                            ? '#bfdbfe'
                            : '#2563eb',
                        color:
                          isPreview || selectedBatchItems.length === 0
                            ? '#475569'
                            : '#ffffff',
                        padding: '12px 16px',
                        fontWeight: 700,
                        boxShadow:
                          isPreview || selectedBatchItems.length === 0
                            ? 'none'
                            : '0 12px 24px rgba(37, 99, 235, 0.18)',
                        cursor:
                          isPreview || selectedBatchItems.length === 0
                            ? 'not-allowed'
                            : 'pointer',
                        opacity: isPreview || selectedBatchItems.length === 0 ? 0.8 : 1,
                      }}
                    >
                      {batchState.status === 'loading' ? '正在批量生成...' : '开始批量生成'}
                    </button>
                  </div>
                  {batchState.status === 'success' && batchState.data ? (
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div style={{ color: '#1d4ed8', fontWeight: 700 }}>
                        已批量生成 {batchState.data.length} 条发现草稿
                      </div>
                      {batchState.data.flatMap((entry) => entry.response.results).map((result, index) => (
                        <div key={`${result.platform}-${result.draftId ?? index}`} style={{ color: '#1e3a8a' }}>
                          draftId: {result.draftId ?? '未保存'} · platform: {result.platform}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {batchState.status === 'error' ? (
                    <p style={{ margin: 0, color: '#b91c1c' }}>批量生成失败：{batchState.error}</p>
                  ) : null}
                </div>
              </div>
            </SectionCard>

            <div style={{ display: 'grid', gap: '16px' }}>
              <SectionCard title="发现条目" description={`当前筛选下 ${filteredItems.length} 条 / 总计 ${viewData.total} 条发现条目`}>
                {filteredItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>
                    {viewData.items.length === 0 ? '暂无发现条目' : '当前筛选下暂无发现条目'}
                  </p>
                ) : null}
              </SectionCard>

              {filteredItems.map((item) => {
              const draftState = getDraftState(item.id);
              const discoveryItemActionState = getDiscoveryItemActionState(item.id);
              const draftPlatform = resolveDraftPlatform(item.source);
              const canGenerateDraft = draftPlatform !== null;
              const canMutateItem = canMutateDiscoveryItem(item);
              const isMutatingItem = discoveryItemActionState.status === 'loading';

              return (
                <SectionCard
                  key={item.id}
                  title={item.title}
                  description={`${item.source} · ${item.status} · ${item.createdAt ?? 'unknown'}`}
                >
                  <div style={{ display: 'grid', gap: '16px' }}>
                    <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{item.summary}</p>

                    {!canGenerateDraft ? (
                      <p style={{ margin: 0, color: '#92400e', fontWeight: 700 }}>
                        当前来源不在首发平台范围内，请改走人工内容流程。
                      </p>
                    ) : null}

                    <div style={{ display: 'grid', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-discovery-save-id={canMutateItem ? String(item.id) : undefined}
                          data-discovery-item-action={`save-${String(item.id)}`}
                          disabled={!canMutateItem || isMutatingItem}
                          onClick={() => {
                            void handleDiscoveryItemAction(item, 'save');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: !canMutateItem || isMutatingItem ? '#e2e8f0' : '#ffffff',
                            color: !canMutateItem || isMutatingItem ? '#475569' : '#334155',
                            padding: '12px 16px',
                            fontWeight: 700,
                            cursor: !canMutateItem || isMutatingItem ? 'not-allowed' : 'pointer',
                            opacity: !canMutateItem || isMutatingItem ? 0.8 : 1,
                          }}
                        >
                          {isMutatingItem && discoveryItemActionState.action === 'save' ? '正在保存...' : '保存'}
                        </button>
                        <button
                          type="button"
                          data-discovery-ignore-id={canMutateItem ? String(item.id) : undefined}
                          data-discovery-item-action={`ignore-${String(item.id)}`}
                          disabled={!canMutateItem || isMutatingItem}
                          onClick={() => {
                            void handleDiscoveryItemAction(item, 'ignore');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: !canMutateItem || isMutatingItem ? '#e2e8f0' : '#ffffff',
                            color: !canMutateItem || isMutatingItem ? '#475569' : '#334155',
                            padding: '12px 16px',
                            fontWeight: 700,
                            cursor: !canMutateItem || isMutatingItem ? 'not-allowed' : 'pointer',
                            opacity: !canMutateItem || isMutatingItem ? 0.8 : 1,
                          }}
                        >
                          {isMutatingItem && discoveryItemActionState.action === 'ignore' ? '正在忽略...' : '忽略'}
                        </button>
                        {canGenerateDraft ? (
                          <button
                            type="button"
                            data-discovery-select-item={String(item.id)}
                            aria-pressed={selectedItemIds.includes(String(item.id)) ? 'true' : 'false'}
                            onClick={() => handleToggleBatchSelection(item)}
                            style={{
                              borderRadius: '12px',
                              border: '1px solid #cbd5e1',
                              background: selectedItemIds.includes(String(item.id)) ? '#dbeafe' : '#ffffff',
                              color: selectedItemIds.includes(String(item.id)) ? '#1d4ed8' : '#334155',
                              padding: '12px 16px',
                              fontWeight: 700,
                            }}
                          >
                            {selectedItemIds.includes(String(item.id)) ? '已加入批量' : '加入批量'}
                          </button>
                        ) : null}
                        <ActionButton
                          label={draftState.status === 'loading' ? '正在生成草稿...' : '生成草稿'}
                          tone="primary"
                          disabled={isPreview || !canGenerateDraft}
                          onClick={() => {
                            void handleGenerateDraft(item);
                          }}
                        />
                      </div>

                      {draftState.status === 'success' && draftState.data ? (
                        <div
                          style={{
                            display: 'grid',
                            gap: '8px',
                            borderRadius: '14px',
                            border: '1px solid #bfdbfe',
                            background: '#eff6ff',
                            padding: '14px',
                          }}
                        >
                          <div style={{ color: '#1d4ed8', fontWeight: 700 }}>草稿已生成</div>
                          {draftState.data.results.map((result, index) => (
                            <div key={`${result.platform}-${result.draftId ?? index}`} style={{ color: '#1e3a8a' }}>
                              draftId: {result.draftId ?? '未保存'} · platform: {result.platform}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {draftState.status === 'error' ? (
                        <p style={{ margin: 0, color: '#b91c1c' }}>草稿生成失败：{draftState.error}</p>
                      ) : null}
                      {discoveryItemActionState.status === 'success' ? (
                        <p style={{ margin: 0, color: '#166534', fontWeight: 700 }}>
                          {discoveryItemActionState.action === 'save' ? '已保存到发现池。' : '已忽略该条发现。'}
                        </p>
                      ) : null}
                      {discoveryItemActionState.status === 'error' ? (
                        <p style={{ margin: 0, color: '#b91c1c', fontWeight: 700 }}>
                          发现条目动作失败：{discoveryItemActionState.error}
                        </p>
                      ) : null}
                      {!canMutateItem ? (
                        <p style={{ margin: 0, color: '#92400e', fontWeight: 700 }}>
                          来源于 inbox 的聚合项暂不支持保存 / 忽略动作
                        </p>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>
              );
            })}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
