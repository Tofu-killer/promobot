import { useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { DraftRecord, DraftsResponse } from '../lib/drafts';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';

export type { DraftRecord, DraftsResponse } from '../lib/drafts';

type CalendarDraftStatus = 'scheduled' | 'published';

export interface UpdatePublishCalendarDraftScheduleResponse {
  draft: DraftRecord;
}

interface PublishCalendarPageProps {
  loadDraftsAction?: () => Promise<DraftsResponse>;
  updateDraftScheduleAction?: (
    id: number,
    input: { scheduledAt: string | null },
  ) => Promise<UpdatePublishCalendarDraftScheduleResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
}

interface ScheduleMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
}

const calendarStatuses: CalendarDraftStatus[] = ['scheduled', 'published'];

export async function loadPublishCalendarRequest(): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>('/api/drafts');
}

export async function updatePublishCalendarDraftScheduleRequest(
  id: number,
  input: { scheduledAt: string | null },
): Promise<UpdatePublishCalendarDraftScheduleResponse> {
  return apiRequest<UpdatePublishCalendarDraftScheduleResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

function isCalendarDraftStatus(status: DraftRecord['status']): status is CalendarDraftStatus {
  return calendarStatuses.includes(status as CalendarDraftStatus);
}

function formatCalendarStatusLabel(status: CalendarDraftStatus) {
  return status === 'scheduled' ? '已排程' : '已发布';
}

function formatDraftTimestamp(draft: DraftRecord) {
  return draft.updatedAt.length > 0 ? draft.updatedAt : draft.createdAt;
}

function createIdleMutationState(): ScheduleMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
  };
}

export function PublishCalendarPage({
  loadDraftsAction = loadPublishCalendarRequest,
  updateDraftScheduleAction = updatePublishCalendarDraftScheduleRequest,
  stateOverride,
}: PublishCalendarPageProps) {
  const { state, reload } = useAsyncQuery(loadDraftsAction, [loadDraftsAction]);
  const { state: updateState, run: updateSchedule } = useAsyncAction(
    ({ id, scheduledAt }: { id: number; scheduledAt: string | null }) =>
      updateDraftScheduleAction(id, { scheduledAt }),
  );
  const [scheduledAtById, setScheduledAtById] = useState<Record<number, string>>({});
  const [mutationStateById, setMutationStateById] = useState<Record<number, ScheduleMutationState>>({});
  const displayState = stateOverride ?? state;
  const calendarDrafts =
    displayState.status === 'success' && displayState.data
      ? displayState.data.drafts.filter((draft) => isCalendarDraftStatus(draft.status))
      : [];
  const scheduledDrafts = calendarDrafts.filter((draft) => draft.status === 'scheduled');
  const publishedDrafts = calendarDrafts.filter((draft) => draft.status === 'published');

  function getScheduledAtValue(draft: DraftRecord) {
    return scheduledAtById[draft.id] ?? draft.scheduledAt ?? '';
  }

  function getMutationState(draftId: number) {
    return mutationStateById[draftId] ?? createIdleMutationState();
  }

  async function handleSaveSchedule(draft: DraftRecord) {
    const scheduledAt = getScheduledAtValue(draft);
    setMutationStateById((current) => ({
      ...current,
      [draft.id]: {
        status: 'loading',
        message: null,
        error: null,
      },
    }));

    try {
      const result = await updateSchedule({
        id: draft.id,
        scheduledAt,
      });

      setScheduledAtById((current) => ({
        ...current,
        [draft.id]: result.draft.scheduledAt ?? '',
      }));
      setMutationStateById((current) => ({
        ...current,
        [draft.id]: {
          status: 'success',
          message: '排程已保存',
          error: null,
        },
      }));
    } catch (error) {
      setMutationStateById((current) => ({
        ...current,
        [draft.id]: {
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
        eyebrow="Publish Queue"
        title="Publish Calendar"
        description="页面直接读取真实 `/api/drafts` 数据，只聚焦 scheduled 与 published 两类发布状态，方便核对队列与已发结果。"
        actions={<ActionButton label="重新加载" onClick={reload} />}
      />

      <SectionCard title="发布状态" description="日历视图当前先用真实草稿数据落地排程与已发信息。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载发布日历...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>发布日历加载失败：{displayState.error}</p>
        ) : null}

        {displayState.status === 'success' && displayState.data ? (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div
                style={{
                  minWidth: '140px',
                  borderRadius: '16px',
                  padding: '14px 16px',
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  fontWeight: 700,
                }}
              >
                已排程 {scheduledDrafts.length}
              </div>
              <div
                style={{
                  minWidth: '140px',
                  borderRadius: '16px',
                  padding: '14px 16px',
                  background: '#ecfdf5',
                  color: '#047857',
                  fontWeight: 700,
                }}
              >
                已发布 {publishedDrafts.length}
              </div>
            </div>

            {calendarDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无 scheduled 或 published 草稿。</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {calendarDrafts.map((draft) => {
                  const mutationState = getMutationState(draft.id);
                  const scheduledAt = getScheduledAtValue(draft);

                  return (
                    <article
                      key={draft.id}
                      style={{
                        borderRadius: '18px',
                        border: '1px solid #dbe4f0',
                        padding: '18px',
                        background: '#f8fafc',
                        display: 'grid',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <strong>{draft.title ?? `${draft.platform} draft #${draft.id}`}</strong>
                        <span
                          style={{
                            borderRadius: '999px',
                            padding: '4px 10px',
                            background: draft.status === 'scheduled' ? '#dbeafe' : '#dcfce7',
                            color: draft.status === 'scheduled' ? '#1d4ed8' : '#047857',
                            fontWeight: 700,
                          }}
                        >
                          {formatCalendarStatusLabel(draft.status)}
                        </span>
                      </div>

                      <div style={{ color: '#475569', lineHeight: 1.5 }}>{draft.content}</div>

                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#64748b', fontSize: '14px' }}>
                        <span>平台：{draft.platform}</span>
                        <span>更新时间：{formatDraftTimestamp(draft)}</span>
                      </div>

                      {draft.status === 'scheduled' ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <label style={{ display: 'grid', gap: '8px' }}>
                            <span style={{ fontWeight: 700 }}>排程时间</span>
                            <input
                              data-calendar-scheduled-at-id={String(draft.id)}
                              value={scheduledAt}
                              onChange={(event) =>
                                setScheduledAtById((current) => ({
                                  ...current,
                                  [draft.id]: event.target.value,
                                }))
                              }
                              style={{
                                width: '100%',
                                borderRadius: '12px',
                                border: '1px solid #cbd5e1',
                                padding: '10px 12px',
                                font: 'inherit',
                                background: '#ffffff',
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            data-calendar-save-id={String(draft.id)}
                            onClick={() => {
                              void handleSaveSchedule(draft);
                            }}
                            style={{
                              width: 'fit-content',
                              borderRadius: '12px',
                              border: 'none',
                              background: '#2563eb',
                              color: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {mutationState.status === 'loading' ? '正在保存排程...' : '保存排程'}
                          </button>
                          {mutationState.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {mutationState.message}
                              {scheduledAt ? `，排程时间：${scheduledAt}` : ''}
                            </div>
                          ) : null}
                          {mutationState.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                              排程保存失败：{mutationState.error}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>初始化后会自动加载真实 drafts 数据。</p>
        ) : null}
      </SectionCard>
    </section>
  );
}
