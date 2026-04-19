import { useEffect, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import type { DraftRecord, DraftsResponse, UpdateDraftResponse } from '../lib/drafts';
import { upsertDraftRecord } from '../lib/drafts';

interface ReviewQueuePageProps {
  loadReviewQueueAction?: () => Promise<DraftsResponse>;
  updateReviewDraftAction?: (id: number, input: { status: 'approved' | 'draft' }) => Promise<UpdateDraftResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
}

interface ReviewActionState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
}

export async function loadReviewQueueRequest(): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>('/api/drafts?status=review');
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

function createIdleActionState(): ReviewActionState {
  return {
    status: 'idle',
    message: null,
    error: null,
  };
}

function getReviewActionState(actionStateById: Record<number, ReviewActionState>, draftId: number) {
  return actionStateById[draftId] ?? createIdleActionState();
}

function formatReviewActionLabel(status: 'approved' | 'draft') {
  return status === 'approved' ? '已通过' : '已退回';
}

export function ReviewQueuePage({
  loadReviewQueueAction = loadReviewQueueRequest,
  updateReviewDraftAction = updateReviewDraftRequest,
  stateOverride,
}: ReviewQueuePageProps) {
  const { state, reload } = useAsyncQuery(loadReviewQueueAction, [loadReviewQueueAction]);
  const [localDrafts, setLocalDrafts] = useState<DraftRecord[]>([]);
  const [actionStateById, setActionStateById] = useState<Record<number, ReviewActionState>>({});
  const displayState = stateOverride ?? state;

  const visibleDrafts =
    displayState.status === 'success' && displayState.data
      ? localDrafts.length > 0
        ? localDrafts
        : displayState.data.drafts
      : [];

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setLocalDrafts(displayState.data.drafts);
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
      },
    }));

    try {
      const result = await updateReviewDraftAction(draftId, { status: nextStatus });
      setLocalDrafts((currentDrafts) =>
        upsertDraftRecord(currentDrafts.length > 0 ? currentDrafts : visibleDrafts, result.draft),
      );
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: `${formatReviewActionLabel(nextStatus)}：${result.draft.title ?? result.draft.platform}`,
          error: null,
        },
      }));
    } catch (error) {
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
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

      <SectionCard title="待审核草稿" description="默认只展示 status=review 的草稿。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载审核队列...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>审核队列加载失败：{displayState.error}</p>
        ) : null}

        {displayState.status === 'success' && displayState.data ? (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ fontWeight: 700 }}>已加载 {displayState.data.drafts.length} 条待审核草稿</div>

            {visibleDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无待审核草稿</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {visibleDrafts.map((draft) => {
                  const actionState = getReviewActionState(actionStateById, draft.id);

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
                            background: '#fef3c7',
                            color: '#92400e',
                            fontWeight: 700,
                          }}
                        >
                          审核中
                        </span>
                      </div>

                      <div style={{ color: '#475569', lineHeight: 1.5 }}>{draft.content}</div>

                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#64748b', fontSize: '14px' }}>
                        <span>平台：{draft.platform}</span>
                        <span>更新时间：{draft.updatedAt}</span>
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
                      </div>

                      {actionState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在提交审核动作...</p> : null}
                      {actionState.status === 'success' && actionState.message ? (
                        <p style={{ margin: 0, color: '#166534', fontWeight: 700 }}>{actionState.message}</p>
                      ) : null}
                      {actionState.status === 'error' && actionState.error ? (
                        <p style={{ margin: 0, color: '#b91c1c', fontWeight: 700 }}>审核动作失败：{actionState.error}</p>
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
                    <div key={`${index}-${state.message}`}>{state.message}</div>
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
