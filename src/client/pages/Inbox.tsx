import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

export interface InboxItem {
  id: number;
  source: string;
  status: string;
  author?: string;
  title: string;
  excerpt: string;
  createdAt: string;
}

export interface InboxResponse {
  items: InboxItem[];
  total: number;
  unread: number;
}

export async function loadInboxRequest(): Promise<InboxResponse> {
  return apiRequest<InboxResponse>('/api/inbox');
}

interface InboxPageProps {
  loadInboxAction?: () => Promise<InboxResponse>;
  stateOverride?: AsyncState<InboxResponse>;
}

export function InboxPage({ loadInboxAction = loadInboxRequest, stateOverride }: InboxPageProps) {
  const { state, reload } = useAsyncQuery(loadInboxAction, [loadInboxAction]);
  const displayState = stateOverride ?? state;
  const fallbackData: InboxResponse = {
    items: [
      {
        id: 1,
        source: 'Reddit',
        status: 'needs_reply',
        author: 'preview-user',
        title: 'Anyone shipping a Claude-compatible endpoint with lower APAC latency?',
        excerpt: 'We need lower APAC latency and predictable pricing.',
        createdAt: 'preview',
      },
    ],
    total: 1,
    unread: 1,
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  return (
    <section>
      <PageHeader
        eyebrow="Response Desk"
        title="Social Inbox"
        description="统一查看命中关键词的帖子、AI 回复建议和人工接管入口，优先处理高价值会话。"
        actions={
          <>
            <ActionButton label="刷新收件箱" onClick={reload} />
            <ActionButton label="AI 生成回复" tone="primary" />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载收件箱...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>收件箱加载失败：{displayState.error}</p> : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="待处理会话" value={String(viewData.total)} detail="跨渠道统一排队视图" />
            <StatCard label="未读命中" value={String(viewData.unread)} detail="等待人工回复或分流的记录" />
            <StatCard
              label="需人工接管"
              value={String(viewData.items.filter((item) => item.status === 'needs_reply').length)}
              detail="高价值或需要人工确认的会话"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
            <SectionCard title="待回复队列" description={`已加载 ${viewData.total} 条收件箱记录`}>
              <div style={{ display: 'grid', gap: '12px' }}>
                {viewData.items.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>暂无命中内容</p>
                ) : (
                  viewData.items.map((item) => (
                    <article
                      key={item.id}
                      style={{
                        borderRadius: '16px',
                        border: '1px solid #dbe4f0',
                        background: '#f8fafc',
                        padding: '18px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{item.title}</div>
                          <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.5 }}>{item.excerpt}</p>
                        </div>
                        <StatusBadge tone="review" label={item.status} />
                      </div>
                      <div style={{ marginTop: '10px', color: '#64748b', fontSize: '13px' }}>
                        {item.source} · {item.author ?? 'unknown'} · {item.createdAt}
                      </div>
                      <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <ActionButton label="打开原帖" />
                        <ActionButton label="标记已处理" />
                        <ActionButton label="稍后处理" />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard title="回复工作台" description="AI 会生成首版草稿，人工可以在发送前再补充事实和语气。">
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>建议回复</div>
                <div
                  style={{
                    borderRadius: '16px',
                    border: '1px solid #dbe4f0',
                    background: '#f8fafc',
                    padding: '16px',
                    color: '#334155',
                    lineHeight: 1.6,
                  }}
                >
                  待和真实回复建议接口打通后，这里会展示 AI 生成的首版草稿。
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <ActionButton label="应用建议" tone="primary" />
                  <ActionButton label="发送回复" />
                </div>
              </div>
            </SectionCard>
          </div>
        </>
      ) : null}
    </section>
  );
}
