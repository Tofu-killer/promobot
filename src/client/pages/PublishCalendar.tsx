import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { apiRequest } from '../lib/api';
import type { DraftRecord, DraftsResponse } from '../lib/drafts';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';

export type { DraftRecord, DraftsResponse } from '../lib/drafts';

type CalendarDraftStatus = 'scheduled' | 'published';

interface PublishCalendarPageProps {
  loadDraftsAction?: () => Promise<DraftsResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
}

const calendarStatuses: CalendarDraftStatus[] = ['scheduled', 'published'];

export async function loadPublishCalendarRequest(): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>('/api/drafts');
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

export function PublishCalendarPage({
  loadDraftsAction = loadPublishCalendarRequest,
  stateOverride,
}: PublishCalendarPageProps) {
  const { state, reload } = useAsyncQuery(loadDraftsAction, [loadDraftsAction]);
  const displayState = stateOverride ?? state;
  const calendarDrafts =
    displayState.status === 'success' && displayState.data
      ? displayState.data.drafts.filter((draft) => isCalendarDraftStatus(draft.status))
      : [];
  const scheduledDrafts = calendarDrafts.filter((draft) => draft.status === 'scheduled');
  const publishedDrafts = calendarDrafts.filter((draft) => draft.status === 'published');

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
                {calendarDrafts.map((draft) => (
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
                  </article>
                ))}
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
