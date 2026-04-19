import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
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

export async function loadMonitorFeedRequest(): Promise<MonitorFeedResponse> {
  return apiRequest<MonitorFeedResponse>('/api/monitor/feed');
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

export async function fetchMonitorFeedRequest(): Promise<FetchMonitorFeedResponse> {
  return apiRequest<FetchMonitorFeedResponse>('/api/monitor/fetch', {
    method: 'POST',
  });
}

export async function enqueueMonitorFetchJobRequest(runAt?: string): Promise<EnqueueMonitorFetchJobResponse> {
  return apiRequest<EnqueueMonitorFetchJobResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'monitor_fetch',
      payload: {},
      ...(runAt ? { runAt } : {}),
    }),
  });
}

interface MonitorPageProps {
  loadMonitorAction?: () => Promise<MonitorFeedResponse>;
  generateFollowUpAction?: (id: number, platform: string) => Promise<FollowUpDraftResponse>;
  fetchMonitorAction?: () => Promise<FetchMonitorFeedResponse>;
  enqueueFetchJobAction?: (runAt?: string) => Promise<EnqueueMonitorFetchJobResponse>;
  enqueueMonitorAction?: (runAt?: string) => Promise<EnqueueMonitorFetchJobResponse>;
  stateOverride?: AsyncState<MonitorFeedResponse>;
  followUpStateOverride?: AsyncState<FollowUpDraftResponse>;
  fetchStateOverride?: AsyncState<FetchMonitorFeedResponse>;
  enqueueStateOverride?: AsyncState<EnqueueMonitorFetchJobResponse>;
}

const sourceFilters = ['全部来源', 'X / Twitter', 'RSS', 'Reddit', 'Product Hunt'];
const queueInputStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

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
}: MonitorPageProps) {
  const resolvedEnqueueAction = enqueueMonitorAction ?? enqueueFetchJobAction ?? enqueueMonitorFetchJobRequest;
  const { state, reload } = useAsyncQuery(loadMonitorAction, [loadMonitorAction]);
  const { state: fetchState, run: runFetchMonitor } = useAsyncAction(fetchMonitorAction);
  const { state: enqueueState, run: runEnqueueFetchJob } = useAsyncAction(resolvedEnqueueAction);
  const { state: followUpState, run: generateFollowUp } = useAsyncAction(
    ({ id, platform }: { id: number; platform: string }) => generateFollowUpAction(id, platform),
  );
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState('');
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
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  function handleGenerateFollowUp() {
    const nextItem = viewData.items.find((item) => item.status === 'new') ?? viewData.items[0];
    if (!nextItem) {
      return;
    }

    void generateFollowUp({
      id: nextItem.id,
      platform: nextItem.source,
    }).catch(() => undefined);
  }

  function handleFetchMonitor() {
    void runFetchMonitor()
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleEnqueueMonitorFetch() {
    const runAt = enqueueRunAtDraft.trim().length > 0 ? enqueueRunAtDraft.trim() : undefined;

    void runEnqueueFetchJob(runAt)
      .then(() => {
        setEnqueueRunAtDraft('');
        reload();
      })
      .catch(() => undefined);
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
              onClick={handleFetchMonitor}
            />
            <ActionButton
              label={displayEnqueueState.status === 'loading' ? '正在提交抓取队列...' : '加入队列 / 定时抓取'}
              onClick={handleEnqueueMonitorFetch}
            />
            <ActionButton
              label={displayFollowUpState.status === 'loading' ? '正在生成跟进草稿...' : '生成跟进草稿'}
              tone="primary"
              onClick={handleGenerateFollowUp}
            />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载监控动态...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>监控动态加载失败：{displayState.error}</p> : null}
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

      {displayFollowUpState.status === 'success' && displayFollowUpState.data ? (
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
      {displayFollowUpState.status === 'error' ? (
        <p style={{ color: '#b91c1c' }}>跟进草稿生成失败：{displayFollowUpState.error}</p>
      ) : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <SectionCard title="抓取排程" description="留空表示立即入队，也可以填写 ISO 时间，作为定时抓取的 runAt。">
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>计划抓取时间（可选）</span>
              <input
                value={enqueueRunAtDraft}
                onChange={(event) => setEnqueueRunAtDraft(event.target.value)}
                placeholder="例如 2026-04-20T09:00:00.000Z"
                style={queueInputStyle}
              />
            </label>
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
