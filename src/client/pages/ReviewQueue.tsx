import { useEffect, useRef, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import type { DraftRecord, DraftsResponse, PublishDraftResponse, UpdateDraftResponse } from '../lib/drafts';
import { upsertDraftRecord } from '../lib/drafts';

type BrowserSessionAction = 'request_session' | 'relogin';

interface RequestChannelAccountSessionActionPayload {
  action?: BrowserSessionAction;
}

interface RequestChannelAccountSessionActionResponse {
  sessionAction: {
    action: BrowserSessionAction;
    message: string;
    artifactPath?: string | null;
    path?: string | null;
  };
}

interface CompleteBrowserHandoffInput {
  artifactPath: string;
  handoffAttempt?: number;
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
}

interface BrowserHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  draftId: number;
  draftStatus: string;
  platform: string;
  mode: string;
  status: string;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
}

interface BrowserHandoffRecord {
  channelAccountId?: number;
  platform: string;
  draftId: string | number;
  title: string | null;
  accountKey: string;
  status: string;
  handoffAttempt?: number;
  readiness?: string;
  sessionAction?: string | null;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

interface BrowserHandoffsResponse {
  handoffs: BrowserHandoffRecord[];
  total: number;
}

interface ReviewQueuePageProps {
  loadReviewQueueAction?: (projectId?: number) => Promise<DraftsResponse>;
  loadBrowserHandoffsAction?: () => Promise<BrowserHandoffsResponse>;
  updateReviewDraftAction?: (id: number, input: { status: 'approved' | 'draft' | 'failed' }) => Promise<UpdateDraftResponse>;
  publishReviewDraftAction?: (id: number) => Promise<PublishDraftResponse>;
  scheduleReviewDraftAction?: (
    id: number,
    input: { scheduledAt: string | null; status: 'scheduled' },
  ) => Promise<UpdateDraftResponse>;
  requestChannelAccountSessionActionAction?: (
    accountId: number,
    input?: RequestChannelAccountSessionActionPayload,
  ) => Promise<RequestChannelAccountSessionActionResponse>;
  completeBrowserHandoffAction?: (input: CompleteBrowserHandoffInput) => Promise<BrowserHandoffCompletionResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
  browserHandoffsStateOverride?: AsyncState<BrowserHandoffsResponse>;
  projectIdDraft?: string;
  onProjectIdDraftChange?: (value: string) => void;
}

interface ReviewActionState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  action: 'review' | 'publish' | 'schedule' | null;
  publishUrl: string | null;
  contractMessage: string | null;
  contractStatus: string | null;
  contractDetails: Record<string, unknown> | null;
}

function parseProjectId(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function buildReviewQueuePath(projectId?: number) {
  return projectId === undefined ? '/api/drafts?status=review' : `/api/drafts?status=review&projectId=${projectId}`;
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

export async function loadReviewQueueRequest(projectId?: number): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>(buildReviewQueuePath(projectId));
}

export async function loadReviewQueueBrowserHandoffsRequest(limit = 100): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(`/api/system/browser-handoffs?limit=${limit}`);
}

function defaultLoadReviewQueueBrowserHandoffsAction() {
  return loadReviewQueueBrowserHandoffsRequest(100);
}

export async function updateReviewDraftRequest(
  id: number,
  input: { status: 'approved' | 'draft' | 'failed' },
): Promise<UpdateDraftResponse> {
  return apiRequest<UpdateDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function discardReviewDraftRequest(id: number): Promise<UpdateDraftResponse> {
  return updateReviewDraftRequest(id, { status: 'failed' });
}

export async function publishReviewDraftRequest(id: number): Promise<PublishDraftResponse> {
  return apiRequest<PublishDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

export async function scheduleReviewDraftRequest(
  id: number,
  input: { scheduledAt: string | null; status: 'scheduled' },
): Promise<UpdateDraftResponse> {
  return apiRequest<UpdateDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function requestReviewQueueSessionActionRequest(
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

export async function completeReviewQueueBrowserHandoffRequest(
  input: CompleteBrowserHandoffInput,
): Promise<BrowserHandoffCompletionResponse> {
  return apiRequest<BrowserHandoffCompletionResponse>('/api/system/browser-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      ...(input.handoffAttempt !== undefined ? { handoffAttempt: input.handoffAttempt } : {}),
      publishStatus: input.publishStatus,
      message:
        input.message ??
        (input.publishStatus === 'published'
          ? 'browser handoff marked published'
          : 'browser handoff marked failed'),
      ...(input.publishUrl !== undefined && input.publishUrl.trim().length > 0
        ? { publishUrl: input.publishUrl.trim() }
        : {}),
    }),
  });
}

function createIdleActionState(): ReviewActionState {
  return {
    status: 'idle',
    message: null,
    error: null,
    action: null,
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
  };
}

function getReviewActionState(actionStateById: Record<number, ReviewActionState>, draftId: number) {
  return actionStateById[draftId] ?? createIdleActionState();
}

function formatReviewActionLabel(status: 'approved' | 'draft' | 'failed') {
  if (status === 'failed') {
    return '已丢弃';
  }

  return status === 'approved' ? '已通过' : '已退回';
}

function formatReviewActionErrorPrefix(action: ReviewActionState['action']) {
  switch (action) {
    case 'publish':
      return '发布失败';
    case 'schedule':
      return '排程失败';
    default:
      return '审核动作失败';
  }
}

const manualHandoffReviewPlatforms = new Set([
  'facebook-group',
  'facebookGroup',
  'instagram',
  'tiktok',
  'xiaohongshu',
  'weibo',
]);

interface BrowserHandoffContract {
  platform: string | null;
  accountKey: string | null;
  channelAccountId?: number;
  handoffAttempt?: number;
  readiness: string | null;
  sessionAction: BrowserSessionAction | null;
  artifactPath: string | null;
}

interface SessionActionMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  artifactPath: string | null;
}

interface BrowserHandoffCompletionMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  result: BrowserHandoffCompletionResponse | null;
}

function createIdleSessionActionState(): SessionActionMutationState {
  return {
    status: 'idle',
    message: null,
    artifactPath: null,
  };
}

function createIdleBrowserHandoffCompletionState(): BrowserHandoffCompletionMutationState {
  return {
    status: 'idle',
    error: null,
    result: null,
  };
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

function readBrowserSessionAction(value: unknown): BrowserSessionAction | null {
  const normalizedValue = readString(value);
  return normalizedValue === 'request_session' || normalizedValue === 'relogin' ? normalizedValue : null;
}

function formatReviewDraftBadgeLabel(status: DraftRecord['status']) {
  switch (status) {
    case 'scheduled':
      return '已排程';
    case 'approved':
      return '已通过';
    case 'draft':
      return '已退回';
    case 'published':
      return '已发布';
    default:
      return '审核中';
  }
}

function getReviewDraftBadgeStyle(status: DraftRecord['status']) {
  switch (status) {
    case 'scheduled':
      return {
        background: '#dbeafe',
        color: '#1d4ed8',
      };
    case 'approved':
      return {
        background: '#dcfce7',
        color: '#166534',
      };
    case 'draft':
      return {
        background: '#fee2e2',
        color: '#b91c1c',
      };
    case 'published':
      return {
        background: '#dcfce7',
        color: '#047857',
      };
    default:
      return {
        background: '#fef3c7',
        color: '#92400e',
      };
  };
}

function filterReviewQueueDrafts(drafts: DraftRecord[]) {
  return drafts.filter((draft) => draft.status === 'review');
}

function upsertReviewQueueDraft(drafts: DraftRecord[], updatedDraft: DraftRecord) {
  return filterReviewQueueDrafts(upsertDraftRecord(drafts, updatedDraft));
}

function removeReviewQueueDraft(drafts: DraftRecord[], draftId: number) {
  return drafts.filter((draft) => draft.id !== draftId);
}

function formatReviewDraftDestination(draft: DraftRecord, scheduledAtValue: string) {
  switch (draft.status) {
    case 'scheduled':
      return scheduledAtValue.length > 0
        ? '当前去向：已推入 Publish Calendar，等待发布窗口。'
        : '当前去向：待补排程，尚未进入 Publish Calendar。';
    case 'published':
      return '当前去向：已完成发布。';
    case 'approved':
      return '当前去向：已通过审核，等待后续流转。';
    case 'draft':
      return '当前去向：已退回草稿池，等待修改。';
    default:
      return '当前去向：仍在审核队列，尚未推入 Publish Calendar。';
  }
}

function formatPublishContractStatus(draft: DraftRecord, actionState: ReviewActionState) {
  if (actionState.action === 'publish') {
    if (actionState.status === 'loading') {
      return '处理中';
    }

    if (actionState.status === 'success') {
      if (actionState.contractStatus === 'queued') {
        return '已入队';
      }
      if (actionState.contractStatus === 'manual_required') {
        return '人工接管';
      }
      return '已确认';
    }

    if (actionState.status === 'error') {
      return '失败';
    }
  }

  if (draft.status === 'published') {
    return '已发布';
  }

  if (actionState.status !== 'success' && actionState.action !== 'publish') {
    return '待触发';
  }

  return '待触发';
}

function formatPublishActionSummaryStatus(actionState: ReviewActionState) {
  if (actionState.contractStatus === 'queued') {
    return '已入队';
  }

  if (actionState.contractStatus === 'manual_required') {
    return '人工接管';
  }

  return '已确认';
}

function getReviewDraftPublishContract(
  draft: DraftRecord,
  actionState: ReviewActionState,
  persistedBrowserHandoff: BrowserHandoffContract | null,
) {
  const draftRecord = asRecord(draft);
  const browserHandoff = readBrowserHandoffContract(actionState.contractDetails) ?? persistedBrowserHandoff;
  const persistedBrowserHandoffMessage = browserHandoff
    ? browserHandoff.readiness === 'blocked'
      ? browserHandoff.sessionAction === 'relogin'
        ? '等待刷新 Session 后继续发布接管。'
        : '等待补充 Session 后继续发布接管。'
      : '发现待处理的 browser handoff，可以直接结单。'
    : null;

  return {
    publishUrl:
      actionState.action === 'publish'
        ? actionState.publishUrl ?? readString(draftRecord?.publishUrl) ?? readString(draftRecord?.lastPublishUrl)
        : readString(draftRecord?.publishUrl) ?? readString(draftRecord?.lastPublishUrl),
    contractMessage:
      actionState.action === 'publish'
        ? actionState.contractMessage ??
          readString(draftRecord?.publishMessage) ??
          readString(draftRecord?.lastPublishMessage) ??
          readString(draftRecord?.message)
        : persistedBrowserHandoffMessage ??
          readString(draftRecord?.publishMessage) ??
          readString(draftRecord?.lastPublishMessage) ??
          readString(draftRecord?.message),
    publishError:
      actionState.action === 'publish'
        ? actionState.error ?? readString(draftRecord?.publishError) ?? readString(draftRecord?.lastPublishError)
        : readString(draftRecord?.publishError) ?? readString(draftRecord?.lastPublishError),
    browserHandoff,
  };
}

function readBrowserHandoffContract(details: Record<string, unknown> | null) {
  const browserHandoff = asRecord(details?.browserHandoff);
  if (!browserHandoff) {
    return null;
  }

  const artifact = browserHandoff.artifact;
  const artifactRecord = asRecord(artifact);
  const sessionActionRecord = asRecord(browserHandoff.sessionAction);
  const sessionAction =
    readBrowserSessionAction(browserHandoff.sessionAction) ??
    readBrowserSessionAction(sessionActionRecord?.action) ??
    readBrowserSessionAction(sessionActionRecord?.type);
  const artifactPath =
    readString(browserHandoff.artifactPath) ??
    readString(artifact) ??
    readString(artifactRecord?.artifactPath) ??
    readString(artifactRecord?.path) ??
    readString(artifactRecord?.relativePath) ??
    readString(sessionActionRecord?.artifactPath) ??
    readString(sessionActionRecord?.path);
  const platform = readString(browserHandoff.platform);
  const accountKey = readString(browserHandoff.accountKey);
  const channelAccountId = readPositiveInteger(browserHandoff.channelAccountId);
  const handoffAttempt = readPositiveInteger(browserHandoff.handoffAttempt);
  const readiness = readString(browserHandoff.readiness);

  if (!platform && !accountKey && !channelAccountId && !handoffAttempt && !readiness && !sessionAction && !artifactPath) {
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

function readSessionActionArtifactPath(result: RequestChannelAccountSessionActionResponse | undefined) {
  const sessionAction = asRecord(result?.sessionAction);

  return readString(sessionAction?.artifactPath) ?? readString(sessionAction?.path);
}

function formatSessionActionLabel(action: BrowserSessionAction) {
  return action === 'relogin' ? '重新登录' : '请求登录';
}

function formatSessionActionPendingLabel(action: BrowserSessionAction) {
  return action === 'relogin' ? '正在提交重新登录...' : '正在提交登录请求...';
}

function readBrowserHandoffDraftId(handoff: BrowserHandoffRecord) {
  return typeof handoff.draftId === 'number'
    ? readPositiveInteger(handoff.draftId)
    : readPositiveInteger(Number(handoff.draftId));
}

function findPendingBrowserHandoff(handoffs: BrowserHandoffRecord[], draftId: number) {
  return handoffs.find((handoff) => handoff.status === 'pending' && readBrowserHandoffDraftId(handoff) === draftId) ?? null;
}

function isReadyBrowserHandoff(handoff: BrowserHandoffRecord) {
  return handoff.status === 'pending' && (handoff.readiness ?? 'ready') === 'ready';
}

function getBrowserHandoffBlockedMessage(handoff: BrowserHandoffRecord) {
  return handoff.sessionAction === 'relogin'
    ? '等待刷新 Session 后继续发布接管。'
    : '等待补充 Session 后继续发布接管。';
}

function toBrowserHandoffContract(handoff: BrowserHandoffRecord): BrowserHandoffContract {
  return {
    platform: handoff.platform,
    accountKey: handoff.accountKey,
    channelAccountId: handoff.channelAccountId,
    handoffAttempt: handoff.handoffAttempt,
    readiness: handoff.readiness ?? 'ready',
    sessionAction: readBrowserSessionAction(handoff.sessionAction),
    artifactPath: handoff.artifactPath,
  };
}

export function ReviewQueuePage({
  loadReviewQueueAction = loadReviewQueueRequest,
  loadBrowserHandoffsAction = defaultLoadReviewQueueBrowserHandoffsAction,
  updateReviewDraftAction = updateReviewDraftRequest,
  publishReviewDraftAction = publishReviewDraftRequest,
  scheduleReviewDraftAction = scheduleReviewDraftRequest,
  requestChannelAccountSessionActionAction = requestReviewQueueSessionActionRequest,
  completeBrowserHandoffAction = completeReviewQueueBrowserHandoffRequest,
  stateOverride,
  browserHandoffsStateOverride,
  projectIdDraft,
  onProjectIdDraftChange,
}: ReviewQueuePageProps) {
  const [localProjectIdDraft, setLocalProjectIdDraft] = useState('');
  const activeProjectIdDraft = projectIdDraft ?? localProjectIdDraft;
  const projectId = parseProjectId(activeProjectIdDraft);
  const shouldLoadBrowserHandoffsLive = browserHandoffsStateOverride === undefined;
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadReviewQueueAction() : loadReviewQueueAction(projectId)),
    [loadReviewQueueAction, projectId],
  );
  const { state: browserHandoffsState, reload: reloadBrowserHandoffs } = useAsyncQuery(
    () =>
      shouldLoadBrowserHandoffsLive
        ? loadBrowserHandoffsAction()
        : Promise.resolve({
            handoffs: [],
            total: 0,
          } satisfies BrowserHandoffsResponse),
    [loadBrowserHandoffsAction, shouldLoadBrowserHandoffsLive],
  );
  const [localDrafts, setLocalDrafts] = useState<DraftRecord[] | null>(null);
  const [scheduledAtById, setScheduledAtById] = useState<Record<number, string>>({});
  const [actionStateById, setActionStateById] = useState<Record<number, ReviewActionState>>({});
  const [sessionActionStateById, setSessionActionStateById] = useState<Record<number, SessionActionMutationState>>({});
  const [browserHandoffDraftByArtifactPath, setBrowserHandoffDraftByArtifactPath] = useState<
    Record<string, { publishUrl: string; message: string }>
  >({});
  const [browserHandoffCompletionStateById, setBrowserHandoffCompletionStateById] = useState<
    Record<number, BrowserHandoffCompletionMutationState>
  >({});
  const pendingDraftActionIdsRef = useRef<Set<number>>(new Set());
  const followUpScopeVersionRef = useRef(0);
  const publishFollowUpAttemptByIdRef = useRef<Record<number, number>>({});
  const displayState = stateOverride ?? state;
  const displayBrowserHandoffsState = browserHandoffsStateOverride ?? browserHandoffsState;
  const hasLiveReviewDrafts =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as DraftsResponse).drafts);
  const loadedReviewDrafts = hasLiveReviewDrafts
    ? filterReviewQueueDrafts((displayState.data as DraftsResponse).drafts)
    : [];
  const browserHandoffs =
    displayBrowserHandoffsState.status === 'success' && displayBrowserHandoffsState.data
      ? displayBrowserHandoffsState.data.handoffs
      : [];

  const visibleDrafts = hasLiveReviewDrafts ? (localDrafts ?? loadedReviewDrafts) : [];

  useEffect(() => {
    followUpScopeVersionRef.current += 1;
    publishFollowUpAttemptByIdRef.current = {};
    setActionStateById({});
    setSessionActionStateById({});
    setBrowserHandoffDraftByArtifactPath({});
    setBrowserHandoffCompletionStateById({});
  }, [projectId]);

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setLocalDrafts(filterReviewQueueDrafts(displayState.data.drafts));
    setScheduledAtById((currentScheduleById) => {
      const nextScheduleById = { ...currentScheduleById };

      for (const draft of filterReviewQueueDrafts(displayState.data.drafts)) {
        nextScheduleById[draft.id] = draft.scheduledAt ?? '';
      }

      return nextScheduleById;
    });
  }, [displayState]);

  function startDraftAction(draftId: number, action: ReviewActionState['action']) {
    if (pendingDraftActionIdsRef.current.has(draftId)) {
      return false;
    }

    pendingDraftActionIdsRef.current.add(draftId);
    setActionStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        action,
        publishUrl: null,
        contractMessage: null,
        contractStatus: null,
        contractDetails: null,
      },
    }));

    return true;
  }

  function finishDraftAction(draftId: number) {
    pendingDraftActionIdsRef.current.delete(draftId);
  }

  function nextPublishFollowUpAttempt(draftId: number) {
    const nextAttempt = (publishFollowUpAttemptByIdRef.current[draftId] ?? 0) + 1;
    publishFollowUpAttemptByIdRef.current[draftId] = nextAttempt;
    return nextAttempt;
  }

  function readPublishFollowUpAttempt(draftId: number) {
    return publishFollowUpAttemptByIdRef.current[draftId] ?? 0;
  }

  function clearBrowserHandoffDrafts(...artifactPaths: Array<string | null>) {
    const normalizedArtifactPaths = artifactPaths.filter((artifactPath): artifactPath is string => !!artifactPath);
    if (normalizedArtifactPaths.length === 0) {
      return;
    }

    setBrowserHandoffDraftByArtifactPath((currentState) => {
      const nextState = { ...currentState };
      for (const artifactPath of normalizedArtifactPaths) {
        delete nextState[artifactPath];
      }
      return nextState;
    });
  }

  function handleBrowserHandoffDraftChange(artifactPath: string, field: 'publishUrl' | 'message', value: string) {
    setBrowserHandoffDraftByArtifactPath((currentState) => ({
      ...currentState,
      [artifactPath]: {
        publishUrl: currentState[artifactPath]?.publishUrl ?? '',
        message: currentState[artifactPath]?.message ?? '',
        [field]: value,
      },
    }));
  }

  function applyCompletedBrowserHandoff(result: BrowserHandoffCompletionResponse) {
    setLocalDrafts((currentDrafts) => {
      if (result.draftStatus !== 'review') {
        return removeReviewQueueDraft(currentDrafts ?? visibleDrafts, result.draftId);
      }

      return currentDrafts ?? visibleDrafts;
    });
  }

  function reloadReviewQueueSurface() {
    void reload();
    void reloadBrowserHandoffs();
  }

  function handleRequestSessionAction(draftId: number, browserHandoff: BrowserHandoffContract) {
    if (!browserHandoff.channelAccountId || !browserHandoff.sessionAction) {
      return;
    }

    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const publishFollowUpAttempt = readPublishFollowUpAttempt(draftId);

    setSessionActionStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        artifactPath: null,
      },
    }));

    void requestChannelAccountSessionActionAction(browserHandoff.channelAccountId, {
      action: browserHandoff.sessionAction,
    })
      .then((result) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
          return;
        }
        setSessionActionStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'success',
            message: result.sessionAction.message,
            artifactPath: readSessionActionArtifactPath(result),
          },
        }));
      })
      .catch((error) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
          return;
        }
        setSessionActionStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'error',
            message: `提交 browser session 动作失败：${getErrorMessage(error)}`,
            artifactPath: null,
          },
        }));
      });
  }

  function handleCompleteBrowserHandoff(
    draftId: number,
    browserHandoff: BrowserHandoffContract,
    publishStatus: 'published' | 'failed',
  ) {
    if (!browserHandoff.artifactPath) {
      return;
    }

    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const publishFollowUpAttempt = readPublishFollowUpAttempt(draftId);
    const handoffDraft = browserHandoffDraftByArtifactPath[browserHandoff.artifactPath];
    const message = handoffDraft?.message.trim();
    const publishUrl = handoffDraft?.publishUrl.trim();

    setBrowserHandoffCompletionStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        error: null,
        result: null,
      },
    }));

    void completeBrowserHandoffAction({
      artifactPath: browserHandoff.artifactPath,
      handoffAttempt: browserHandoff.handoffAttempt,
      publishStatus,
      ...(message ? { message } : {}),
      ...(publishUrl ? { publishUrl } : {}),
    })
      .then((result) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
          return;
        }

        applyCompletedBrowserHandoff(result);
        setBrowserHandoffCompletionStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'success',
            error: null,
            result,
          },
        }));
        reloadReviewQueueSurface();
      })
      .catch((error) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
          return;
        }
        setBrowserHandoffCompletionStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'error',
            error: `Review browser handoff 结单失败：${getErrorMessage(error)}`,
            result: null,
          },
        }));
      });
  }

  async function handleReviewDraft(draftId: number, nextStatus: 'approved' | 'draft' | 'failed') {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ?? displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft || !startDraftAction(draftId, 'review')) {
      return;
    }

    try {
      const result = await updateReviewDraftAction(draftId, { status: nextStatus });
      setLocalDrafts((currentDrafts) =>
        upsertReviewQueueDraft(currentDrafts ?? visibleDrafts, result.draft),
      );
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: `${formatReviewActionLabel(nextStatus)}：${result.draft.title ?? result.draft.platform}`,
          error: null,
          action: 'review',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
          contractDetails: null,
        },
      }));
    } catch (error) {
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          action: 'review',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
          contractDetails: null,
        },
      }));
    }
    finally {
      finishDraftAction(draftId);
    }
  }

  async function handlePublishDraft(draftId: number) {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ?? displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft || !startDraftAction(draftId, 'publish')) {
      return;
    }

    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const previousBrowserHandoff = readBrowserHandoffContract(getReviewActionState(actionStateById, draftId).contractDetails);
    const publishFollowUpAttempt = nextPublishFollowUpAttempt(draftId);

    setSessionActionStateById((currentState) => ({
      ...currentState,
      [draftId]: createIdleSessionActionState(),
    }));
    setBrowserHandoffCompletionStateById((currentState) => ({
      ...currentState,
      [draftId]: createIdleBrowserHandoffCompletionState(),
    }));
    clearBrowserHandoffDrafts(previousBrowserHandoff?.artifactPath ?? null);

    try {
      const result = await publishReviewDraftAction(draftId);
      if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
        return;
      }
      if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
        return;
      }
      const publishSucceeded = result.success || result.status === 'queued';
      if (publishSucceeded) {
        setLocalDrafts((currentDrafts) => removeReviewQueueDraft(currentDrafts ?? visibleDrafts, draftId));
      }
      const nextActionState: ReviewActionState = {
        status:
          result.status === 'manual_required' || publishSucceeded
            ? 'success'
            : 'error',
        message:
          result.success
            ? `已发布：${sourceDraft.title ?? sourceDraft.platform}`
            : result.status === 'queued'
              ? `已入队等待发布：${sourceDraft.title ?? sourceDraft.platform}`
              : result.status === 'manual_required'
                ? `已生成人工接管回执：${sourceDraft.title ?? sourceDraft.platform}`
                : null,
        error:
          result.success || result.status === 'manual_required' || result.status === 'queued'
            ? null
            : result.message,
        action: 'publish',
        publishUrl: result.publishUrl,
        contractMessage: result.message,
        contractStatus: result.status ?? null,
        contractDetails: asRecord(result.details),
      };
      clearBrowserHandoffDrafts(readBrowserHandoffContract(nextActionState.contractDetails)?.artifactPath ?? null);
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: nextActionState,
      }));
    } catch (error) {
      if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
        return;
      }
      if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
        return;
      }
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          action: 'publish',
          publishUrl: null,
          contractMessage: getErrorMessage(error),
          contractStatus: 'failed',
          contractDetails: null,
        },
      }));
    }
    finally {
      finishDraftAction(draftId);
    }
  }

  async function handleScheduleDraft(draftId: number) {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ?? displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft || !startDraftAction(draftId, 'schedule')) {
      return;
    }

    const scheduledAt = scheduledAtById[draftId] ?? sourceDraft.scheduledAt ?? '';

    try {
      const result = await scheduleReviewDraftAction(draftId, {
        scheduledAt,
        status: 'scheduled',
      });
      setLocalDrafts((currentDrafts) =>
        upsertReviewQueueDraft(currentDrafts ?? visibleDrafts, result.draft),
      );
      setScheduledAtById((currentScheduleById) => ({
        ...currentScheduleById,
        [draftId]: result.draft.scheduledAt ?? '',
      }));
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: result.draft.scheduledAt
            ? `已排程：${result.draft.title ?? result.draft.platform}，排程时间：${result.draft.scheduledAt}`
            : `已标记待补排程：${result.draft.title ?? result.draft.platform}`,
          error: null,
          action: 'schedule',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
          contractDetails: null,
        },
      }));
    } catch (error) {
      setActionStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          action: 'schedule',
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
          contractDetails: null,
        },
      }));
    }
    finally {
      finishDraftAction(draftId);
    }
  }

  function handleReloadQueue() {
    followUpScopeVersionRef.current += 1;
    publishFollowUpAttemptByIdRef.current = {};
    setActionStateById({});
    setSessionActionStateById({});
    setBrowserHandoffDraftByArtifactPath({});
    setBrowserHandoffCompletionStateById({});
    reloadReviewQueueSurface();
  }

  function renderReviewDraftPublishFollowUp(
    draftId: number,
    actionState: ReviewActionState,
    persistedBrowserHandoffRecord: BrowserHandoffRecord | null,
  ) {
    const immediateBrowserHandoff =
      actionState.status === 'success' && actionState.contractStatus === 'manual_required'
        ? readBrowserHandoffContract(actionState.contractDetails)
        : null;
    const browserHandoff = immediateBrowserHandoff ?? (persistedBrowserHandoffRecord ? toBrowserHandoffContract(persistedBrowserHandoffRecord) : null);

    if (!browserHandoff) {
      return null;
    }
    const persistedBrowserHandoffFeedback =
      immediateBrowserHandoff === null && persistedBrowserHandoffRecord
        ? isReadyBrowserHandoff(persistedBrowserHandoffRecord)
          ? '发现待处理的 browser handoff，可以直接结单。'
          : getBrowserHandoffBlockedMessage(persistedBrowserHandoffRecord)
        : null;
    const sessionActionState = sessionActionStateById[draftId] ?? createIdleSessionActionState();
    const browserHandoffCompletionState =
      browserHandoffCompletionStateById[draftId] ?? createIdleBrowserHandoffCompletionState();
    const handoffDraft = browserHandoff.artifactPath
      ? browserHandoffDraftByArtifactPath[browserHandoff.artifactPath]
      : undefined;
    const shouldShowSessionActionButton =
      !!browserHandoff.channelAccountId &&
      (browserHandoff.sessionAction === 'request_session' || browserHandoff.sessionAction === 'relogin');
    const shouldShowBrowserHandoffCompletionActions =
      !!browserHandoff.artifactPath &&
      (browserHandoff.readiness ?? 'ready') === 'ready' &&
      (!browserHandoffCompletionState.result || browserHandoffCompletionState.result.draftId !== draftId);

    return (
      <div style={{ display: 'grid', gap: '10px' }}>
        {persistedBrowserHandoffFeedback ? (
          <p style={{ margin: 0, color: '#92400e', background: '#fffbeb', borderRadius: '12px', padding: '10px 12px' }}>
            {persistedBrowserHandoffFeedback}
          </p>
        ) : null}
        {shouldShowSessionActionButton ? (
          <div style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Browser Session 动作</span>
            <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
              <ActionButton
                label={
                  sessionActionState.status === 'loading'
                    ? formatSessionActionPendingLabel(browserHandoff.sessionAction as BrowserSessionAction)
                    : formatSessionActionLabel(browserHandoff.sessionAction as BrowserSessionAction)
                }
                tone="primary"
                onClick={() => {
                  handleRequestSessionAction(draftId, browserHandoff);
                }}
                disabled={sessionActionState.status === 'loading'}
                buttonAttributes={{
                  'data-review-session-action': browserHandoff.sessionAction ?? undefined,
                }}
              />
            </span>
            {sessionActionState.message ? <span>{sessionActionState.message}</span> : null}
            {sessionActionState.artifactPath ? (
              <span>Session 请求路径：{sessionActionState.artifactPath}</span>
            ) : null}
          </div>
        ) : null}
        {shouldShowBrowserHandoffCompletionActions ? (
          <div style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Review browser handoff 结单</span>
            <input
              data-review-browser-handoff-field="publishUrl"
              value={handoffDraft?.publishUrl ?? ''}
              onChange={(event) => {
                handleBrowserHandoffDraftChange(browserHandoff.artifactPath!, 'publishUrl', event.target.value);
              }}
              placeholder="publish URL（可选）"
              style={projectInputStyle}
            />
            <input
              data-review-browser-handoff-field="message"
              value={handoffDraft?.message ?? ''}
              onChange={(event) => {
                handleBrowserHandoffDraftChange(browserHandoff.artifactPath!, 'message', event.target.value);
              }}
              placeholder="结单备注（可选）"
              style={projectInputStyle}
            />
            <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
              <ActionButton
                label={browserHandoffCompletionState.status === 'loading' ? '正在结单...' : '标记已发布'}
                tone="primary"
                onClick={() => {
                  handleCompleteBrowserHandoff(draftId, browserHandoff, 'published');
                }}
                disabled={browserHandoffCompletionState.status === 'loading'}
                buttonAttributes={{
                  'data-review-browser-handoff-complete': 'published',
                }}
              />
              <ActionButton
                label={browserHandoffCompletionState.status === 'loading' ? '正在结单...' : '标记失败'}
                onClick={() => {
                  handleCompleteBrowserHandoff(draftId, browserHandoff, 'failed');
                }}
                disabled={browserHandoffCompletionState.status === 'loading'}
                buttonAttributes={{
                  'data-review-browser-handoff-complete': 'failed',
                }}
              />
            </span>
          </div>
        ) : null}
        {browserHandoffCompletionState.status === 'success' && browserHandoffCompletionState.result ? (
          <div style={{ display: 'grid', gap: '6px', color: '#166534' }}>
            <span>{`已结单 draft #${browserHandoffCompletionState.result.draftId} (${browserHandoffCompletionState.result.draftStatus})`}</span>
            {browserHandoffCompletionState.result.message ? (
              <span>{browserHandoffCompletionState.result.message}</span>
            ) : null}
            {browserHandoffCompletionState.result.publishUrl ? (
              <span>{browserHandoffCompletionState.result.publishUrl}</span>
            ) : null}
          </div>
        ) : null}
        {browserHandoffCompletionState.status === 'error' && browserHandoffCompletionState.error ? (
          <div style={{ color: '#b91c1c' }}>{browserHandoffCompletionState.error}</div>
        ) : null}
      </div>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Review Queue"
        title="Review Queue"
        description="页面直接读取真实 `/api/drafts?status=review` 数据，支持快速通过或退回最小审核动作。"
        actions={<ActionButton label="重新加载" onClick={handleReloadQueue} />}
      />

      <label style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
        <input
          value={activeProjectIdDraft}
          onChange={(event) => {
            if (projectIdDraft === undefined) {
              setLocalProjectIdDraft(event.target.value);
            }
            onProjectIdDraftChange?.(event.target.value);
          }}
          placeholder="例如 12"
          style={projectInputStyle}
        />
      </label>

      <SectionCard title="待审核草稿" description="默认只展示 status=review 的草稿。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载审核队列...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>审核队列加载失败：{displayState.error}</p>
        ) : null}

        {hasLiveReviewDrafts ? (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ fontWeight: 700 }}>已加载 {visibleDrafts.length} 条待审核草稿</div>

            {visibleDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无待审核草稿</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {visibleDrafts.map((draft) => {
                  const actionState = getReviewActionState(actionStateById, draft.id);
                  const persistedBrowserHandoffRecord = findPendingBrowserHandoff(browserHandoffs, draft.id);
                  const persistedBrowserHandoff = persistedBrowserHandoffRecord
                    ? toBrowserHandoffContract(persistedBrowserHandoffRecord)
                    : null;
                  const isDraftActionPending = actionState.status === 'loading';
                  const publishContract = getReviewDraftPublishContract(draft, actionState, persistedBrowserHandoff);
                  const scheduledAtValue = scheduledAtById[draft.id] ?? draft.scheduledAt ?? '';
                  const badgeStyle = getReviewDraftBadgeStyle(draft.status);

                  return (
                    <article
                      key={draft.id}
                      style={{
                        borderRadius: '18px',
                        border: '1px solid #dbe4f0',
                        padding: '18px',
                        background: '#f8fafc',
                        display: 'grid',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <strong>{draft.title ?? `${draft.platform} draft #${draft.id}`}</strong>
                        <span
                          style={{
                            borderRadius: '999px',
                            padding: '4px 10px',
                            background: badgeStyle.background,
                            color: badgeStyle.color,
                            fontWeight: 700,
                          }}
                        >
                          {formatReviewDraftBadgeLabel(draft.status)}
                        </span>
                      </div>

                      <div style={{ color: '#475569', lineHeight: 1.5 }}>{draft.content}</div>

                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#64748b', fontSize: '14px' }}>
                        <span>平台：{draft.platform}</span>
                        <span>更新时间：{draft.updatedAt}</span>
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
                        <div style={{ fontWeight: 700 }}>{formatReviewDraftDestination(draft, scheduledAtValue)}</div>
                        <div>计划推送时间：{scheduledAtValue.length > 0 ? scheduledAtValue : '未设置'}</div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-review-approve-id={draft.id}
                          disabled={isDraftActionPending}
                          onClick={() => {
                            void handleReviewDraft(draft.id, 'approved');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: 'none',
                            background: '#16a34a',
                            color: '#ffffff',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          通过
                        </button>
                        <button
                          type="button"
                          data-review-reject-id={draft.id}
                          disabled={isDraftActionPending}
                          onClick={() => {
                            void handleReviewDraft(draft.id, 'draft');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#122033',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          退回
                        </button>
                        <button
                          type="button"
                          data-review-discard-id={draft.id}
                          disabled={isDraftActionPending}
                          onClick={() => {
                            void handleReviewDraft(draft.id, 'failed');
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #fecaca',
                            background: '#fff1f2',
                            color: '#b91c1c',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          丢弃
                        </button>
                        <button
                          type="button"
                          data-review-publish-id={draft.id}
                          disabled={isDraftActionPending}
                          onClick={() => {
                            void handlePublishDraft(draft.id);
                          }}
                          style={{
                            borderRadius: '12px',
                            border: 'none',
                            background: '#2563eb',
                            color: '#ffffff',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          {manualHandoffReviewPlatforms.has(draft.platform) ? '转入人工接管' : '立即发布'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          type="datetime-local"
                          data-review-scheduled-at-id={draft.id}
                          disabled={isDraftActionPending}
                          value={scheduledAtById[draft.id] ?? draft.scheduledAt ?? ''}
                          onChange={(event) =>
                            setScheduledAtById((currentScheduleById) => ({
                              ...currentScheduleById,
                              [draft.id]: event.target.value,
                            }))
                          }
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#122033',
                            padding: '10px 12px',
                            font: 'inherit',
                          }}
                        />
                        <button
                          type="button"
                          data-review-schedule-id={draft.id}
                          disabled={isDraftActionPending}
                          onClick={() => {
                            void handleScheduleDraft(draft.id);
                          }}
                          style={{
                            borderRadius: '12px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#122033',
                            padding: '10px 14px',
                            fontWeight: 700,
                          }}
                        >
                          推入排程
                        </button>
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
                        <div style={{ fontWeight: 700 }}>Publish contract</div>
                        <div>
                          回执状态：
                          {publishContract.browserHandoff ? '人工接管' : formatPublishContractStatus(draft, actionState)}
                        </div>
                        <div>发布链接：{publishContract.publishUrl ?? '未返回'}</div>
                        <div>回执消息：{publishContract.contractMessage ?? '待触发发布'}</div>
                        {publishContract.browserHandoff?.readiness ? (
                          <div>Handoff 状态：{publishContract.browserHandoff.readiness}</div>
                        ) : null}
                        {publishContract.browserHandoff?.sessionAction ? (
                          <div>Handoff 动作：{publishContract.browserHandoff.sessionAction}</div>
                        ) : null}
                        {publishContract.browserHandoff?.artifactPath ? (
                          <div>Handoff 路径：{publishContract.browserHandoff.artifactPath}</div>
                        ) : null}
                        {publishContract.publishError ? <div>最近错误：{publishContract.publishError}</div> : null}
                      </div>

                      {renderReviewDraftPublishFollowUp(draft.id, actionState, persistedBrowserHandoffRecord)}

                      {actionState.status === 'loading' ? (
                        <p style={{ margin: 0, color: '#334155' }}>
                          {actionState.action === 'publish'
                            ? '正在发布...'
                            : actionState.action === 'schedule'
                              ? '正在保存排程...'
                              : '正在提交审核动作...'}
                        </p>
                      ) : null}
                      {actionState.status === 'success' && actionState.message ? (
                        <p style={{ margin: 0, color: '#166534', fontWeight: 700 }}>{actionState.message}</p>
                      ) : null}
                      {actionState.status === 'error' && actionState.error ? (
                        <p style={{ margin: 0, color: '#b91c1c', fontWeight: 700 }}>
                          {formatReviewActionErrorPrefix(actionState.action)}：{actionState.error}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}

            {Object.values(actionStateById).some((state) => state.status === 'success') ? (
              <div style={{ display: 'grid', gap: '6px', color: '#166534', fontWeight: 700 }}>
                {Object.values(actionStateById)
                  .filter((state): state is ReviewActionState & { message: string } => state.status === 'success' && Boolean(state.message))
                  .map((state, index) => (
                    <div
                      key={`${index}-${state.message}`}
                      style={{
                        borderRadius: '14px',
                        border: '1px solid #bbf7d0',
                        background: '#f0fdf4',
                        padding: '12px 14px',
                        display: 'grid',
                        gap: '6px',
                      }}
                    >
                      <div>{state.message}</div>
                      {state.action === 'publish' ? (
                        <>
                          <div>回执状态：{formatPublishActionSummaryStatus(state)}</div>
                          <div>发布链接：{state.publishUrl ?? '未返回'}</div>
                          <div>回执消息：{state.contractMessage ?? '待触发发布'}</div>
                          {readBrowserHandoffContract(state.contractDetails)?.readiness ? (
                            <div>Handoff 状态：{readBrowserHandoffContract(state.contractDetails)?.readiness}</div>
                          ) : null}
                          {readBrowserHandoffContract(state.contractDetails)?.artifactPath ? (
                            <div>
                              Handoff 路径：
                              {readBrowserHandoffContract(state.contractDetails)?.artifactPath}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>初始化后会自动加载真实审核队列。</p>
        ) : null}
      </SectionCard>
    </section>
  );
}
