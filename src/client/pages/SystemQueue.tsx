import { useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';

export interface SystemQueueJob {
  id: number;
  type: string;
  status: string;
  runAt: string;
  attempts: number;
  lastError?: string;
  canRetry?: boolean;
  canCancel?: boolean;
}

export interface SystemQueueResponse {
  jobs: SystemQueueJob[];
  queue: {
    pending?: number;
    running?: number;
    done?: number;
    failed?: number;
    canceled?: number;
    duePending?: number;
  };
  recentJobs: SystemQueueJob[];
}

export interface SystemQueueMutationResponse {
  job: SystemQueueJob;
  runtime: Record<string, unknown>;
}

export interface BrowserLaneRequestRecord {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: string;
  jobStatus: string;
  requestedAt: string;
  artifactPath: string;
  resolvedAt: string | null;
}

export interface BrowserLaneRequestsResponse {
  requests: BrowserLaneRequestRecord[];
  total: number;
}

export interface BrowserHandoffRecord {
  channelAccountId?: number;
  accountDisplayName?: string;
  ownership?: string;
  platform: string;
  draftId: string;
  title: string | null;
  accountKey: string;
  status: string;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserHandoffsResponse {
  handoffs: BrowserHandoffRecord[];
  total: number;
}

export interface InboxReplyHandoffRecord {
  channelAccountId?: number;
  platform: string;
  itemId: string;
  source: string;
  title: string | null;
  author: string | null;
  accountKey: string;
  status: string;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface InboxReplyHandoffsResponse {
  handoffs: InboxReplyHandoffRecord[];
  total: number;
}

export interface BrowserHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  draftId: number;
  draftStatus: string;
  platform: string;
  mode: string;
  status: string;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
}

export interface InboxReplyHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  itemId: number;
  itemStatus: string;
  platform: string;
  mode: string;
  status: string;
  success: boolean;
  deliveryUrl: string | null;
  externalId: string | null;
  message: string;
  deliveredAt: string | null;
}

export async function loadSystemQueueRequest(limit = 50): Promise<SystemQueueResponse> {
  return apiRequest<SystemQueueResponse>(`/api/system/jobs?limit=${limit}`);
}

export async function loadBrowserLaneRequestsRequest(limit = 20): Promise<BrowserLaneRequestsResponse> {
  return apiRequest<BrowserLaneRequestsResponse>(`/api/system/browser-lane-requests?limit=${limit}`);
}

export async function loadBrowserHandoffsRequest(limit = 20): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(`/api/system/browser-handoffs?limit=${limit}`);
}

export async function loadInboxReplyHandoffsRequest(limit = 20): Promise<InboxReplyHandoffsResponse> {
  return apiRequest<InboxReplyHandoffsResponse>(`/api/system/inbox-reply-handoffs?limit=${limit}`);
}

export async function completeBrowserHandoffRequest(input: {
  artifactPath: string;
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
}): Promise<BrowserHandoffCompletionResponse> {
  return apiRequest<BrowserHandoffCompletionResponse>('/api/system/browser-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      publishStatus: input.publishStatus,
      message:
        input.message ??
        (input.publishStatus === 'published'
          ? 'browser handoff marked published'
          : 'browser handoff marked failed'),
      ...(input.publishUrl !== undefined && input.publishUrl.trim().length > 0
        ? { publishUrl: input.publishUrl.trim() }
        : {}),
    }),
  });
}

export async function completeInboxReplyHandoffRequest(input: {
  artifactPath: string;
  replyStatus: 'sent' | 'failed';
  message?: string;
  deliveryUrl?: string;
}): Promise<InboxReplyHandoffCompletionResponse> {
  return apiRequest<InboxReplyHandoffCompletionResponse>('/api/system/inbox-reply-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      replyStatus: input.replyStatus,
      message:
        input.message ??
        (input.replyStatus === 'sent'
          ? 'inbox reply handoff marked sent'
          : 'inbox reply handoff marked failed'),
      ...(input.deliveryUrl !== undefined && input.deliveryUrl.trim().length > 0
        ? { deliveryUrl: input.deliveryUrl.trim() }
        : {}),
    }),
  });
}

export async function retrySystemQueueJobRequest(
  jobId: number,
  runAt?: string,
): Promise<SystemQueueMutationResponse> {
  return apiRequest<SystemQueueMutationResponse>(`/api/system/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(runAt ? { runAt } : {}),
  });
}

export async function cancelSystemQueueJobRequest(jobId: number): Promise<SystemQueueMutationResponse> {
  return apiRequest<SystemQueueMutationResponse>(`/api/system/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
}

export async function enqueueSystemQueueJobRequest(input: {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: string;
}): Promise<SystemQueueMutationResponse> {
  return apiRequest<SystemQueueMutationResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

interface SystemQueuePageProps {
  loadSystemQueueAction?: () => Promise<SystemQueueResponse>;
  loadBrowserLaneRequestsAction?: () => Promise<BrowserLaneRequestsResponse>;
  loadBrowserHandoffsAction?: () => Promise<BrowserHandoffsResponse>;
  loadInboxReplyHandoffsAction?: () => Promise<InboxReplyHandoffsResponse>;
  retrySystemQueueJobAction?: (jobId: number, runAt?: string) => Promise<SystemQueueMutationResponse>;
  cancelSystemQueueJobAction?: (jobId: number) => Promise<SystemQueueMutationResponse>;
  enqueueSystemQueueJobAction?: (input: {
    type: string;
    payload?: Record<string, unknown>;
    runAt?: string;
  }) => Promise<SystemQueueMutationResponse>;
  completeBrowserHandoffAction?: (input: {
    artifactPath: string;
    publishStatus: 'published' | 'failed';
    message?: string;
    publishUrl?: string;
  }) => Promise<BrowserHandoffCompletionResponse>;
  completeInboxReplyHandoffAction?: (input: {
    artifactPath: string;
    replyStatus: 'sent' | 'failed';
    message?: string;
    deliveryUrl?: string;
  }) => Promise<InboxReplyHandoffCompletionResponse>;
  stateOverride?: AsyncState<SystemQueueResponse>;
  browserLaneStateOverride?: AsyncState<BrowserLaneRequestsResponse>;
  browserHandoffStateOverride?: AsyncState<BrowserHandoffsResponse>;
  inboxReplyHandoffStateOverride?: AsyncState<InboxReplyHandoffsResponse>;
  mutationStateOverride?: AsyncState<SystemQueueMutationResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

function defaultLoadSystemQueueAction() {
  return loadSystemQueueRequest(50);
}

function defaultLoadBrowserLaneRequestsAction() {
  return loadBrowserLaneRequestsRequest(20);
}

function defaultLoadBrowserHandoffsAction() {
  return loadBrowserHandoffsRequest(20);
}

function defaultLoadInboxReplyHandoffsAction() {
  return loadInboxReplyHandoffsRequest(20);
}

export function SystemQueuePage({
  loadSystemQueueAction = defaultLoadSystemQueueAction,
  loadBrowserLaneRequestsAction = defaultLoadBrowserLaneRequestsAction,
  loadBrowserHandoffsAction = defaultLoadBrowserHandoffsAction,
  loadInboxReplyHandoffsAction = defaultLoadInboxReplyHandoffsAction,
  retrySystemQueueJobAction = retrySystemQueueJobRequest,
  cancelSystemQueueJobAction = cancelSystemQueueJobRequest,
  enqueueSystemQueueJobAction = enqueueSystemQueueJobRequest,
  completeBrowserHandoffAction = completeBrowserHandoffRequest,
  completeInboxReplyHandoffAction = completeInboxReplyHandoffRequest,
  stateOverride,
  browserLaneStateOverride,
  browserHandoffStateOverride,
  inboxReplyHandoffStateOverride,
  mutationStateOverride,
}: SystemQueuePageProps) {
  type QueueMutationInput =
    | { mode: 'retry'; jobId?: number; runAt?: string }
    | { mode: 'cancel'; jobId?: number }
    | { mode: 'enqueue'; runAt?: string; type?: string; payloadJson?: string };
  const { state, reload } = useAsyncQuery(loadSystemQueueAction, [loadSystemQueueAction]);
  const { state: browserLaneState, reload: reloadBrowserLane } = useAsyncQuery(
    loadBrowserLaneRequestsAction,
    [loadBrowserLaneRequestsAction],
  );
  const { state: browserHandoffState, reload: reloadBrowserHandoffs } = useAsyncQuery(
    loadBrowserHandoffsAction,
    [loadBrowserHandoffsAction],
  );
  const { state: inboxReplyHandoffState, reload: reloadInboxReplyHandoffs } = useAsyncQuery(
    loadInboxReplyHandoffsAction,
    [loadInboxReplyHandoffsAction],
  );
  const { state: mutationState, run: mutateQueue } = useAsyncAction(
    (input: QueueMutationInput) => {
      if (input.mode === 'retry') {
        return retrySystemQueueJobAction(input.jobId ?? -1, input.runAt);
      }

      if (input.mode === 'cancel') {
        return cancelSystemQueueJobAction(input.jobId ?? -1);
      }

      const payload = parseEnqueuePayload(input.payloadJson);

      return enqueueSystemQueueJobAction({
        type: input.type ?? 'monitor_fetch',
        ...(payload === undefined ? {} : { payload }),
        runAt: input.runAt,
      });
    },
  );
  const { state: handoffMutationState, run: runBrowserHandoffCompletion } = useAsyncAction(
    (input: {
      artifactPath: string;
      publishStatus: 'published' | 'failed';
      message?: string;
      publishUrl?: string;
    }) => completeBrowserHandoffAction(input),
  );
  const { state: inboxReplyHandoffMutationState, run: runInboxReplyHandoffCompletion } = useAsyncAction(
    (input: {
      artifactPath: string;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => completeInboxReplyHandoffAction(input),
  );
  const displayState = stateOverride ?? state;
  const displayBrowserLaneState = browserLaneStateOverride ?? browserLaneState;
  const displayBrowserHandoffState = browserHandoffStateOverride ?? browserHandoffState;
  const displayInboxReplyHandoffState = inboxReplyHandoffStateOverride ?? inboxReplyHandoffState;
  const displayMutationState = mutationStateOverride ?? mutationState;
  const [activeMutation, setActiveMutation] = useState<QueueMutationInput | null>(null);
  const [activeBrowserHandoffArtifactPath, setActiveBrowserHandoffArtifactPath] = useState<string | null>(null);
  const [activeInboxReplyHandoffArtifactPath, setActiveInboxReplyHandoffArtifactPath] = useState<string | null>(null);
  const [browserHandoffDraftByArtifactPath, setBrowserHandoffDraftByArtifactPath] = useState<
    Record<string, { publishUrl: string; message: string }>
  >({});
  const [inboxReplyHandoffDraftByArtifactPath, setInboxReplyHandoffDraftByArtifactPath] = useState<
    Record<string, { deliveryUrl: string; message: string }>
  >({});
  const [enqueueType, setEnqueueType] = useState('monitor_fetch');
  const [enqueuePayloadJson, setEnqueuePayloadJson] = useState('');
  const [enqueueRunAt, setEnqueueRunAt] = useState('');
  const enqueueTypeFieldRef = useRef<HTMLInputElement | null>(null);
  const queueMutationPendingRef = useRef(false);

  const fallbackData: SystemQueueResponse = {
    jobs: [],
    queue: {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      canceled: 0,
      duePending: 0,
    },
    recentJobs: [],
  };
  const hasLiveQueueData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as SystemQueueResponse).jobs);
  const viewData = hasLiveQueueData ? (displayState.data as SystemQueueResponse) : fallbackData;

  const queueStats = {
    pending: viewData.queue.pending ?? 0,
    running: viewData.queue.running ?? 0,
    done: viewData.queue.done ?? 0,
    failed: viewData.queue.failed ?? 0,
    canceled: viewData.queue.canceled ?? 0,
    duePending: viewData.queue.duePending ?? 0,
  };
  const hasLiveBrowserLaneData =
    typeof displayBrowserLaneState.data === 'object' &&
    displayBrowserLaneState.data !== null &&
    Array.isArray(displayBrowserLaneState.data.requests);
  const visibleBrowserLaneRequests = hasLiveBrowserLaneData ? displayBrowserLaneState.data.requests : [];
  const hasLiveBrowserHandoffData =
    typeof displayBrowserHandoffState.data === 'object' &&
    displayBrowserHandoffState.data !== null &&
    Array.isArray(displayBrowserHandoffState.data.handoffs);
  const visibleBrowserHandoffs = hasLiveBrowserHandoffData ? displayBrowserHandoffState.data.handoffs : [];
  const hasLiveInboxReplyHandoffData =
    typeof displayInboxReplyHandoffState.data === 'object' &&
    displayInboxReplyHandoffState.data !== null &&
    Array.isArray(displayInboxReplyHandoffState.data.handoffs);
  const visibleInboxReplyHandoffs = hasLiveInboxReplyHandoffData
    ? displayInboxReplyHandoffState.data.handoffs
    : [];

  const mutationFeedback =
    displayMutationState.status === 'success' && displayMutationState.data
      ? `已更新作业 #${displayMutationState.data.job.id} (${displayMutationState.data.job.type})`
      : displayMutationState.status === 'error'
        ? `队列动作失败：${displayMutationState.error}`
        : null;
  const browserHandoffFeedback =
    handoffMutationState.status === 'success' && handoffMutationState.data
      ? `已结单 handoff draft #${handoffMutationState.data.draftId} (${handoffMutationState.data.status})`
      : handoffMutationState.status === 'error'
        ? `browser handoff 结单失败：${handoffMutationState.error}`
        : null;
  const inboxReplyHandoffFeedback =
    inboxReplyHandoffMutationState.status === 'success' && inboxReplyHandoffMutationState.data
      ? `已结单 inbox reply item #${inboxReplyHandoffMutationState.data.itemId} (${inboxReplyHandoffMutationState.data.status})`
      : inboxReplyHandoffMutationState.status === 'error'
        ? `inbox reply handoff 结单失败：${inboxReplyHandoffMutationState.error}`
        : null;
  const isQueueMutationPending = queueMutationPendingRef.current || displayMutationState.status === 'loading';
  const isBrowserHandoffMutationPending = handoffMutationState.status === 'loading';
  const isInboxReplyHandoffMutationPending = inboxReplyHandoffMutationState.status === 'loading';

  function startQueueMutation(input: QueueMutationInput, onSuccess?: () => void) {
    if (queueMutationPendingRef.current) {
      return;
    }

    queueMutationPendingRef.current = true;
    setActiveMutation(input);
    void mutateQueue(input)
      .then(() => {
        onSuccess?.();
      })
      .catch(() => undefined)
      .finally(() => {
        queueMutationPendingRef.current = false;
      });
  }

  function handleRetry(job: SystemQueueJob) {
    startQueueMutation(
      {
        mode: 'retry',
        jobId: job.id,
      },
      () => {
        reload();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      },
    );
  }

  function handleCancel(job: SystemQueueJob) {
    startQueueMutation(
      {
        mode: 'cancel',
        jobId: job.id,
      },
      () => {
        reload();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      },
    );
  }

  function handleEnqueue() {
    startQueueMutation(
      {
        mode: 'enqueue',
        type: enqueueType,
        payloadJson: enqueuePayloadJson,
        runAt: enqueueRunAt.trim().length > 0 ? enqueueRunAt.trim() : undefined,
      },
      () => {
        reload();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      },
    );
  }

  function handleFocusEnqueueForm() {
    enqueueTypeFieldRef.current?.focus();
  }

  function handleCompleteBrowserHandoff(
    handoff: BrowserHandoffRecord,
    publishStatus: 'published' | 'failed',
  ) {
    if (isBrowserHandoffMutationPending) {
      return;
    }

    const handoffDraft = browserHandoffDraftByArtifactPath[handoff.artifactPath];
    const message =
      handoffDraft?.message.trim().length
        ? handoffDraft.message.trim()
        : undefined;
    const publishUrl =
      handoffDraft?.publishUrl.trim().length
        ? handoffDraft.publishUrl.trim()
        : undefined;

    setActiveBrowserHandoffArtifactPath(handoff.artifactPath);
    void runBrowserHandoffCompletion({
      artifactPath: handoff.artifactPath,
      publishStatus,
      ...(message ? { message } : {}),
      ...(publishUrl ? { publishUrl } : {}),
    })
      .then(() => {
        setBrowserHandoffDraftByArtifactPath((current) => {
          const { [handoff.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadBrowserHandoffs();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveBrowserHandoffArtifactPath(null);
      });
  }

  function handleCompleteInboxReplyHandoff(
    handoff: InboxReplyHandoffRecord,
    replyStatus: 'sent' | 'failed',
  ) {
    if (isInboxReplyHandoffMutationPending) {
      return;
    }

    const handoffDraft = inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath];
    const message = handoffDraft?.message.trim().length ? handoffDraft.message.trim() : undefined;
    const deliveryUrl =
      handoffDraft?.deliveryUrl.trim().length ? handoffDraft.deliveryUrl.trim() : undefined;

    setActiveInboxReplyHandoffArtifactPath(handoff.artifactPath);
    void runInboxReplyHandoffCompletion({
      artifactPath: handoff.artifactPath,
      replyStatus,
      ...(message ? { message } : {}),
      ...(deliveryUrl ? { deliveryUrl } : {}),
    })
      .then(() => {
        setInboxReplyHandoffDraftByArtifactPath((current) => {
          const { [handoff.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadInboxReplyHandoffs();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveInboxReplyHandoffArtifactPath(null);
      });
  }

  return (
    <section>
      <PageHeader
        eyebrow="Queue Control"
        title="System Queue"
        description="集中查看 scheduler 作业、失败项、待执行队列，并支持手动重试、取消和入队。"
        actions={
          <>
            <ActionButton
              label="刷新队列"
              onClick={() => {
                reload();
                reloadBrowserLane();
                reloadBrowserHandoffs();
                reloadInboxReplyHandoffs();
              }}
            />
            <ActionButton label="前往创建表单" tone="primary" onClick={handleFocusEnqueueForm} />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载 system queue...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>system queue 加载失败：{displayState.error}</p> : null}
      {mutationFeedback ? (
        <p style={{ color: displayMutationState.status === 'error' ? '#b91c1c' : '#166534', fontWeight: 700 }}>
          {mutationFeedback}
        </p>
      ) : null}
      {browserHandoffFeedback ? (
        <p style={{ color: handoffMutationState.status === 'error' ? '#b91c1c' : '#166534', fontWeight: 700 }}>
          {browserHandoffFeedback}
        </p>
      ) : null}
      {inboxReplyHandoffFeedback ? (
        <p
          style={{
            color: inboxReplyHandoffMutationState.status === 'error' ? '#b91c1c' : '#166534',
            fontWeight: 700,
          }}
        >
          {inboxReplyHandoffFeedback}
        </p>
      ) : null}

      {hasLiveQueueData || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="Pending Jobs" value={String(queueStats.pending)} detail="等待 scheduler 执行的任务数量" />
            <StatCard label="Running Jobs" value={String(queueStats.running)} detail="当前正在运行的任务数量" />
            <StatCard label="Done Jobs" value={String(queueStats.done)} detail="已经执行完成的任务数量" />
            <StatCard label="Failed Jobs" value={String(queueStats.failed)} detail="需要人工重试或排查的失败任务" />
            <StatCard label="Canceled Jobs" value={String(queueStats.canceled)} detail="被人工或系统取消的任务数量" />
            <StatCard label="Due Pending" value={String(queueStats.duePending)} detail="已到执行时间但尚未消费的任务数量" />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(340px, 1.1fr)' }}>
            <SectionCard title="创建作业" description="直接向 `/api/system/jobs` 提交新的抓取或发布类作业。">
              <div style={{ display: 'grid', gap: '12px' }}>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>作业类型</span>
                  <input
                    ref={enqueueTypeFieldRef}
                    data-system-queue-field="type"
                    value={enqueueType}
                    onChange={(event) => setEnqueueType(event.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>runAt</span>
                  <input
                    data-system-queue-field="runAt"
                    value={enqueueRunAt}
                    onChange={(event) => setEnqueueRunAt(event.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>payload JSON</span>
                  <textarea
                    data-system-queue-field="payload"
                    value={enqueuePayloadJson}
                    onChange={(event) => setEnqueuePayloadJson(event.target.value)}
                    placeholder='例如 {"source":"rss"}'
                    style={{
                      ...fieldStyle,
                      minHeight: '120px',
                      resize: 'vertical',
                    }}
                  />
                </label>
                <ActionButton
                  label={
                    isQueueMutationPending && activeMutation?.mode === 'enqueue'
                      ? '正在创建作业...'
                      : '创建作业'
                  }
                  tone="primary"
                  disabled={isQueueMutationPending}
                  onClick={handleEnqueue}
                />
              </div>
            </SectionCard>

            <SectionCard title="队列作业" description="这里优先展示当前 jobs 列表，并暴露 retry/cancel。">
              <div style={{ display: 'grid', gap: '12px' }}>
                {viewData.jobs.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>当前没有 system jobs。</p>
                ) : (
                  viewData.jobs.map((job) => (
                    <article
                      key={job.id}
                      style={{
                        borderRadius: '16px',
                        border: '1px solid #dbe4f0',
                        background: '#f8fafc',
                        padding: '18px',
                        display: 'grid',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700 }}>
                          #{job.id} · {job.type}
                        </div>
                        <div style={{ color: '#475569' }}>{job.status}</div>
                      </div>
                      <div style={{ color: '#475569' }}>runAt: {job.runAt}</div>
                      <div style={{ color: '#475569' }}>attempts: {job.attempts}</div>
                      {job.lastError ? <div style={{ color: '#b91c1c' }}>lastError: {job.lastError}</div> : null}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {job.canRetry ? (
                          <ActionButton
                            label={
                              isQueueMutationPending &&
                              activeMutation?.mode === 'retry' &&
                              activeMutation.jobId === job.id
                                ? '正在重试...'
                                : '重试'
                            }
                            disabled={isQueueMutationPending}
                            onClick={() => handleRetry(job)}
                          />
                        ) : null}
                        {job.canCancel ? (
                          <ActionButton
                            label={
                              isQueueMutationPending &&
                              activeMutation?.mode === 'cancel' &&
                              activeMutation.jobId === job.id
                                ? '正在取消...'
                                : '取消'
                            }
                            disabled={isQueueMutationPending}
                            onClick={() => handleCancel(job)}
                          />
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Browser Lane 工单" description="集中展示最近的 browser lane request artifact，便于人工接管或外部 lane 消费。">
            {displayBrowserLaneState.status === 'loading' ? (
              <p style={{ margin: 0, color: '#475569' }}>正在加载 browser lane requests...</p>
            ) : null}
            {displayBrowserLaneState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>
                browser lane requests 加载失败：{displayBrowserLaneState.error}
              </p>
            ) : null}
            {hasLiveBrowserLaneData && visibleBrowserLaneRequests.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>当前没有 browser lane requests。</p>
            ) : null}
            {hasLiveBrowserLaneData && visibleBrowserLaneRequests.length > 0 ? (
              <div style={{ display: 'grid', gap: '12px' }}>
                {visibleBrowserLaneRequests.map((request) => (
                  <article
                    key={`${request.channelAccountId}-${request.artifactPath}-${request.requestedAt}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '18px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      #{request.channelAccountId} · {request.platform} · {request.action} · {request.jobStatus}
                    </div>
                    <div style={{ color: '#475569' }}>accountKey: {request.accountKey}</div>
                    <div style={{ color: '#475569' }}>requestedAt: {request.requestedAt}</div>
                    <div style={{ color: '#475569' }}>artifactPath: {request.artifactPath}</div>
                    <div style={{ color: '#475569' }}>
                      resolvedAt: {request.resolvedAt ?? '未结单'}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Browser Handoff 工单" description="集中展示 browser manual handoff artifact 的最新状态，区分待处理、已完成和已作废。">
            {displayBrowserHandoffState.status === 'loading' ? (
              <p style={{ margin: 0, color: '#475569' }}>正在加载 browser handoffs...</p>
            ) : null}
            {displayBrowserHandoffState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>
                browser handoffs 加载失败：{displayBrowserHandoffState.error}
              </p>
            ) : null}
            {hasLiveBrowserHandoffData && visibleBrowserHandoffs.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>当前没有 browser handoffs。</p>
            ) : null}
            {hasLiveBrowserHandoffData && visibleBrowserHandoffs.length > 0 ? (
              <div style={{ display: 'grid', gap: '12px' }}>
                {visibleBrowserHandoffs.map((handoff) => (
                  <article
                    key={`${handoff.artifactPath}-${handoff.updatedAt}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '18px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {handoff.platform} · draft #{handoff.draftId} · {handoff.status}
                    </div>
                    {typeof handoff.channelAccountId === 'number' ? (
                      <div style={{ color: '#475569' }}>account #{handoff.channelAccountId}</div>
                    ) : null}
                    {handoff.accountDisplayName ? (
                      <div style={{ color: '#475569' }}>account: {handoff.accountDisplayName}</div>
                    ) : null}
                    {handoff.ownership ? (
                      <div style={{ color: '#475569' }}>ownership: {handoff.ownership}</div>
                    ) : null}
                    <div style={{ color: '#475569' }}>title: {handoff.title ?? '未提供'}</div>
                    <div style={{ color: '#475569' }}>accountKey: {handoff.accountKey}</div>
                    <div style={{ color: '#475569' }}>artifactPath: {handoff.artifactPath}</div>
                    <div style={{ color: '#475569' }}>updatedAt: {handoff.updatedAt}</div>
                    <div style={{ color: '#475569' }}>resolvedAt: {handoff.resolvedAt ?? '未结单'}</div>
                    {readResolutionStatus(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        resolution: {readResolutionStatus(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionDetail(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        resolution detail: {readResolutionDetail(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionPublishUrl(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        publishUrl: {readResolutionPublishUrl(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionMessage(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        message: {readResolutionMessage(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionPublishedAt(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        publishedAt: {readResolutionPublishedAt(handoff.resolution)}
                      </div>
                    ) : null}
                    {handoff.status === 'pending' ? (
                      <div style={{ display: 'grid', gap: '10px' }}>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>发布链接</span>
                          <input
                            data-browser-handoff-field="publishUrl"
                            value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.publishUrl ?? ''}
                            onChange={(event) =>
                              setBrowserHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  publishUrl: event.target.value,
                                  message: current[handoff.artifactPath]?.message ?? '',
                                },
                              }))
                            }
                            placeholder="可选：发布后链接"
                            style={fieldStyle}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>结单备注</span>
                          <input
                            data-browser-handoff-field="message"
                            value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
                            onChange={(event) =>
                              setBrowserHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  publishUrl: current[handoff.artifactPath]?.publishUrl ?? '',
                                  message: event.target.value,
                                },
                              }))
                            }
                            placeholder="可选：覆盖默认结单消息"
                            style={fieldStyle}
                          />
                        </label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <ActionButton
                            label={
                              isBrowserHandoffMutationPending &&
                              activeBrowserHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记已发布...'
                                : '标记已发布'
                            }
                            tone="primary"
                            disabled={isBrowserHandoffMutationPending}
                            onClick={() => handleCompleteBrowserHandoff(handoff, 'published')}
                          />
                          <ActionButton
                            label={
                              isBrowserHandoffMutationPending &&
                              activeBrowserHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记失败...'
                                : '标记失败'
                            }
                            disabled={isBrowserHandoffMutationPending}
                            onClick={() => handleCompleteBrowserHandoff(handoff, 'failed')}
                          />
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Inbox Reply Handoff 工单"
            description="集中展示 inbox reply browser/manual handoff artifact 的最新状态，便于人工回复后回写 sent 或 failed。"
          >
            {displayInboxReplyHandoffState.status === 'loading' ? (
              <p style={{ margin: 0, color: '#475569' }}>正在加载 inbox reply handoffs...</p>
            ) : null}
            {displayInboxReplyHandoffState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>
                inbox reply handoffs 加载失败：{displayInboxReplyHandoffState.error}
              </p>
            ) : null}
            {hasLiveInboxReplyHandoffData && visibleInboxReplyHandoffs.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>当前没有 inbox reply handoffs。</p>
            ) : null}
            {hasLiveInboxReplyHandoffData && visibleInboxReplyHandoffs.length > 0 ? (
              <div style={{ display: 'grid', gap: '12px' }}>
                {visibleInboxReplyHandoffs.map((handoff) => (
                  <article
                    key={`${handoff.artifactPath}-${handoff.updatedAt}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '18px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {handoff.platform} · item #{handoff.itemId} · {handoff.status}
                    </div>
                    {typeof handoff.channelAccountId === 'number' ? (
                      <div style={{ color: '#475569' }}>account #{handoff.channelAccountId}</div>
                    ) : null}
                    <div style={{ color: '#475569' }}>source: {handoff.source}</div>
                    <div style={{ color: '#475569' }}>title: {handoff.title ?? '未提供'}</div>
                    <div style={{ color: '#475569' }}>author: {handoff.author ?? '未提供'}</div>
                    <div style={{ color: '#475569' }}>accountKey: {handoff.accountKey}</div>
                    <div style={{ color: '#475569' }}>artifactPath: {handoff.artifactPath}</div>
                    <div style={{ color: '#475569' }}>updatedAt: {handoff.updatedAt}</div>
                    <div style={{ color: '#475569' }}>resolvedAt: {handoff.resolvedAt ?? '未结单'}</div>
                    {readResolutionStatus(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        resolution: {readResolutionStatus(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionDetail(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        resolution detail: {readResolutionDetail(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionDeliveryUrl(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        deliveryUrl: {readResolutionDeliveryUrl(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionMessage(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        message: {readResolutionMessage(handoff.resolution)}
                      </div>
                    ) : null}
                    {readResolutionDeliveredAt(handoff.resolution) ? (
                      <div style={{ color: '#475569' }}>
                        deliveredAt: {readResolutionDeliveredAt(handoff.resolution)}
                      </div>
                    ) : null}
                    {handoff.status === 'pending' ? (
                      <div style={{ display: 'grid', gap: '10px' }}>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>回复链接</span>
                          <input
                            data-inbox-reply-handoff-field="deliveryUrl"
                            value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.deliveryUrl ?? ''}
                            onChange={(event) =>
                              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  deliveryUrl: event.target.value,
                                  message: current[handoff.artifactPath]?.message ?? '',
                                },
                              }))
                            }
                            placeholder="可选：回复后链接"
                            style={fieldStyle}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>结单备注</span>
                          <input
                            data-inbox-reply-handoff-field="message"
                            value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
                            onChange={(event) =>
                              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  deliveryUrl: current[handoff.artifactPath]?.deliveryUrl ?? '',
                                  message: event.target.value,
                                },
                              }))
                            }
                            placeholder="可选：覆盖默认结单消息"
                            style={fieldStyle}
                          />
                        </label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <ActionButton
                            label={
                              isInboxReplyHandoffMutationPending &&
                              activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记已发送...'
                                : '标记已发送'
                            }
                            tone="primary"
                            disabled={isInboxReplyHandoffMutationPending}
                            onClick={() => handleCompleteInboxReplyHandoff(handoff, 'sent')}
                          />
                          <ActionButton
                            label={
                              isInboxReplyHandoffMutationPending &&
                              activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记失败...'
                                : '标记失败'
                            }
                            disabled={isInboxReplyHandoffMutationPending}
                            onClick={() => handleCompleteInboxReplyHandoff(handoff, 'failed')}
                          />
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="最近作业" description="这里单独展示 `/api/system/jobs` 返回的 recentJobs，避免与当前作业列表混淆。">
            {viewData.recentJobs.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>当前没有 recent jobs。</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {viewData.recentJobs.map((job) => (
                  <article
                    key={`recent-${job.id}-${job.runAt}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '18px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      #{job.id} · {job.type} · {job.status}
                    </div>
                    <div style={{ color: '#475569' }}>runAt: {job.runAt}</div>
                    <div style={{ color: '#475569' }}>attempts: {job.attempts}</div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </section>
  );
}

function readResolutionStatus(value: unknown) {
  return typeof (value as { status?: unknown } | null)?.status === 'string'
    ? ((value as { status: string }).status)
    : null;
}

function readResolutionDetail(value: unknown) {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return typeof record?.reason === 'string'
    ? record.reason
    : typeof record?.publishStatus === 'string'
      ? record.publishStatus
      : typeof record?.replyStatus === 'string'
        ? record.replyStatus
        : typeof record?.draftStatus === 'string'
          ? record.draftStatus
          : typeof record?.itemStatus === 'string'
            ? record.itemStatus
        : null;
}

function readResolutionPublishUrl(value: unknown) {
  return typeof (value as { publishUrl?: unknown } | null)?.publishUrl === 'string'
    ? ((value as { publishUrl: string }).publishUrl)
    : null;
}

function readResolutionMessage(value: unknown) {
  return typeof (value as { message?: unknown } | null)?.message === 'string'
    ? ((value as { message: string }).message)
    : null;
}

function readResolutionDeliveryUrl(value: unknown) {
  return typeof (value as { deliveryUrl?: unknown } | null)?.deliveryUrl === 'string'
    ? ((value as { deliveryUrl: string }).deliveryUrl)
    : null;
}

function readResolutionPublishedAt(value: unknown) {
  return typeof (value as { publishedAt?: unknown } | null)?.publishedAt === 'string'
    ? ((value as { publishedAt: string }).publishedAt)
    : null;
}

function readResolutionDeliveredAt(value: unknown) {
  return typeof (value as { deliveredAt?: unknown } | null)?.deliveredAt === 'string'
    ? ((value as { deliveredAt: string }).deliveredAt)
    : null;
}

function parseEnqueuePayload(value: string | undefined) {
  const normalizedValue = value?.trim() ?? '';
  if (normalizedValue.length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedValue);
  } catch {
    throw new Error('payload JSON 必须是合法的 JSON 对象');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('payload JSON 必须是 JSON 对象');
  }

  return parsed as Record<string, unknown>;
}
