import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface DraftRecord {
  id: number;
  platform: string;
  title?: string;
  content: string;
  hashtags: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftsResponse {
  drafts: DraftRecord[];
}

export interface UpdateDraftPayload {
  title?: string;
  content?: string;
  status?: string;
}

export interface UpdateDraftResponse {
  draft: DraftRecord;
}

export interface PublishDraftResponse {
  success: boolean;
  publishUrl: string | null;
  message: string;
}

export async function loadDraftsRequest(): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>('/api/drafts');
}

export async function updateDraftRequest(
  id: number,
  input: UpdateDraftPayload,
): Promise<UpdateDraftResponse> {
  return apiRequest<UpdateDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function publishDraftRequest(id: number): Promise<PublishDraftResponse> {
  return apiRequest<PublishDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

type RequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; message?: string }
  | { status: 'error'; error: string };

interface DraftFormValue {
  title: string;
  content: string;
  status: string;
}

export interface DraftInteractionStateOverride {
  formValuesById?: Record<number, DraftFormValue>;
  saveStateById?: Record<number, RequestState>;
  publishStateById?: Record<number, RequestState>;
}

interface DraftsPageProps {
  loadDraftsAction?: () => Promise<DraftsResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
  draftInteractionStateOverride?: DraftInteractionStateOverride;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '12px',
  border: '1px solid #cbd5e1',
  padding: '10px 12px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export function DraftsPage({
  loadDraftsAction = loadDraftsRequest,
  stateOverride,
  draftInteractionStateOverride,
}: DraftsPageProps) {
  const { state, reload } = useAsyncQuery(loadDraftsAction, [loadDraftsAction]);
  const displayState = stateOverride ?? state;

  return (
    <section>
      <PageHeader
        eyebrow="Content Queue"
        title="Drafts"
        description="草稿列表会集中展示不同项目和渠道的候选内容，支持审核、定时和快速发布。"
        actions={<ActionButton label="重新加载" onClick={reload} />}
      />

      <SectionCard title="草稿列表" description="页面加载时直接请求 `/api/drafts`。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载草稿...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>草稿加载失败：{displayState.error}</p>
        ) : null}

        {displayState.status === 'success' && displayState.data ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontWeight: 700 }}>已加载 {displayState.data.drafts.length} 条草稿</div>

            {displayState.data.drafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无草稿</p>
            ) : (
              displayState.data.drafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  interactionOverride={draftInteractionStateOverride}
                />
              ))
            )}
          </div>
        ) : null}

        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>初始化后会自动加载真实草稿列表。</p>
        ) : null}
      </SectionCard>
    </section>
  );
}

function DraftCard({
  draft,
  interactionOverride,
}: {
  draft: DraftRecord;
  interactionOverride?: DraftInteractionStateOverride;
}) {
  const formOverride = interactionOverride?.formValuesById?.[draft.id];
  const [title, setTitle] = useState(formOverride?.title ?? draft.title ?? '');
  const [content, setContent] = useState(formOverride?.content ?? draft.content);
  const [status, setStatus] = useState(formOverride?.status ?? draft.status);
  const saveOverride = interactionOverride?.saveStateById?.[draft.id];
  const publishOverride = interactionOverride?.publishStateById?.[draft.id];
  const { state: saveState, run: saveDraft } = useAsyncAction((payload: UpdateDraftPayload) =>
    updateDraftRequest(draft.id, payload),
  );
  const { state: publishState, run: publishDraft } = useAsyncAction(() => publishDraftRequest(draft.id));

  const displaySaveState = saveOverride ?? saveState;
  const displayPublishState = publishOverride ?? publishState;

  function handleSave() {
    void saveDraft({ title, content, status });
  }

  function handlePublish() {
    void publishDraft(undefined);
  }

  return (
    <article
      style={{
        borderRadius: '16px',
        border: '1px solid #dbe4f0',
        background: '#f8fafc',
        padding: '16px',
        display: 'grid',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <strong>{draft.title ?? `Draft #${draft.id}`}</strong>
        <span style={{ color: '#475569' }}>{draft.status}</span>
      </div>

      <div style={{ fontSize: '13px', color: '#2563eb', textTransform: 'uppercase' }}>{draft.platform}</div>

      <label style={{ display: 'grid', gap: '8px' }}>
        <span style={{ fontWeight: 700 }}>标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} style={fieldStyle} />
      </label>

      <label style={{ display: 'grid', gap: '8px' }}>
        <span style={{ fontWeight: 700 }}>内容</span>
        <textarea
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          style={{ ...fieldStyle, resize: 'vertical' }}
        />
      </label>

      <label style={{ display: 'grid', gap: '8px' }}>
        <span style={{ fontWeight: 700 }}>状态</span>
        <input value={status} onChange={(event) => setStatus(event.target.value)} style={fieldStyle} />
      </label>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <ActionButton
          label={displaySaveState.status === 'loading' ? '正在保存...' : '保存修改'}
          onClick={handleSave}
        />
        <ActionButton
          label={displayPublishState.status === 'loading' ? '正在发布...' : '触发发布'}
          tone="primary"
          onClick={handlePublish}
        />
      </div>

      {displaySaveState.status === 'success' ? (
        <div style={{ color: '#166534' }}>{displaySaveState.message ?? '草稿已保存'}</div>
      ) : null}
      {displaySaveState.status === 'error' ? (
        <div style={{ color: '#b91c1c' }}>{displaySaveState.error}</div>
      ) : null}

      {displayPublishState.status === 'success' ? (
        <div style={{ color: '#166534' }}>{displayPublishState.message ?? '发布成功'}</div>
      ) : null}
      {displayPublishState.status === 'error' ? (
        <div style={{ color: '#b91c1c' }}>{displayPublishState.error}</div>
      ) : null}
    </article>
  );
}
