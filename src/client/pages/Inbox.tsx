import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { InboxDetail } from '../components/InboxDetail';
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

export interface SendInboxReplyResponse {
  item: InboxItem;
  delivery: {
    status: string;
    mode: string;
    message: string;
    reply: string;
  };
}

export async function sendInboxReplyRequest(id: number, reply: string): Promise<SendInboxReplyResponse> {
  return apiRequest<SendInboxReplyResponse>(`/api/inbox/${id}/send-reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reply }),
  });
}

interface InboxPageProps {
  loadInboxAction?: (projectId?: number) => Promise<InboxResponse>;
  fetchInboxAction?: (projectId?: number) => Promise<FetchInboxResponse>;
  enqueueFetchJobAction?: (runAt?: string, projectId?: number) => Promise<EnqueueInboxFetchJobResponse>;
  updateInboxAction?: (id: number, status: string) => Promise<UpdateInboxItemResponse>;
  suggestReplyAction?: (id: number) => Promise<InboxReplySuggestionResponse>;
  sendReplyAction?: (id: number, reply: string) => Promise<SendInboxReplyResponse>;
  stateOverride?: AsyncState<InboxResponse>;
  fetchStateOverride?: AsyncState<FetchInboxResponse>;
  enqueueStateOverride?: AsyncState<EnqueueInboxFetchJobResponse>;
  inboxUpdateStateOverride?: AsyncState<UpdateInboxItemResponse>;
  replySuggestionStateOverride?: AsyncState<InboxReplySuggestionResponse>;
  sendReplyStateOverride?: AsyncState<SendInboxReplyResponse>;
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

function extractOriginalPostUrl(excerpt: string) {
  const matches = excerpt.match(/https?:\/\/\S+/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const candidate = matches[matches.length - 1]?.trim();
  return candidate && candidate.length > 0 ? candidate : null;
}

function normalizeInboxPlatformFilter(source: string) {
  const normalized = source.trim().toLowerCase();

  if (normalized === 'x / twitter' || normalized === 'twitter') {
    return 'x';
  }

  return normalized;
}

function formatInboxPlatformFilterLabel(filter: string) {
  if (filter === 'all') {
    return '全部平台';
  }

  if (filter === 'x') {
    return 'X';
  }

  if (filter === 'reddit') {
    return 'Reddit';
  }

  if (filter === 'xiaohongshu') {
    return '小红书';
  }

  if (filter === 'weibo') {
    return '微博';
  }

  return filter;
}

function formatInboxStatusFilterLabel(filter: string) {
  if (filter === 'all') {
    return '全部状态';
  }

  if (filter === 'needs_reply') {
    return '需回复';
  }

  if (filter === 'needs_review') {
    return '待复核';
  }

  if (filter === 'handled') {
    return '已处理';
  }

  if (filter === 'snoozed') {
    return '稍后处理';
  }

  return filter;
}

function filterInboxItems(items: InboxItem[], activePlatformFilter: string, activeStatusFilter: string) {
  return items.filter((item) => {
    const matchesPlatform =
      activePlatformFilter === 'all' ||
      normalizeInboxPlatformFilter(item.source) === activePlatformFilter;
    const matchesStatus = activeStatusFilter === 'all' || item.status === activeStatusFilter;

    return matchesPlatform && matchesStatus;
  });
}

export function InboxPage({
  loadInboxAction = loadInboxRequest,
  fetchInboxAction = fetchInboxRequest,
  enqueueFetchJobAction = enqueueInboxFetchJobRequest,
  updateInboxAction = updateInboxItemRequest,
  suggestReplyAction = suggestInboxReplyRequest,
  sendReplyAction = sendInboxReplyRequest,
  stateOverride,
  fetchStateOverride,
  enqueueStateOverride,
  inboxUpdateStateOverride,
  replySuggestionStateOverride,
  sendReplyStateOverride,
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
  const { state: sendReplyState, run: runSendReply } = useAsyncAction(
    ({ id, reply }: { id: number; reply: string }) => sendReplyAction(id, reply),
  );
  const [activePlatformFilter, setActivePlatformFilter] = useState('all');
  const [activeStatusFilter, setActiveStatusFilter] = useState('all');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [inboxMutationItemId, setInboxMutationItemId] = useState<number | null>(null);
  const [replySuggestionItemId, setReplySuggestionItemId] = useState<number | null>(null);
  const [replyDeliveryItemId, setReplyDeliveryItemId] = useState<number | null>(null);
  const [replyDraftByItemId, setReplyDraftByItemId] = useState<Record<number, string>>({});
  const [allowReplySuggestionFallback, setAllowReplySuggestionFallback] = useState(true);
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState('');
  const displayState = stateOverride ?? state;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayEnqueueState = enqueueStateOverride ?? enqueueState;
  const displayInboxUpdateState = inboxUpdateStateOverride ?? inboxUpdateState;
  const displayReplySuggestionState = replySuggestionStateOverride ?? replySuggestionState;
  const displaySendReplyState = sendReplyStateOverride ?? sendReplyState;
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
  const deliveredReplyItem =
    displaySendReplyState.status === 'success' && displaySendReplyState.data ? displaySendReplyState.data.item : null;
  let displayItems = viewData.items;
  if (updatedInboxItem) {
    displayItems = displayItems.map((item) => (item.id === updatedInboxItem.id ? updatedInboxItem : item));
  }
  if (deliveredReplyItem) {
    displayItems = displayItems.map((item) => (item.id === deliveredReplyItem.id ? deliveredReplyItem : item));
  }
  const filteredItems = filterInboxItems(displayItems, activePlatformFilter, activeStatusFilter);
  const selectedItem = isPreview ? null : filteredItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? null;
  const activeInboxMutationItemId = inboxMutationItemId;
  const canGenerateReply = !isPreview && selectedItem !== null;
  const activeReplySuggestionItemId =
    replySuggestionItemId ?? (allowReplySuggestionFallback ? selectedItem?.id ?? null : null);
  const showReplySuggestionForSelectedItem =
    selectedItem !== null && selectedItem.id === activeReplySuggestionItemId;
  const replyDraft = selectedItem ? replyDraftByItemId[selectedItem.id] ?? '' : '';
  const canSendReply = !isPreview && selectedItem !== null && replyDraft.trim().length > 0;

  useEffect(() => {
    setActivePlatformFilter('all');
    setActiveStatusFilter('all');
    setSelectedItemId(null);
    setInboxMutationItemId(null);
    setReplySuggestionItemId(null);
    setReplyDeliveryItemId(null);
    setReplyDraftByItemId({});
    setAllowReplySuggestionFallback(false);
  }, [projectId]);

  const platformFilters = [
    { id: 'all', label: formatInboxPlatformFilterLabel('all') },
    ...Array.from(new Set(displayItems.map((item) => normalizeInboxPlatformFilter(item.source)))).map((filter) => ({
      id: filter,
      label: formatInboxPlatformFilterLabel(filter),
    })),
  ];
  const statusFilters = ['all', 'needs_reply', 'needs_review', 'handled', 'snoozed'].map((filter) => ({
    id: filter,
    label: formatInboxStatusFilterLabel(filter),
  }));

  const inboxStatusFeedback =
    displayInboxUpdateState.status === 'success' && displayInboxUpdateState.data
      ? `已将“${displayInboxUpdateState.data.item.title}”回写为 ${displayInboxUpdateState.data.item.status}`
      : displaySendReplyState.status === 'success' && displaySendReplyState.data
        ? `已将“${displaySendReplyState.data.item.title}”回写为 ${displaySendReplyState.data.item.status}`
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
  const sendReplyFeedback =
    displaySendReplyState.status === 'success' &&
    displaySendReplyState.data &&
    selectedItem !== null &&
    replyDeliveryItemId === selectedItem.id
      ? displaySendReplyState.data.delivery.message
      : displaySendReplyState.status === 'error' &&
          selectedItem !== null &&
          replyDeliveryItemId === selectedItem.id
        ? `发送回复失败：${displaySendReplyState.error}`
        : null;
  const suggestedReply =
    showReplySuggestionForSelectedItem &&
    displayReplySuggestionState.status === 'success' &&
    displayReplySuggestionState.data
      ? displayReplySuggestionState.data.suggestion.reply
      : null;

  async function handleInboxStatus(item: InboxItem, status: 'handled' | 'snoozed') {
    setSelectedItemId(item.id);
    setInboxMutationItemId(item.id);

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
    setAllowReplySuggestionFallback(false);

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

  function handleReplyDraftChange(value: string) {
    if (!selectedItem) {
      return;
    }

    setReplyDraftByItemId((current) => ({
      ...current,
      [selectedItem.id]: value,
    }));
  }

  function handleApplySuggestion() {
    if (!selectedItem || !suggestedReply) {
      return;
    }

    setReplyDraftByItemId((current) => ({
      ...current,
      [selectedItem.id]: suggestedReply,
    }));
  }

  function handleSendReply() {
    if (!selectedItem) {
      return;
    }

    const nextReply = replyDraft.trim();
    if (nextReply.length === 0) {
      return;
    }

    setReplyDeliveryItemId(selectedItem.id);
    void runSendReply({
      id: selectedItem.id,
      reply: nextReply,
    }).catch(() => undefined);
  }

  function handleSelectPlatformFilter(filter: string) {
    const nextFilteredItems = filterInboxItems(displayItems, filter, activeStatusFilter);
    setActivePlatformFilter(filter);
    setSelectedItemId((currentSelectedItemId) =>
      currentSelectedItemId !== null && nextFilteredItems.some((item) => item.id === currentSelectedItemId)
        ? currentSelectedItemId
        : null,
    );
  }

  function handleSelectStatusFilter(filter: string) {
    const nextFilteredItems = filterInboxItems(displayItems, activePlatformFilter, filter);
    setActiveStatusFilter(filter);
    setSelectedItemId((currentSelectedItemId) =>
      currentSelectedItemId !== null && nextFilteredItems.some((item) => item.id === currentSelectedItemId)
        ? currentSelectedItemId
        : null,
    );
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
      {sendReplyFeedback ? (
        <p
          style={{
            ...feedbackStyle,
            margin: '0 0 16px',
            background: displaySendReplyState.status === 'error' ? '#fef2f2' : '#ecfdf5',
            color: displaySendReplyState.status === 'error' ? '#b91c1c' : '#166534',
          }}
        >
          {sendReplyFeedback}
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
            <StatCard label="待处理会话" value={String(filteredItems.length)} detail="跨渠道统一排队视图" />
            <StatCard
              label="未读命中"
              value={String(filteredItems.filter((item) => item.status !== 'handled').length)}
              detail="等待人工回复或分流的记录"
            />
            <StatCard
              label="需人工接管"
              value={String(filteredItems.filter((item) => item.status === 'needs_reply').length)}
              detail="高价值或需要人工确认的会话"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
            <SectionCard title="筛选" description="先按平台和处理状态缩小当前会话范围，再进入回复工作台。">
              <div style={{ display: 'grid', gap: '14px' }}>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>平台筛选</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {platformFilters.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        data-inbox-filter-platform={filter.id}
                        aria-pressed={activePlatformFilter === filter.id ? 'true' : 'false'}
                        onClick={() => handleSelectPlatformFilter(filter.id)}
                        style={{
                          borderRadius: '999px',
                          border: '1px solid #cbd5e1',
                          background: activePlatformFilter === filter.id ? '#dbeafe' : '#ffffff',
                          color: activePlatformFilter === filter.id ? '#1d4ed8' : '#334155',
                          padding: '8px 12px',
                          fontWeight: 700,
                        }}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>状态筛选</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {statusFilters.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        data-inbox-filter-status={filter.id}
                        aria-pressed={activeStatusFilter === filter.id ? 'true' : 'false'}
                        onClick={() => handleSelectStatusFilter(filter.id)}
                        style={{
                          borderRadius: '999px',
                          border: '1px solid #cbd5e1',
                          background: activeStatusFilter === filter.id ? '#dbeafe' : '#ffffff',
                          color: activeStatusFilter === filter.id ? '#1d4ed8' : '#334155',
                          padding: '8px 12px',
                          fontWeight: 700,
                        }}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="待回复队列" description={`当前筛选下 ${filteredItems.length} 条 / 总计 ${displayItems.length} 条收件箱记录`}>
              <div style={{ display: 'grid', gap: '12px' }}>
                {filteredItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>{displayItems.length === 0 ? '暂无命中内容' : '当前筛选下暂无命中内容'}</p>
                ) : (
                  filteredItems.map((item) => (
                    (() => {
                      const originalPostUrl = extractOriginalPostUrl(item.excerpt);

                      return (
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
                            {originalPostUrl ? (
                              <a
                                href={originalPostUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  borderRadius: '12px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  color: '#122033',
                                  padding: '12px 16px',
                                  fontWeight: 700,
                                  textDecoration: 'none',
                                }}
                              >
                                打开原帖
                              </a>
                            ) : (
                              <PlaceholderActionButton label="打开原帖（人工处理）" hint="原帖跳转暂未接入，请在源站手动打开。" />
                            )}
                            <ActionButton
                              label={
                                displayInboxUpdateState.status === 'loading' && item.id === activeInboxMutationItemId
                                  ? '处理中...'
                                  : '标记已处理'
                              }
                              disabled={isPreview}
                              onClick={() => {
                                void handleInboxStatus(item, 'handled');
                              }}
                            />
                            <ActionButton
                              label={
                                displayInboxUpdateState.status === 'loading' && item.id === activeInboxMutationItemId
                                  ? '处理中...'
                                  : '稍后处理'
                              }
                              disabled={isPreview}
                              onClick={() => {
                                void handleInboxStatus(item, 'snoozed');
                              }}
                            />
                          </div>
                          <p style={{ ...placeholderActionNoteStyle, marginTop: '10px' }}>
                            {originalPostUrl ? '检测到原帖链接，可直接打开源站继续处理。' : '原帖跳转暂未接入，请在源站手动打开。'}
                          </p>
                        </article>
                      );
                    })()
                  ))
                )}
              </div>
            </SectionCard>

            <InboxDetail
              isPreview={isPreview}
              selectedItem={selectedItem}
              suggestedReply={suggestedReply}
              replyDraft={replyDraft}
              isGeneratingReply={displayReplySuggestionState.status === 'loading' && showReplySuggestionForSelectedItem}
              isSendingReply={displaySendReplyState.status === 'loading' && replyDeliveryItemId === selectedItem?.id}
              canGenerateReply={canGenerateReply}
              canSendReply={canSendReply}
              onGenerateReply={() => {
                void handleGenerateReply(selectedItem);
              }}
              onSendReply={handleSendReply}
              onReplyDraftChange={handleReplyDraftChange}
              onApplySuggestion={handleApplySuggestion}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
