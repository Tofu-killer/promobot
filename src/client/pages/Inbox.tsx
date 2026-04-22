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

export interface EnqueueInboxFetchJobResponse {
  job: {
    id: number;
    type: string;
    status: string;
    runAt: string;
    attempts?: number;
  };
  runtime: Record<string, unknown>;
}

function parseProjectId(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function buildProjectScopedPath(path: string, projectId?: number) {
  return projectId === undefined ? path : `${path}?projectId=${projectId}`;
}

function createProjectIdBody(projectId?: number) {
  return projectId === undefined ? undefined : JSON.stringify({ projectId });
}

function createProjectPayload(projectId?: number) {
  return projectId === undefined ? {} : { projectId };
}

export async function loadInboxRequest(projectId?: number): Promise<InboxResponse> {
  return apiRequest<InboxResponse>(buildProjectScopedPath('/api/inbox', projectId));
}

export async function fetchInboxRequest(projectId?: number): Promise<FetchInboxResponse> {
  return apiRequest<FetchInboxResponse>('/api/inbox/fetch', {
    method: 'POST',
    ...(projectId === undefined
      ? {}
      : {
          headers: {
            'Content-Type': 'application/json',
          },
          body: createProjectIdBody(projectId),
        }),
  });
}

export async function enqueueInboxFetchJobRequest(
  runAt?: string,
  projectId?: number,
): Promise<EnqueueInboxFetchJobResponse> {
  return apiRequest<EnqueueInboxFetchJobResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'inbox_fetch',
      payload: createProjectPayload(projectId),
      ...(runAt ? { runAt } : {}),
    }),
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
  loadInboxAction?: (projectId?: number) => Promise<InboxResponse>;
  fetchInboxAction?: (projectId?: number) => Promise<FetchInboxResponse>;
  enqueueFetchJobAction?: (runAt?: string, projectId?: number) => Promise<EnqueueInboxFetchJobResponse>;
  updateInboxAction?: (id: number, status: string) => Promise<UpdateInboxItemResponse>;
  suggestReplyAction?: (id: number) => Promise<InboxReplySuggestionResponse>;
  stateOverride?: AsyncState<InboxResponse>;
  fetchStateOverride?: AsyncState<FetchInboxResponse>;
  enqueueStateOverride?: AsyncState<EnqueueInboxFetchJobResponse>;
  inboxUpdateStateOverride?: AsyncState<UpdateInboxItemResponse>;
  replySuggestionStateOverride?: AsyncState<InboxReplySuggestionResponse>;
}

interface PlaceholderActionButtonProps {
  label: string;
  hint: string;
  tone?: 'primary' | 'secondary';
}

const feedbackStyle = {
  borderRadius: '16px',
  padding: '14px 16px',
  fontWeight: 600,
} as const;
const queueInputStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;
const placeholderActionNoteStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: '13px',
  lineHeight: 1.5,
} as const;

function PlaceholderActionButton({ label, hint, tone = 'secondary' }: PlaceholderActionButtonProps) {
  const isPrimary = tone === 'primary';

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={hint}
      style={{
        borderRadius: '12px',
        border: isPrimary ? 'none' : '1px solid #cbd5e1',
        background: isPrimary ? '#bfdbfe' : '#e2e8f0',
        color: '#475569',
        padding: '12px 16px',
        fontWeight: 700,
        boxShadow: 'none',
        cursor: 'not-allowed',
        opacity: 0.8,
      }}
    >
      {label}
    </button>
  );
}

export function InboxPage({
  loadInboxAction = loadInboxRequest,
  fetchInboxAction = fetchInboxRequest,
  enqueueFetchJobAction = enqueueInboxFetchJobRequest,
  updateInboxAction = updateInboxItemRequest,
  suggestReplyAction = suggestInboxReplyRequest,
  stateOverride,
  fetchStateOverride,
  enqueueStateOverride,
  inboxUpdateStateOverride,
  replySuggestionStateOverride,
}: InboxPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadInboxAction() : loadInboxAction(projectId)),
    [loadInboxAction, projectId],
  );
  const { state: fetchState, run: runFetchInbox } = useAsyncAction((nextProjectId?: number) =>
    nextProjectId === undefined ? fetchInboxAction() : fetchInboxAction(nextProjectId),
  );
  const { state: enqueueState, run: runEnqueueFetchJob } = useAsyncAction(
    ({ runAt, projectId: nextProjectId }: { runAt?: string; projectId?: number }) =>
      nextProjectId === undefined ? enqueueFetchJobAction(runAt) : enqueueFetchJobAction(runAt, nextProjectId),
  );
  const { state: inboxUpdateState, run: runInboxUpdate } = useAsyncAction(({ id, status }: { id: number; status: string }) =>
    updateInboxAction(id, status),
  );
  const { state: replySuggestionState, run: runReplySuggestion } = useAsyncAction((id: number) => suggestReplyAction(id));
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [replySuggestionItemId, setReplySuggestionItemId] = useState<number | null>(null);
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState('');
  const displayState = stateOverride ?? state;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayEnqueueState = enqueueStateOverride ?? enqueueState;
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
  const hasLiveData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as InboxResponse).items);
  const isPreview = !hasLiveData;
  const viewData = hasLiveData ? (displayState.data as InboxResponse) : fallbackData;
  const updatedInboxItem =
    displayInboxUpdateState.status === 'success' && displayInboxUpdateState.data ? displayInboxUpdateState.data.item : null;
  const displayItems = updatedInboxItem
    ? viewData.items.map((item) => (item.id === updatedInboxItem.id ? updatedInboxItem : item))
    : viewData.items;
  const selectedItem = isPreview ? null : displayItems.find((item) => item.id === selectedItemId) ?? displayItems[0] ?? null;
  const canGenerateReply = !isPreview && selectedItem !== null;
  const activeReplySuggestionItemId = replySuggestionItemId ?? selectedItem?.id ?? null;
  const showReplySuggestionForSelectedItem =
    selectedItem !== null && selectedItem.id === activeReplySuggestionItemId;
  const inboxStatusFeedback =
    displayInboxUpdateState.status === 'success' && displayInboxUpdateState.data
      ? `已将“${displayInboxUpdateState.data.item.title}”回写为 ${displayInboxUpdateState.data.item.status}`
      : displayInboxUpdateState.status === 'error'
        ? `收件箱状态更新失败：${displayInboxUpdateState.error}`
        : null;
  const replyFeedback =
    showReplySuggestionForSelectedItem &&
    displayReplySuggestionState.status === 'success' &&
    displayReplySuggestionState.data
      ? '已生成最新回复建议'
      : showReplySuggestionForSelectedItem && displayReplySuggestionState.status === 'error'
        ? `生成回复失败：${displayReplySuggestionState.error}`
        : null;
  const suggestedReply =
    showReplySuggestionForSelectedItem &&
    displayReplySuggestionState.status === 'success' &&
    displayReplySuggestionState.data
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
    setReplySuggestionItemId(item.id);

    try {
      await runReplySuggestion(item.id);
    } catch {}
  }

  function handleFetchInbox() {
    void runFetchInbox(projectId)
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function handleEnqueueInboxFetch() {
    const runAt = enqueueRunAtDraft.trim().length > 0 ? enqueueRunAtDraft.trim() : undefined;

    void runEnqueueFetchJob({ runAt, projectId })
      .then(() => {
        setEnqueueRunAtDraft('');
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
              label={displayEnqueueState.status === 'loading' ? '正在提交抓取队列...' : '加入队列 / 定时抓取'}
              onClick={handleEnqueueInboxFetch}
            />
            <ActionButton
              label={
                displayReplySuggestionState.status === 'loading' && showReplySuggestionForSelectedItem
                  ? '正在生成回复...'
                  : 'AI 生成回复'
              }
              tone="primary"
              disabled={!canGenerateReply}
              onClick={() => {
                void handleGenerateReply(selectedItem);
              }}
            />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载收件箱...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>收件箱加载失败：{displayState.error}</p> : null}
      {displayState.status === 'idle' ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#fffbeb', color: '#92400e' }}>
          当前展示的是预览数据，真实收件箱加载完成后会自动替换。
        </p>
      ) : null}
      {isPreview ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#fff7ed', color: '#9a3412' }}>
          预览数据不可回写状态或生成回复。
        </p>
      ) : null}
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
      {displayEnqueueState.status === 'success' && displayEnqueueState.data ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#eff6ff', color: '#1d4ed8' }}>
          已将收件箱抓取加入队列，job #{displayEnqueueState.data.job.id}，执行时间 {displayEnqueueState.data.job.runAt}
        </p>
      ) : null}
      {displayEnqueueState.status === 'error' ? (
        <p style={{ ...feedbackStyle, margin: '0 0 16px', background: '#fef2f2', color: '#b91c1c' }}>
          收件箱排程失败：{displayEnqueueState.error}
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

      {hasLiveData || displayState.status === 'idle' ? (
        <>
          <SectionCard title="抓取排程" description="留空会立即加入 system jobs，也可以填写 ISO 时间做定时抓取。">
            <div style={{ display: 'grid', gap: '16px' }}>
              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
                <input
                  value={projectIdDraft}
                  onChange={(event) => setProjectIdDraft(event.target.value)}
                  placeholder="例如 12"
                  style={queueInputStyle}
                />
              </label>

              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>计划抓取时间（可选）</span>
                <input
                  value={enqueueRunAtDraft}
                  onChange={(event) => setEnqueueRunAtDraft(event.target.value)}
                  placeholder="例如 2026-04-20T09:15:00.000Z"
                  style={queueInputStyle}
                />
              </label>
            </div>
          </SectionCard>

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
                      onClick={() => {
                        if (!isPreview) {
                          setSelectedItemId(item.id);
                        }
                      }}
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
                        <PlaceholderActionButton label="打开原帖（人工处理）" hint="原帖跳转暂未接入，请在源站手动打开。" />
                        <ActionButton
                          label={
                            displayInboxUpdateState.status === 'loading' && item.id === selectedItemId ? '处理中...' : '标记已处理'
                          }
                          disabled={isPreview}
                          onClick={() => {
                            void handleInboxStatus(item, 'handled');
                          }}
                        />
                        <ActionButton
                          label={
                            displayInboxUpdateState.status === 'loading' && item.id === selectedItemId ? '处理中...' : '稍后处理'
                          }
                          disabled={isPreview}
                          onClick={() => {
                            void handleInboxStatus(item, 'snoozed');
                          }}
                        />
                      </div>
                      <p style={{ ...placeholderActionNoteStyle, marginTop: '10px' }}>原帖跳转暂未接入，请在源站手动打开。</p>
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
                  {displayReplySuggestionState.status === 'loading' && showReplySuggestionForSelectedItem
                    ? '正在生成回复建议...'
                    : suggestedReply ??
                      (isPreview
                        ? '预览数据不可生成回复。'
                        : selectedItem
                          ? '点击“AI 生成回复”后，这里会展示最新的 AI 草稿。'
                          : '收件箱为空，暂无可生成回复的会话。')}
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <PlaceholderActionButton
                    label="应用建议（人工复制）"
                    tone="primary"
                    hint="当前仅提供 AI 草稿预览；应用建议和发送回复仍需人工处理。"
                  />
                  <PlaceholderActionButton
                    label="发送回复（暂未接线）"
                    hint="当前仅提供 AI 草稿预览；应用建议和发送回复仍需人工处理。"
                  />
                </div>
                <p style={placeholderActionNoteStyle}>当前仅提供 AI 草稿预览；应用建议和发送回复仍需人工处理。</p>
              </div>
            </SectionCard>
          </div>
        </>
      ) : null}
    </section>
  );
}
