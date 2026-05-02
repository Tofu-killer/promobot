import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { DataSourceSetupHint } from '../components/DataSourceSetupHint';
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
  metadata?: InboxItemMetadata | null;
}

interface InboxItemMetadata {
  sourceUrl?: string | null;
  [key: string]: unknown;
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

export interface InboxReplyHandoffRecord {
  channelAccountId?: number;
  platform: string;
  itemId: string | number;
  handoffAttempt?: number | string | null;
  source: string;
  title: string | null;
  author: string | null;
  accountKey: string;
  status: string;
  readiness?: string;
  sessionAction?: string | null;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface InboxReplyHandoffsResponse {
  handoffs: InboxReplyHandoffRecord[];
  total: number;
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

export async function loadInboxReplyHandoffsRequest(limit = 100): Promise<InboxReplyHandoffsResponse> {
  return apiRequest<InboxReplyHandoffsResponse>(`/api/system/inbox-reply-handoffs?limit=${limit}`);
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

type BrowserSessionAction = 'request_session' | 'relogin';

interface BrowserReplyHandoffArtifact {
  artifactPath?: string | null;
  path?: string | null;
  relativePath?: string | null;
}

interface BrowserReplyHandoffSessionAction {
  action?: string | null;
  type?: string | null;
  artifactPath?: string | null;
  path?: string | null;
}

interface BrowserReplyHandoffDetails {
  platform?: string | null;
  channelAccountId?: number | null;
  accountKey?: string | null;
  handoffAttempt?: number | string | null;
  readiness?: string | null;
  sessionAction?: string | BrowserReplyHandoffSessionAction | null;
  artifactPath?: string | null;
  artifact?: string | BrowserReplyHandoffArtifact | null;
}

interface ManualReplyAssistantDetails {
  platform?: string | null;
  label?: string | null;
  copyText?: string | null;
  sourceUrl?: string | null;
  openUrl?: string | null;
  title?: string | null;
}

type SendInboxReplyDetails = Record<string, unknown> & {
  browserReplyHandoff?: BrowserReplyHandoffDetails | null;
  manualReplyAssistant?: ManualReplyAssistantDetails | null;
};

export async function suggestInboxReplyRequest(id: number): Promise<InboxReplySuggestionResponse> {
  return apiRequest<InboxReplySuggestionResponse>(`/api/inbox/${id}/suggest-reply`, {
    method: 'POST',
  });
}

export interface SendInboxReplyResponse {
  item: InboxItem;
  delivery: {
    success: boolean;
    status: 'sent' | 'manual_required' | 'failed';
    mode: 'api' | 'browser' | 'manual';
    message: string;
    reply: string;
    deliveryUrl?: string | null;
    externalId?: string | null;
    details?: SendInboxReplyDetails;
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

export interface RequestChannelAccountSessionActionPayload {
  action?: BrowserSessionAction;
}

export interface RequestChannelAccountSessionActionResponse {
  sessionAction: {
    action: BrowserSessionAction;
    message: string;
    artifactPath?: string | null;
    path?: string | null;
  };
}

export async function requestInboxReplySessionActionRequest(
  accountId: number,
  input: RequestChannelAccountSessionActionPayload = {},
): Promise<RequestChannelAccountSessionActionResponse> {
  return apiRequest<RequestChannelAccountSessionActionResponse>(`/api/channel-accounts/${accountId}/session/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export interface CompleteInboxReplyHandoffInput {
  artifactPath: string;
  handoffAttempt?: number;
  replyStatus: 'sent' | 'failed';
  message?: string;
  deliveryUrl?: string;
}

export interface InboxReplyHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  itemId: number;
  itemStatus: string;
  platform: string;
  mode: string;
  status: string;
  success: boolean;
  deliveryUrl: string | null;
  externalId: string | null;
  message: string;
  deliveredAt: string | null;
}

export async function completeInboxReplyHandoffRequest(
  input: CompleteInboxReplyHandoffInput,
): Promise<InboxReplyHandoffCompletionResponse> {
  return apiRequest<InboxReplyHandoffCompletionResponse>('/api/system/inbox-reply-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      ...(input.handoffAttempt !== undefined ? { handoffAttempt: input.handoffAttempt } : {}),
      replyStatus: input.replyStatus,
      message:
        input.message ??
        (input.replyStatus === 'sent'
          ? 'inbox reply handoff marked sent'
          : 'inbox reply handoff marked failed'),
      ...(input.deliveryUrl !== undefined && input.deliveryUrl.trim().length > 0
        ? { deliveryUrl: input.deliveryUrl.trim() }
        : {}),
    }),
  });
}

interface InboxPageProps {
  loadInboxAction?: (projectId?: number) => Promise<InboxResponse>;
  loadInboxReplyHandoffsAction?: (limit?: number) => Promise<InboxReplyHandoffsResponse>;
  fetchInboxAction?: (projectId?: number) => Promise<FetchInboxResponse>;
  enqueueFetchJobAction?: (runAt?: string, projectId?: number) => Promise<EnqueueInboxFetchJobResponse>;
  updateInboxAction?: (id: number, status: string) => Promise<UpdateInboxItemResponse>;
  suggestReplyAction?: (id: number) => Promise<InboxReplySuggestionResponse>;
  sendReplyAction?: (id: number, reply: string) => Promise<SendInboxReplyResponse>;
  requestChannelAccountSessionAction?: (
    accountId: number,
    input?: RequestChannelAccountSessionActionPayload,
  ) => Promise<RequestChannelAccountSessionActionResponse>;
  completeInboxReplyHandoffAction?: (
    input: CompleteInboxReplyHandoffInput,
  ) => Promise<InboxReplyHandoffCompletionResponse>;
  stateOverride?: AsyncState<InboxResponse>;
  replyHandoffsStateOverride?: AsyncState<InboxReplyHandoffsResponse>;
  fetchStateOverride?: AsyncState<FetchInboxResponse>;
  enqueueStateOverride?: AsyncState<EnqueueInboxFetchJobResponse>;
  inboxUpdateStateOverride?: AsyncState<UpdateInboxItemResponse>;
  replySuggestionStateOverride?: AsyncState<InboxReplySuggestionResponse>;
  sendReplyStateOverride?: AsyncState<SendInboxReplyResponse>;
  sessionActionStateOverride?: AsyncState<RequestChannelAccountSessionActionResponse>;
  replyHandoffCompletionStateOverride?: AsyncState<InboxReplyHandoffCompletionResponse>;
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

  if (filter === 'instagram') {
    return 'Instagram';
  }

  if (filter === 'tiktok') {
    return 'TikTok';
  }

  if (filter === 'v2ex') {
    return 'V2EX';
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readPositiveIntegerLikeString(value: unknown) {
  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    if (/^[1-9]\d*$/.test(normalizedValue)) {
      return Number(normalizedValue);
    }
  }

  return readPositiveInteger(value);
}

function resolveOriginalPostUrl(item: InboxItem) {
  return readString(item.metadata?.sourceUrl) ?? extractOriginalPostUrl(item.excerpt);
}

function readBrowserReplyHandoff(details: SendInboxReplyDetails | undefined) {
  const browserReplyHandoff = asRecord(details?.browserReplyHandoff);
  if (!browserReplyHandoff) {
    return null;
  }

  const artifact = browserReplyHandoff.artifact;
  const artifactRecord = asRecord(artifact);
  const sessionActionRecord = asRecord(browserReplyHandoff.sessionAction);
  const readiness = readString(browserReplyHandoff.readiness);
  const sessionAction =
    readString(browserReplyHandoff.sessionAction) ??
    readString(sessionActionRecord?.action) ??
    readString(sessionActionRecord?.type);
  const artifactPath =
    readString(browserReplyHandoff.artifactPath) ??
    readString(artifact) ??
    readString(artifactRecord?.artifactPath) ??
    readString(artifactRecord?.path) ??
    readString(artifactRecord?.relativePath) ??
    readString(sessionActionRecord?.artifactPath) ??
    readString(sessionActionRecord?.path);
  const platform = readString(browserReplyHandoff.platform);
  const accountKey = readString(browserReplyHandoff.accountKey);
  const channelAccountId = readPositiveInteger(browserReplyHandoff.channelAccountId);
  const handoffAttempt = readPositiveIntegerLikeString(browserReplyHandoff.handoffAttempt);

  if (!readiness && !sessionAction && !artifactPath && !platform && !accountKey && !channelAccountId) {
    return null;
  }

  return {
    platform,
    accountKey,
    channelAccountId,
    handoffAttempt,
    readiness,
    sessionAction,
    artifactPath,
  };
}

function readManualReplyAssistant(details: SendInboxReplyDetails | undefined) {
  const assistant = asRecord(details?.manualReplyAssistant);
  if (!assistant) {
    return null;
  }

  const label = readString(assistant.label);
  const copyText = readString(assistant.copyText);
  const sourceUrl = readString(assistant.sourceUrl);
  const openUrl = readString(assistant.openUrl) ?? sourceUrl;
  const title = readString(assistant.title);
  const platform = readString(assistant.platform);

  if (!copyText && !openUrl && !label && !title && !platform) {
    return null;
  }

  return {
    platform,
    label,
    copyText,
    sourceUrl,
    openUrl,
    title,
  };
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

function formatSessionActionLabel(action: BrowserSessionAction) {
  return action === 'relogin' ? '重新登录' : '请求登录';
}

function formatSessionActionPendingLabel(action: BrowserSessionAction) {
  return action === 'relogin' ? '正在提交重新登录...' : '正在提交登录请求...';
}

function readSessionActionArtifactPath(result: RequestChannelAccountSessionActionResponse | undefined) {
  const sessionAction = asRecord(result?.sessionAction);

  return readString(sessionAction?.artifactPath) ?? readString(sessionAction?.path);
}

function readInboxReplyHandoffItemId(handoff: InboxReplyHandoffRecord) {
  return typeof handoff.itemId === 'number'
    ? readPositiveInteger(handoff.itemId)
    : readPositiveInteger(Number(handoff.itemId));
}

function readInboxReplyHandoffAttempt(handoff: Pick<InboxReplyHandoffRecord, 'handoffAttempt'>) {
  return readPositiveIntegerLikeString(handoff.handoffAttempt);
}

function buildInboxReplyHandoffIdentityKey(
  itemId: number | null,
  artifactPath: string | null | undefined,
  handoffAttempt?: number,
  legacyScopeKey?: string | null,
) {
  if (itemId === null || !artifactPath) {
    return null;
  }

  if (handoffAttempt !== undefined) {
    return `${itemId}:${artifactPath}:${handoffAttempt}`;
  }

  return legacyScopeKey
    ? `${itemId}:${artifactPath}:legacy:${legacyScopeKey}`
    : `${itemId}:${artifactPath}:legacy`;
}

function pickNewerInboxReplyHandoff(
  current: InboxReplyHandoffRecord | null,
  candidate: InboxReplyHandoffRecord,
) {
  if (!current) {
    return candidate;
  }

  const currentAttempt = readInboxReplyHandoffAttempt(current) ?? 0;
  const candidateAttempt = readInboxReplyHandoffAttempt(candidate) ?? 0;
  if (candidateAttempt !== currentAttempt) {
    return candidateAttempt > currentAttempt ? candidate : current;
  }

  return Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt) ? candidate : current;
}

function findPendingInboxReplyHandoff(handoffs: InboxReplyHandoffRecord[], itemId: number) {
  return handoffs.reduce<InboxReplyHandoffRecord | null>((current, handoff) => {
    if (handoff.status !== 'pending' || readInboxReplyHandoffItemId(handoff) !== itemId) {
      return current;
    }

    return pickNewerInboxReplyHandoff(current, handoff);
  }, null);
}

function isReadyInboxReplyHandoff(handoff: InboxReplyHandoffRecord) {
  return handoff.status === 'pending' && (handoff.readiness ?? 'ready') === 'ready';
}

function getInboxReplyHandoffBlockedMessage(handoff: InboxReplyHandoffRecord) {
  return handoff.sessionAction === 'relogin'
    ? '等待刷新 Session 后继续回复接管。'
    : '等待补充 Session 后继续回复接管。';
}

function shouldPreferImmediateInboxReplyHandoff(
  immediate: ReturnType<typeof readBrowserReplyHandoff>,
  persisted: InboxReplyHandoffRecord | null,
) {
  if (!immediate) {
    return false;
  }

  if (!persisted) {
    return true;
  }

  const immediateAttempt = readPositiveInteger(immediate.handoffAttempt) ?? 0;
  const persistedAttempt = readInboxReplyHandoffAttempt(persisted) ?? 0;
  if (immediateAttempt !== persistedAttempt) {
    return immediateAttempt > persistedAttempt;
  }

  return false;
}

export function InboxPage({
  loadInboxAction = loadInboxRequest,
  loadInboxReplyHandoffsAction = loadInboxReplyHandoffsRequest,
  fetchInboxAction = fetchInboxRequest,
  enqueueFetchJobAction = enqueueInboxFetchJobRequest,
  updateInboxAction = updateInboxItemRequest,
  suggestReplyAction = suggestInboxReplyRequest,
  sendReplyAction = sendInboxReplyRequest,
  requestChannelAccountSessionAction = requestInboxReplySessionActionRequest,
  completeInboxReplyHandoffAction = completeInboxReplyHandoffRequest,
  stateOverride,
  replyHandoffsStateOverride,
  fetchStateOverride,
  enqueueStateOverride,
  inboxUpdateStateOverride,
  replySuggestionStateOverride,
  sendReplyStateOverride,
  sessionActionStateOverride,
  replyHandoffCompletionStateOverride,
}: InboxPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const shouldLoadReplyHandoffsLive = replyHandoffsStateOverride === undefined;
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadInboxAction() : loadInboxAction(projectId)),
    [loadInboxAction, projectId],
  );
  const { state: replyHandoffsState, reload: reloadReplyHandoffs } = useAsyncQuery(
    () =>
      shouldLoadReplyHandoffsLive
        ? loadInboxReplyHandoffsAction()
        : Promise.resolve({
            handoffs: [],
            total: 0,
          } satisfies InboxReplyHandoffsResponse),
    [loadInboxReplyHandoffsAction, shouldLoadReplyHandoffsLive],
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
  const { state: sessionActionState, run: runSessionAction } = useAsyncAction(
    ({ accountId, action }: { accountId: number; action: BrowserSessionAction }) =>
      requestChannelAccountSessionAction(accountId, { action }),
  );
  const { state: replyHandoffCompletionState, run: runReplyHandoffCompletion } = useAsyncAction(
    (input: CompleteInboxReplyHandoffInput) => completeInboxReplyHandoffAction(input),
  );
  const [activePlatformFilter, setActivePlatformFilter] = useState('all');
  const [activeStatusFilter, setActiveStatusFilter] = useState('all');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [inboxMutationItemId, setInboxMutationItemId] = useState<number | null>(null);
  const [replySuggestionItemId, setReplySuggestionItemId] = useState<number | null>(null);
  const [replyDeliveryItemId, setReplyDeliveryItemId] = useState<number | null>(null);
  const [replyDraftByItemId, setReplyDraftByItemId] = useState<Record<number, string>>({});
  const [manualReplyAssistantFeedback, setManualReplyAssistantFeedback] = useState<string | null>(null);
  const [sessionActionItemId, setSessionActionItemId] = useState<number | null>(null);
  const [replyHandoffCompletionItemId, setReplyHandoffCompletionItemId] = useState<number | null>(null);
  const [replyHandoffCompletionResult, setReplyHandoffCompletionResult] =
    useState<InboxReplyHandoffCompletionResponse | null>(null);
  const [replyHandoffCompletionIdentityKey, setReplyHandoffCompletionIdentityKey] = useState<string | null>(null);
  const [manualReplyAssistantCompletionResult, setManualReplyAssistantCompletionResult] = useState<InboxItem | null>(null);
  const [replyHandoffDraftByArtifactPath, setReplyHandoffDraftByArtifactPath] = useState<
    Record<string, { deliveryUrl: string; message: string }>
  >({});
  const replyHandoffCompletionAttemptRef = useRef(0);
  const manualReplyAssistantCompletionAttemptRef = useRef(0);
  const [allowReplySuggestionFallback, setAllowReplySuggestionFallback] = useState(true);
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState('');
  const displayState = stateOverride ?? state;
  const displayReplyHandoffsState = replyHandoffsStateOverride ?? replyHandoffsState;
  const displayFetchState = fetchStateOverride ?? fetchState;
  const displayEnqueueState = enqueueStateOverride ?? enqueueState;
  const displayInboxUpdateState = inboxUpdateStateOverride ?? inboxUpdateState;
  const displayReplySuggestionState = replySuggestionStateOverride ?? replySuggestionState;
  const displaySendReplyState = sendReplyStateOverride ?? sendReplyState;
  const displaySessionActionState = sessionActionStateOverride ?? sessionActionState;
  const displayReplyHandoffCompletionState = replyHandoffCompletionStateOverride ?? replyHandoffCompletionState;
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
  const replyHandoffs =
    displayReplyHandoffsState.status === 'success' && displayReplyHandoffsState.data
      ? displayReplyHandoffsState.data.handoffs
      : [];
  const updatedInboxItem =
    displayInboxUpdateState.status === 'success' && displayInboxUpdateState.data ? displayInboxUpdateState.data.item : null;
  const deliveredReplyItem =
    displaySendReplyState.status === 'success' && displaySendReplyState.data ? displaySendReplyState.data.item : null;
  const completedReplyHandoff = replyHandoffCompletionResult;
  let displayItems = viewData.items;
  if (updatedInboxItem) {
    displayItems = displayItems.map((item) => (item.id === updatedInboxItem.id ? updatedInboxItem : item));
  }
  if (deliveredReplyItem) {
    displayItems = displayItems.map((item) => (item.id === deliveredReplyItem.id ? deliveredReplyItem : item));
  }
  if (manualReplyAssistantCompletionResult) {
    displayItems = displayItems.map((item) =>
      item.id === manualReplyAssistantCompletionResult.id ? manualReplyAssistantCompletionResult : item,
    );
  }
  if (completedReplyHandoff) {
    displayItems = displayItems.map((item) =>
      item.id === completedReplyHandoff.itemId
        ? {
            ...item,
            status: completedReplyHandoff.itemStatus,
          }
        : item,
    );
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
    setSessionActionItemId(null);
    replyHandoffCompletionAttemptRef.current += 1;
    setReplyHandoffCompletionItemId(null);
    setReplyHandoffCompletionResult(null);
    setReplyHandoffCompletionIdentityKey(null);
    manualReplyAssistantCompletionAttemptRef.current += 1;
    setManualReplyAssistantCompletionResult(null);
    setReplyHandoffDraftByArtifactPath({});
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
          && displaySendReplyState.data.delivery.status === 'sent'
          && displaySendReplyState.data.item.status === 'handled'
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
  const deliveredReplyFeedbackItemId =
    displaySendReplyState.status === 'success' && displaySendReplyState.data
      ? displaySendReplyState.data.item.id
      : null;
  const deliveredReplyFeedback =
    displaySendReplyState.status === 'success' &&
    displaySendReplyState.data &&
    replyDeliveryItemId !== null &&
    deliveredReplyFeedbackItemId === replyDeliveryItemId
      ? displaySendReplyState.data.delivery
      : null;
  const manualReplyAssistantCompletionItemId = manualReplyAssistantCompletionResult?.id ?? null;
  const hasCurrentReplyDeliveryFollowUp =
    replyDeliveryItemId !== null && (selectedItem === null || selectedItem.id === replyDeliveryItemId);
  const activeReplyDeliveryItemId = hasCurrentReplyDeliveryFollowUp ? replyDeliveryItemId : selectedItem?.id ?? null;
  const replyDeliveryClosedLocally =
    manualReplyAssistantCompletionItemId !== null && manualReplyAssistantCompletionItemId === activeReplyDeliveryItemId;
  const immediateReplyBrowserHandoff =
    hasCurrentReplyDeliveryFollowUp && deliveredReplyFeedback ? readBrowserReplyHandoff(deliveredReplyFeedback.details) : null;
  const persistedReplyHandoff =
    activeReplyDeliveryItemId !== null ? findPendingInboxReplyHandoff(replyHandoffs, activeReplyDeliveryItemId) : null;
  const persistedReplyHandoffFeedback = persistedReplyHandoff
    ? isReadyInboxReplyHandoff(persistedReplyHandoff)
      ? '发现待处理的 Inbox reply handoff，可以直接结单。'
      : getInboxReplyHandoffBlockedMessage(persistedReplyHandoff)
    : null;
  const shouldUsePersistedReplyHandoff =
    persistedReplyHandoff !== null &&
    !shouldPreferImmediateInboxReplyHandoff(immediateReplyBrowserHandoff, persistedReplyHandoff);
  const activeReplyBrowserHandoff =
    shouldUsePersistedReplyHandoff
      ? {
          platform: persistedReplyHandoff.platform,
          accountKey: persistedReplyHandoff.accountKey,
          channelAccountId: readPositiveInteger(persistedReplyHandoff.channelAccountId),
          handoffAttempt: readInboxReplyHandoffAttempt(persistedReplyHandoff),
          readiness: persistedReplyHandoff.readiness ?? 'ready',
          sessionAction: persistedReplyHandoff.sessionAction ?? null,
          artifactPath: persistedReplyHandoff.artifactPath,
        }
      : immediateReplyBrowserHandoff;
  const showReplyDeliveryFollowUp = (hasCurrentReplyDeliveryFollowUp || persistedReplyHandoff !== null) && !replyDeliveryClosedLocally;
  const shouldShowReplyDeliveryActions = showReplyDeliveryFollowUp;
  const sendReplyFeedback =
    shouldUsePersistedReplyHandoff && persistedReplyHandoff && !replyDeliveryClosedLocally
      ? persistedReplyHandoffFeedback
      : deliveredReplyFeedback && !replyDeliveryClosedLocally
      ? deliveredReplyFeedback.message
      : displaySendReplyState.status === 'error' && replyDeliveryItemId !== null
        ? `发送回复失败：${displaySendReplyState.error}`
        : null;
  const sendReplyManualReplyAssistant =
    !shouldUsePersistedReplyHandoff && hasCurrentReplyDeliveryFollowUp && deliveredReplyFeedback
    ? readManualReplyAssistant(deliveredReplyFeedback.details)
    : null;
  const sendReplyFeedbackTone =
    shouldUsePersistedReplyHandoff && persistedReplyHandoff && !replyDeliveryClosedLocally
      ? 'warning'
      : deliveredReplyFeedback && !replyDeliveryClosedLocally
      ? deliveredReplyFeedback.status === 'sent'
        ? 'success'
        : deliveredReplyFeedback.status === 'manual_required'
          ? 'warning'
          : 'error'
      : displaySendReplyState.status === 'error'
        ? 'error'
        : null;
  const persistedReplyHandoffLegacyScopeKey = persistedReplyHandoff
    ? `${persistedReplyHandoff.updatedAt}:${persistedReplyHandoff.createdAt}`
    : null;
  const immediateReplyBrowserHandoffLegacyScopeKey =
    deliveredReplyFeedback && replyDeliveryItemId !== null
      ? `${replyDeliveryItemId}:${deliveredReplyFeedback.status}:${deliveredReplyFeedback.message}:${immediateReplyBrowserHandoff?.artifactPath ?? 'none'}:${immediateReplyBrowserHandoff?.handoffAttempt ?? 'none'}`
      : null;
  const replyDeliveryFeedbackResetKey =
    shouldUsePersistedReplyHandoff && persistedReplyHandoff && activeReplyDeliveryItemId !== null
      ? `persisted:${activeReplyDeliveryItemId}:${persistedReplyHandoff.artifactPath}:${persistedReplyHandoff.readiness ?? 'ready'}:${readInboxReplyHandoffAttempt(persistedReplyHandoff) ?? 'none'}:${persistedReplyHandoffLegacyScopeKey ?? 'none'}`
      : deliveredReplyFeedback && replyDeliveryItemId !== null
      ? immediateReplyBrowserHandoffLegacyScopeKey
      : displaySendReplyState.status === 'error' && replyDeliveryItemId !== null
        ? `error:${replyDeliveryItemId}:${displaySendReplyState.error}`
        : null;
  const activeReplyBrowserHandoffAttempt = readPositiveIntegerLikeString(activeReplyBrowserHandoff?.handoffAttempt);
  const activeReplyBrowserHandoffIdentityKey = buildInboxReplyHandoffIdentityKey(
    activeReplyDeliveryItemId,
    activeReplyBrowserHandoff?.artifactPath,
    activeReplyBrowserHandoffAttempt,
    shouldUsePersistedReplyHandoff
      ? persistedReplyHandoffLegacyScopeKey
      : immediateReplyBrowserHandoffLegacyScopeKey,
  );
  const suggestedReply =
    showReplySuggestionForSelectedItem &&
    displayReplySuggestionState.status === 'success' &&
    displayReplySuggestionState.data
      ? displayReplySuggestionState.data.suggestion.reply
      : null;

  useEffect(() => {
    setManualReplyAssistantFeedback(null);
    setSessionActionItemId(null);
    const shouldPreserveReplyHandoffCompletion =
      activeReplyBrowserHandoffIdentityKey !== null &&
      replyHandoffCompletionIdentityKey !== null &&
      activeReplyBrowserHandoffIdentityKey === replyHandoffCompletionIdentityKey;

    if (!shouldPreserveReplyHandoffCompletion) {
      replyHandoffCompletionAttemptRef.current += 1;
      setReplyHandoffCompletionItemId(null);
      setReplyHandoffCompletionResult(null);
      setReplyHandoffCompletionIdentityKey(null);
    }
    manualReplyAssistantCompletionAttemptRef.current += 1;
    setManualReplyAssistantCompletionResult(null);
    setReplyHandoffDraftByArtifactPath({});
  }, [
    activeReplyBrowserHandoffIdentityKey,
    deliveredReplyFeedbackItemId,
    replyDeliveryFeedbackResetKey,
    replyHandoffCompletionIdentityKey,
  ]);

  const sessionActionFeedback =
    displaySessionActionState.status === 'success' && displaySessionActionState.data && sessionActionItemId !== null
      ? displaySessionActionState.data.sessionAction.message
      : displaySessionActionState.status === 'error' && sessionActionItemId !== null
        ? `提交 browser session 动作失败：${displaySessionActionState.error}`
        : null;
  const sessionActionArtifactPath =
    displaySessionActionState.status === 'success' &&
    displaySessionActionState.data &&
    sessionActionItemId !== null &&
    sessionActionItemId === activeReplyDeliveryItemId
      ? readSessionActionArtifactPath(displaySessionActionState.data)
      : null;
  const replyHandoffCompletionFeedback =
    showReplyDeliveryFollowUp && completedReplyHandoff && replyHandoffCompletionItemId !== null
      ? `已结单 inbox reply item #${completedReplyHandoff.itemId} (${completedReplyHandoff.itemStatus})`
      : showReplyDeliveryFollowUp &&
          displayReplyHandoffCompletionState.status === 'error' &&
          replyHandoffCompletionItemId !== null
        ? `Inbox reply handoff 结单失败：${displayReplyHandoffCompletionState.error}`
        : null;
  const replyHandoffCompletionFeedbackTone =
    showReplyDeliveryFollowUp && completedReplyHandoff
      ? 'success'
      : showReplyDeliveryFollowUp && displayReplyHandoffCompletionState.status === 'error'
        ? 'error'
        : null;

  function reloadInboxSurface() {
    void reload();
    void reloadReplyHandoffs();
  }

  async function handleInboxStatus(item: InboxItem, status: 'handled' | 'snoozed') {
    setSelectedItemId(item.id);
    setInboxMutationItemId(item.id);

    try {
      await runInboxUpdate({ id: item.id, status });
      reloadInboxSurface();
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
        reloadInboxSurface();
      })
      .catch(() => undefined);
  }

  function handleEnqueueInboxFetch() {
    const runAt = enqueueRunAtDraft.trim().length > 0 ? enqueueRunAtDraft.trim() : undefined;

    void runEnqueueFetchJob({ runAt, projectId })
      .then(() => {
        setEnqueueRunAtDraft('');
        reloadInboxSurface();
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
    })
      .then(() => {
        void reloadReplyHandoffs();
      })
      .catch(() => undefined);
  }

  function handleOpenManualReplyAssistant(url: string) {
    if (typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function handleCopyManualReplyAssistant(copyText: string) {
    const clipboard = navigator.clipboard;

    if (!clipboard?.writeText) {
      setManualReplyAssistantFeedback('当前环境不支持自动复制，请手动复制。');
      return;
    }

    void clipboard
      .writeText(copyText)
      .then(() => {
        setManualReplyAssistantFeedback('已复制回复内容');
      })
      .catch(() => {
        setManualReplyAssistantFeedback('复制回复内容失败，请手动复制。');
      });
  }

  function handleResolveManualReplyAssistant() {
    if (!selectedItem || replyDeliveryItemId === null || selectedItem.id !== replyDeliveryItemId) {
      return;
    }

    const completionAttemptId = manualReplyAssistantCompletionAttemptRef.current + 1;
    manualReplyAssistantCompletionAttemptRef.current = completionAttemptId;
    setSelectedItemId(selectedItem.id);
    setInboxMutationItemId(selectedItem.id);

    void runInboxUpdate({ id: selectedItem.id, status: 'handled' })
      .then((result) => {
        if (manualReplyAssistantCompletionAttemptRef.current !== completionAttemptId) {
          return;
        }

        setManualReplyAssistantFeedback(null);
        setManualReplyAssistantCompletionResult(result.item);
        reloadInboxSurface();
      })
      .catch(() => undefined);
  }

  function handleReplyHandoffDraftChange(artifactPath: string, field: 'deliveryUrl' | 'message', value: string) {
    setReplyHandoffDraftByArtifactPath((current) => ({
      ...current,
      [artifactPath]: {
        deliveryUrl: current[artifactPath]?.deliveryUrl ?? '',
        message: current[artifactPath]?.message ?? '',
        [field]: value,
      },
    }));
  }

  function handleRequestSessionAction() {
    if (
      !activeReplyBrowserHandoff?.sessionAction ||
      !activeReplyBrowserHandoff.channelAccountId ||
      activeReplyDeliveryItemId === null
    ) {
      return;
    }

    const action = activeReplyBrowserHandoff.sessionAction;
    if (action !== 'request_session' && action !== 'relogin') {
      return;
    }

    setSessionActionItemId(activeReplyDeliveryItemId);
    void runSessionAction({
      accountId: activeReplyBrowserHandoff.channelAccountId,
      action,
    })
      .then(() => {
        void reloadReplyHandoffs();
      })
      .catch(() => undefined);
  }

  function handleCompleteReplyHandoff(replyStatus: 'sent' | 'failed') {
    if (
      !activeReplyBrowserHandoff?.artifactPath ||
      activeReplyDeliveryItemId === null
    ) {
      return;
    }

    const handoffAttempt = readPositiveIntegerLikeString(activeReplyBrowserHandoff.handoffAttempt);
    if (activeReplyBrowserHandoff.handoffAttempt !== undefined && handoffAttempt === undefined) {
      return;
    }

    const draft = replyHandoffDraftByArtifactPath[activeReplyBrowserHandoff.artifactPath];
    const message = draft?.message.trim();
    const deliveryUrl = draft?.deliveryUrl.trim();
    const completionAttemptId = replyHandoffCompletionAttemptRef.current + 1;
    const completionIdentityKey = activeReplyBrowserHandoffIdentityKey;

    if (completionIdentityKey === null) {
      return;
    }

    replyHandoffCompletionAttemptRef.current = completionAttemptId;
    setReplyHandoffCompletionItemId(activeReplyDeliveryItemId);
    setReplyHandoffCompletionResult(null);
    void runReplyHandoffCompletion({
      artifactPath: activeReplyBrowserHandoff.artifactPath,
      handoffAttempt,
      replyStatus,
      ...(message ? { message } : {}),
      ...(deliveryUrl ? { deliveryUrl } : {}),
    })
      .then((result) => {
        if (replyHandoffCompletionAttemptRef.current !== completionAttemptId) {
          return;
        }

        setReplyHandoffCompletionIdentityKey(completionIdentityKey);
        setReplyHandoffCompletionResult(result);
        reloadInboxSurface();
      })
      .catch(() => undefined);
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

  const activeReplyHandoffDraft = activeReplyBrowserHandoff?.artifactPath
    ? replyHandoffDraftByArtifactPath[activeReplyBrowserHandoff.artifactPath]
    : undefined;
  const shouldShowReplyHandoffCompletionActions =
    !!activeReplyBrowserHandoff?.artifactPath &&
    activeReplyBrowserHandoffIdentityKey !== null &&
    (activeReplyBrowserHandoff.readiness ?? 'ready') === 'ready' &&
    activeReplyBrowserHandoffIdentityKey !== replyHandoffCompletionIdentityKey;
  const shouldShowSessionActionButton =
    !!activeReplyBrowserHandoff?.channelAccountId &&
    (activeReplyBrowserHandoff.sessionAction === 'request_session' ||
      activeReplyBrowserHandoff.sessionAction === 'relogin');

  return (
    <section>
      <PageHeader
        eyebrow="Response Desk"
        title="Social Inbox"
        description="统一查看命中关键词的帖子、AI 回复建议和人工接管入口，优先处理高价值会话。"
        actions={
          <>
            <ActionButton label="刷新收件箱" onClick={reloadInboxSurface} />
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
            background:
              sendReplyFeedbackTone === 'error'
                ? '#fef2f2'
                : sendReplyFeedbackTone === 'warning'
                  ? '#fffbeb'
                  : '#ecfdf5',
            color:
              sendReplyFeedbackTone === 'error'
                ? '#b91c1c'
                : sendReplyFeedbackTone === 'warning'
                  ? '#92400e'
                  : '#166534',
          }}
        >
          <span>{sendReplyFeedback}</span>
          {activeReplyBrowserHandoff?.readiness ? (
            <span style={{ display: 'block', marginTop: '6px' }}>Handoff 状态：{activeReplyBrowserHandoff.readiness}</span>
          ) : null}
          {activeReplyBrowserHandoff?.sessionAction ? (
            <span style={{ display: 'block', marginTop: '6px' }}>Handoff 动作：{activeReplyBrowserHandoff.sessionAction}</span>
          ) : null}
          {activeReplyBrowserHandoff?.artifactPath ? (
            <span style={{ display: 'block', marginTop: '6px' }}>Handoff 路径：{activeReplyBrowserHandoff.artifactPath}</span>
          ) : null}
          {shouldShowSessionActionButton ? (
            <span style={{ display: 'block', marginTop: '10px' }}>
              <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
                <ActionButton
                  label={
                    displaySessionActionState.status === 'loading' && sessionActionItemId === activeReplyDeliveryItemId
                      ? formatSessionActionPendingLabel(activeReplyBrowserHandoff!.sessionAction as BrowserSessionAction)
                      : formatSessionActionLabel(activeReplyBrowserHandoff!.sessionAction as BrowserSessionAction)
                  }
                  tone="primary"
                  onClick={handleRequestSessionAction}
                  disabled={
                    displaySessionActionState.status === 'loading' && sessionActionItemId === activeReplyDeliveryItemId
                  }
                />
              </span>
              {sessionActionFeedback ? (
                <span style={{ display: 'block', marginTop: '8px' }}>{sessionActionFeedback}</span>
              ) : null}
              {sessionActionArtifactPath ? (
                <span style={{ display: 'block', marginTop: '6px' }}>Session 请求路径：{sessionActionArtifactPath}</span>
              ) : null}
            </span>
          ) : null}
          {shouldShowReplyHandoffCompletionActions ? (
            <span style={{ display: 'block', marginTop: '10px' }}>
              <span style={{ display: 'block', marginBottom: '8px' }}>Inbox reply handoff 结单</span>
              <span style={{ display: 'grid', gap: '8px' }}>
                <input
                  data-inbox-reply-handoff-field="deliveryUrl"
                  value={activeReplyHandoffDraft?.deliveryUrl ?? ''}
                  onChange={(event) => {
                    handleReplyHandoffDraftChange(activeReplyBrowserHandoff!.artifactPath!, 'deliveryUrl', event.target.value);
                  }}
                  placeholder="delivery URL（可选）"
                  style={queueInputStyle}
                />
                <input
                  data-inbox-reply-handoff-field="message"
                  value={activeReplyHandoffDraft?.message ?? ''}
                  onChange={(event) => {
                    handleReplyHandoffDraftChange(activeReplyBrowserHandoff!.artifactPath!, 'message', event.target.value);
                  }}
                  placeholder="结单备注（可选）"
                  style={queueInputStyle}
                />
                <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
                  <ActionButton
                    label={
                      displayReplyHandoffCompletionState.status === 'loading' &&
                      replyHandoffCompletionItemId === activeReplyDeliveryItemId
                        ? '正在结单...'
                        : '标记已发送'
                    }
                    tone="primary"
                    onClick={() => {
                      handleCompleteReplyHandoff('sent');
                    }}
                    disabled={
                      displayReplyHandoffCompletionState.status === 'loading' &&
                      replyHandoffCompletionItemId === activeReplyDeliveryItemId
                    }
                  />
                  <ActionButton
                    label={
                      displayReplyHandoffCompletionState.status === 'loading' &&
                      replyHandoffCompletionItemId === activeReplyDeliveryItemId
                        ? '正在结单...'
                        : '标记失败'
                    }
                    onClick={() => {
                      handleCompleteReplyHandoff('failed');
                    }}
                    disabled={
                      displayReplyHandoffCompletionState.status === 'loading' &&
                      replyHandoffCompletionItemId === activeReplyDeliveryItemId
                    }
                  />
                </span>
              </span>
            </span>
          ) : null}
          {replyHandoffCompletionFeedback ? (
            <span
              style={{
                display: 'block',
                marginTop: '10px',
                color: replyHandoffCompletionFeedbackTone === 'error' ? '#b91c1c' : '#166534',
              }}
            >
              <span style={{ display: 'block' }}>{replyHandoffCompletionFeedback}</span>
              {completedReplyHandoff?.message ? (
                <span style={{ display: 'block', marginTop: '6px' }}>{completedReplyHandoff.message}</span>
              ) : null}
              {completedReplyHandoff?.deliveryUrl ? (
                <span style={{ display: 'block', marginTop: '6px' }}>{completedReplyHandoff.deliveryUrl}</span>
              ) : null}
            </span>
          ) : null}
          {sendReplyManualReplyAssistant ? (
            <span style={{ display: 'block', marginTop: '10px' }}>
              <span style={{ display: 'block' }}>
                手工回复辅助：{sendReplyManualReplyAssistant.label ?? sendReplyManualReplyAssistant.platform ?? 'manual'}
              </span>
              {(sendReplyManualReplyAssistant.openUrl || sendReplyManualReplyAssistant.copyText) ? (
                <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {sendReplyManualReplyAssistant.openUrl ? (
                    <ActionButton
                      label="打开原帖"
                      onClick={() => {
                        handleOpenManualReplyAssistant(sendReplyManualReplyAssistant.openUrl!);
                      }}
                    />
                  ) : null}
                  <ActionButton
                    label={
                      displayInboxUpdateState.status === 'loading' && activeInboxMutationItemId === activeReplyDeliveryItemId
                        ? '正在结单...'
                        : '标记已处理'
                    }
                    tone="primary"
                    onClick={handleResolveManualReplyAssistant}
                    disabled={
                      displayInboxUpdateState.status === 'loading' && activeInboxMutationItemId === activeReplyDeliveryItemId
                    }
                  />
                  {sendReplyManualReplyAssistant.copyText ? (
                    <ActionButton
                      label="复制回复"
                      tone="primary"
                      onClick={() => {
                        handleCopyManualReplyAssistant(sendReplyManualReplyAssistant.copyText!);
                      }}
                    />
                  ) : null}
                </span>
              ) : null}
              {manualReplyAssistantFeedback ? (
                <span style={{ display: 'block', marginTop: '6px' }}>{manualReplyAssistantFeedback}</span>
              ) : null}
            </span>
          ) : null}
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
                {displayItems.length === 0 ? (
                  <DataSourceSetupHint dataLabel="收件箱会话" />
                ) : filteredItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>当前筛选下暂无命中内容</p>
                ) : (
                  filteredItems.map((item) => (
                    (() => {
                      const originalPostUrl = resolveOriginalPostUrl(item);

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
