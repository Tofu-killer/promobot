import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { SectionCard } from '../components/SectionCard';

interface PlatformOption {
  label: string;
  value: string;
  launchStatus: 'ready' | 'manual' | 'later';
  launchBadge: string;
}

const platformOptions: PlatformOption[] = [
  { label: 'X / Twitter', value: 'x', launchStatus: 'ready', launchBadge: '首发可用' },
  { label: 'Reddit', value: 'reddit', launchStatus: 'ready', launchBadge: '首发可用' },
  { label: 'Blog', value: 'blog', launchStatus: 'ready', launchBadge: '首发可用' },
  { label: 'Facebook Group', value: 'facebook-group', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: 'Instagram', value: 'instagram', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: 'TikTok', value: 'tiktok', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: '小红书', value: 'xiaohongshu', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: '微博', value: 'weibo', launchStatus: 'manual', launchBadge: '人工接管' },
];

const defaultLaunchPlatforms = platformOptions
  .filter((platform) => platform.launchStatus === 'ready')
  .map((platform) => platform.value);

const toneOptions = [
  { label: '专业', value: 'professional' },
  { label: '轻松', value: 'casual' },
  { label: '激动人心', value: 'exciting' },
] as const;

const generationProgressStages = [
  {
    title: '已接收生成请求',
    description: '正在校验输入并锁定本次生成配置。',
  },
  {
    title: '正在拆解平台策略',
    description: '按渠道语气和发布方式组织这一轮生成上下文。',
  },
  {
    title: '正在生成平台草稿',
    description: '逐个平台写入标题、正文和 hashtags。',
  },
] as const;

function parseProjectId(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function getProjectIdValidationError(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return null;
  }

  return parseProjectId(value) === undefined ? '项目 ID 必须是大于 0 的整数' : null;
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

export interface GenerateDraftsPayload {
  topic: string;
  tone: string;
  platforms: string[];
  saveAsDraft?: boolean;
  projectId?: number;
}

export interface GenerateDraftsResponse {
  results: Array<{
    platform: string;
    title?: string;
    content: string;
    hashtags: string[];
    draftId?: number;
  }>;
}

export interface SendDraftToReviewResponse {
  draft: {
    id: number;
    platform: string;
    title?: string;
    content: string;
    hashtags: string[];
    status: string;
  };
}

export interface PublishGeneratedDraftResponse {
  success: boolean;
  status?: string;
  publishUrl: string | null;
  message: string;
  details?: Record<string, unknown>;
}

export interface ScheduleGeneratedDraftResponse {
  draft: {
    id: number;
    status: string;
    scheduledAt?: string | null;
  };
}

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

export async function generateDraftsRequest(input: GenerateDraftsPayload): Promise<GenerateDraftsResponse> {
  return apiRequest<GenerateDraftsResponse>('/api/content/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function publishGeneratedDraftRequest(id: number): Promise<PublishGeneratedDraftResponse> {
  return apiRequest<PublishGeneratedDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

export async function loadGeneratedDraftBrowserHandoffsRequest(limit = 100): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(`/api/system/browser-handoffs?limit=${limit}`);
}

function defaultLoadGeneratedDraftBrowserHandoffsAction() {
  return loadGeneratedDraftBrowserHandoffsRequest(100);
}

export async function requestGeneratedDraftSessionActionRequest(
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

export async function completeGeneratedDraftBrowserHandoffRequest(
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

export async function scheduleGeneratedDraftRequest(
  id: number,
  input: { scheduledAt: string | null },
): Promise<ScheduleGeneratedDraftResponse> {
  return apiRequest<ScheduleGeneratedDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function sendDraftToReviewRequest(id: number): Promise<SendDraftToReviewResponse> {
  return apiRequest<SendDraftToReviewResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'review' }),
  });
}

interface ReviewMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  reviewStatus: string | null;
}

interface PublishMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  publishUrl: string | null;
  contractMessage: string | null;
  contractStatus: string | null;
  contractDetails: Record<string, unknown> | null;
}

interface ScheduleMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
}

interface GeneratePageProps {
  generateAction?: (input: GenerateDraftsPayload) => Promise<GenerateDraftsResponse>;
  sendDraftToReviewAction?: (id: number) => Promise<SendDraftToReviewResponse>;
  publishGeneratedDraftAction?: (id: number) => Promise<PublishGeneratedDraftResponse>;
  loadBrowserHandoffsAction?: () => Promise<BrowserHandoffsResponse>;
  requestChannelAccountSessionActionAction?: (
    accountId: number,
    input?: RequestChannelAccountSessionActionPayload,
  ) => Promise<RequestChannelAccountSessionActionResponse>;
  completeBrowserHandoffAction?: (input: CompleteBrowserHandoffInput) => Promise<BrowserHandoffCompletionResponse>;
  scheduleGeneratedDraftAction?: (
    id: number,
    input: { scheduledAt: string | null },
  ) => Promise<ScheduleGeneratedDraftResponse>;
  stateOverride?: AsyncState<GenerateDraftsResponse>;
  browserHandoffsStateOverride?: AsyncState<BrowserHandoffsResponse>;
  projectIdDraft?: string;
  onProjectIdDraftChange?: (value: string) => void;
}

function createIdleReviewMutationState(): ReviewMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
    reviewStatus: null,
  };
}

function createIdlePublishMutationState(): PublishMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
  };
}

function createIdleScheduleMutationState(): ScheduleMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readPositiveInteger(value: unknown): number | undefined {
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

export function GeneratePage({
  generateAction = generateDraftsRequest,
  sendDraftToReviewAction = sendDraftToReviewRequest,
  publishGeneratedDraftAction = publishGeneratedDraftRequest,
  loadBrowserHandoffsAction = defaultLoadGeneratedDraftBrowserHandoffsAction,
  requestChannelAccountSessionActionAction = requestGeneratedDraftSessionActionRequest,
  completeBrowserHandoffAction = completeGeneratedDraftBrowserHandoffRequest,
  scheduleGeneratedDraftAction = scheduleGeneratedDraftRequest,
  stateOverride,
  browserHandoffsStateOverride,
  projectIdDraft,
  onProjectIdDraftChange,
}: GeneratePageProps) {
  const [topic, setTopic] = useState('We added a cheaper Claude-compatible endpoint for Australian customers.');
  const [localProjectIdDraft, setLocalProjectIdDraft] = useState('');
  const activeProjectIdDraft = projectIdDraft ?? localProjectIdDraft;
  const projectId = parseProjectId(activeProjectIdDraft);
  const projectIdValidationError = getProjectIdValidationError(activeProjectIdDraft);
  const [tone, setTone] = useState<(typeof toneOptions)[number]['value']>('professional');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(defaultLaunchPlatforms);
  const [reviewStateByDraftId, setReviewStateByDraftId] = useState<Record<number, ReviewMutationState>>({});
  const [publishStateByDraftId, setPublishStateByDraftId] = useState<Record<number, PublishMutationState>>({});
  const [scheduleStateByDraftId, setScheduleStateByDraftId] = useState<Record<number, ScheduleMutationState>>({});
  const [sessionActionStateByDraftId, setSessionActionStateByDraftId] = useState<
    Record<number, SessionActionMutationState>
  >({});
  const [browserHandoffDraftByArtifactPath, setBrowserHandoffDraftByArtifactPath] = useState<
    Record<string, { publishUrl: string; message: string }>
  >({});
  const [browserHandoffCompletionStateByDraftId, setBrowserHandoffCompletionStateByDraftId] = useState<
    Record<number, BrowserHandoffCompletionMutationState>
  >({});
  const [scheduledAtByDraftId, setScheduledAtByDraftId] = useState<Record<number, string>>({});
  const [draftStatusById, setDraftStatusById] = useState<Record<number, string>>({});
  const [generationProgressStep, setGenerationProgressStep] = useState(0);
  const followUpScopeVersionRef = useRef(0);
  const publishFollowUpAttemptByIdRef = useRef<Record<number, number>>({});
  const shouldLoadBrowserHandoffsLive = browserHandoffsStateOverride === undefined;
  const { state, run } = useAsyncAction(generateAction);
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

  const displayState = stateOverride ?? state;
  const displayBrowserHandoffsState = browserHandoffsStateOverride ?? browserHandoffsState;
  const generateControlsDisabled = displayState.status === 'loading' || projectIdValidationError !== null;
  const hasGeneratedResults =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as GenerateDraftsResponse).results);
  const browserHandoffs =
    displayBrowserHandoffsState.status === 'success' && displayBrowserHandoffsState.data
      ? displayBrowserHandoffsState.data.handoffs
      : [];
  const activeGenerationProgressStage = generationProgressStages[generationProgressStep] ?? generationProgressStages[0];

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    followUpScopeVersionRef.current += 1;
    publishFollowUpAttemptByIdRef.current = {};
    setReviewStateByDraftId({});
    setPublishStateByDraftId({});
    setScheduleStateByDraftId({});
    setSessionActionStateByDraftId({});
    setBrowserHandoffDraftByArtifactPath({});
    setBrowserHandoffCompletionStateByDraftId({});
    setScheduledAtByDraftId({});
    setDraftStatusById({});
  }, [displayState]);

  useEffect(() => {
    if (displayState.status !== 'loading') {
      setGenerationProgressStep(0);
      return;
    }

    setGenerationProgressStep(0);
    const timers = generationProgressStages.slice(1).map((_, index) =>
      setTimeout(() => {
        setGenerationProgressStep(index + 1);
      }, (index + 1) * 1200),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [displayState.status]);

  function togglePlatform(platformValue: string) {
    setSelectedPlatforms((currentPlatforms) =>
      currentPlatforms.includes(platformValue)
        ? currentPlatforms.filter((value) => value !== platformValue)
        : [...currentPlatforms, platformValue],
    );
  }

  function handleGenerate(saveAsDraft: boolean) {
    if (projectIdValidationError) {
      return;
    }

    void run({
      topic,
      tone,
      platforms: selectedPlatforms,
      saveAsDraft,
      ...(projectId === undefined ? {} : { projectId }),
    });
  }

  function getReviewState(draftId: number): ReviewMutationState {
    return reviewStateByDraftId[draftId] ?? createIdleReviewMutationState();
  }

  function getPublishState(draftId: number): PublishMutationState {
    return publishStateByDraftId[draftId] ?? createIdlePublishMutationState();
  }

  function getDisplayPublishState(draftId: number, draftTitle: string): PublishMutationState {
    const currentPublishState = getPublishState(draftId);
    if (currentPublishState.status !== 'idle') {
      return currentPublishState;
    }

    const persistedBrowserHandoff = findPendingBrowserHandoff(browserHandoffs, draftId);
    const currentDraftStatus = draftStatusById[draftId];
    if (
      !persistedBrowserHandoff ||
      currentDraftStatus === 'published' ||
      currentDraftStatus === 'scheduled' ||
      currentDraftStatus === 'queued' ||
      currentDraftStatus === 'failed'
    ) {
      return currentPublishState;
    }

    return {
      status: 'success',
      message: `已恢复人工接管：${draftTitle}`,
      error: null,
      publishUrl: null,
      contractMessage: isReadyBrowserHandoff(persistedBrowserHandoff)
        ? '发现待处理的 browser handoff，可以直接结单。'
        : getBrowserHandoffBlockedMessage(persistedBrowserHandoff),
      contractStatus: 'manual_required',
      contractDetails: {
        browserHandoff: toBrowserHandoffContract(persistedBrowserHandoff),
      },
    } satisfies PublishMutationState;
  }

  function getScheduleState(draftId: number): ScheduleMutationState {
    return scheduleStateByDraftId[draftId] ?? createIdleScheduleMutationState();
  }

  function getSessionActionState(draftId: number): SessionActionMutationState {
    return sessionActionStateByDraftId[draftId] ?? createIdleSessionActionState();
  }

  function getBrowserHandoffCompletionState(draftId: number): BrowserHandoffCompletionMutationState {
    return browserHandoffCompletionStateByDraftId[draftId] ?? createIdleBrowserHandoffCompletionState();
  }

  function getScheduledAtValue(draftId: number) {
    return scheduledAtByDraftId[draftId] ?? '';
  }

  function getDisplayedDraftStatus(draftId: number) {
    return (
      draftStatusById[draftId] ??
      getReviewState(draftId).reviewStatus ??
      (findPendingBrowserHandoff(browserHandoffs, draftId) ? 'manual_required' : 'draft')
    );
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

  function updateScheduledAtDraftInput(draftId: number, value: string) {
    setScheduledAtByDraftId((currentState) => ({
      ...currentState,
      [draftId]: value,
    }));
    setScheduleStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: createIdleScheduleMutationState(),
    }));
  }

  async function handleSendDraftToReview(draftId: number) {
    setReviewStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        reviewStatus: null,
      },
    }));

    try {
      const result = await sendDraftToReviewAction(draftId);

      setReviewStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: '已送审',
          error: null,
          reviewStatus: result.draft.status,
        },
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: result.draft.status,
      }));
    } catch (error) {
      setReviewStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          reviewStatus: null,
        },
      }));
    }
  }

  async function handlePublishGeneratedDraft(draftId: number, draftTitle: string) {
    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const previousBrowserHandoff = readBrowserHandoffContract(getPublishState(draftId).contractDetails);
    const publishFollowUpAttempt = nextPublishFollowUpAttempt(draftId);

    setSessionActionStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: createIdleSessionActionState(),
    }));
    setBrowserHandoffCompletionStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: createIdleBrowserHandoffCompletionState(),
    }));
    clearBrowserHandoffDrafts(previousBrowserHandoff?.artifactPath ?? null);
    setPublishStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        publishUrl: null,
        contractMessage: null,
        contractStatus: null,
        contractDetails: null,
      },
    }));

    try {
      const result = await publishGeneratedDraftAction(draftId);
      if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
        return;
      }
      if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
        return;
      }
      const publishSucceeded = result.success || result.status === 'manual_required' || result.status === 'queued';
      const nextStatus = result.status ?? (result.success ? 'published' : 'failed');
      const nextPublishState: PublishMutationState = {
        status: publishSucceeded ? 'success' : 'error',
        message: result.success
          ? result.message
          : result.status === 'queued'
            ? `已入队等待发布：${draftTitle}`
            : result.status === 'manual_required'
              ? `已转入人工接管：${draftTitle}`
              : null,
        error: publishSucceeded ? null : result.message,
        publishUrl: result.publishUrl,
        contractMessage: result.message,
        contractStatus: nextStatus,
        contractDetails: asRecord(result.details),
      };

      setPublishStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: nextPublishState,
      }));
      clearBrowserHandoffDrafts(readBrowserHandoffContract(nextPublishState.contractDetails)?.artifactPath ?? null);
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: nextStatus,
      }));
    } catch (error) {
      if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
        return;
      }
      if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
        return;
      }
      const errorMessage = getErrorMessage(error);

      setPublishStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: errorMessage,
          publishUrl: null,
          contractMessage: errorMessage,
          contractStatus: 'failed',
          contractDetails: null,
        },
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: 'failed',
      }));
    }
  }

  function handleRequestSessionAction(draftId: number, browserHandoff: BrowserHandoffContract) {
    if (!browserHandoff.channelAccountId || !browserHandoff.sessionAction) {
      return;
    }

    const scopeVersionAtStart = followUpScopeVersionRef.current;
    const publishFollowUpAttempt = readPublishFollowUpAttempt(draftId);

    setSessionActionStateByDraftId((currentState) => ({
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
        setSessionActionStateByDraftId((currentState) => ({
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
        setSessionActionStateByDraftId((currentState) => ({
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

    setBrowserHandoffCompletionStateByDraftId((currentState) => ({
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
        if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
          return;
        }

        clearBrowserHandoffDrafts(browserHandoff.artifactPath);
        setDraftStatusById((currentState) => ({
          ...currentState,
          [draftId]: result.draftStatus,
        }));
        setPublishStateByDraftId((currentState) => ({
          ...currentState,
          [draftId]: {
            ...(currentState[draftId] ?? createIdlePublishMutationState()),
            status: 'success',
            message: result.message,
            error: null,
            publishUrl: result.publishUrl ?? currentState[draftId]?.publishUrl ?? null,
            contractMessage: result.message,
            contractStatus: result.draftStatus,
            contractDetails: null,
          },
        }));
        setBrowserHandoffCompletionStateByDraftId((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'success',
            error: null,
            result,
          },
        }));
        void reloadBrowserHandoffs();
      })
      .catch((error) => {
        if (scopeVersionAtStart !== followUpScopeVersionRef.current) {
          return;
        }
        if (publishFollowUpAttempt !== readPublishFollowUpAttempt(draftId)) {
          return;
        }
        setBrowserHandoffCompletionStateByDraftId((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'error',
            error: `Generate browser handoff 结单失败：${getErrorMessage(error)}`,
            result: null,
          },
        }));
      });
  }

  async function handleScheduleGeneratedDraft(draftId: number) {
    const scheduledAt = normalizeScheduledAtInput(getScheduledAtValue(draftId));

    setScheduleStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
      },
    }));

    try {
      const result = await scheduleGeneratedDraftAction(draftId, { scheduledAt });
      const resultScheduledAt = result.draft.scheduledAt ?? null;

      setScheduledAtByDraftId((currentState) => ({
        ...currentState,
        [draftId]: resultScheduledAt ?? '',
      }));
      setScheduleStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: createScheduleSuccessState(resultScheduledAt),
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: result.draft.status,
      }));
    } catch (error) {
      setScheduleStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
        },
      }));
    }
  }

  function renderGeneratedDraftPublishFollowUp(draftId: number, publishState: PublishMutationState) {
    if (publishState.status !== 'success' || publishState.contractStatus !== 'manual_required') {
      return null;
    }

    const browserHandoff = readBrowserHandoffContract(publishState.contractDetails);
    if (!browserHandoff) {
      return null;
    }

    const sessionActionState = getSessionActionState(draftId);
    const browserHandoffCompletionState = getBrowserHandoffCompletionState(draftId);
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
        {publishState.contractMessage ? <div>回执消息：{publishState.contractMessage}</div> : null}
        {browserHandoff.readiness ? <div>Handoff 状态：{browserHandoff.readiness}</div> : null}
        {browserHandoff.sessionAction ? <div>Handoff 动作：{browserHandoff.sessionAction}</div> : null}
        {browserHandoff.artifactPath ? <div>Handoff 路径：{browserHandoff.artifactPath}</div> : null}
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
                  'data-generate-session-action': browserHandoff.sessionAction ?? undefined,
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
            <span style={{ fontWeight: 700, color: '#334155' }}>Generate browser handoff 结单</span>
            <input
              data-generate-browser-handoff-field="publishUrl"
              value={handoffDraft?.publishUrl ?? ''}
              onChange={(event) => {
                handleBrowserHandoffDraftChange(browserHandoff.artifactPath!, 'publishUrl', event.target.value);
              }}
              placeholder="publish URL（可选）"
              style={projectInputStyle}
            />
            <input
              data-generate-browser-handoff-field="message"
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
                  'data-generate-browser-handoff-complete': 'published',
                }}
              />
              <ActionButton
                label={browserHandoffCompletionState.status === 'loading' ? '正在结单...' : '标记失败'}
                onClick={() => {
                  handleCompleteBrowserHandoff(draftId, browserHandoff, 'failed');
                }}
                disabled={browserHandoffCompletionState.status === 'loading'}
                buttonAttributes={{
                  'data-generate-browser-handoff-complete': 'failed',
                }}
              />
            </span>
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
      <header style={{ marginBottom: '24px' }}>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>Content Studio</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>Generate Center</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px' }}>
          从一个话题同时生成多平台草稿，并为审核与定时发布留出空间。
        </p>
      </header>

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
        <section
          style={{
            borderRadius: '20px',
            background: '#ffffff',
            padding: '24px',
            border: '1px solid #dbe4f0',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>话题输入</h3>
          <label style={{ display: 'grid', gap: '10px' }}>
            <span style={{ fontWeight: 700 }}>输入原始话题、功能更新或竞品动态</span>
            <textarea
              rows={8}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              style={{
                width: '100%',
                borderRadius: '14px',
                border: '1px solid #cbd5e1',
                padding: '14px',
                font: 'inherit',
                resize: 'vertical',
              }}
            />
          </label>

          <label style={{ marginTop: '18px', display: 'grid', gap: '8px' }}>
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
          {projectIdValidationError ? (
            <div style={{ marginTop: '8px', color: '#b91c1c', fontWeight: 700 }}>{projectIdValidationError}</div>
          ) : null}

          <div style={{ marginTop: '18px', display: 'grid', gap: '10px' }}>
            <div style={{ fontWeight: 700 }}>语气</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {toneOptions.map((toneOption) => (
                <button
                  key={toneOption.value}
                  type="button"
                  onClick={() => setTone(toneOption.value)}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid #cbd5e1',
                    background: tone === toneOption.value ? '#dbeafe' : '#f8fafc',
                    color: '#1e3a8a',
                    padding: '8px 12px',
                  }}
                >
                  {toneOption.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section
          style={{
            borderRadius: '20px',
            background: '#ffffff',
            padding: '24px',
            border: '1px solid #dbe4f0',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>选择渠道</h3>
          <p style={{ margin: '0 0 16px', color: '#475569', lineHeight: 1.6 }}>
            当前开放首发可用和人工接管平台生成文案；生成并不等于自动发布，人工接管平台仍需后续手动完成发布。
          </p>
          <div style={{ display: 'grid', gap: '10px' }}>
            {platformOptions.map((platform) => (
              <label
                key={platform.value}
                data-generate-platform={platform.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderRadius: '12px',
                  border: '1px solid #dbe4f0',
                  padding: '10px 12px',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform.value)}
                  disabled={platform.launchStatus === 'later'}
                  onChange={() => togglePlatform(platform.value)}
                />
                <span style={{ fontWeight: 600 }}>{platform.label}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    borderRadius: '999px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    background:
                      platform.launchStatus === 'ready'
                        ? '#dcfce7'
                        : platform.launchStatus === 'manual'
                          ? '#fef3c7'
                          : '#e2e8f0',
                    color:
                      platform.launchStatus === 'ready'
                        ? '#166534'
                        : platform.launchStatus === 'manual'
                          ? '#92400e'
                          : '#475569',
                  }}
                >
                  {platform.launchBadge}
                </span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={generateControlsDisabled}
              style={{
                border: 'none',
                borderRadius: '12px',
                background: '#2563eb',
                color: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
              }}
            >
              {displayState.status === 'loading' ? '正在生成草稿...' : '一键生成'}
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(true)}
              disabled={generateControlsDisabled}
              style={{
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
              }}
            >
              保存为草稿
            </button>
          </div>
        </section>
      </div>

      <SectionCard title="生成结果" description="生成结果将在这里出现，并按平台拆分为可编辑卡片。">
        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>生成结果将在这里出现，并按平台拆分为可编辑卡片。</p>
        ) : null}

        {displayState.status === 'loading' ? (
          <div
            style={{
              display: 'grid',
              gap: '12px',
              borderRadius: '18px',
              border: '1px solid #bfdbfe',
              background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#1d4ed8', fontWeight: 700 }}>生成进行中</div>
                <div style={{ marginTop: '4px', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  {activeGenerationProgressStage.title}
                </div>
              </div>
              <div
                style={{
                  borderRadius: '999px',
                  background: '#dbeafe',
                  color: '#1d4ed8',
                  fontWeight: 700,
                  padding: '6px 10px',
                  whiteSpace: 'nowrap',
                }}
              >
                {generationProgressStep + 1}/{generationProgressStages.length}
              </div>
            </div>
            <p style={{ margin: 0, color: '#334155', lineHeight: 1.6 }}>{activeGenerationProgressStage.description}</p>
            <div style={{ display: 'grid', gap: '8px' }}>
              {generationProgressStages.map((stage, index) => {
                const stageStatus =
                  index < generationProgressStep ? '已完成' : index === generationProgressStep ? '进行中' : '待执行';

                return (
                  <div
                    key={stage.title}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      alignItems: 'center',
                      borderRadius: '12px',
                      border: '1px solid #dbe4f0',
                      background: index === generationProgressStep ? '#ffffff' : '#f8fafc',
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{stage.title}</div>
                    <div
                      style={{
                        color: index <= generationProgressStep ? '#2563eb' : '#64748b',
                        fontWeight: 700,
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stageStatus}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>生成失败：{displayState.error}</p>
        ) : null}

        {hasGeneratedResults ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>
              已返回 {(displayState.data as GenerateDraftsResponse).results.length} 条生成结果
            </div>
            {(displayState.data as GenerateDraftsResponse).results.map((result, index) => (
              (() => {
                const reviewState = result.draftId !== undefined ? getReviewState(result.draftId) : null;
                const scheduleState = result.draftId !== undefined ? getScheduleState(result.draftId) : null;
                const scheduledAt = result.draftId !== undefined ? getScheduledAtValue(result.draftId) : '';
                const draftTitle = result.title ?? `${result.platform} draft #${result.draftId}`;
                const publishState =
                  result.draftId !== undefined ? getDisplayPublishState(result.draftId, draftTitle) : null;
                const displayedDraftStatus = result.draftId !== undefined ? getDisplayedDraftStatus(result.draftId) : null;
                const reviewActionDisabled =
                  reviewState !== null &&
                  (reviewState.status === 'loading' || displayedDraftStatus !== 'draft');
                const publishActionDisabled =
                  publishState !== null &&
                  (publishState.status === 'loading' || displayedDraftStatus !== 'draft');
                const scheduleActionDisabled =
                  scheduleState !== null &&
                  (scheduleState.status === 'loading' || displayedDraftStatus !== 'draft');

                return (
                  <article
                    key={`${result.platform}-${index}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '16px',
                    }}
                  >
                    <div style={{ fontSize: '13px', color: '#2563eb', textTransform: 'uppercase' }}>{result.platform}</div>
                    <div style={{ marginTop: '8px', fontWeight: 700 }}>{result.title ?? 'Untitled draft'}</div>
                    <p style={{ margin: '8px 0 0', color: '#475569', lineHeight: 1.5 }}>{result.content}</p>
                    <div style={{ marginTop: '8px', color: '#64748b' }}>
                      Hashtags: {result.hashtags.length > 0 ? result.hashtags.join(', ') : 'None'}
                    </div>
                    {result.draftId !== undefined ? (
                      <>
                        <div style={{ marginTop: '6px', color: '#64748b' }}>draftId: {result.draftId}</div>
                        <div style={{ marginTop: '6px', color: '#64748b' }}>status: {displayedDraftStatus}</div>
                        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
                          <button
                            data-publish-draft-id={String(result.draftId)}
                            type="button"
                            onClick={() => {
                              void handlePublishGeneratedDraft(result.draftId as number, draftTitle);
                            }}
                            disabled={publishActionDisabled}
                            style={{
                              width: 'fit-content',
                              borderRadius: '10px',
                              border: 'none',
                              background: '#2563eb',
                              color: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {publishState?.status === 'loading' ? '正在发布...' : '立即发布'}
                          </button>
                          {publishState?.status === 'success' ? (
                            <div style={{ display: 'grid', gap: '8px', color: '#166534', fontWeight: 700 }}>
                              <div>
                                {publishState.message}
                                {publishState.contractStatus ? `，当前状态：${publishState.contractStatus}` : ''}
                                {publishState.publishUrl ? `，发布链接：${publishState.publishUrl}` : ''}
                              </div>
                              {result.draftId !== undefined
                                ? renderGeneratedDraftPublishFollowUp(result.draftId, publishState)
                                : null}
                            </div>
                          ) : null}
                          {publishState?.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                              发布失败：{publishState.error}
                            </div>
                          ) : null}
                          <label style={{ display: 'grid', gap: '6px', maxWidth: '360px' }}>
                            <span style={{ fontWeight: 700 }}>排程时间</span>
                            <input
                              data-generate-scheduled-at-id={String(result.draftId)}
                              value={scheduledAt}
                              onChange={(event) =>
                                updateScheduledAtDraftInput(result.draftId as number, event.target.value)
                              }
                              placeholder="2026-04-20T09:30:00.000Z"
                              style={{
                                borderRadius: '10px',
                                border: '1px solid #cbd5e1',
                                padding: '10px 12px',
                                font: 'inherit',
                                background: '#ffffff',
                              }}
                            />
                          </label>
                          <button
                            data-schedule-draft-id={String(result.draftId)}
                            type="button"
                            onClick={() => {
                              void handleScheduleGeneratedDraft(result.draftId as number);
                            }}
                            disabled={scheduleActionDisabled}
                            style={{
                              width: 'fit-content',
                              borderRadius: '10px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {scheduleState?.status === 'loading' ? '正在推入排程...' : '推入排程'}
                          </button>
                          {scheduleState?.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {scheduleState.message}
                              {scheduledAt ? `，计划发布时间：${scheduledAt}` : ''}
                            </div>
                          ) : null}
                          {scheduleState?.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                              排程保存失败：{scheduleState.error}
                              {scheduledAt ? `。待保存时间：${scheduledAt}` : '。待保存操作：清空排程'}
                            </div>
                          ) : null}
                          <button
                            data-review-draft-id={String(result.draftId)}
                            type="button"
                            onClick={() => {
                              void handleSendDraftToReview(result.draftId as number);
                            }}
                            disabled={reviewActionDisabled}
                            style={{
                              width: 'fit-content',
                              borderRadius: '10px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {reviewState?.status === 'loading'
                              ? '正在送审...'
                              : displayedDraftStatus === 'review'
                                ? '已送审'
                                : '送审'}
                          </button>
                          {reviewState?.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {reviewState.message}
                              {reviewState.reviewStatus ? `，当前状态：${reviewState.reviewStatus}` : ''}
                            </div>
                          ) : null}
                          {reviewState?.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>送审失败：{reviewState.error}</div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </article>
                );
              })()
            ))}
          </div>
        ) : null}
      </SectionCard>
    </section>
  );
}
