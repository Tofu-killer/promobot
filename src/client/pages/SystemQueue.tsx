import { useState } from 'react';
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

export async function loadSystemQueueRequest(limit = 50): Promise<SystemQueueResponse> {
  return apiRequest<SystemQueueResponse>(`/api/system/jobs?limit=${limit}`);
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
  retrySystemQueueJobAction?: (jobId: number, runAt?: string) => Promise<SystemQueueMutationResponse>;
  cancelSystemQueueJobAction?: (jobId: number) => Promise<SystemQueueMutationResponse>;
  enqueueSystemQueueJobAction?: (input: {
    type: string;
    payload?: Record<string, unknown>;
    runAt?: string;
  }) => Promise<SystemQueueMutationResponse>;
  stateOverride?: AsyncState<SystemQueueResponse>;
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

export function SystemQueuePage({
  loadSystemQueueAction = () => loadSystemQueueRequest(50),
  retrySystemQueueJobAction = retrySystemQueueJobRequest,
  cancelSystemQueueJobAction = cancelSystemQueueJobRequest,
  enqueueSystemQueueJobAction = enqueueSystemQueueJobRequest,
  stateOverride,
  mutationStateOverride,
}: SystemQueuePageProps) {
  const { state, reload } = useAsyncQuery(loadSystemQueueAction, [loadSystemQueueAction]);
  const { state: mutationState, run: mutateQueue } = useAsyncAction(
    (input: { mode: 'retry' | 'cancel' | 'enqueue'; jobId?: number; runAt?: string; type?: string }) => {
      if (input.mode === 'retry') {
        return retrySystemQueueJobAction(input.jobId ?? -1, input.runAt);
      }

      if (input.mode === 'cancel') {
        return cancelSystemQueueJobAction(input.jobId ?? -1);
      }

      return enqueueSystemQueueJobAction({
        type: input.type ?? 'monitor_fetch',
        payload: {},
        runAt: input.runAt,
      });
    },
  );
  const displayState = stateOverride ?? state;
  const displayMutationState = mutationStateOverride ?? mutationState;
  const [enqueueType, setEnqueueType] = useState('monitor_fetch');
  const [enqueueRunAt, setEnqueueRunAt] = useState('2026-04-20T09:00');

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
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  const queueStats = {
    pending: viewData.queue.pending ?? 0,
    running: viewData.queue.running ?? 0,
    failed: viewData.queue.failed ?? 0,
    duePending: viewData.queue.duePending ?? 0,
  };

  const mutationFeedback =
    displayMutationState.status === 'success' && displayMutationState.data
      ? `已更新作业 #${displayMutationState.data.job.id} (${displayMutationState.data.job.type})`
      : displayMutationState.status === 'error'
        ? `队列动作失败：${displayMutationState.error}`
        : null;

  function handleRetry(job: SystemQueueJob) {
    void mutateQueue({
      mode: 'retry',
      jobId: job.id,
      runAt: enqueueRunAt.trim().length > 0 ? enqueueRunAt.trim() : undefined,
    })
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleCancel(job: SystemQueueJob) {
    void mutateQueue({
      mode: 'cancel',
      jobId: job.id,
    })
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleEnqueue() {
    void mutateQueue({
      mode: 'enqueue',
      type: enqueueType,
      runAt: enqueueRunAt.trim().length > 0 ? enqueueRunAt.trim() : undefined,
    })
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Queue Control"
        title="System Queue"
        description="集中查看 scheduler 作业、失败项、待执行队列，并支持手动重试、取消和入队。"
        actions={
          <>
            <ActionButton label="刷新队列" onClick={reload} />
            <ActionButton
              label={displayMutationState.status === 'loading' ? '正在提交队列动作...' : '创建作业'}
              tone="primary"
              onClick={handleEnqueue}
            />
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

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="Pending Jobs" value={String(queueStats.pending)} detail="等待 scheduler 执行的任务数量" />
            <StatCard label="Running Jobs" value={String(queueStats.running)} detail="当前正在运行的任务数量" />
            <StatCard label="Failed Jobs" value={String(queueStats.failed)} detail="需要人工重试或排查的失败任务" />
            <StatCard label="Due Pending" value={String(queueStats.duePending)} detail="已到执行时间但尚未消费的任务数量" />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(340px, 1.1fr)' }}>
            <SectionCard title="创建作业" description="直接向 `/api/system/jobs` 提交新的抓取或发布类作业。">
              <div style={{ display: 'grid', gap: '12px' }}>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>作业类型</span>
                  <input
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
                <ActionButton
                  label={displayMutationState.status === 'loading' ? '正在创建作业...' : '创建作业'}
                  tone="primary"
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
                            label={displayMutationState.status === 'loading' ? '正在重试...' : '重试'}
                            onClick={() => handleRetry(job)}
                          />
                        ) : null}
                        {job.canCancel ? (
                          <ActionButton
                            label={displayMutationState.status === 'loading' ? '正在取消...' : '取消'}
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
        </>
      ) : null}
    </section>
  );
}
