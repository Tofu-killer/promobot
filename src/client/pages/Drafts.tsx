import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
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

export async function loadDraftsRequest(): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>('/api/drafts');
}

interface DraftsPageProps {
  loadDraftsAction?: () => Promise<DraftsResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
}

export function DraftsPage({ loadDraftsAction = loadDraftsRequest, stateOverride }: DraftsPageProps) {
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
                <article
                  key={draft.id}
                  style={{
                    borderRadius: '16px',
                    border: '1px solid #dbe4f0',
                    background: '#f8fafc',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <strong>{draft.title ?? `Draft #${draft.id}`}</strong>
                    <span style={{ color: '#475569' }}>{draft.status}</span>
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '13px', color: '#2563eb', textTransform: 'uppercase' }}>
                    {draft.platform}
                  </div>
                  <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.5 }}>{draft.content}</p>
                </article>
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
