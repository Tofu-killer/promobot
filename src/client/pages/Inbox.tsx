import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
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

export interface FetchInboxResponse extends InboxResponse {
  inserted: number;
}

export async function loadInboxRequest(): Promise<InboxResponse> {
  return apiRequest<InboxResponse>('/api/inbox');
}

export async function fetchInboxRequest(): Promise<FetchInboxResponse> {
  return apiRequest<FetchInboxResponse>('/api/inbox/fetch', {
    method: 'POST',
  });
}

export interface UpdateInboxItemResponse {
  item: InboxItem;
}

export async function updateInboxItemRequest(id: number, status: string): Promise<UpdateInboxItemResponse> {
  return apiRequest<UpdateInboxItemResponse>(`/api/inbox/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
}

export interface InboxReplySuggestionResponse {
  suggestion: {
    reply: string;
  };
}

export async function suggestInboxReplyRequest(id: number): Promise<InboxReplySuggestionResponse> {
  return apiRequest<InboxReplySuggestionResponse>(`/api/inbox/${id}/suggest-reply`, {
    method: 'POST',
  });
}

interface InboxPageProps {
  loadInboxAction?: () => Promise<InboxResponse>;
  fetchInboxAction?: () => Promise<FetchInboxResponse>;
  updateInboxAction?: (id: number, status: string) => Promise<UpdateInboxItemResponse>;
  suggestReplyAction?: (id: number) => Promise<InboxReplySuggestionResponse>;
  stateOverride?: AsyncState<InboxResponse>;
  fetchStateOverride?: AsyncState<FetchInboxResponse>;
  inboxUpdateStateOverride?: AsyncState<UpdateInboxItemResponse>;
  replySuggestionStateOverride?: AsyncState<InboxReplySuggestionResponse>;
}

const feedbackStyle = {
  borderRadius: '16px',
  padding: '14px 16px',
  fontWeight: 600,
} as const;

export function InboxPage({
  loadInboxAction = loadInboxRequest,
  fetchInboxAction = fetchInboxRequest,
  updateInboxAction = updateInboxItemRequest,
  suggestReplyAction = suggestInboxReplyRequest,
  stateOverride,
  fetchStateOverride,
  inboxUpdateStateOverride,
  replySuggestionStateOverride,
}: InboxPageProps) {
  const { state, reload } = useAsyncQuery(loadInboxAction, [loadInboxAction]);
  const { state: fetchState, run: runFetchInbox } = useAsyncAction(fetchInboxAction);
  const { state: inboxUpdateState, run: runInboxUpdate } = useAsyncAction(({ id, status }: { id: number; status: string }) =>
    updateInboxAction(id, status),
  );
  const { state: replySuggestionState, run: runReplySuggestion } = useAsyncAction((id: number) => suggestReplyAction(id));
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const displayState = stateOverride ?? state;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayInboxUpdateState = inboxUpdateStateOverride ?? inboxUpdateState;
  const displayReplySuggestionState = replySuggestionStateOverride ?? replySuggestionState;
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
  const updatedInboxItem =
    displayInboxUpdateState.status === 'success' && displayInboxUpdateState.data ? displayInboxUpdateState.data.item : null;
  const displayItems = updatedInboxItem
    ? viewData.items.map((item) => (item.id === updatedInboxItem.id ? updatedInboxItem : item))
    : viewData.items;
  const selectedItem = displayItems.find((item) => item.id === selectedItemId) ?? displayItems[0] ?? null;
  const inboxStatusFeedback =
    displayInboxUpdateState.status === 'success' && displayInboxUpdateState.data
      ? `已将“${displayInboxUpdateState.data.item.title}”回写为 ${displayInboxUpdateState.data.item.status}`
      : displayInboxUpdateState.status === 'error'
        ? `收件箱状态更新失败：${displayInboxUpdateState.error}`
        : null;
  const replyFeedback =
    displayReplySuggestionState.status === 'success' && displayReplySuggestionState.data
      ? '已生成最新回复建议'
      : displayReplySuggestionState.status === 'error'
        ? `生成回复失败：${displayReplySuggestionState.error}`
        : null;
  const suggestedReply =
    displayReplySuggestionState.status === 'success' && displayReplySuggestionState.data
      ? displayReplySuggestionState.data.suggestion.reply
      : null;

  async function handleInboxStatus(item: InboxItem, status: 'handled' | 'snoozed') {
    setSelectedItemId(item.id);

    try {
      await runInboxUpdate({ id: item.id, status });
      reload();
    } catch {}
  }

  async function handleGenerateReply(item: InboxItem | null) {
    if (!item) {
      return;
    }

    setSelectedItemId(item.id);

    try {
      await runReplySuggestion(item.id);
    } catch {}
  }

  function handleFetchInbox() {
    void runFetchInbox()
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Response Desk"
        title="Social Inbox"
        description="统一查看命中关键词的帖子、AI 回复建议和人工接管入口，优先处理高价值会话。"
        actions={
          <>
            <ActionButton label="刷新收件箱" onClick={reload} />
            <ActionButton
              label={displayFetchState.status === 'loading' ? '正在抓取收件箱...' : '抓取新命中'}
              onClick={handleFetchInbox}
            />
            <ActionButton
              label={displayReplySuggestionState.status === 'loading' ? '正在生成回复...' : 'AI 生成回复'}
              tone="primary"
              onClick={() => {
                void handleGenerateReply(selectedItem);
              }}
            />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载收件箱...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>收件箱加载失败：{displayState.error}</p> : null}
      {displayFetchState.status === 'success' && displayFetchState.data ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#eff6ff', color: '#1d4ed8' }}>
          已抓取 {displayFetchState.data.inserted} 条收件箱命中，未读 {displayFetchState.data.unread}
        </p>
      ) : null}
      {displayFetchState.status === 'error' ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#fef2f2', color: '#b91c1c' }}>
          收件箱抓取失败：{displayFetchState.error}
        </p>
      ) : null}
      {inboxStatusFeedback ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#ecfdf5', color: '#166534' }}>{inboxStatusFeedback}</p>
      ) : null}
      {replyFeedback ? (
        <p
          style={{
            ...feedbackStyle,
            margin: '0 0 16px',
            background: displayReplySuggestionState.status === 'error' ? '#fef2f2' : '#eff6ff',
            color: displayReplySuggestionState.status === 'error' ? '#b91c1c' : '#1d4ed8',
          }}
        >
          {replyFeedback}
        </p>
      ) : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="待处理会话" value={String(viewData.total)} detail="跨渠道统一排队视图" />
            <StatCard label="未读命中" value={String(viewData.unread)} detail="等待人工回复或分流的记录" />
            <StatCard
              label="需人工接管"
              value={String(displayItems.filter((item) => item.status === 'needs_reply').length)}
              detail="高价值或需要人工确认的会话"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
            <SectionCard title="待回复队列" description={`已加载 ${viewData.total} 条收件箱记录`}>
              <div style={{ display: 'grid', gap: '12px' }}>
                {displayItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>暂无命中内容</p>
                ) : (
                  displayItems.map((item) => (
                    <article
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      style={{
                        borderRadius: '16px',
                        border: item.id === selectedItem?.id ? '1px solid #93c5fd' : '1px solid #dbe4f0',
                        background: item.id === selectedItem?.id ? '#eff6ff' : '#f8fafc',
                        padding: '18px',
                        cursor: 'pointer',
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
                        <ActionButton
                          label={
                            displayInboxUpdateState.status === 'loading' && item.id === selectedItemId ? '处理中...' : '标记已处理'
                          }
                          onClick={() => {
                            void handleInboxStatus(item, 'handled');
                          }}
                        />
                        <ActionButton
                          label={
                            displayInboxUpdateState.status === 'loading' && item.id === selectedItemId ? '处理中...' : '稍后处理'
                          }
                          onClick={() => {
                            void handleInboxStatus(item, 'snoozed');
                          }}
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard title="回复工作台" description="AI 会生成首版草稿，人工可以在发送前再补充事实和语气。">
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ color: '#475569', lineHeight: 1.5 }}>
                  {selectedItem ? `当前会话：${selectedItem.source} · ${selectedItem.author ?? 'unknown'}` : '暂无可生成回复的会话'}
                </div>
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
                  {displayReplySuggestionState.status === 'loading'
                    ? '正在生成回复建议...'
                    : suggestedReply ?? '点击“AI 生成回复”后，这里会展示最新的 AI 草稿。'}
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
