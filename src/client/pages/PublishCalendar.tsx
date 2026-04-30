import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { DraftRecord, DraftsResponse } from '../lib/drafts';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';

export type { DraftRecord, DraftsResponse } from '../lib/drafts';

type CalendarDraftStatus = 'scheduled' | 'published';
type BrowserSessionAction = 'request_session' | 'relogin';

export interface UpdatePublishCalendarDraftScheduleResponse {
  draft: DraftRecord;
}

export interface RetryPublishCalendarDraftResponse {
  success: boolean;
  status?: string;
  publishUrl: string | null;
  message: string;
  details?: Record<string, unknown>;
}

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
  platform: string;
  channelAccountId?: number;
  draftId: number | string;
  title: string | null;
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

interface BrowserHandoffsResponse {
  handoffs: BrowserHandoffRecord[];
  total: number;
}

interface BrowserHandoffContract {
  platform: string | null;
  accountKey: string | null;
  channelAccountId?: number;
  readiness: string | null;
  sessionAction: BrowserSessionAction | null;
  artifactPath: string | null;
}

interface PublishCalendarPageProps {
  loadDraftsAction?: (projectId?: number) => Promise<DraftsResponse>;
  loadBrowserHandoffsAction?: () => Promise<BrowserHandoffsResponse>;
  updateDraftScheduleAction?: (
    id: number,
    input: { scheduledAt: string | null },
  ) => Promise<UpdatePublishCalendarDraftScheduleResponse>;
  retryPublishDraftAction?: (id: number) => Promise<RetryPublishCalendarDraftResponse>;
  requestChannelAccountSessionActionAction?: (
    accountId: number,
    input?: RequestChannelAccountSessionActionPayload,
  ) => Promise<RequestChannelAccountSessionActionResponse>;
  completeBrowserHandoffAction?: (input: CompleteBrowserHandoffInput) => Promise<BrowserHandoffCompletionResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
  browserHandoffsStateOverride?: AsyncState<BrowserHandoffsResponse>;
}

interface ScheduleMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  action: 'schedule' | 'retry' | null;
  publishUrl: string | null;
  contractMessage: string | null;
  contractStatus: string | null;
  contractDetails: Record<string, unknown> | null;
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

export async function loadPublishCalendarBrowserHandoffsRequest(limit = 100): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(`/api/system/browser-handoffs?limit=${limit}`);
}

function defaultLoadPublishCalendarBrowserHandoffsAction() {
  return loadPublishCalendarBrowserHandoffsRequest(100);
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

export async function retryPublishCalendarDraftRequest(id: number): Promise<RetryPublishCalendarDraftResponse> {
  return apiRequest<RetryPublishCalendarDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

export async function requestPublishCalendarSessionActionRequest(
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

export async function completePublishCalendarBrowserHandoffRequest(
  input: CompleteBrowserHandoffInput,
): Promise<BrowserHandoffCompletionResponse> {
  return apiRequest<BrowserHandoffCompletionResponse>('/api/system/browser-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
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

function isCalendarDraftStatus(status: DraftRecord['status']): status is CalendarDraftStatus {
  return calendarStatuses.includes(status as CalendarDraftStatus);
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

function readPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readBrowserSessionAction(value: unknown): BrowserSessionAction | null {
  const normalizedValue = readString(value);
  return normalizedValue === 'request_session' || normalizedValue === 'relogin' ? normalizedValue : null;
}

function readBrowserHandoffContract(details: Record<string, unknown> | null): BrowserHandoffContract | null {
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
  const readiness = readString(browserHandoff.readiness);

  if (!platform && !accountKey && !channelAccountId && !readiness && !sessionAction && !artifactPath) {
    return null;
  }

  return {
    platform,
    accountKey,
    channelAccountId,
    readiness,
    sessionAction,
    artifactPath,
  };
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
    readiness: handoff.readiness ?? 'ready',
    sessionAction: readBrowserSessionAction(handoff.sessionAction),
    artifactPath: handoff.artifactPath,
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

function formatCalendarDraftStateDescription(draft: DraftRecord, scheduledAt: string) {
  if (draft.status === 'failed') {
    return '当前排程状态：最近一次发布失败，可直接重试。';
  }

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
    action: null,
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
  };
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

function createLoadingMutationState(action: ScheduleMutationState['action']): ScheduleMutationState {
  return {
    status: 'loading',
    message: null,
    error: null,
    action,
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
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
    action: 'schedule',
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
  };
}

function createScheduleErrorState(error: string): ScheduleMutationState {
  return {
    status: 'error',
    message: null,
    error,
    action: 'schedule',
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
  };
}

function isHandledRetryResult(result: RetryPublishCalendarDraftResponse) {
  return result.success || result.status === 'manual_required' || result.status === 'queued';
}

function formatPublishContractStatus(draft: DraftRecord, mutationState: ScheduleMutationState) {
  if (mutationState.action === 'retry') {
    if (mutationState.status === 'loading') {
      return '处理中';
    }

    if (mutationState.status === 'error') {
      return '失败';
    }
  }

  if (mutationState.contractStatus === 'queued') {
    return '已入队';
  }

  if (mutationState.contractStatus === 'manual_required') {
    return '人工接管';
  }

  if (mutationState.contractStatus === 'published' || draft.status === 'published') {
    return '已发布';
  }

  if (mutationState.action === 'retry' && mutationState.status === 'success') {
    return '已确认';
  }

  if (draft.status === 'published') {
    return '已发布';
  }

  if (draft.status === 'failed') {
    return '失败';
  }

  return '待触发';
}

function getDraftPublishContract(draft: DraftRecord, mutationState: ScheduleMutationState) {
  const draftRecord = asRecord(draft);
  const browserHandoff = readBrowserHandoffContract(mutationState.contractDetails);

  return {
    publishUrl:
      mutationState.action === 'retry'
        ? mutationState.publishUrl ??
          readString(draftRecord?.publishUrl) ??
          readString(draftRecord?.lastPublishUrl) ??
          readString(draftRecord?.url)
        : readString(draftRecord?.publishUrl) ??
          readString(draftRecord?.lastPublishUrl) ??
          readString(draftRecord?.url),
    contractMessage:
      mutationState.action === 'retry'
        ? mutationState.contractMessage ??
          readString(draftRecord?.publishMessage) ??
          readString(draftRecord?.lastPublishMessage) ??
          readString(draftRecord?.message)
        : readString(draftRecord?.publishMessage) ??
          readString(draftRecord?.lastPublishMessage) ??
          readString(draftRecord?.message),
    publishError:
      mutationState.action === 'retry'
        ? mutationState.error ?? readString(draftRecord?.lastPublishError) ?? readString(draftRecord?.publishError)
        : readString(draftRecord?.lastPublishError) ?? readString(draftRecord?.publishError),
    browserHandoff,
  };
}

export function PublishCalendarPage({
  loadDraftsAction = loadPublishCalendarRequest,
  loadBrowserHandoffsAction = defaultLoadPublishCalendarBrowserHandoffsAction,
  updateDraftScheduleAction = updatePublishCalendarDraftScheduleRequest,
  retryPublishDraftAction = retryPublishCalendarDraftRequest,
  requestChannelAccountSessionActionAction = requestPublishCalendarSessionActionRequest,
  completeBrowserHandoffAction = completePublishCalendarBrowserHandoffRequest,
  stateOverride,
  browserHandoffsStateOverride,
}: PublishCalendarPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const shouldLoadBrowserHandoffsLive = browserHandoffsStateOverride === undefined;
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadDraftsAction() : loadDraftsAction(projectId)),
    [loadDraftsAction, projectId],
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
  const { run: updateSchedule } = useAsyncAction(
    ({ id, scheduledAt }: { id: number; scheduledAt: string | null }) =>
      updateDraftScheduleAction(id, { scheduledAt }),
  );
  const { run: retryPublish } = useAsyncAction((id: number) => retryPublishDraftAction(id));
  const [draftsById, setDraftsById] = useState<Record<number, DraftRecord>>({});
  const [scheduledAtById, setScheduledAtById] = useState<Record<number, string>>({});
  const [mutationStateById, setMutationStateById] = useState<Record<number, ScheduleMutationState>>({});
  const [calendarFeedback, setCalendarFeedback] = useState<ScheduleMutationState>(createIdleMutationState());
  const [sessionActionStateById, setSessionActionStateById] = useState<Record<number, SessionActionMutationState>>({});
  const [browserHandoffDraftByArtifactPath, setBrowserHandoffDraftByArtifactPath] = useState<
    Record<string, { publishUrl: string; message: string }>
  >({});
  const [browserHandoffCompletionStateById, setBrowserHandoffCompletionStateById] = useState<
    Record<number, BrowserHandoffCompletionMutationState>
  >({});
  const followUpScopeVersionRef = useRef(0);
  const retryFollowUpAttemptByIdRef = useRef<Record<number, number>>({});
  const displayState = stateOverride ?? state;
  const displayBrowserHandoffsState = browserHandoffsStateOverride ?? browserHandoffsState;
  const hasLiveDrafts =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as DraftsResponse).drafts);
  const browserHandoffs =
    displayBrowserHandoffsState.status === 'success' && displayBrowserHandoffsState.data
      ? displayBrowserHandoffsState.data.handoffs
      : [];
  const visibleDrafts = hasLiveDrafts
    ? (displayState.data as DraftsResponse).drafts.map((draft) => draftsById[draft.id] ?? draft)
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
    followUpScopeVersionRef.current += 1;
    retryFollowUpAttemptByIdRef.current = {};
    setCalendarFeedback(createIdleMutationState());
    setMutationStateById({});
    setSessionActionStateById({});
    setBrowserHandoffDraftByArtifactPath({});
    setBrowserHandoffCompletionStateById({});
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
  const failedDrafts = visibleDrafts.filter((draft) => draft.status === 'failed');

  function getMutationState(draftId: number) {
    return mutationStateById[draftId] ?? createIdleMutationState();
  }

  function getDisplayMutationState(draft: DraftRecord) {
    const currentMutationState = getMutationState(draft.id);
    if (currentMutationState.status !== 'idle') {
      return currentMutationState;
    }

    const persistedBrowserHandoff = findPendingBrowserHandoff(browserHandoffs, draft.id);
    if (!persistedBrowserHandoff || draft.status === 'published' || draft.status === 'scheduled') {
      return currentMutationState;
    }

    return {
      status: 'success',
      message: `已恢复人工接管：${draft.title ?? `${draft.platform} draft #${draft.id}`}`,
      error: null,
      action: 'retry',
      publishUrl: null,
      contractMessage: isReadyBrowserHandoff(persistedBrowserHandoff)
        ? '发现待处理的 browser handoff，可以直接结单。'
        : getBrowserHandoffBlockedMessage(persistedBrowserHandoff),
      contractStatus: 'manual_required',
      contractDetails: {
        browserHandoff: toBrowserHandoffContract(persistedBrowserHandoff),
      },
    } satisfies ScheduleMutationState;
  }

  function nextRetryFollowUpAttempt(draftId: number) {
    const nextAttempt = (retryFollowUpAttemptByIdRef.current[draftId] ?? 0) + 1;
    retryFollowUpAttemptByIdRef.current[draftId] = nextAttempt;
    return nextAttempt;
  }

  function readRetryFollowUpAttempt(draftId: number) {
    return retryFollowUpAttemptByIdRef.current[draftId] ?? 0;
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

  function reloadCalendarSurface() {
    void reload();
    void reloadBrowserHandoffs();
  }

  function applyCompletedBrowserHandoff(result: BrowserHandoffCompletionResponse) {
    setDraftsById((currentState) => {
      const sourceDraft = currentState[result.draftId] ?? visibleDrafts.find((draft) => draft.id === result.draftId);
      if (!sourceDraft) {
        return currentState;
      }

      return {
        ...currentState,
        [result.draftId]: {
          ...sourceDraft,
          status:
            result.draftStatus === 'published' || result.draftStatus === 'scheduled'
              ? result.draftStatus
              : sourceDraft.status,
          ...(result.publishUrl ? { publishUrl: result.publishUrl, lastPublishUrl: result.publishUrl } : {}),
          ...(result.message ? { publishMessage: result.message, lastPublishMessage: result.message } : {}),
          ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
          updatedAt: result.publishedAt ?? sourceDraft.updatedAt,
        } as DraftRecord,
      };
    });

    setMutationStateById((currentState) => ({
      ...currentState,
      [result.draftId]: {
        status: 'success',
        message: result.message,
        error: null,
        action: 'retry',
        publishUrl: result.publishUrl,
        contractMessage: result.message,
        contractStatus: result.status,
        contractDetails: null,
      },
    }));
    clearBrowserHandoffDrafts(result.artifactPath);
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
      [draft.id]: createLoadingMutationState('schedule'),
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

  async function handleRetryPublish(draft: DraftRecord) {
    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const previousBrowserHandoff = readBrowserHandoffContract(getMutationState(draft.id).contractDetails);
    const retryFollowUpAttempt = nextRetryFollowUpAttempt(draft.id);

    setCalendarFeedback(createIdleMutationState());
    setMutationStateById((current) => ({
      ...current,
      [draft.id]: createLoadingMutationState('retry'),
    }));
    setSessionActionStateById((currentState) => ({
      ...currentState,
      [draft.id]: createIdleSessionActionState(),
    }));
    setBrowserHandoffCompletionStateById((currentState) => ({
      ...currentState,
      [draft.id]: createIdleBrowserHandoffCompletionState(),
    }));
    clearBrowserHandoffDrafts(previousBrowserHandoff?.artifactPath ?? null);

    try {
      const result = await retryPublish(draft.id);
      if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
        return;
      }
      if (retryFollowUpAttempt !== readRetryFollowUpAttempt(draft.id)) {
        return;
      }

      const nextMutationState: ScheduleMutationState = {
        status: isHandledRetryResult(result) ? 'success' : 'error',
        message:
          result.success
            ? result.message
            : result.status === 'queued'
              ? `已入队等待发布：${draft.title ?? draft.platform}`
              : result.status === 'manual_required'
                ? `已生成人工接管回执：${draft.title ?? draft.platform}`
                : null,
        error: isHandledRetryResult(result) ? null : result.message,
        action: 'retry',
        publishUrl: result.publishUrl,
        contractMessage: result.message,
        contractStatus: result.status ?? (result.success ? 'published' : null),
        contractDetails: asRecord(result.details),
      };

      setDraftsById((current) => ({
        ...current,
        [draft.id]: {
          ...draft,
          status: result.success || result.status === 'published' ? 'published' : draft.status,
          ...(result.publishUrl ? { publishUrl: result.publishUrl, lastPublishUrl: result.publishUrl } : {}),
          ...(result.message ? { publishMessage: result.message, lastPublishMessage: result.message } : {}),
        } as DraftRecord,
      }));
      clearBrowserHandoffDrafts(readBrowserHandoffContract(nextMutationState.contractDetails)?.artifactPath ?? null);
      setMutationStateById((current) => ({
        ...current,
        [draft.id]: nextMutationState,
      }));
      setCalendarFeedback({
        status: isHandledRetryResult(result) ? 'success' : 'error',
        message: isHandledRetryResult(result) ? result.message : null,
        error: isHandledRetryResult(result) ? null : result.message,
        action: 'retry',
        publishUrl: result.publishUrl,
        contractMessage: result.message,
        contractStatus: nextMutationState.contractStatus,
        contractDetails: nextMutationState.contractDetails,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const nextErrorState: ScheduleMutationState = {
        status: 'error',
        message: null,
        error: errorMessage,
        action: 'retry',
        publishUrl: null,
        contractMessage: errorMessage,
        contractStatus: 'failed',
        contractDetails: null,
      };
      if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
        return;
      }
      if (retryFollowUpAttempt !== readRetryFollowUpAttempt(draft.id)) {
        return;
      }
      setCalendarFeedback(nextErrorState);
      setMutationStateById((current) => ({
        ...current,
        [draft.id]: nextErrorState,
      }));
    }
  }

  function handleRequestSessionAction(draftId: number, browserHandoff: BrowserHandoffContract) {
    if (!browserHandoff.channelAccountId || !browserHandoff.sessionAction) {
      return;
    }

    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const retryFollowUpAttempt = readRetryFollowUpAttempt(draftId);

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
        if (retryFollowUpAttempt !== readRetryFollowUpAttempt(draftId)) {
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
        if (retryFollowUpAttempt !== readRetryFollowUpAttempt(draftId)) {
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
    const retryFollowUpAttempt = readRetryFollowUpAttempt(draftId);
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
      publishStatus,
      ...(message ? { message } : {}),
      ...(publishUrl ? { publishUrl } : {}),
    })
      .then((result) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (retryFollowUpAttempt !== readRetryFollowUpAttempt(draftId)) {
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
        reloadCalendarSurface();
      })
      .catch((error) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (retryFollowUpAttempt !== readRetryFollowUpAttempt(draftId)) {
          return;
        }
        setBrowserHandoffCompletionStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'error',
            error: `Publish browser handoff 结单失败：${getErrorMessage(error)}`,
            result: null,
          },
        }));
      });
  }

  function handleReloadCalendar() {
    followUpScopeVersionRef.current += 1;
    retryFollowUpAttemptByIdRef.current = {};
    setCalendarFeedback(createIdleMutationState());
    setMutationStateById({});
    setSessionActionStateById({});
    setBrowserHandoffDraftByArtifactPath({});
    setBrowserHandoffCompletionStateById({});
    reloadCalendarSurface();
  }

  function renderRetryPublishFollowUp(draftId: number, mutationState: ScheduleMutationState) {
    if (mutationState.status !== 'success' || mutationState.action !== 'retry' || mutationState.contractStatus !== 'manual_required') {
      return null;
    }

    const browserHandoff = readBrowserHandoffContract(mutationState.contractDetails);
    if (!browserHandoff) {
      return null;
    }

    const sessionActionState = sessionActionStateById[draftId] ?? createIdleSessionActionState();
    const browserHandoffCompletionState =
      browserHandoffCompletionStateById[draftId] ?? createIdleBrowserHandoffCompletionState();
    const handoffDraft = browserHandoff.artifactPath
      ? browserHandoffDraftByArtifactPath[browserHandoff.artifactPath]
      : undefined;
    const shouldShowSessionActionButton =
      !!browserHandoff.channelAccountId &&
      (browserHandoff.sessionAction === 'request_session' || browserHandoff.sessionAction === 'relogin');
    const browserHandoffIsReady = (browserHandoff.readiness ?? 'ready') === 'ready';
    const shouldShowBrowserHandoffCompletionActions =
      !!browserHandoff.artifactPath &&
      browserHandoffIsReady &&
      (!browserHandoffCompletionState.result || browserHandoffCompletionState.result.draftId !== draftId);

    return (
      <div style={{ display: 'grid', gap: '10px' }}>
        {mutationState.message ? <div>{mutationState.message}</div> : null}
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
                  'data-calendar-session-action': browserHandoff.sessionAction ?? undefined,
                }}
              />
            </span>
            {sessionActionState.message ? <span>{sessionActionState.message}</span> : null}
            {sessionActionState.artifactPath ? <span>Session 请求路径：{sessionActionState.artifactPath}</span> : null}
          </div>
        ) : null}
        {shouldShowBrowserHandoffCompletionActions ? (
          <div style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Publish browser handoff 结单</span>
            <input
              data-calendar-browser-handoff-field="publishUrl"
              value={handoffDraft?.publishUrl ?? ''}
              onChange={(event) => {
                handleBrowserHandoffDraftChange(browserHandoff.artifactPath!, 'publishUrl', event.target.value);
              }}
              placeholder="publish URL（可选）"
              style={projectInputStyle}
            />
            <input
              data-calendar-browser-handoff-field="message"
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
                  'data-calendar-browser-handoff-complete': 'published',
                }}
              />
              <ActionButton
                label={browserHandoffCompletionState.status === 'loading' ? '正在结单...' : '标记失败'}
                onClick={() => {
                  handleCompleteBrowserHandoff(draftId, browserHandoff, 'failed');
                }}
                disabled={browserHandoffCompletionState.status === 'loading'}
                buttonAttributes={{
                  'data-calendar-browser-handoff-complete': 'failed',
                }}
              />
            </span>
          </div>
        ) : null}
        {browserHandoffCompletionState.status === 'success' && browserHandoffCompletionState.result ? (
          <div style={{ display: 'grid', gap: '6px', color: '#166534' }}>
            <span>{`已结单 draft #${browserHandoffCompletionState.result.draftId} (${browserHandoffCompletionState.result.draftStatus})`}</span>
            {browserHandoffCompletionState.result.message ? <span>{browserHandoffCompletionState.result.message}</span> : null}
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
        eyebrow="Publish Queue"
        title="Publish Calendar"
        description="当前页是草稿状态视图，不等同于真实 job_queue 或发布执行结果。"
        actions={<ActionButton label="重新加载 Calendar" onClick={handleReloadCalendar} />}
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

        {hasLiveDrafts ? (
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
              <div
                style={{
                  minWidth: '140px',
                  borderRadius: '16px',
                  padding: '14px 16px',
                  background: '#fee2e2',
                  color: '#b91c1c',
                  fontWeight: 700,
                }}
              >
                发布失败 {failedDrafts.length}
              </div>
            </div>

            {calendarDrafts.length === 0 && failedDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无 scheduled 或 published 草稿。</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {[...calendarDrafts, ...failedDrafts].map((draft) => {
                  const mutationState = getDisplayMutationState(draft);
                  const scheduledAt = getScheduledAtValue(draft);
                  const publishContract = getDraftPublishContract(draft, mutationState);
                  const shouldShowPublishContract =
                    draft.status === 'published' ||
                    draft.status === 'failed' ||
                    !!publishContract.publishUrl ||
                    !!publishContract.contractMessage ||
                    !!publishContract.publishError ||
                    mutationState.action === 'retry';

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
                              draft.status === 'failed'
                                ? '#fee2e2'
                                : draft.status === 'published'
                                  ? '#dcfce7'
                                  : scheduledAt.length > 0
                                    ? '#dbeafe'
                                    : '#fef3c7',
                            color:
                              draft.status === 'failed'
                                ? '#b91c1c'
                                : draft.status === 'published'
                                  ? '#047857'
                                  : scheduledAt.length > 0
                                    ? '#1d4ed8'
                                    : '#92400e',
                            fontWeight: 700,
                          }}
                        >
                          {draft.status === 'failed' ? '发布失败' : formatCalendarPhaseLabel(draft, scheduledAt)}
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
                        {shouldShowPublishContract ? (
                          <>
                            <div>回执状态：{formatPublishContractStatus(draft, mutationState)}</div>
                            <div>发布链接：{publishContract.publishUrl ?? '未返回'}</div>
                            <div>回执消息：{publishContract.contractMessage ?? '等待 contract 字段'}</div>
                            {publishContract.publishError ? <div>最近错误：{publishContract.publishError}</div> : null}
                            {publishContract.browserHandoff?.readiness ? (
                              <div>Handoff 状态：{publishContract.browserHandoff.readiness}</div>
                            ) : null}
                            {publishContract.browserHandoff?.sessionAction ? (
                              <div>Handoff 动作：{publishContract.browserHandoff.sessionAction}</div>
                            ) : null}
                            {publishContract.browserHandoff?.artifactPath ? (
                              <div>Handoff 路径：{publishContract.browserHandoff.artifactPath}</div>
                            ) : null}
                          </>
                        ) : (
                          <div>排程草稿尚未进入发布回执阶段。</div>
                        )}
                      </div>

                      {draft.status === 'failed' ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <button
                            type="button"
                            data-calendar-retry-id={String(draft.id)}
                            onClick={() => {
                              void handleRetryPublish(draft);
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
                            {mutationState.status === 'loading' ? '正在重试发布...' : '重试发布'}
                          </button>
                          {mutationState.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>重试发布失败：{mutationState.error}</div>
                          ) : null}
                          {renderRetryPublishFollowUp(draft.id, mutationState)}
                        </div>
                      ) : null}

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
                          {mutationState.status === 'success' && mutationState.action === 'schedule' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {mutationState.message}
                              {scheduledAt ? `，排程时间：${scheduledAt}` : ''}
                            </div>
                          ) : null}
                          {mutationState.status === 'error' && mutationState.action === 'schedule' ? (
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
