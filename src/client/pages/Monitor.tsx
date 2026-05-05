import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { DataSourceSetupHint } from '../components/DataSourceSetupHint';
import { MonitorFeed } from '../components/MonitorFeed';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';
import {
  createProjectIdBody,
  createProjectPayload,
  getProjectIdValidationError,
  parseProjectId,
  queueInputStyle,
  withProjectIdQuery,
} from '../lib/projectId';

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

export interface FollowUpDraftResponse {
  draft: {
    id: number;
    platform: string;
    title?: string;
    content: string;
    status: string;
  };
}

export interface FetchMonitorFeedResponse {
  items: MonitorItem[];
  inserted: number;
  total: number;
}

export interface EnqueueMonitorFetchJobResponse {
  job: {
    id: number;
    type: string;
    status: string;
    runAt: string;
    attempts?: number;
  };
  runtime: Record<string, unknown>;
}

const launchReadyFollowUpPlatforms = new Set(['x', 'reddit', 'instagram', 'tiktok', 'xiaohongshu', 'weibo']);
const manualMonitorGeneratePlatforms = ['facebook-group', 'instagram', 'tiktok', 'xiaohongshu', 'weibo'];

function buildMonitorGenerateTopic(item: MonitorItem) {
  return [item.title, item.detail].filter((value) => value.trim().length > 0).join('\n\n');
}

export async function loadMonitorFeedRequest(projectId?: number): Promise<MonitorFeedResponse> {
  return apiRequest<MonitorFeedResponse>(withProjectIdQuery('/api/monitor/feed', projectId));
}

export async function generateFollowUpRequest(
  id: number,
  platform: string,
): Promise<FollowUpDraftResponse> {
  return apiRequest<FollowUpDraftResponse>(`/api/monitor/${id}/generate-follow-up`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ platform }),
  });
}

export async function fetchMonitorFeedRequest(projectId?: number): Promise<FetchMonitorFeedResponse> {
  return apiRequest<FetchMonitorFeedResponse>('/api/monitor/fetch', {
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

export async function enqueueMonitorFetchJobRequest(
  runAt?: string,
  projectId?: number,
): Promise<EnqueueMonitorFetchJobResponse> {
  return apiRequest<EnqueueMonitorFetchJobResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'monitor_fetch',
      payload: createProjectPayload(projectId),
      ...(runAt ? { runAt } : {}),
    }),
  });
}

interface MonitorPageProps {
  loadMonitorAction?: (projectId?: number) => Promise<MonitorFeedResponse>;
  generateFollowUpAction?: (id: number, platform: string) => Promise<FollowUpDraftResponse>;
  fetchMonitorAction?: (projectId?: number) => Promise<FetchMonitorFeedResponse>;
  enqueueFetchJobAction?: (runAt?: string, projectId?: number) => Promise<EnqueueMonitorFetchJobResponse>;
  enqueueMonitorAction?: (runAt?: string, projectId?: number) => Promise<EnqueueMonitorFetchJobResponse>;
  stateOverride?: AsyncState<MonitorFeedResponse>;
  followUpStateOverride?: AsyncState<FollowUpDraftResponse>;
  fetchStateOverride?: AsyncState<FetchMonitorFeedResponse>;
  enqueueStateOverride?: AsyncState<EnqueueMonitorFetchJobResponse>;
  projectIdDraft?: string;
  onProjectIdDraftChange?: (value: string) => void;
  onOpenGenerateCenter?: (input: { topic: string; preferredPlatforms: string[] }) => void;
}

type FollowUpAttemptState =
  | {
      kind: 'request';
      itemId: number;
    }
  | {
      kind: 'blocked';
      itemId: number | null;
    }
  | null;

type MonitorSourceFilter =
  | 'all'
  | 'x'
  | 'rss'
  | 'reddit'
  | 'product-hunt'
  | 'instagram'
  | 'tiktok'
  | 'xiaohongshu'
  | 'weibo'
  | 'v2ex';

const sourceFilters: Array<{ id: MonitorSourceFilter; label: string }> = [
  { id: 'all', label: '全部来源' },
  { id: 'x', label: 'X / Twitter' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'weibo', label: '微博' },
  { id: 'rss', label: 'RSS' },
  { id: 'product-hunt', label: 'Product Hunt' },
  { id: 'v2ex', label: 'V2EX' },
];
export function MonitorPage({
  loadMonitorAction = loadMonitorFeedRequest,
  generateFollowUpAction = generateFollowUpRequest,
  fetchMonitorAction = fetchMonitorFeedRequest,
  enqueueFetchJobAction,
  enqueueMonitorAction,
  stateOverride,
  followUpStateOverride,
  fetchStateOverride,
  enqueueStateOverride,
  projectIdDraft,
  onProjectIdDraftChange,
  onOpenGenerateCenter,
}: MonitorPageProps) {
  const resolvedEnqueueAction = enqueueMonitorAction ?? enqueueFetchJobAction ?? enqueueMonitorFetchJobRequest;
  const [localProjectIdDraft, setLocalProjectIdDraft] = useState('');
  const activeProjectIdDraft = projectIdDraft ?? localProjectIdDraft;
  const projectId = parseProjectId(activeProjectIdDraft);
  const projectIdValidationError = getProjectIdValidationError(activeProjectIdDraft);
  const { state, reload } = useAsyncQuery(
    () => {
      if (projectIdValidationError) {
        return Promise.reject(new Error(projectIdValidationError));
      }

      return projectId === undefined ? loadMonitorAction() : loadMonitorAction(projectId);
    },
    [loadMonitorAction, projectId, projectIdValidationError],
  );
  const { state: fetchState, run: runFetchMonitor } = useAsyncAction((nextProjectId?: number) =>
    nextProjectId === undefined ? fetchMonitorAction() : fetchMonitorAction(nextProjectId),
  );
  const { state: enqueueState, run: runEnqueueFetchJob } = useAsyncAction(
    ({ runAt, projectId: nextProjectId }: { runAt?: string; projectId?: number }) =>
      nextProjectId === undefined ? resolvedEnqueueAction(runAt) : resolvedEnqueueAction(runAt, nextProjectId),
  );
  const { state: followUpState, run: generateFollowUp } = useAsyncAction(
    ({ id, platform }: { id: number; platform: string }) => generateFollowUpAction(id, platform),
  );
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState('');
  const [activeSourceFilter, setActiveSourceFilter] = useState<MonitorSourceFilter>('all');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [followUpSelectionMessage, setFollowUpSelectionMessage] = useState<string | null>(null);
  const [latestFollowUpAttempt, setLatestFollowUpAttempt] = useState<FollowUpAttemptState>(null);
  const displayState = stateOverride ?? state;
  const displayFollowUpState = followUpStateOverride ?? followUpState;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayEnqueueState = enqueueStateOverride ?? enqueueState;
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
  const showLoadError = displayState.status === 'error' && displayState.error !== projectIdValidationError;
  const hasLiveData =
    !projectIdValidationError &&
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as MonitorFeedResponse).items);
  const isPreview = !hasLiveData;
  const viewData = hasLiveData ? (displayState.data as MonitorFeedResponse) : fallbackData;
  const filteredItems = filterMonitorItems(viewData.items, activeSourceFilter);
  const selectedItem = filteredItems.find((item) => item.id === selectedItemId) ?? null;
  const activeFollowUpItemId = latestFollowUpAttempt?.itemId ?? selectedItem?.id ?? null;
  const showFollowUpFeedback =
    (latestFollowUpAttempt === null || latestFollowUpAttempt.kind === 'request') &&
    selectedItem !== null &&
    selectedItem.id === activeFollowUpItemId;
  const showFollowUpLoadingForSelectedItem =
    displayFollowUpState.status === 'loading' &&
    (latestFollowUpAttempt === null || selectedItem?.id === activeFollowUpItemId);

  useEffect(() => {
    setSelectedItemId(null);
    setFollowUpSelectionMessage(null);
    setLatestFollowUpAttempt(null);
  }, [projectId]);

  function handleGenerateFollowUp() {
    if (isPreview) {
      setLatestFollowUpAttempt({
        kind: 'blocked',
        itemId: null,
      });
      setFollowUpSelectionMessage('预览数据不可直接生成跟进草稿，请先加载真实监控信号');
      return;
    }

    if (!selectedItem) {
      setLatestFollowUpAttempt({
        kind: 'blocked',
        itemId: null,
      });
      setFollowUpSelectionMessage('请先从当前列表中选择一条动态');
      return;
    }

    const followUpPlatform = resolveFollowUpPlatform(selectedItem.source);
    if (!followUpPlatform || !launchReadyFollowUpPlatforms.has(followUpPlatform)) {
      setLatestFollowUpAttempt({
        kind: 'blocked',
        itemId: selectedItem.id,
      });
      setFollowUpSelectionMessage('当前动态来源不在首发平台范围内');
      return;
    }

    setLatestFollowUpAttempt({
      kind: 'request',
      itemId: selectedItem.id,
    });
    setFollowUpSelectionMessage(null);
    void generateFollowUp({
      id: selectedItem.id,
      platform: followUpPlatform,
    }).catch(() => undefined);
  }

  function handleFetchMonitor() {
    if (projectIdValidationError) {
      return;
    }

    void runFetchMonitor(projectId)
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleEnqueueMonitorFetch() {
    if (projectIdValidationError) {
      return;
    }

    const runAt = enqueueRunAtDraft.trim().length > 0 ? enqueueRunAtDraft.trim() : undefined;

    void runEnqueueFetchJob({ runAt, projectId })
      .then(() => {
        setEnqueueRunAtDraft('');
        reload();
      })
      .catch(() => undefined);
  }

  function handleSelectSourceFilter(filter: MonitorSourceFilter) {
    const nextFilteredItems = filterMonitorItems(viewData.items, filter);

    setActiveSourceFilter(filter);
    setFollowUpSelectionMessage(null);
    setSelectedItemId((currentSelectedItemId) =>
      currentSelectedItemId !== null && nextFilteredItems.some((item) => item.id === currentSelectedItemId)
        ? currentSelectedItemId
        : null,
    );
  }

  function handleSelectItem(item: MonitorItem) {
    setSelectedItemId(item.id);
    setFollowUpSelectionMessage(null);
  }

  function canOpenGenerateCenter() {
    return typeof onOpenGenerateCenter === 'function';
  }

  function resolveMonitorGeneratePreferredPlatforms(source: string) {
    const followUpPlatform = resolveFollowUpPlatform(source);
    return followUpPlatform ? [followUpPlatform] : manualMonitorGeneratePlatforms;
  }

  function handleOpenGenerateCenter() {
    if (!selectedItem || !canOpenGenerateCenter()) {
      return;
    }

    onOpenGenerateCenter?.({
      topic: buildMonitorGenerateTopic(selectedItem),
      preferredPlatforms: resolveMonitorGeneratePreferredPlatforms(selectedItem.source),
    });
  }

  return (
    <section>
      <PageHeader
        eyebrow="Tracking"
        title="Competitor Monitor"
        description="把竞品动态、关键词搜索结果和 RSS 更新放到一个时间线里，支持快速生成跟进草稿。"
        actions={
          <>
            <ActionButton label="刷新监控" onClick={reload} />
            <ActionButton
              label={displayFetchState.status === 'loading' ? '正在抓取动态...' : '抓取新动态'}
              disabled={projectIdValidationError !== null}
              onClick={handleFetchMonitor}
            />
            <ActionButton
              label={displayEnqueueState.status === 'loading' ? '正在提交抓取队列...' : '加入队列 / 定时抓取'}
              disabled={projectIdValidationError !== null}
              onClick={handleEnqueueMonitorFetch}
            />
            <ActionButton
              label={showFollowUpLoadingForSelectedItem ? '正在生成跟进草稿...' : '生成跟进草稿'}
              tone="primary"
              disabled={isPreview || showFollowUpLoadingForSelectedItem}
              onClick={handleGenerateFollowUp}
            />
            {canOpenGenerateCenter() ? (
              <ActionButton
                label="发送到 Generate Center"
                disabled={isPreview || selectedItem === null}
                buttonAttributes={{ 'data-monitor-generate-center': 'true' }}
                onClick={handleOpenGenerateCenter}
              />
            ) : null}
          </>
        }
      />

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
          style={queueInputStyle}
        />
      </label>

      {projectIdValidationError ? (
        <p style={{ color: '#b91c1c', fontWeight: 700 }}>{projectIdValidationError}</p>
      ) : null}

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载监控动态...</p> : null}
      {showLoadError ? <p style={{ color: '#b91c1c' }}>监控动态加载失败：{displayState.error}</p> : null}
      {displayState.status === 'idle' ? (
        <p style={{ color: '#92400e', fontWeight: 700 }}>
          当前展示的是预览数据，真实监控信号加载完成后会自动替换。
        </p>
      ) : null}
      {displayFetchState.status === 'success' && displayFetchState.data ? (
        <p style={{ color: '#166534', fontWeight: 700 }}>
          已抓取 {displayFetchState.data.inserted} 条监控动态，当前总数 {displayFetchState.data.total}
        </p>
      ) : null}
      {displayFetchState.status === 'error' ? (
        <p style={{ color: '#b91c1c' }}>监控抓取失败：{displayFetchState.error}</p>
      ) : null}
      {displayEnqueueState.status === 'success' && displayEnqueueState.data ? (
        <p style={{ color: '#1d4ed8', fontWeight: 700 }}>
          已将监控抓取加入队列，job #{displayEnqueueState.data.job.id}，执行时间 {displayEnqueueState.data.job.runAt}
        </p>
      ) : null}
      {displayEnqueueState.status === 'error' ? (
        <p style={{ color: '#b91c1c' }}>监控排程失败：{displayEnqueueState.error}</p>
      ) : null}

      {showFollowUpFeedback && displayFollowUpState.status === 'success' && displayFollowUpState.data ? (
        <SectionCard
          title="跟进草稿已生成"
          description="已收到 `/api/monitor/:id/generate-follow-up` 返回的最新 draft 信息。"
        >
          <div style={{ display: 'grid', gap: '8px' }}>
            <div style={{ fontWeight: 700 }}>{displayFollowUpState.data.draft.title ?? `Follow-up draft #${displayFollowUpState.data.draft.id}`}</div>
            <div style={{ color: '#475569' }}>draftId: {displayFollowUpState.data.draft.id}</div>
            <div style={{ color: '#475569' }}>platform: {displayFollowUpState.data.draft.platform}</div>
            <div style={{ color: '#475569' }}>status: {displayFollowUpState.data.draft.status}</div>
            <p style={{ margin: 0, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{displayFollowUpState.data.draft.content}</p>
          </div>
        </SectionCard>
      ) : null}
      {showFollowUpFeedback && displayFollowUpState.status === 'error' ? (
        <p style={{ color: '#b91c1c' }}>跟进草稿生成失败：{displayFollowUpState.error}</p>
      ) : null}
      {followUpSelectionMessage ? (
        <p style={{ color: '#b45309', fontWeight: 700 }}>{followUpSelectionMessage}</p>
      ) : null}

      {hasLiveData || displayState.status === 'idle' ? (
        <>
          <SectionCard title="抓取排程" description="留空表示立即入队，也可以填写 ISO 时间，作为定时抓取的 runAt。">
            <div style={{ display: 'grid', gap: '16px' }}>
              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>计划抓取时间（可选）</span>
                <input
                  value={enqueueRunAtDraft}
                  onChange={(event) => setEnqueueRunAtDraft(event.target.value)}
                  placeholder="例如 2026-04-20T09:00:00.000Z"
                  style={queueInputStyle}
                />
              </label>
            </div>
          </SectionCard>

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
                    key={filter.id}
                    type="button"
                    data-monitor-filter-source={filter.id}
                    aria-pressed={activeSourceFilter === filter.id ? 'true' : 'false'}
                    onClick={() => {
                      handleSelectSourceFilter(filter.id);
                    }}
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
            </SectionCard>

            <SectionCard title="最新动态" description={`当前筛选下 ${filteredItems.length} 条 / 总计 ${viewData.total} 条监控动态`}>
              {viewData.total === 0 ? (
                <DataSourceSetupHint dataLabel="监控动态" />
              ) : (
                <MonitorFeed
                  items={filteredItems}
                  selectedItemId={selectedItemId}
                  onSelectItem={handleSelectItem}
                />
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </section>
  );
}

function normalizeSourceFilter(source: string): MonitorSourceFilter {
  const normalized = source.trim().toLowerCase();

  if (normalized === 'x' || normalized === 'x / twitter' || normalized === 'twitter') {
    return 'x';
  }

  if (normalized === 'rss') {
    return 'rss';
  }

  if (normalized === 'reddit') {
    return 'reddit';
  }

  if (normalized === 'instagram') {
    return 'instagram';
  }

  if (normalized === 'tiktok' || normalized === 'tik tok') {
    return 'tiktok';
  }

  if (normalized === 'xiaohongshu' || normalized === '小红书') {
    return 'xiaohongshu';
  }

  if (normalized === 'weibo' || normalized === '微博') {
    return 'weibo';
  }

  if (normalized === 'product hunt' || normalized === 'product-hunt') {
    return 'product-hunt';
  }

  if (normalized === 'v2ex') {
    return 'v2ex';
  }

  return 'all';
}

function filterMonitorItems(items: MonitorItem[], activeSourceFilter: MonitorSourceFilter) {
  return activeSourceFilter === 'all'
    ? items
    : items.filter((item) => normalizeSourceFilter(item.source) === activeSourceFilter);
}

function resolveFollowUpPlatform(source: string) {
  const normalized = normalizeSourceFilter(source);
  return launchReadyFollowUpPlatforms.has(normalized) ? normalized : null;
}
