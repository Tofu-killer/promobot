import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';

export interface SystemQueueJob {
  id: number;
  type: string;
  status: string;
  runAt: string;
  attempts: number;
  lastError?: string;
  canRetry?: boolean;
  canCancel?: boolean;
}

export interface SystemQueueResponse {
  jobs: SystemQueueJob[];
  queue: {
    pending?: number;
    running?: number;
    done?: number;
    failed?: number;
    canceled?: number;
    duePending?: number;
  };
  recentJobs: SystemQueueJob[];
}

export interface SystemQueueMutationResponse {
  job: SystemQueueJob;
  runtime: Record<string, unknown>;
}

export interface BrowserLaneRequestRecord {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: string;
  jobStatus: string;
  requestedAt: string;
  artifactPath: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserLaneRequestsResponse {
  requests: BrowserLaneRequestRecord[];
  total: number;
}

export interface BrowserLaneSessionSummary {
  hasSession: boolean;
  status: 'active' | 'expired' | 'missing' | string;
  validatedAt: string | null;
  storageStatePath: string | null;
  id?: string;
  notes?: string;
}

export interface BrowserLaneRequestImportResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  session: BrowserLaneSessionSummary | null;
  channelAccount: {
    id: number;
    metadata?: Record<string, unknown>;
    session?: BrowserLaneSessionSummary;
    [key: string]: unknown;
  };
}

export interface BrowserHandoffRecord {
  channelAccountId?: number;
  accountDisplayName?: string;
  ownership?: string;
  platform: string;
  draftId: string;
  title: string | null;
  accountKey: string;
  status: string;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserHandoffsResponse {
  handoffs: BrowserHandoffRecord[];
  total: number;
}

export interface InboxReplyHandoffRecord {
  channelAccountId?: number;
  platform: string;
  itemId: string;
  source: string;
  title: string | null;
  author: string | null;
  accountKey: string;
  status: string;
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

interface BasePriorityActionRecord {
  key: string;
  priority: number;
  title: string;
  detail: string;
  artifactPath: string;
  timestampLabel: 'requestedAt' | 'updatedAt';
  timestampValue: string;
  pendingLabel: string;
  destinationHref: string;
  destinationLabel: string;
}

interface BrowserLanePriorityActionRecord extends BasePriorityActionRecord {
  kind: 'browser_lane';
  request: BrowserLaneRequestRecord;
}

interface InboxReplyPriorityActionRecord extends BasePriorityActionRecord {
  kind: 'inbox_reply_handoff';
  handoff: InboxReplyHandoffRecord;
}

interface BrowserHandoffPriorityActionRecord extends BasePriorityActionRecord {
  kind: 'browser_handoff';
  handoff: BrowserHandoffRecord;
}

type PriorityActionRecord =
  | BrowserLanePriorityActionRecord
  | InboxReplyPriorityActionRecord
  | BrowserHandoffPriorityActionRecord;

export interface BrowserHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  draftId: number;
  draftStatus: string;
  platform: string;
  mode: string;
  status: string;
  publishStatus?: string;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
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
  replyStatus?: string;
  success: boolean;
  deliveryUrl: string | null;
  externalId: string | null;
  message: string;
  deliveredAt: string | null;
}

export async function loadSystemQueueRequest(limit = 50): Promise<SystemQueueResponse> {
  return apiRequest<SystemQueueResponse>(`/api/system/jobs?limit=${limit}`);
}

export async function loadBrowserLaneRequestsRequest(limit = 20): Promise<BrowserLaneRequestsResponse> {
  return apiRequest<BrowserLaneRequestsResponse>(`/api/system/browser-lane-requests?limit=${limit}`);
}

export async function loadBrowserHandoffsRequest(limit = 20): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(`/api/system/browser-handoffs?limit=${limit}`);
}

export async function importBrowserLaneRequestResultRequest(input: {
  requestArtifactPath: string;
  storageState: Record<string, unknown>;
  notes?: string;
}): Promise<BrowserLaneRequestImportResponse> {
  return apiRequest<BrowserLaneRequestImportResponse>('/api/system/browser-lane-requests/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestArtifactPath: input.requestArtifactPath,
      storageState: input.storageState,
      ...(input.notes !== undefined && input.notes.trim().length > 0 ? { notes: input.notes.trim() } : {}),
    }),
  });
}

export async function loadInboxReplyHandoffsRequest(limit = 20): Promise<InboxReplyHandoffsResponse> {
  return apiRequest<InboxReplyHandoffsResponse>(`/api/system/inbox-reply-handoffs?limit=${limit}`);
}

export async function completeBrowserHandoffRequest(input: {
  artifactPath: string;
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
}): Promise<BrowserHandoffCompletionResponse> {
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

export async function completeInboxReplyHandoffRequest(input: {
  artifactPath: string;
  replyStatus: 'sent' | 'failed';
  message?: string;
  deliveryUrl?: string;
}): Promise<InboxReplyHandoffCompletionResponse> {
  return apiRequest<InboxReplyHandoffCompletionResponse>('/api/system/inbox-reply-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
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

export async function retrySystemQueueJobRequest(
  jobId: number,
  runAt?: string,
): Promise<SystemQueueMutationResponse> {
  return apiRequest<SystemQueueMutationResponse>(`/api/system/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(runAt ? { runAt } : {}),
  });
}

export async function cancelSystemQueueJobRequest(jobId: number): Promise<SystemQueueMutationResponse> {
  return apiRequest<SystemQueueMutationResponse>(`/api/system/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
}

export async function enqueueSystemQueueJobRequest(input: {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: string;
}): Promise<SystemQueueMutationResponse> {
  return apiRequest<SystemQueueMutationResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

interface SystemQueuePageProps {
  loadSystemQueueAction?: () => Promise<SystemQueueResponse>;
  loadBrowserLaneRequestsAction?: () => Promise<BrowserLaneRequestsResponse>;
  loadBrowserHandoffsAction?: () => Promise<BrowserHandoffsResponse>;
  loadInboxReplyHandoffsAction?: () => Promise<InboxReplyHandoffsResponse>;
  retrySystemQueueJobAction?: (jobId: number, runAt?: string) => Promise<SystemQueueMutationResponse>;
  cancelSystemQueueJobAction?: (jobId: number) => Promise<SystemQueueMutationResponse>;
  enqueueSystemQueueJobAction?: (input: {
    type: string;
    payload?: Record<string, unknown>;
    runAt?: string;
  }) => Promise<SystemQueueMutationResponse>;
  importBrowserLaneRequestResultAction?: (input: {
    requestArtifactPath: string;
    storageState: Record<string, unknown>;
    notes?: string;
  }) => Promise<BrowserLaneRequestImportResponse>;
  completeBrowserHandoffAction?: (input: {
    artifactPath: string;
    publishStatus: 'published' | 'failed';
    message?: string;
    publishUrl?: string;
  }) => Promise<BrowserHandoffCompletionResponse>;
  completeInboxReplyHandoffAction?: (input: {
    artifactPath: string;
    replyStatus: 'sent' | 'failed';
    message?: string;
    deliveryUrl?: string;
  }) => Promise<InboxReplyHandoffCompletionResponse>;
  stateOverride?: AsyncState<SystemQueueResponse>;
  browserLaneStateOverride?: AsyncState<BrowserLaneRequestsResponse>;
  browserHandoffStateOverride?: AsyncState<BrowserHandoffsResponse>;
  inboxReplyHandoffStateOverride?: AsyncState<InboxReplyHandoffsResponse>;
  mutationStateOverride?: AsyncState<SystemQueueMutationResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

function defaultLoadSystemQueueAction() {
  return loadSystemQueueRequest(50);
}

function defaultLoadBrowserLaneRequestsAction() {
  return loadBrowserLaneRequestsRequest(20);
}

function defaultLoadBrowserHandoffsAction() {
  return loadBrowserHandoffsRequest(20);
}

function defaultLoadInboxReplyHandoffsAction() {
  return loadInboxReplyHandoffsRequest(20);
}

export function SystemQueuePage({
  loadSystemQueueAction = defaultLoadSystemQueueAction,
  loadBrowserLaneRequestsAction = defaultLoadBrowserLaneRequestsAction,
  loadBrowserHandoffsAction = defaultLoadBrowserHandoffsAction,
  loadInboxReplyHandoffsAction = defaultLoadInboxReplyHandoffsAction,
  retrySystemQueueJobAction = retrySystemQueueJobRequest,
  cancelSystemQueueJobAction = cancelSystemQueueJobRequest,
  enqueueSystemQueueJobAction = enqueueSystemQueueJobRequest,
  importBrowserLaneRequestResultAction = importBrowserLaneRequestResultRequest,
  completeBrowserHandoffAction = completeBrowserHandoffRequest,
  completeInboxReplyHandoffAction = completeInboxReplyHandoffRequest,
  stateOverride,
  browserLaneStateOverride,
  browserHandoffStateOverride,
  inboxReplyHandoffStateOverride,
  mutationStateOverride,
}: SystemQueuePageProps) {
  type QueueMutationInput =
    | { mode: 'retry'; jobId?: number; runAt?: string }
    | { mode: 'cancel'; jobId?: number }
    | { mode: 'enqueue'; runAt?: string; type?: string; payloadJson?: string };
  const { state, reload } = useAsyncQuery(loadSystemQueueAction, [loadSystemQueueAction]);
  const { state: browserLaneState, reload: reloadBrowserLane } = useAsyncQuery(
    loadBrowserLaneRequestsAction,
    [loadBrowserLaneRequestsAction],
  );
  const { state: browserHandoffState, reload: reloadBrowserHandoffs } = useAsyncQuery(
    loadBrowserHandoffsAction,
    [loadBrowserHandoffsAction],
  );
  const { state: inboxReplyHandoffState, reload: reloadInboxReplyHandoffs } = useAsyncQuery(
    loadInboxReplyHandoffsAction,
    [loadInboxReplyHandoffsAction],
  );
  const { state: mutationState, run: mutateQueue } = useAsyncAction(
    (input: QueueMutationInput) => {
      if (input.mode === 'retry') {
        return retrySystemQueueJobAction(input.jobId ?? -1, input.runAt);
      }

      if (input.mode === 'cancel') {
        return cancelSystemQueueJobAction(input.jobId ?? -1);
      }

      const payload = parseEnqueuePayload(input.payloadJson);

      return enqueueSystemQueueJobAction({
        type: input.type ?? 'monitor_fetch',
        ...(payload === undefined ? {} : { payload }),
        runAt: input.runAt,
      });
    },
  );
  const { state: browserLaneRequestMutationState, run: runBrowserLaneRequestImport } = useAsyncAction(
    (input: {
      requestArtifactPath: string;
      storageStateJson: string;
      notes?: string;
    }) =>
      importBrowserLaneRequestResultAction({
        requestArtifactPath: input.requestArtifactPath,
        storageState: parseStorageStateJson(input.storageStateJson),
        ...(input.notes ? { notes: input.notes } : {}),
      }),
  );
  const { state: handoffMutationState, run: runBrowserHandoffCompletion } = useAsyncAction(
    (input: {
      artifactPath: string;
      publishStatus: 'published' | 'failed';
      message?: string;
      publishUrl?: string;
    }) => completeBrowserHandoffAction(input),
  );
  const { state: inboxReplyHandoffMutationState, run: runInboxReplyHandoffCompletion } = useAsyncAction(
    (input: {
      artifactPath: string;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => completeInboxReplyHandoffAction(input),
  );
  const displayState = stateOverride ?? state;
  const displayBrowserLaneState = browserLaneStateOverride ?? browserLaneState;
  const displayBrowserHandoffState = browserHandoffStateOverride ?? browserHandoffState;
  const displayInboxReplyHandoffState = inboxReplyHandoffStateOverride ?? inboxReplyHandoffState;
  const displayMutationState = mutationStateOverride ?? mutationState;
  const [activeMutation, setActiveMutation] = useState<QueueMutationInput | null>(null);
  const [activeBrowserLaneArtifactPath, setActiveBrowserLaneArtifactPath] = useState<string | null>(null);
  const [activeBrowserHandoffArtifactPath, setActiveBrowserHandoffArtifactPath] = useState<string | null>(null);
  const [activeInboxReplyHandoffArtifactPath, setActiveInboxReplyHandoffArtifactPath] = useState<string | null>(null);
  const [resolvedBrowserLaneRequestsByArtifactPath, setResolvedBrowserLaneRequestsByArtifactPath] = useState<
    Record<string, { resolvedAt: string; jobStatus: string; resolution?: unknown }>
  >({});
  const [resolvedBrowserHandoffsByArtifactPath, setResolvedBrowserHandoffsByArtifactPath] = useState<
    Record<string, { resolvedAt: string; status: string; resolution?: unknown }>
  >({});
  const [resolvedInboxReplyHandoffsByArtifactPath, setResolvedInboxReplyHandoffsByArtifactPath] = useState<
    Record<string, { resolvedAt: string; status: string; resolution?: unknown }>
  >({});
  const [browserLaneDraftByArtifactPath, setBrowserLaneDraftByArtifactPath] = useState<
    Record<string, { storageState: string; notes: string }>
  >({});
  const [browserHandoffDraftByArtifactPath, setBrowserHandoffDraftByArtifactPath] = useState<
    Record<string, { publishUrl: string; message: string }>
  >({});
  const [inboxReplyHandoffDraftByArtifactPath, setInboxReplyHandoffDraftByArtifactPath] = useState<
    Record<string, { deliveryUrl: string; message: string }>
  >({});
  const [enqueueType, setEnqueueType] = useState('monitor_fetch');
  const [enqueuePayloadJson, setEnqueuePayloadJson] = useState('');
  const [enqueueRunAt, setEnqueueRunAt] = useState('');
  const enqueueTypeFieldRef = useRef<HTMLInputElement | null>(null);
  const queueMutationPendingRef = useRef(false);

  const fallbackData: SystemQueueResponse = {
    jobs: [],
    queue: {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      canceled: 0,
      duePending: 0,
    },
    recentJobs: [],
  };
  const hasLiveQueueData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as SystemQueueResponse).jobs);
  const viewData = hasLiveQueueData ? (displayState.data as SystemQueueResponse) : fallbackData;

  const queueStats = {
    pending: viewData.queue.pending ?? 0,
    running: viewData.queue.running ?? 0,
    done: viewData.queue.done ?? 0,
    failed: viewData.queue.failed ?? 0,
    canceled: viewData.queue.canceled ?? 0,
    duePending: viewData.queue.duePending ?? 0,
  };
  const hasLiveBrowserLaneData =
    typeof displayBrowserLaneState.data === 'object' &&
    displayBrowserLaneState.data !== null &&
    Array.isArray(displayBrowserLaneState.data.requests);
  const visibleBrowserLaneRequests = hasLiveBrowserLaneData
    ? displayBrowserLaneState.data.requests.map((request) => {
        const resolvedRequest = resolvedBrowserLaneRequestsByArtifactPath[request.artifactPath];
        const hasLiveResolution =
          request.resolvedAt !== null ||
          readResolutionStatus(request.resolution) !== null ||
          request.jobStatus === 'resolved';
        if (!resolvedRequest || hasLiveResolution) {
          return request;
        }

        return {
          ...request,
          resolvedAt: resolvedRequest.resolvedAt,
          jobStatus: resolvedRequest.jobStatus,
          ...(resolvedRequest.resolution !== undefined
            ? { resolution: resolvedRequest.resolution }
            : request.resolution !== undefined
              ? { resolution: request.resolution }
              : {}),
        };
      })
    : [];
  const hasLiveBrowserHandoffData =
    typeof displayBrowserHandoffState.data === 'object' &&
    displayBrowserHandoffState.data !== null &&
    Array.isArray(displayBrowserHandoffState.data.handoffs);
  const visibleBrowserHandoffs = hasLiveBrowserHandoffData
    ? displayBrowserHandoffState.data.handoffs.map((handoff) => {
        const resolvedHandoff = resolvedBrowserHandoffsByArtifactPath[handoff.artifactPath];
        const hasLiveResolution =
          handoff.resolvedAt !== null ||
          readResolutionStatus(handoff.resolution) !== null ||
          handoff.status !== 'pending';
        if (!resolvedHandoff || hasLiveResolution) {
          return handoff;
        }

        return {
          ...handoff,
          resolvedAt: resolvedHandoff.resolvedAt,
          status: resolvedHandoff.status,
          ...(resolvedHandoff.resolution !== undefined
            ? { resolution: resolvedHandoff.resolution }
            : handoff.resolution !== undefined
              ? { resolution: handoff.resolution }
              : {}),
        };
      })
    : [];
  const hasLiveInboxReplyHandoffData =
    typeof displayInboxReplyHandoffState.data === 'object' &&
    displayInboxReplyHandoffState.data !== null &&
    Array.isArray(displayInboxReplyHandoffState.data.handoffs);
  const visibleInboxReplyHandoffs = hasLiveInboxReplyHandoffData
    ? displayInboxReplyHandoffState.data.handoffs.map((handoff) => {
        const resolvedHandoff =
          resolvedInboxReplyHandoffsByArtifactPath[handoff.artifactPath];
        const hasLiveResolution =
          handoff.resolvedAt !== null ||
          readResolutionStatus(handoff.resolution) !== null ||
          handoff.status !== 'pending';
        if (!resolvedHandoff || hasLiveResolution) {
          return handoff;
        }

        return {
          ...handoff,
          resolvedAt: resolvedHandoff.resolvedAt,
          status: resolvedHandoff.status,
          ...(resolvedHandoff.resolution !== undefined
            ? { resolution: resolvedHandoff.resolution }
            : handoff.resolution !== undefined
              ? { resolution: handoff.resolution }
              : {}),
        };
      })
    : [];
  const pendingPriorityActions = buildPriorityActionRecords({
    browserLaneRequests: visibleBrowserLaneRequests,
    browserHandoffs: visibleBrowserHandoffs,
    inboxReplyHandoffs: visibleInboxReplyHandoffs,
  });

  const mutationFeedback =
    displayMutationState.status === 'success' && displayMutationState.data
      ? `已更新作业 #${displayMutationState.data.job.id} (${displayMutationState.data.job.type})`
      : displayMutationState.status === 'error'
        ? `队列动作失败：${displayMutationState.error}`
        : null;
  const browserLaneRequestFeedback =
    browserLaneRequestMutationState.status === 'success' && browserLaneRequestMutationState.data
      ? `已导入 browser lane session #${browserLaneRequestMutationState.data.channelAccount.id} (${readBrowserLaneImportSession(browserLaneRequestMutationState.data)?.status ?? 'unknown'})`
      : browserLaneRequestMutationState.status === 'error'
        ? `browser lane session 导入失败：${browserLaneRequestMutationState.error}`
        : null;
  const browserHandoffFeedback =
    handoffMutationState.status === 'success' && handoffMutationState.data
      ? `已结单 handoff draft #${handoffMutationState.data.draftId} (${handoffMutationState.data.status})`
      : handoffMutationState.status === 'error'
        ? `browser handoff 结单失败：${handoffMutationState.error}`
        : null;
  const inboxReplyHandoffFeedback =
    inboxReplyHandoffMutationState.status === 'success' && inboxReplyHandoffMutationState.data
      ? `已结单 inbox reply item #${inboxReplyHandoffMutationState.data.itemId} (${inboxReplyHandoffMutationState.data.status})`
      : inboxReplyHandoffMutationState.status === 'error'
        ? `inbox reply handoff 结单失败：${inboxReplyHandoffMutationState.error}`
        : null;
  const isQueueMutationPending = queueMutationPendingRef.current || displayMutationState.status === 'loading';
  const isBrowserLaneRequestMutationPending = browserLaneRequestMutationState.status === 'loading';
  const isBrowserHandoffMutationPending = handoffMutationState.status === 'loading';
  const isInboxReplyHandoffMutationPending = inboxReplyHandoffMutationState.status === 'loading';

  useEffect(() => {
    if (!hasLiveBrowserLaneData) {
      return;
    }

    setResolvedBrowserLaneRequestsByArtifactPath((current) => {
      let changed = false;
      const next = { ...current };

      for (const request of displayBrowserLaneState.data.requests) {
        if (!(request.artifactPath in next)) {
          continue;
        }

        if (
          request.resolvedAt !== null ||
          readResolutionStatus(request.resolution) !== null ||
          request.jobStatus === 'resolved'
        ) {
          delete next[request.artifactPath];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [displayBrowserLaneState.data, hasLiveBrowserLaneData]);

  useEffect(() => {
    if (!hasLiveBrowserHandoffData) {
      return;
    }

    setResolvedBrowserHandoffsByArtifactPath((current) => {
      let changed = false;
      const next = { ...current };

      for (const handoff of displayBrowserHandoffState.data.handoffs) {
        if (!(handoff.artifactPath in next)) {
          continue;
        }

        if (
          handoff.resolvedAt !== null ||
          readResolutionStatus(handoff.resolution) !== null ||
          handoff.status !== 'pending'
        ) {
          delete next[handoff.artifactPath];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [displayBrowserHandoffState.data, hasLiveBrowserHandoffData]);

  useEffect(() => {
    if (!hasLiveInboxReplyHandoffData) {
      return;
    }

    setResolvedInboxReplyHandoffsByArtifactPath((current) => {
      let changed = false;
      const next = { ...current };

      for (const handoff of displayInboxReplyHandoffState.data.handoffs) {
        if (!(handoff.artifactPath in next)) {
          continue;
        }

        if (
          handoff.resolvedAt !== null ||
          readResolutionStatus(handoff.resolution) !== null ||
          handoff.status !== 'pending'
        ) {
          delete next[handoff.artifactPath];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [displayInboxReplyHandoffState.data, hasLiveInboxReplyHandoffData]);

  function startQueueMutation(input: QueueMutationInput, onSuccess?: () => void) {
    if (queueMutationPendingRef.current) {
      return;
    }

    queueMutationPendingRef.current = true;
    setActiveMutation(input);
    void mutateQueue(input)
      .then(() => {
        onSuccess?.();
      })
      .catch(() => undefined)
      .finally(() => {
        queueMutationPendingRef.current = false;
      });
  }

  function handleRetry(job: SystemQueueJob) {
    startQueueMutation(
      {
        mode: 'retry',
        jobId: job.id,
      },
      () => {
        reload();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      },
    );
  }

  function handleCancel(job: SystemQueueJob) {
    startQueueMutation(
      {
        mode: 'cancel',
        jobId: job.id,
      },
      () => {
        reload();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      },
    );
  }

  function handleEnqueue() {
    startQueueMutation(
      {
        mode: 'enqueue',
        type: enqueueType,
        payloadJson: enqueuePayloadJson,
        runAt: enqueueRunAt.trim().length > 0 ? enqueueRunAt.trim() : undefined,
      },
      () => {
        reload();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      },
    );
  }

  function handleFocusEnqueueForm() {
    enqueueTypeFieldRef.current?.focus();
  }

  function handleImportBrowserLaneRequest(request: BrowserLaneRequestRecord) {
    if (isBrowserLaneRequestMutationPending) {
      return;
    }

    const requestDraft = browserLaneDraftByArtifactPath[request.artifactPath];
    const notes = requestDraft?.notes.trim().length ? requestDraft.notes.trim() : undefined;

    setActiveBrowserLaneArtifactPath(request.artifactPath);
    void runBrowserLaneRequestImport({
      requestArtifactPath: request.artifactPath,
      storageStateJson: requestDraft?.storageState ?? '',
      ...(notes ? { notes } : {}),
    })
      .then((response) => {
        setResolvedBrowserLaneRequestsByArtifactPath((current) => ({
          ...current,
          [request.artifactPath]: buildOptimisticBrowserLaneRequestResolution(response),
        }));
        setBrowserLaneDraftByArtifactPath((current) => {
          const { [request.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadBrowserLane();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveBrowserLaneArtifactPath(null);
      });
  }

  function handleCompleteBrowserHandoff(
    handoff: BrowserHandoffRecord,
    publishStatus: 'published' | 'failed',
  ) {
    if (isBrowserHandoffMutationPending) {
      return;
    }

    const handoffDraft = browserHandoffDraftByArtifactPath[handoff.artifactPath];
    const message =
      handoffDraft?.message.trim().length
        ? handoffDraft.message.trim()
        : undefined;
    const publishUrl =
      handoffDraft?.publishUrl.trim().length
        ? handoffDraft.publishUrl.trim()
        : undefined;

    setActiveBrowserHandoffArtifactPath(handoff.artifactPath);
    void runBrowserHandoffCompletion({
      artifactPath: handoff.artifactPath,
      publishStatus,
      ...(message ? { message } : {}),
      ...(publishUrl ? { publishUrl } : {}),
    })
      .then((response) => {
        setResolvedBrowserHandoffsByArtifactPath((current) => ({
          ...current,
          [handoff.artifactPath]: buildOptimisticBrowserHandoffResolution(response),
        }));
        setBrowserHandoffDraftByArtifactPath((current) => {
          const { [handoff.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadBrowserHandoffs();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveBrowserHandoffArtifactPath(null);
      });
  }

  function handleCompleteInboxReplyHandoff(
    handoff: InboxReplyHandoffRecord,
    replyStatus: 'sent' | 'failed',
  ) {
    if (isInboxReplyHandoffMutationPending) {
      return;
    }

    const handoffDraft = inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath];
    const message = handoffDraft?.message.trim().length ? handoffDraft.message.trim() : undefined;
    const deliveryUrl =
      handoffDraft?.deliveryUrl.trim().length ? handoffDraft.deliveryUrl.trim() : undefined;

    setActiveInboxReplyHandoffArtifactPath(handoff.artifactPath);
    void runInboxReplyHandoffCompletion({
      artifactPath: handoff.artifactPath,
      replyStatus,
      ...(message ? { message } : {}),
      ...(deliveryUrl ? { deliveryUrl } : {}),
    })
      .then((response) => {
        setResolvedInboxReplyHandoffsByArtifactPath((current) => ({
          ...current,
          [handoff.artifactPath]: buildOptimisticInboxReplyHandoffResolution(response),
        }));
        setInboxReplyHandoffDraftByArtifactPath((current) => {
          const { [handoff.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadInboxReplyHandoffs();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveInboxReplyHandoffArtifactPath(null);
      });
  }

  function renderPriorityActionControls(action: PriorityActionRecord) {
    if (action.kind === 'browser_lane') {
      const request = action.request;
      return (
        <div style={{ display: 'grid', gap: '10px' }}>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>storageState JSON</span>
            <textarea
              data-priority-browser-lane-field="storageState"
              value={browserLaneDraftByArtifactPath[request.artifactPath]?.storageState ?? ''}
              onChange={(event) =>
                setBrowserLaneDraftByArtifactPath((current) => ({
                  ...current,
                  [request.artifactPath]: {
                    storageState: event.target.value,
                    notes: current[request.artifactPath]?.notes ?? '',
                  },
                }))
              }
              rows={4}
              placeholder='{"cookies":[],"origins":[]}'
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </label>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>导入备注</span>
            <input
              data-priority-browser-lane-field="notes"
              value={browserLaneDraftByArtifactPath[request.artifactPath]?.notes ?? ''}
              onChange={(event) =>
                setBrowserLaneDraftByArtifactPath((current) => ({
                  ...current,
                  [request.artifactPath]: {
                    storageState: current[request.artifactPath]?.storageState ?? '',
                    notes: event.target.value,
                  },
                }))
              }
              placeholder="可选：记录导入备注"
              style={fieldStyle}
            />
          </label>
          <ActionButton
            label={
              isBrowserLaneRequestMutationPending &&
              activeBrowserLaneArtifactPath === request.artifactPath
                ? '正在导入 storageState...'
                : '导入 storageState'
            }
            tone="primary"
            disabled={isBrowserLaneRequestMutationPending}
            onClick={() => handleImportBrowserLaneRequest(request)}
          />
        </div>
      );
    }

    if (action.kind === 'browser_handoff') {
      const handoff = action.handoff;
      return (
        <div style={{ display: 'grid', gap: '10px' }}>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>发布链接</span>
            <input
              data-priority-browser-handoff-field="publishUrl"
              value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.publishUrl ?? ''}
              onChange={(event) =>
                setBrowserHandoffDraftByArtifactPath((current) => ({
                  ...current,
                  [handoff.artifactPath]: {
                    publishUrl: event.target.value,
                    message: current[handoff.artifactPath]?.message ?? '',
                  },
                }))
              }
              placeholder="可选：发布后链接"
              style={fieldStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>结单备注</span>
            <input
              data-priority-browser-handoff-field="message"
              value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
              onChange={(event) =>
                setBrowserHandoffDraftByArtifactPath((current) => ({
                  ...current,
                  [handoff.artifactPath]: {
                    publishUrl: current[handoff.artifactPath]?.publishUrl ?? '',
                    message: event.target.value,
                  },
                }))
              }
              placeholder="可选：覆盖默认结单消息"
              style={fieldStyle}
            />
          </label>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <ActionButton
              label={
                isBrowserHandoffMutationPending &&
                activeBrowserHandoffArtifactPath === handoff.artifactPath
                  ? '正在标记已发布...'
                  : '标记已发布'
              }
              tone="primary"
              disabled={isBrowserHandoffMutationPending}
              onClick={() => handleCompleteBrowserHandoff(handoff, 'published')}
            />
            <ActionButton
              label={
                isBrowserHandoffMutationPending &&
                activeBrowserHandoffArtifactPath === handoff.artifactPath
                  ? '正在标记失败...'
                  : '标记失败'
              }
              disabled={isBrowserHandoffMutationPending}
              onClick={() => handleCompleteBrowserHandoff(handoff, 'failed')}
            />
          </div>
        </div>
      );
    }

    const handoff = action.handoff;
    return (
      <div style={{ display: 'grid', gap: '10px' }}>
        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontWeight: 700, color: '#334155' }}>回复链接</span>
          <input
            data-priority-inbox-reply-handoff-field="deliveryUrl"
            value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.deliveryUrl ?? ''}
            onChange={(event) =>
              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                ...current,
                [handoff.artifactPath]: {
                  deliveryUrl: event.target.value,
                  message: current[handoff.artifactPath]?.message ?? '',
                },
              }))
            }
            placeholder="可选：回复后链接"
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontWeight: 700, color: '#334155' }}>结单备注</span>
          <input
            data-priority-inbox-reply-handoff-field="message"
            value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
            onChange={(event) =>
              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                ...current,
                [handoff.artifactPath]: {
                  deliveryUrl: current[handoff.artifactPath]?.deliveryUrl ?? '',
                  message: event.target.value,
                },
              }))
            }
            placeholder="可选：覆盖默认结单消息"
            style={fieldStyle}
          />
        </label>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <ActionButton
            label={
              isInboxReplyHandoffMutationPending &&
              activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                ? '正在标记已发送...'
                : '标记已发送'
            }
            tone="primary"
            disabled={isInboxReplyHandoffMutationPending}
            onClick={() => handleCompleteInboxReplyHandoff(handoff, 'sent')}
          />
          <ActionButton
            label={
              isInboxReplyHandoffMutationPending &&
              activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                ? '正在标记失败...'
                : '标记失败'
            }
            disabled={isInboxReplyHandoffMutationPending}
            onClick={() => handleCompleteInboxReplyHandoff(handoff, 'failed')}
          />
        </div>
      </div>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Queue Control"
        title="System Queue"
        description="集中查看 scheduler 作业、失败项、待执行队列，并支持手动重试、取消和入队。"
        actions={
          <>
            <ActionButton
              label="刷新队列"
              onClick={() => {
                reload();
                reloadBrowserLane();
                reloadBrowserHandoffs();
                reloadInboxReplyHandoffs();
              }}
            />
            <ActionButton label="前往创建表单" tone="primary" onClick={handleFocusEnqueueForm} />
          </>
        }
      />

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载 system queue...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>system queue 加载失败：{displayState.error}</p> : null}
      {mutationFeedback ? (
        <p style={{ color: displayMutationState.status === 'error' ? '#b91c1c' : '#166534', fontWeight: 700 }}>
          {mutationFeedback}
        </p>
      ) : null}
      {browserLaneRequestFeedback ? (
        <p
          style={{
            color: browserLaneRequestMutationState.status === 'error' ? '#b91c1c' : '#166534',
            fontWeight: 700,
          }}
        >
          {browserLaneRequestFeedback}
        </p>
      ) : null}
      {browserHandoffFeedback ? (
        <p style={{ color: handoffMutationState.status === 'error' ? '#b91c1c' : '#166534', fontWeight: 700 }}>
          {browserHandoffFeedback}
        </p>
      ) : null}
      {inboxReplyHandoffFeedback ? (
        <p
          style={{
            color: inboxReplyHandoffMutationState.status === 'error' ? '#b91c1c' : '#166534',
            fontWeight: 700,
          }}
        >
          {inboxReplyHandoffFeedback}
        </p>
      ) : null}

      {hasLiveQueueData || displayState.status === 'idle' ? (
        <>
          <SectionCard
            title="重点待办"
            description="把 session、回复和发布回写统一收进一个入口，先处理会阻塞后续动作的工单。"
          >
            {pendingPriorityActions.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>当前没有待处理的 session、reply 或 publish handoff。</p>
            ) : (
              <div style={{ display: 'grid', gap: '14px' }}>
                <p style={{ margin: 0, color: '#334155', fontWeight: 700 }}>
                  当前 {pendingPriorityActions.length} 条待处理动作，优先处理 session 续登，再处理回复和发布回写。
                </p>
                {pendingPriorityActions.map((action) => (
                  <article
                    key={action.key}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #bfdbfe',
                      background: 'linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%)',
                      padding: '18px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{action.title}</div>
                      <div
                        style={{
                          borderRadius: '999px',
                          background: '#dbeafe',
                          color: '#1d4ed8',
                          padding: '6px 10px',
                          fontSize: '13px',
                          fontWeight: 700,
                        }}
                      >
                        {action.pendingLabel}
                      </div>
                    </div>
                    <div style={{ color: '#475569' }}>{action.detail}</div>
                    <div style={{ color: '#475569' }}>
                      {action.timestampLabel}: {action.timestampValue}
                    </div>
                    <div style={{ color: '#475569' }}>artifactPath: {action.artifactPath}</div>
                    {renderPriorityActionControls(action)}
                    <div>
                      <a
                        href={action.destinationHref}
                        style={{
                          color: '#2563eb',
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                      >
                        {action.destinationLabel}
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="Pending Jobs" value={String(queueStats.pending)} detail="等待 scheduler 执行的任务数量" />
            <StatCard label="Running Jobs" value={String(queueStats.running)} detail="当前正在运行的任务数量" />
            <StatCard label="Done Jobs" value={String(queueStats.done)} detail="已经执行完成的任务数量" />
            <StatCard label="Failed Jobs" value={String(queueStats.failed)} detail="需要人工重试或排查的失败任务" />
            <StatCard label="Canceled Jobs" value={String(queueStats.canceled)} detail="被人工或系统取消的任务数量" />
            <StatCard label="Due Pending" value={String(queueStats.duePending)} detail="已到执行时间但尚未消费的任务数量" />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(340px, 1.1fr)' }}>
            <SectionCard title="创建作业" description="直接向 `/api/system/jobs` 提交新的抓取或发布类作业。">
              <div style={{ display: 'grid', gap: '12px' }}>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>作业类型</span>
                  <input
                    ref={enqueueTypeFieldRef}
                    data-system-queue-field="type"
                    value={enqueueType}
                    onChange={(event) => setEnqueueType(event.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>runAt</span>
                  <input
                    data-system-queue-field="runAt"
                    value={enqueueRunAt}
                    onChange={(event) => setEnqueueRunAt(event.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontWeight: 700 }}>payload JSON</span>
                  <textarea
                    data-system-queue-field="payload"
                    value={enqueuePayloadJson}
                    onChange={(event) => setEnqueuePayloadJson(event.target.value)}
                    placeholder='例如 {"source":"rss"}'
                    style={{
                      ...fieldStyle,
                      minHeight: '120px',
                      resize: 'vertical',
                    }}
                  />
                </label>
                <ActionButton
                  label={
                    isQueueMutationPending && activeMutation?.mode === 'enqueue'
                      ? '正在创建作业...'
                      : '创建作业'
                  }
                  tone="primary"
                  disabled={isQueueMutationPending}
                  onClick={handleEnqueue}
                />
              </div>
            </SectionCard>

            <SectionCard title="队列作业" description="这里优先展示当前 jobs 列表，并暴露 retry/cancel。">
              <div style={{ display: 'grid', gap: '12px' }}>
                {viewData.jobs.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>当前没有 system jobs。</p>
                ) : (
                  viewData.jobs.map((job) => (
                    <article
                      key={job.id}
                      style={{
                        borderRadius: '16px',
                        border: '1px solid #dbe4f0',
                        background: '#f8fafc',
                        padding: '18px',
                        display: 'grid',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700 }}>
                          #{job.id} · {job.type}
                        </div>
                        <div style={{ color: '#475569' }}>{job.status}</div>
                      </div>
                      <div style={{ color: '#475569' }}>runAt: {job.runAt}</div>
                      <div style={{ color: '#475569' }}>attempts: {job.attempts}</div>
                      {job.lastError ? <div style={{ color: '#b91c1c' }}>lastError: {job.lastError}</div> : null}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {job.canRetry ? (
                          <ActionButton
                            label={
                              isQueueMutationPending &&
                              activeMutation?.mode === 'retry' &&
                              activeMutation.jobId === job.id
                                ? '正在重试...'
                                : '重试'
                            }
                            disabled={isQueueMutationPending}
                            onClick={() => handleRetry(job)}
                          />
                        ) : null}
                        {job.canCancel ? (
                          <ActionButton
                            label={
                              isQueueMutationPending &&
                              activeMutation?.mode === 'cancel' &&
                              activeMutation.jobId === job.id
                                ? '正在取消...'
                                : '取消'
                            }
                            disabled={isQueueMutationPending}
                            onClick={() => handleCancel(job)}
                          />
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </SectionCard>
          </div>

          <div id="system-queue-browser-lane">
            <SectionCard title="Browser Lane 工单" description="集中展示最近的 browser lane request artifact，便于人工接管或外部 lane 消费。">
              {displayBrowserLaneState.status === 'loading' ? (
                <p style={{ margin: 0, color: '#475569' }}>正在加载 browser lane requests...</p>
              ) : null}
              {displayBrowserLaneState.status === 'error' ? (
                <p style={{ margin: 0, color: '#b91c1c' }}>
                  browser lane requests 加载失败：{displayBrowserLaneState.error}
                </p>
              ) : null}
              {hasLiveBrowserLaneData && visibleBrowserLaneRequests.length === 0 ? (
                <p style={{ margin: 0, color: '#475569' }}>当前没有 browser lane requests。</p>
              ) : null}
              {hasLiveBrowserLaneData && visibleBrowserLaneRequests.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {visibleBrowserLaneRequests.map((request) => (
                    <article
                      key={`${request.channelAccountId}-${request.artifactPath}-${request.requestedAt}`}
                      style={{
                        borderRadius: '16px',
                        border: '1px solid #dbe4f0',
                        background: '#f8fafc',
                        padding: '18px',
                        display: 'grid',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        #{request.channelAccountId} · {request.platform} · {request.action} · {request.jobStatus}
                      </div>
                      <div style={{ color: '#475569' }}>accountKey: {request.accountKey}</div>
                      <div style={{ color: '#475569' }}>requestedAt: {request.requestedAt}</div>
                      <div style={{ color: '#475569' }}>artifactPath: {request.artifactPath}</div>
                      <div style={{ color: '#475569' }}>
                        resolvedAt: {request.resolvedAt ?? '未结单'}
                      </div>
                      {readResolutionStatus(request.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          resolution: {readResolutionStatus(request.resolution)}
                        </div>
                      ) : null}
                      {readBrowserLaneSessionStatus(request.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          session status: {readBrowserLaneSessionStatus(request.resolution)}
                        </div>
                      ) : null}
                      {readBrowserLaneSessionValidatedAt(request.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          validatedAt: {readBrowserLaneSessionValidatedAt(request.resolution)}
                        </div>
                      ) : null}
                      {readBrowserLaneSessionStorageStatePath(request.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          storageStatePath: {readBrowserLaneSessionStorageStatePath(request.resolution)}
                        </div>
                      ) : null}
                      {readBrowserLaneSessionNotes(request.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          notes: {readBrowserLaneSessionNotes(request.resolution)}
                        </div>
                      ) : null}
                      {request.resolvedAt === null ? (
                        <div style={{ display: 'grid', gap: '10px' }}>
                          <label style={{ display: 'grid', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>storageState JSON</span>
                            <textarea
                              data-browser-lane-field="storageState"
                              value={browserLaneDraftByArtifactPath[request.artifactPath]?.storageState ?? ''}
                              onChange={(event) =>
                                setBrowserLaneDraftByArtifactPath((current) => ({
                                  ...current,
                                  [request.artifactPath]: {
                                    storageState: event.target.value,
                                    notes: current[request.artifactPath]?.notes ?? '',
                                  },
                                }))
                              }
                              placeholder='例如 {"cookies":[],"origins":[]}'
                              style={{
                                ...fieldStyle,
                                minHeight: '120px',
                                resize: 'vertical',
                              }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>导入备注</span>
                            <input
                              data-browser-lane-field="notes"
                              value={browserLaneDraftByArtifactPath[request.artifactPath]?.notes ?? ''}
                              onChange={(event) =>
                                setBrowserLaneDraftByArtifactPath((current) => ({
                                  ...current,
                                  [request.artifactPath]: {
                                    storageState: current[request.artifactPath]?.storageState ?? '',
                                    notes: event.target.value,
                                  },
                                }))
                              }
                              placeholder="可选：记录导入备注"
                              style={fieldStyle}
                            />
                          </label>
                          <ActionButton
                            label={
                              isBrowserLaneRequestMutationPending &&
                              activeBrowserLaneArtifactPath === request.artifactPath
                                ? '正在导入 storageState...'
                                : '导入 storageState'
                            }
                            tone="primary"
                            disabled={isBrowserLaneRequestMutationPending}
                            onClick={() => handleImportBrowserLaneRequest(request)}
                          />
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </SectionCard>
          </div>

          <div id="system-queue-browser-handoffs">
            <SectionCard title="Browser Handoff 工单" description="集中展示 browser manual handoff artifact 的最新状态，区分待处理、已完成和已作废。">
              {displayBrowserHandoffState.status === 'loading' ? (
                <p style={{ margin: 0, color: '#475569' }}>正在加载 browser handoffs...</p>
              ) : null}
              {displayBrowserHandoffState.status === 'error' ? (
                <p style={{ margin: 0, color: '#b91c1c' }}>
                  browser handoffs 加载失败：{displayBrowserHandoffState.error}
                </p>
              ) : null}
              {hasLiveBrowserHandoffData && visibleBrowserHandoffs.length === 0 ? (
                <p style={{ margin: 0, color: '#475569' }}>当前没有 browser handoffs。</p>
              ) : null}
              {hasLiveBrowserHandoffData && visibleBrowserHandoffs.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {visibleBrowserHandoffs.map((handoff) => (
                    <article
                      key={`${handoff.artifactPath}-${handoff.updatedAt}`}
                      style={{
                        borderRadius: '16px',
                        border: '1px solid #dbe4f0',
                        background: '#f8fafc',
                        padding: '18px',
                        display: 'grid',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {handoff.platform} · draft #{handoff.draftId} · {handoff.status}
                      </div>
                      {typeof handoff.channelAccountId === 'number' ? (
                        <div style={{ color: '#475569' }}>account #{handoff.channelAccountId}</div>
                      ) : null}
                      {handoff.accountDisplayName ? (
                        <div style={{ color: '#475569' }}>account: {handoff.accountDisplayName}</div>
                      ) : null}
                      {handoff.ownership ? (
                        <div style={{ color: '#475569' }}>ownership: {handoff.ownership}</div>
                      ) : null}
                      <div style={{ color: '#475569' }}>title: {handoff.title ?? '未提供'}</div>
                      <div style={{ color: '#475569' }}>accountKey: {handoff.accountKey}</div>
                      <div style={{ color: '#475569' }}>artifactPath: {handoff.artifactPath}</div>
                      <div style={{ color: '#475569' }}>updatedAt: {handoff.updatedAt}</div>
                      <div style={{ color: '#475569' }}>resolvedAt: {handoff.resolvedAt ?? '未结单'}</div>
                      {readResolutionStatus(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          resolution: {readResolutionStatus(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionDetail(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          resolution detail: {readResolutionDetail(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionPublishUrl(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          publishUrl: {readResolutionPublishUrl(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionMessage(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          message: {readResolutionMessage(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionPublishedAt(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          publishedAt: {readResolutionPublishedAt(handoff.resolution)}
                        </div>
                      ) : null}
                      {handoff.status === 'pending' ? (
                        <div style={{ display: 'grid', gap: '10px' }}>
                          <label style={{ display: 'grid', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>发布链接</span>
                            <input
                              data-browser-handoff-field="publishUrl"
                              value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.publishUrl ?? ''}
                              onChange={(event) =>
                                setBrowserHandoffDraftByArtifactPath((current) => ({
                                  ...current,
                                  [handoff.artifactPath]: {
                                    publishUrl: event.target.value,
                                    message: current[handoff.artifactPath]?.message ?? '',
                                  },
                                }))
                              }
                              placeholder="可选：发布后链接"
                              style={fieldStyle}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>结单备注</span>
                            <input
                              data-browser-handoff-field="message"
                              value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
                              onChange={(event) =>
                                setBrowserHandoffDraftByArtifactPath((current) => ({
                                  ...current,
                                  [handoff.artifactPath]: {
                                    publishUrl: current[handoff.artifactPath]?.publishUrl ?? '',
                                    message: event.target.value,
                                  },
                                }))
                              }
                              placeholder="可选：覆盖默认结单消息"
                              style={fieldStyle}
                            />
                          </label>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <ActionButton
                              label={
                                isBrowserHandoffMutationPending &&
                                activeBrowserHandoffArtifactPath === handoff.artifactPath
                                  ? '正在标记已发布...'
                                  : '标记已发布'
                              }
                              tone="primary"
                              disabled={isBrowserHandoffMutationPending}
                              onClick={() => handleCompleteBrowserHandoff(handoff, 'published')}
                            />
                            <ActionButton
                              label={
                                isBrowserHandoffMutationPending &&
                                activeBrowserHandoffArtifactPath === handoff.artifactPath
                                  ? '正在标记失败...'
                                  : '标记失败'
                              }
                              disabled={isBrowserHandoffMutationPending}
                              onClick={() => handleCompleteBrowserHandoff(handoff, 'failed')}
                            />
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </SectionCard>
          </div>

          <div id="system-queue-inbox-reply-handoffs">
            <SectionCard
              title="Inbox Reply Handoff 工单"
              description="集中展示 inbox reply browser/manual handoff artifact 的最新状态，便于人工回复后回写 sent 或 failed。"
            >
              {displayInboxReplyHandoffState.status === 'loading' ? (
                <p style={{ margin: 0, color: '#475569' }}>正在加载 inbox reply handoffs...</p>
              ) : null}
              {displayInboxReplyHandoffState.status === 'error' ? (
                <p style={{ margin: 0, color: '#b91c1c' }}>
                  inbox reply handoffs 加载失败：{displayInboxReplyHandoffState.error}
                </p>
              ) : null}
              {hasLiveInboxReplyHandoffData && visibleInboxReplyHandoffs.length === 0 ? (
                <p style={{ margin: 0, color: '#475569' }}>当前没有 inbox reply handoffs。</p>
              ) : null}
              {hasLiveInboxReplyHandoffData && visibleInboxReplyHandoffs.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {visibleInboxReplyHandoffs.map((handoff) => (
                    <article
                      key={`${handoff.artifactPath}-${handoff.updatedAt}`}
                      style={{
                        borderRadius: '16px',
                        border: '1px solid #dbe4f0',
                        background: '#f8fafc',
                        padding: '18px',
                        display: 'grid',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {handoff.platform} · item #{handoff.itemId} · {handoff.status}
                      </div>
                      {typeof handoff.channelAccountId === 'number' ? (
                        <div style={{ color: '#475569' }}>account #{handoff.channelAccountId}</div>
                      ) : null}
                      <div style={{ color: '#475569' }}>source: {handoff.source}</div>
                      <div style={{ color: '#475569' }}>title: {handoff.title ?? '未提供'}</div>
                      <div style={{ color: '#475569' }}>author: {handoff.author ?? '未提供'}</div>
                      <div style={{ color: '#475569' }}>accountKey: {handoff.accountKey}</div>
                      <div style={{ color: '#475569' }}>artifactPath: {handoff.artifactPath}</div>
                      <div style={{ color: '#475569' }}>updatedAt: {handoff.updatedAt}</div>
                      <div style={{ color: '#475569' }}>resolvedAt: {handoff.resolvedAt ?? '未结单'}</div>
                      {readResolutionStatus(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          resolution: {readResolutionStatus(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionDetail(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          resolution detail: {readResolutionDetail(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionDeliveryUrl(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          deliveryUrl: {readResolutionDeliveryUrl(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionMessage(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          message: {readResolutionMessage(handoff.resolution)}
                        </div>
                      ) : null}
                      {readResolutionDeliveredAt(handoff.resolution) ? (
                        <div style={{ color: '#475569' }}>
                          deliveredAt: {readResolutionDeliveredAt(handoff.resolution)}
                        </div>
                      ) : null}
                      {handoff.status === 'pending' ? (
                        <div style={{ display: 'grid', gap: '10px' }}>
                          <label style={{ display: 'grid', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>回复链接</span>
                            <input
                              data-inbox-reply-handoff-field="deliveryUrl"
                              value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.deliveryUrl ?? ''}
                              onChange={(event) =>
                                setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                  ...current,
                                  [handoff.artifactPath]: {
                                    deliveryUrl: event.target.value,
                                    message: current[handoff.artifactPath]?.message ?? '',
                                  },
                                }))
                              }
                              placeholder="可选：回复后链接"
                              style={fieldStyle}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>结单备注</span>
                            <input
                              data-inbox-reply-handoff-field="message"
                              value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
                              onChange={(event) =>
                                setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                  ...current,
                                  [handoff.artifactPath]: {
                                    deliveryUrl: current[handoff.artifactPath]?.deliveryUrl ?? '',
                                    message: event.target.value,
                                  },
                                }))
                              }
                              placeholder="可选：覆盖默认结单消息"
                              style={fieldStyle}
                            />
                          </label>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <ActionButton
                              label={
                                isInboxReplyHandoffMutationPending &&
                                activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                                  ? '正在标记已发送...'
                                  : '标记已发送'
                              }
                              tone="primary"
                              disabled={isInboxReplyHandoffMutationPending}
                              onClick={() => handleCompleteInboxReplyHandoff(handoff, 'sent')}
                            />
                            <ActionButton
                              label={
                                isInboxReplyHandoffMutationPending &&
                                activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                                  ? '正在标记失败...'
                                  : '标记失败'
                              }
                              disabled={isInboxReplyHandoffMutationPending}
                              onClick={() => handleCompleteInboxReplyHandoff(handoff, 'failed')}
                            />
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </SectionCard>
          </div>

          <SectionCard title="最近作业" description="这里单独展示 `/api/system/jobs` 返回的 recentJobs，避免与当前作业列表混淆。">
            {viewData.recentJobs.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>当前没有 recent jobs。</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {viewData.recentJobs.map((job) => (
                  <article
                    key={`recent-${job.id}-${job.runAt}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '18px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      #{job.id} · {job.type} · {job.status}
                    </div>
                    <div style={{ color: '#475569' }}>runAt: {job.runAt}</div>
                    <div style={{ color: '#475569' }}>attempts: {job.attempts}</div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </section>
  );
}

function buildOptimisticBrowserLaneRequestResolution(response: BrowserLaneRequestImportResponse) {
  const session = readBrowserLaneImportSession(response);

  return {
    resolvedAt: session?.validatedAt ?? new Date().toISOString(),
    jobStatus: 'resolved',
    resolution: {
      status: 'resolved',
      session,
    },
  };
}

function buildOptimisticBrowserHandoffResolution(response: BrowserHandoffCompletionResponse) {
  return {
    resolvedAt: response.publishedAt ?? new Date().toISOString(),
    status: response.status,
    resolution: {
      status: response.status,
      draftStatus: response.draftStatus,
      publishStatus: response.publishStatus ?? response.status,
      ...(response.publishUrl ? { publishUrl: response.publishUrl } : {}),
      ...(response.message ? { message: response.message } : {}),
      ...(response.publishedAt ? { publishedAt: response.publishedAt } : {}),
    },
  };
}

function buildOptimisticInboxReplyHandoffResolution(response: InboxReplyHandoffCompletionResponse) {
  return {
    resolvedAt: response.deliveredAt ?? new Date().toISOString(),
    status: response.status,
    resolution: {
      status: response.status,
      itemStatus: response.itemStatus,
      ...(response.replyStatus ? { replyStatus: response.replyStatus } : {}),
      ...(response.deliveryUrl ? { deliveryUrl: response.deliveryUrl } : {}),
      ...(response.message ? { message: response.message } : {}),
      ...(response.deliveredAt ? { deliveredAt: response.deliveredAt } : {}),
    },
  };
}

function readChannelAccountMetadataSession(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const session = (value as { session?: unknown }).session;
  return typeof session === 'object' && session !== null && !Array.isArray(session)
    ? (session as BrowserLaneSessionSummary)
    : null;
}

function readBrowserLaneImportSession(response: BrowserLaneRequestImportResponse) {
  return (
    response.session ??
    response.channelAccount.session ??
    readChannelAccountMetadataSession(response.channelAccount.metadata) ??
    null
  );
}

function readResolutionStatus(value: unknown) {
  return typeof (value as { status?: unknown } | null)?.status === 'string'
    ? ((value as { status: string }).status)
    : null;
}

function readBrowserLaneSession(value: unknown) {
  const session = (value as { session?: unknown } | null)?.session;
  return typeof session === 'object' && session !== null && !Array.isArray(session)
    ? (session as Record<string, unknown>)
    : null;
}

function readBrowserLaneSessionStatus(value: unknown) {
  const session = readBrowserLaneSession(value);
  return typeof session?.status === 'string' ? session.status : null;
}

function readBrowserLaneSessionValidatedAt(value: unknown) {
  const session = readBrowserLaneSession(value);
  return typeof session?.validatedAt === 'string' ? session.validatedAt : null;
}

function readBrowserLaneSessionStorageStatePath(value: unknown) {
  const session = readBrowserLaneSession(value);
  return typeof session?.storageStatePath === 'string' ? session.storageStatePath : null;
}

function readBrowserLaneSessionNotes(value: unknown) {
  const session = readBrowserLaneSession(value);
  return typeof session?.notes === 'string' ? session.notes : null;
}

function readResolutionDetail(value: unknown) {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return typeof record?.reason === 'string'
    ? record.reason
    : typeof record?.publishStatus === 'string'
      ? record.publishStatus
      : typeof record?.replyStatus === 'string'
        ? record.replyStatus
        : typeof record?.draftStatus === 'string'
          ? record.draftStatus
          : typeof record?.itemStatus === 'string'
            ? record.itemStatus
        : null;
}

function readResolutionPublishUrl(value: unknown) {
  return typeof (value as { publishUrl?: unknown } | null)?.publishUrl === 'string'
    ? ((value as { publishUrl: string }).publishUrl)
    : null;
}

function readResolutionMessage(value: unknown) {
  return typeof (value as { message?: unknown } | null)?.message === 'string'
    ? ((value as { message: string }).message)
    : null;
}

function readResolutionDeliveryUrl(value: unknown) {
  return typeof (value as { deliveryUrl?: unknown } | null)?.deliveryUrl === 'string'
    ? ((value as { deliveryUrl: string }).deliveryUrl)
    : null;
}

function readResolutionPublishedAt(value: unknown) {
  return typeof (value as { publishedAt?: unknown } | null)?.publishedAt === 'string'
    ? ((value as { publishedAt: string }).publishedAt)
    : null;
}

function readResolutionDeliveredAt(value: unknown) {
  return typeof (value as { deliveredAt?: unknown } | null)?.deliveredAt === 'string'
    ? ((value as { deliveredAt: string }).deliveredAt)
    : null;
}

function buildPriorityActionRecords(input: {
  browserLaneRequests: BrowserLaneRequestRecord[];
  browserHandoffs: BrowserHandoffRecord[];
  inboxReplyHandoffs: InboxReplyHandoffRecord[];
}): PriorityActionRecord[] {
  const browserLaneActions = input.browserLaneRequests
    .filter(isPendingBrowserLaneRequest)
    .map((request) => ({
      kind: 'browser_lane' as const,
      request,
      key: `browser-lane:${request.artifactPath}`,
      priority: readBrowserLanePriority(request.action),
      title: `${request.action === 'relogin' ? '重新登录' : '补充 Session'} · ${request.platform} · ${request.accountKey}`,
      detail:
        request.action === 'relogin'
          ? `account #${request.channelAccountId} · 当前 session 已失效，等待重新登录并回写新 session。`
          : `account #${request.channelAccountId} · 当前缺少可用 session，等待导入 storageState。`,
      artifactPath: request.artifactPath,
      timestampLabel: 'requestedAt' as const,
      timestampValue: request.requestedAt,
      pendingLabel: request.action === 'relogin' ? '待重新登录' : '待补充 Session',
      destinationHref: '#system-queue-browser-lane',
      destinationLabel: '前往 Browser Lane 工单',
    }));
  const inboxReplyActions = input.inboxReplyHandoffs
    .filter((handoff) => handoff.status === 'pending')
    .map((handoff) => ({
      kind: 'inbox_reply_handoff' as const,
      handoff,
      key: `inbox-reply:${handoff.artifactPath}`,
      priority: 2,
      title: `回复接管 · ${handoff.platform} · item #${handoff.itemId}`,
      detail: `author: ${handoff.author ?? '未提供'} · ${handoff.title ?? '未提供标题'}`,
      artifactPath: handoff.artifactPath,
      timestampLabel: 'updatedAt' as const,
      timestampValue: handoff.updatedAt,
      pendingLabel: '待人工回复',
      destinationHref: '#system-queue-inbox-reply-handoffs',
      destinationLabel: '前往 Inbox Reply Handoff 工单',
    }));
  const browserHandoffActions = input.browserHandoffs
    .filter((handoff) => handoff.status === 'pending')
    .map((handoff) => ({
      kind: 'browser_handoff' as const,
      handoff,
      key: `browser-handoff:${handoff.artifactPath}`,
      priority: 3,
      title: `发布接管 · ${handoff.platform} · draft #${handoff.draftId}`,
      detail: `${handoff.accountDisplayName ? `account: ${handoff.accountDisplayName}` : `accountKey: ${handoff.accountKey}`} · ${handoff.title ?? '未提供标题'}`,
      artifactPath: handoff.artifactPath,
      timestampLabel: 'updatedAt' as const,
      timestampValue: handoff.updatedAt,
      pendingLabel: '待发布回写',
      destinationHref: '#system-queue-browser-handoffs',
      destinationLabel: '前往 Browser Handoff 工单',
    }));

  return [...browserLaneActions, ...inboxReplyActions, ...browserHandoffActions].sort(comparePriorityActionRecords);
}

function isPendingBrowserLaneRequest(request: BrowserLaneRequestRecord) {
  return request.resolvedAt === null && readResolutionStatus(request.resolution) === null && request.jobStatus !== 'resolved';
}

function readBrowserLanePriority(action: string) {
  if (action === 'relogin') {
    return 0;
  }

  if (action === 'request_session') {
    return 1;
  }

  return 2;
}

function comparePriorityActionRecords(left: PriorityActionRecord, right: PriorityActionRecord) {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  if (left.timestampValue !== right.timestampValue) {
    return left.timestampValue.localeCompare(right.timestampValue);
  }

  return left.title.localeCompare(right.title);
}

function parseEnqueuePayload(value: string | undefined) {
  const normalizedValue = value?.trim() ?? '';
  if (normalizedValue.length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedValue);
  } catch {
    throw new Error('payload JSON 必须是合法的 JSON 对象');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('payload JSON 必须是 JSON 对象');
  }

  return parsed as Record<string, unknown>;
}

function parseStorageStateJson(value: string | undefined) {
  const normalizedValue = value?.trim() ?? '';
  if (normalizedValue.length === 0) {
    throw new Error('storageState JSON 不能为空');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedValue);
  } catch {
    throw new Error('storageState JSON 必须是合法的 JSON 对象');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('storageState JSON 必须是 JSON 对象');
  }

  if (
    !Array.isArray((parsed as { cookies?: unknown }).cookies) ||
    !Array.isArray((parsed as { origins?: unknown }).origins)
  ) {
    throw new Error('storageState JSON 必须包含 cookies 和 origins 数组');
  }

  return parsed as Record<string, unknown>;
}
