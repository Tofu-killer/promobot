import { useEffect, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import type { DraftRecord, DraftsResponse, PublishDraftResponse, UpdateDraftResponse } from '../lib/drafts';
import { upsertDraftRecord } from '../lib/drafts';

interface ReviewQueuePageProps {
  loadReviewQueueAction?: (projectId?: number) => Promise<DraftsResponse>;
  updateReviewDraftAction?: (id: number, input: { status: 'approved' | 'draft' }) => Promise<UpdateDraftResponse>;
  publishReviewDraftAction?: (id: number) => Promise<PublishDraftResponse>;
  scheduleReviewDraftAction?: (
    id: number,
    input: { scheduledAt: string | null; status: 'scheduled' },
  ) => Promise<UpdateDraftResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
}

interface ReviewActionState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  action: 'review' | 'publish' | 'schedule' | null;
  publishUrl: string | null;
  contractMessage: string | null;
  contractStatus: string | null;
}

function parseProjectId(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function buildReviewQueuePath(projectId?: number) {
  return projectId === undefined ? '/api/drafts?status=review' : `/api/drafts?status=review&projectId=${projectId}`;
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

export async function loadReviewQueueRequest(projectId?: number): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>(buildReviewQueuePath(projectId));
}

export async function updateReviewDraftRequest(
  id: number,
  input: { status: 'approved' | 'draft' },
): Promise<UpdateDraftResponse> {
  return apiRequest<UpdateDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function publishReviewDraftRequest(id: number): Promise<PublishDraftResponse> {
  return apiRequest<PublishDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

export async function scheduleReviewDraftRequest(
  id: number,
  input: { scheduledAt: string | null; status: 'scheduled' },
): Promise<UpdateDraftResponse> {
  return apiRequest<UpdateDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

function createIdleActionState(): ReviewActionState {
  return {
    status: 'idle',
    message: null,
    error: null,
    action: null,
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
  };
}

function getReviewActionState(actionStateById: Record<number, ReviewActionState>, draftId: number) {
  return actionStateById[draftId] ?? createIdleActionState();
}

function formatReviewActionLabel(status: 'approved' | 'draft') {
  return status === 'approved' ? '已通过' : '已退回';
}

function formatReviewActionErrorPrefix(action: ReviewActionState['action']) {
  switch (action) {
    case 'publish':
      return '发布失败';
    case 'schedule':
      return '排程失败';
    default:
      return '审核动作失败';
  }
}

const manualHandoffReviewPlatforms = new Set([
  'facebook-group',
  'facebookGroup',
  'xiaohongshu',
  'weibo',
  'blog',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function formatReviewDraftBadgeLabel(status: DraftRecord['status']) {
  switch (status) {
    case 'scheduled':
      return '已排程';
    case 'approved':
      return '已通过';
    case 'draft':
      return '已退回';
    case 'published':
      return '已发布';
    default:
      return '审核中';
  }
}

function getReviewDraftBadgeStyle(status: DraftRecord['status']) {
  switch (status) {
    case 'scheduled':
      return {
        background: '#dbeafe',
        color: '#1d4ed8',
      };
    case 'approved':
      return {
        background: '#dcfce7',
        color: '#166534',
      };
    case 'draft':
      return {
        background: '#fee2e2',
        color: '#b91c1c',
      };
    case 'published':
      return {
        background: '#dcfce7',
        color: '#047857',
      };
    default:
      return {
        background: '#fef3c7',
        color: '#92400e',
      };
  };
}

function filterReviewQueueDrafts(drafts: DraftRecord[]) {
  return drafts.filter((draft) => draft.status === 'review');
}

function upsertReviewQueueDraft(drafts: DraftRecord[], updatedDraft: DraftRecord) {
  return filterReviewQueueDrafts(upsertDraftRecord(drafts, updatedDraft));
}

function removeReviewQueueDraft(drafts: DraftRecord[], draftId: number) {
  return drafts.filter((draft) => draft.id !== draftId);
}

function formatReviewDraftDestination(draft: DraftRecord, scheduledAtValue: string) {
  switch (draft.status) {
    case 'scheduled':
      return scheduledAtValue.length > 0
        ? '当前去向：已推入 Publish Calendar，等待发布窗口。'
        : '当前去向：待补排程，尚未进入 Publish Calendar。';
    case 'published':
      return '当前去向：已完成发布。';
    case 'approved':
      return '当前去向：已通过审核，等待后续流转。';
    case 'draft':
      return '当前去向：已退回草稿池，等待修改。';
    default:
      return '当前去向：仍在审核队列，尚未推入 Publish Calendar。';
  }
}

function formatPublishContractStatus(draft: DraftRecord, actionState: ReviewActionState) {
  if (actionState.action === 'publish') {
    if (actionState.status === 'loading') {
      return '处理中';
    }

    if (actionState.status === 'success') {
      if (actionState.contractStatus === 'queued') {
        return '已入队';
      }
      if (actionState.contractStatus === 'manual_required') {
        return '人工接管';
      }
      return '已确认';
    }

    if (actionState.status === 'error') {
      return '失败';
    }
  }

  if (draft.status === 'published') {
    return '已发布';
  }

  return '待触发';
}

function formatPublishActionSummaryStatus(actionState: ReviewActionState) {
  if (actionState.contractStatus === 'queued') {
    return '已入队';
  }

  if (actionState.contractStatus === 'manual_required') {
    return '人工接管';
  }

  return '已确认';
}

function getReviewDraftPublishContract(draft: DraftRecord, actionState: ReviewActionState) {
  const draftRecord = asRecord(draft);

  return {
    publishUrl:
      actionState.action === 'publish'
        ? actionState.publishUrl ?? readString(draftRecord?.publishUrl) ?? readString(draftRecord?.lastPublishUrl)
        : readString(draftRecord?.publishUrl) ?? readString(draftRecord?.lastPublishUrl),
    contractMessage:
      actionState.action === 'publish'
        ? actionState.contractMessage ??
          readString(draftRecord?.publishMessage) ??
          readString(draftRecord?.lastPublishMessage) ??
          readString(draftRecord?.message)
        : readString(draftRecord?.publishMessage) ??
          readString(draftRecord?.lastPublishMessage) ??
          readString(draftRecord?.message),
    publishError:
      actionState.action === 'publish'
        ? actionState.error ?? readString(draftRecord?.publishError) ?? readString(draftRecord?.lastPublishError)
        : readString(draftRecord?.publishError) ?? readString(draftRecord?.lastPublishError),
  };
}

export function ReviewQueuePage({
  loadReviewQueueAction = loadReviewQueueRequest,
  updateReviewDraftAction = updateReviewDraftRequest,
  publishReviewDraftAction = publishReviewDraftRequest,
  scheduleReviewDraftAction = scheduleReviewDraftRequest,
  stateOverride,
}: ReviewQueuePageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadReviewQueueAction() : loadReviewQueueAction(projectId)),
    [loadReviewQueueAction, projectId],
  );
  const [localDrafts, setLocalDrafts] = useState<DraftRecord[] | null>(null);
  const [scheduledAtById, setScheduledAtById] = useState<Record<number, string>>({});
  const [actionStateById, setActionStateById] = useState<Record<number, ReviewActionState>>({});
  const displayState = stateOverride ?? state;
  const loadedReviewDrafts =
    displayState.status === 'success' && displayState.data ? filterReviewQueueDrafts(displayState.data.drafts) : [];

  const visibleDrafts = displayState.status === 'success' ? (localDrafts ?? loadedReviewDrafts) : [];

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setLocalDrafts(filterReviewQueueDrafts(displayState.data.drafts));
    setScheduledAtById((currentScheduleById) => {
      const nextScheduleById = { ...currentScheduleById };

      for (const draft of filterReviewQueueDrafts(displayState.data.drafts)) {
        if (!(draft.id in nextScheduleById)) {
          nextScheduleById[draft.id] = draft.scheduledAt ?? '';
        }
      }

      return nextScheduleById;
    });
  }, [displayState]);

  async function handleReviewDraft(draftId: number, nextStatus: 'approved' | 'draft') {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ?? displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    setActionStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        action: 'review',
        publishUrl: null,
        contractMessage: null,
        contractStatus: null,
      },
    }));

    try {
      const result = await updateReviewDraftAction(draftId, { status: nextStatus });
      setLocalDrafts((currentDrafts) =>
        upsertReviewQueueDraft(currentDrafts ?? visibleDrafts, result.draft),
      );
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: `${formatReviewActionLabel(nextStatus)}：${result.draft.title ?? result.draft.platform}`,
          error: null,
          action: 'review',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
        },
      }));
    } catch (error) {
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          action: 'review',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
        },
      }));
    }
  }

  async function handlePublishDraft(draftId: number) {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ?? displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    setActionStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        action: 'publish',
        publishUrl: null,
        contractMessage: null,
        contractStatus: null,
      },
    }));

    try {
      const result = await publishReviewDraftAction(draftId);
      const publishSucceeded = result.success || result.status === 'manual_required' || result.status === 'queued';
      if (publishSucceeded) {
        setLocalDrafts((currentDrafts) => removeReviewQueueDraft(currentDrafts ?? visibleDrafts, draftId));
      }
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: publishSucceeded ? 'success' : 'error',
          message:
            result.success
              ? `已发布：${sourceDraft.title ?? sourceDraft.platform}`
              : result.status === 'queued'
                ? `已入队等待发布：${sourceDraft.title ?? sourceDraft.platform}`
              : result.status === 'manual_required'
                ? `已转入人工接管：${sourceDraft.title ?? sourceDraft.platform}`
                : null,
          error:
            result.success || result.status === 'manual_required' || result.status === 'queued'
              ? null
              : result.message,
          action: 'publish',
          publishUrl: result.publishUrl,
          contractMessage: result.message,
          contractStatus: result.status ?? null,
        },
      }));
    } catch (error) {
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          action: 'publish',
          publishUrl: null,
          contractMessage: getErrorMessage(error),
          contractStatus: 'failed',
        },
      }));
    }
  }

  async function handleScheduleDraft(draftId: number) {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ?? displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    const scheduledAt = scheduledAtById[draftId] ?? sourceDraft.scheduledAt ?? '';

    setActionStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        action: 'schedule',
        publishUrl: null,
        contractMessage: null,
        contractStatus: null,
      },
    }));

    try {
      const result = await scheduleReviewDraftAction(draftId, {
        scheduledAt,
        status: 'scheduled',
      });
      setLocalDrafts((currentDrafts) =>
        upsertReviewQueueDraft(currentDrafts ?? visibleDrafts, result.draft),
      );
      setScheduledAtById((currentScheduleById) => ({
        ...currentScheduleById,
        [draftId]: result.draft.scheduledAt ?? '',
      }));
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: result.draft.scheduledAt
            ? `已排程：${result.draft.title ?? result.draft.platform}，排程时间：${result.draft.scheduledAt}`
            : `已标记待补排程：${result.draft.title ?? result.draft.platform}`,
          error: null,
          action: 'schedule',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
        },
      }));
    } catch (error) {
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          action: 'schedule',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
        },
      }));
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Review Queue"
        title="Review Queue"
        description="页面直接读取真实 `/api/drafts?status=review` 数据，支持快速通过或退回最小审核动作。"
        actions={<ActionButton label="重新加载" onClick={reload} />}
      />

      <label style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
        <input
          value={projectIdDraft}
          onChange={(event) => setProjectIdDraft(event.target.value)}
          placeholder="例如 12"
          style={projectInputStyle}
        />
      </label>

      <SectionCard title="待审核草稿" description="默认只展示 status=review 的草稿。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载审核队列...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>审核队列加载失败：{displayState.error}</p>
        ) : null}

        {displayState.status === 'success' && displayState.data ? (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ fontWeight: 700 }}>已加载 {visibleDrafts.length} 条待审核草稿</div>

            {visibleDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无待审核草稿</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {visibleDrafts.map((draft) => {
                  const actionState = getReviewActionState(actionStateById, draft.id);
                  const publishContract = getReviewDraftPublishContract(draft, actionState);
                  const scheduledAtValue = scheduledAtById[draft.id] ?? draft.scheduledAt ?? '';
                  const badgeStyle = getReviewDraftBadgeStyle(draft.status);

                  return (
                    <article
                      key={draft.id}
                      style={{
                        borderRadius: '18px',
                        border: '1px solid #dbe4f0',
                        padding: '18px',
                        background: '#f8fafc',
                        display: 'grid',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <strong>{draft.title ?? `${draft.platform} draft #${draft.id}`}</strong>
                        <span
                          style={{
                            borderRadius: '999px',
                            padding: '4px 10px',
                            background: badgeStyle.background,
                            color: badgeStyle.color,
                            fontWeight: 700,
                          }}
                        >
                          {formatReviewDraftBadgeLabel(draft.status)}
                        </span>
                      </div>

                      <div style={{ color: '#475569', lineHeight: 1.5 }}>{draft.content}</div>

                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#64748b', fontSize: '14px' }}>
                        <span>平台：{draft.platform}</span>
                        <span>更新时间：{draft.updatedAt}</span>
                      </div>

                      <div
                        style={{
                          borderRadius: '14px',
                          border: '1px solid #dbe4f0',
                          background: '#ffffff',
                          padding: '12px 14px',
                          display: 'grid',
                          gap: '6px',
                          color: '#334155',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{formatReviewDraftDestination(draft, scheduledAtValue)}</div>
                        <div>计划推送时间：{scheduledAtValue.length > 0 ? scheduledAtValue : '未设置'}</div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-review-approve-id={draft.id}
                          onClick={() => {
                            void handleReviewDraft(draft.id, 'approved');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: 'none',
                            background: '#16a34a',
                            color: '#ffffff',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          通过
                        </button>
                        <button
                          type="button"
                          data-review-reject-id={draft.id}
                          onClick={() => {
                            void handleReviewDraft(draft.id, 'draft');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#122033',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          退回
                        </button>
                        <button
                          type="button"
                          data-review-publish-id={draft.id}
                          onClick={() => {
                            void handlePublishDraft(draft.id);
                          }}
                          style={{
                            borderRadius: '12px',
                            border: 'none',
                            background: '#2563eb',
                            color: '#ffffff',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          {manualHandoffReviewPlatforms.has(draft.platform) ? '转入人工接管' : '立即发布'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          type="datetime-local"
                          data-review-scheduled-at-id={draft.id}
                          value={scheduledAtById[draft.id] ?? draft.scheduledAt ?? ''}
                          onChange={(event) =>
                            setScheduledAtById((currentScheduleById) => ({
                              ...currentScheduleById,
                              [draft.id]: event.target.value,
                            }))
                          }
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#122033',
                            padding: '10px 12px',
                            font: 'inherit',
                          }}
                        />
                        <button
                          type="button"
                          data-review-schedule-id={draft.id}
                          onClick={() => {
                            void handleScheduleDraft(draft.id);
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#122033',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          推入排程
                        </button>
                      </div>

                      <div
                        style={{
                          borderRadius: '14px',
                          border: '1px solid #dbe4f0',
                          background: '#ffffff',
                          padding: '12px 14px',
                          display: 'grid',
                          gap: '6px',
                          color: '#334155',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>Publish contract</div>
                        <div>回执状态：{formatPublishContractStatus(draft, actionState)}</div>
                        <div>发布链接：{publishContract.publishUrl ?? '未返回'}</div>
                        <div>回执消息：{publishContract.contractMessage ?? '待触发发布'}</div>
                        {publishContract.publishError ? <div>最近错误：{publishContract.publishError}</div> : null}
                      </div>

                      {actionState.status === 'loading' ? (
                        <p style={{ margin: 0, color: '#334155' }}>
                          {actionState.action === 'publish'
                            ? '正在发布...'
                            : actionState.action === 'schedule'
                              ? '正在保存排程...'
                              : '正在提交审核动作...'}
                        </p>
                      ) : null}
                      {actionState.status === 'success' && actionState.message ? (
                        <p style={{ margin: 0, color: '#166534', fontWeight: 700 }}>{actionState.message}</p>
                      ) : null}
                      {actionState.status === 'error' && actionState.error ? (
                        <p style={{ margin: 0, color: '#b91c1c', fontWeight: 700 }}>
                          {formatReviewActionErrorPrefix(actionState.action)}：{actionState.error}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}

            {Object.values(actionStateById).some((state) => state.status === 'success') ? (
              <div style={{ display: 'grid', gap: '6px', color: '#166534', fontWeight: 700 }}>
                {Object.values(actionStateById)
                  .filter((state): state is ReviewActionState & { message: string } => state.status === 'success' && Boolean(state.message))
                  .map((state, index) => (
                    <div
                      key={`${index}-${state.message}`}
                      style={{
                        borderRadius: '14px',
                        border: '1px solid #bbf7d0',
                        background: '#f0fdf4',
                        padding: '12px 14px',
                        display: 'grid',
                        gap: '6px',
                      }}
                    >
                      <div>{state.message}</div>
                      {state.action === 'publish' ? (
                        <>
                          <div>回执状态：{formatPublishActionSummaryStatus(state)}</div>
                          <div>发布链接：{state.publishUrl ?? '未返回'}</div>
                          <div>回执消息：{state.contractMessage ?? '待触发发布'}</div>
                        </>
                      ) : null}
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>初始化后会自动加载真实审核队列。</p>
        ) : null}
      </SectionCard>
    </section>
  );
}
