import { useEffect, useState } from 'react';
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
  loadDraftsAction?: (projectId?: number) => Promise<DraftsResponse>;
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

function parseProjectId(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function buildPublishCalendarPath(projectId?: number) {
  return projectId === undefined ? '/api/drafts' : `/api/drafts?projectId=${projectId}`;
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

export async function loadPublishCalendarRequest(projectId?: number): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>(buildPublishCalendarPath(projectId));
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

function formatCalendarPhaseLabel(draft: DraftRecord, scheduledAt: string) {
  if (draft.status === 'published') {
    return '已发布';
  }

  return scheduledAt.length > 0 ? '已排程' : '待补排程';
}

function formatDraftTimestamp(draft: DraftRecord) {
  return draft.updatedAt.length > 0 ? draft.updatedAt : draft.createdAt;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getDraftPublishContract(draft: DraftRecord) {
  const draftRecord = asRecord(draft);

  return {
    publishUrl:
      readString(draftRecord?.publishUrl) ??
      readString(draftRecord?.lastPublishUrl) ??
      readString(draftRecord?.url),
    publishMessage:
      readString(draftRecord?.publishMessage) ??
      readString(draftRecord?.lastPublishMessage) ??
      readString(draftRecord?.message),
    publishError: readString(draftRecord?.lastPublishError) ?? readString(draftRecord?.publishError),
  };
}

function formatCalendarDraftStateDescription(draft: DraftRecord, scheduledAt: string) {
  if (draft.status === 'published') {
    return '当前排程状态：已完成发布。';
  }

  if (scheduledAt.length > 0) {
    return '当前排程状态：已写入 scheduled，等待发布器消费。';
  }

  return '当前排程状态：尚未提供 scheduledAt，保存后才能进入发布窗口。';
}

function createIdleMutationState(): ScheduleMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
  };
}

function normalizeScheduledAtInput(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

function createScheduleSuccessState(scheduledAt: string | null): ScheduleMutationState {
  return {
    status: 'success',
    message: scheduledAt ? '排程已保存' : '排程已清空',
    error: null,
  };
}

function createScheduleErrorState(error: string): ScheduleMutationState {
  return {
    status: 'error',
    message: null,
    error,
  };
}

export function PublishCalendarPage({
  loadDraftsAction = loadPublishCalendarRequest,
  updateDraftScheduleAction = updatePublishCalendarDraftScheduleRequest,
  stateOverride,
}: PublishCalendarPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadDraftsAction() : loadDraftsAction(projectId)),
    [loadDraftsAction, projectId],
  );
  const { run: updateSchedule } = useAsyncAction(
    ({ id, scheduledAt }: { id: number; scheduledAt: string | null }) =>
      updateDraftScheduleAction(id, { scheduledAt }),
  );
  const [draftsById, setDraftsById] = useState<Record<number, DraftRecord>>({});
  const [scheduledAtById, setScheduledAtById] = useState<Record<number, string>>({});
  const [mutationStateById, setMutationStateById] = useState<Record<number, ScheduleMutationState>>({});
  const [calendarFeedback, setCalendarFeedback] = useState<ScheduleMutationState>(createIdleMutationState());
  const displayState = stateOverride ?? state;
  const visibleDrafts =
    displayState.status === 'success' && displayState.data
      ? displayState.data.drafts.map((draft) => draftsById[draft.id] ?? draft)
      : [];
  const calendarDrafts = visibleDrafts.filter((draft) => isCalendarDraftStatus(draft.status));

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setDraftsById(
      Object.fromEntries(displayState.data.drafts.map((draft) => [draft.id, draft])) as Record<number, DraftRecord>,
    );
    setScheduledAtById(
      Object.fromEntries(displayState.data.drafts.map((draft) => [draft.id, draft.scheduledAt ?? ''])) as Record<
        number,
        string
      >,
    );
  }, [displayState]);

  useEffect(() => {
    setCalendarFeedback(createIdleMutationState());
    setMutationStateById({});
  }, [projectId]);

  function getScheduledAtValue(draft: DraftRecord) {
    return scheduledAtById[draft.id] ?? draft.scheduledAt ?? '';
  }

  const scheduledDrafts = calendarDrafts.filter(
    (draft) => draft.status === 'scheduled' && getScheduledAtValue(draft).trim().length > 0,
  );
  const pendingScheduleDrafts = calendarDrafts.filter(
    (draft) => draft.status === 'scheduled' && getScheduledAtValue(draft).trim().length === 0,
  );
  const publishedDrafts = calendarDrafts.filter((draft) => draft.status === 'published');

  function getMutationState(draftId: number) {
    return mutationStateById[draftId] ?? createIdleMutationState();
  }

  function updateScheduledAtDraftInput(draftId: number, value: string) {
    setCalendarFeedback(createIdleMutationState());
    setScheduledAtById((current) => ({
      ...current,
      [draftId]: value,
    }));
    setMutationStateById((current) => ({
      ...current,
      [draftId]: createIdleMutationState(),
    }));
  }

  async function handleSaveSchedule(draft: DraftRecord) {
    const scheduledAt = normalizeScheduledAtInput(getScheduledAtValue(draft));
    setCalendarFeedback(createIdleMutationState());
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

      setDraftsById((current) => ({
        ...current,
        [draft.id]: result.draft,
      }));

      setScheduledAtById((current) => ({
        ...current,
        [draft.id]: result.draft.scheduledAt ?? '',
      }));
      setCalendarFeedback(createScheduleSuccessState(result.draft.scheduledAt ?? null));
      setMutationStateById((current) => ({
        ...current,
        [draft.id]: createScheduleSuccessState(result.draft.scheduledAt ?? null),
      }));
    } catch (error) {
      const nextErrorState = createScheduleErrorState(getErrorMessage(error));
      setCalendarFeedback(nextErrorState);
      setMutationStateById((current) => ({
        ...current,
        [draft.id]: nextErrorState,
      }));
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Publish Queue"
        title="Publish Calendar"
        description="当前页是草稿状态视图，不等同于真实 job_queue 或发布执行结果。"
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

      <SectionCard title="发布状态" description="日历视图当前先用真实草稿数据落地排程与已发信息。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载发布日历...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>发布日历加载失败：{displayState.error}</p>
        ) : null}

        {calendarFeedback.status === 'success' && calendarFeedback.message ? (
          <p style={{ margin: 0, color: '#166534', fontWeight: 700 }}>{calendarFeedback.message}</p>
        ) : null}

        {calendarFeedback.status === 'error' && calendarFeedback.error ? (
          <p style={{ margin: 0, color: '#b91c1c', fontWeight: 700 }}>
            排程保存失败：{calendarFeedback.error}
          </p>
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
                  background: '#fef3c7',
                  color: '#92400e',
                  fontWeight: 700,
                }}
              >
                待补排程 {pendingScheduleDrafts.length}
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
                  const publishContract = getDraftPublishContract(draft);

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
                            background:
                              draft.status === 'published'
                                ? '#dcfce7'
                                : scheduledAt.length > 0
                                  ? '#dbeafe'
                                  : '#fef3c7',
                            color:
                              draft.status === 'published'
                                ? '#047857'
                                : scheduledAt.length > 0
                                  ? '#1d4ed8'
                                  : '#92400e',
                            fontWeight: 700,
                          }}
                        >
                          {formatCalendarPhaseLabel(draft, scheduledAt)}
                        </span>
                      </div>

                      <div style={{ color: '#475569', lineHeight: 1.5 }}>{draft.content}</div>

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
                        <div style={{ fontWeight: 700 }}>{formatCalendarDraftStateDescription(draft, scheduledAt)}</div>
                        {draft.status === 'scheduled' ? (
                          <div>计划发布时间：{scheduledAt.length > 0 ? scheduledAt : '未设置'}</div>
                        ) : null}
                        {draft.status === 'published' ? (
                          <div>发布时间：{draft.publishedAt ?? '未返回'}</div>
                        ) : null}
                      </div>

                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#64748b', fontSize: '14px' }}>
                        <span>平台：{draft.platform}</span>
                        <span>更新时间：{formatDraftTimestamp(draft)}</span>
                        {draft.status === 'published' && draft.publishedAt ? <span>发布时间：{draft.publishedAt}</span> : null}
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
                        <div style={{ fontWeight: 700 }}>发布 contract</div>
                        {draft.status === 'published' || publishContract.publishUrl || publishContract.publishMessage || publishContract.publishError ? (
                          <>
                            <div>发布链接：{publishContract.publishUrl ?? '未返回'}</div>
                            <div>回执消息：{publishContract.publishMessage ?? '等待 contract 字段'}</div>
                            {publishContract.publishError ? <div>最近错误：{publishContract.publishError}</div> : null}
                          </>
                        ) : (
                          <div>排程草稿尚未进入发布回执阶段。</div>
                        )}
                      </div>

                      {draft.status === 'scheduled' ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <label style={{ display: 'grid', gap: '8px' }}>
                            <span style={{ fontWeight: 700 }}>排程时间</span>
                            <input
                              data-calendar-scheduled-at-id={String(draft.id)}
                              value={scheduledAt}
                              onChange={(event) => updateScheduledAtDraftInput(draft.id, event.target.value)}
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
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              data-calendar-clear-id={String(draft.id)}
                              onClick={() => updateScheduledAtDraftInput(draft.id, '')}
                              style={{
                                width: 'fit-content',
                                borderRadius: '12px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                color: '#334155',
                                padding: '10px 14px',
                                fontWeight: 700,
                              }}
                            >
                              清空排程
                            </button>
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
                          </div>
                          {mutationState.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {mutationState.message}
                              {scheduledAt ? `，排程时间：${scheduledAt}` : ''}
                            </div>
                          ) : null}
                          {mutationState.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                              排程保存失败：{mutationState.error}
                              {scheduledAt ? `。待保存时间：${scheduledAt}` : '。待保存操作：清空排程'}
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
