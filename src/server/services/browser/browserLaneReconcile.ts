import {
  createBrowserLaneDispatch,
  type BrowserLaneDispatch,
  type BrowserLaneDispatchKind,
} from './browserLaneDispatch.js';
import {
  channelAccountSessionRequestPollJobType,
  defaultSessionRequestPollDelayMs,
  defaultSessionRequestPollMaxAttempts,
  hasOutstandingSessionRequestPollJob,
} from './sessionRequestHandler.js';
import {
  listSessionRequestArtifacts,
  getSessionRequestResultArtifact,
  type SessionRequestArtifactSummary,
} from './sessionRequestArtifacts.js';
import { createJobQueueStore, type JobQueueStore } from '../../store/jobQueue.js';
import {
  browserHandoffPollJobType,
  defaultBrowserHandoffPollDelayMs,
  defaultBrowserHandoffPollMaxAttempts,
  hasOutstandingBrowserHandoffPollJob,
} from '../publishers/browserHandoffPollHandler.js';
import {
  listBrowserHandoffArtifacts,
  type BrowserHandoffArtifactSummary,
} from '../publishers/browserHandoffArtifacts.js';
import { getBrowserHandoffResultArtifact } from '../publishers/browserHandoffResultArtifacts.js';
import {
  defaultInboxReplyHandoffPollDelayMs,
  defaultInboxReplyHandoffPollMaxAttempts,
  hasOutstandingInboxReplyHandoffPollJob,
  inboxReplyHandoffPollJobType,
} from '../inbox/replyHandoffPollHandler.js';
import {
  listInboxReplyHandoffArtifacts,
  type InboxReplyHandoffArtifactSummary,
} from '../inbox/replyHandoffArtifacts.js';
import { getInboxReplyHandoffResultArtifact } from '../inbox/replyHandoffResultArtifacts.js';

export type BrowserLaneReconcileKind =
  | 'all'
  | 'session_request'
  | 'publish_handoff'
  | 'inbox_reply_handoff';

type BrowserLaneReconcileItemKind = Exclude<BrowserLaneReconcileKind, 'all'>;
type BrowserLaneReconcileStatus = 'planned' | 'replayed' | 'skipped';
type BrowserLaneReconcilePollJobStatus = 'would_enqueue' | 'enqueued' | 'existing';

export interface BrowserLaneReconcileEntry {
  kind: BrowserLaneReconcileItemKind;
  artifactPath: string;
  status: BrowserLaneReconcileStatus;
  reason: string;
  pollJobStatus?: BrowserLaneReconcilePollJobStatus;
}

export interface BrowserLaneReconcileResult {
  dryRun: boolean;
  counts: {
    planned: number;
    replayed: number;
    skipped: number;
    pollJobsEnqueued: number;
    pollJobsExisting: number;
  };
  entries: BrowserLaneReconcileEntry[];
}

interface BrowserLaneReconcileDependencies {
  now?: () => Date;
  jobQueueStore?: Pick<JobQueueStore, 'enqueue' | 'list'>;
  browserLaneDispatch?: BrowserLaneDispatch;
  listSessionRequestArtifacts?: typeof listSessionRequestArtifacts;
  listBrowserHandoffArtifacts?: typeof listBrowserHandoffArtifacts;
  listInboxReplyHandoffArtifacts?: typeof listInboxReplyHandoffArtifacts;
}

export async function runBrowserLaneReconcile(
  input: {
    apply: boolean;
    kind: BrowserLaneReconcileKind;
  },
  dependencies: BrowserLaneReconcileDependencies = {},
): Promise<BrowserLaneReconcileResult> {
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const browserLaneDispatch = dependencies.browserLaneDispatch ?? createBrowserLaneDispatch();
  const now = dependencies.now ?? (() => new Date());
  const sessionArtifacts =
    dependencies.listSessionRequestArtifacts ?? listSessionRequestArtifacts;
  const browserHandoffArtifacts =
    dependencies.listBrowserHandoffArtifacts ?? listBrowserHandoffArtifacts;
  const inboxReplyHandoffArtifacts =
    dependencies.listInboxReplyHandoffArtifacts ?? listInboxReplyHandoffArtifacts;
  const result: BrowserLaneReconcileResult = {
    dryRun: !input.apply,
    counts: {
      planned: 0,
      replayed: 0,
      skipped: 0,
      pollJobsEnqueued: 0,
      pollJobsExisting: 0,
    },
    entries: [],
  };

  if (input.kind === 'all' || input.kind === 'session_request') {
    for (const artifact of sessionArtifacts()) {
      reconcileSessionRequestArtifact(
        artifact,
        result,
        input.apply,
        jobQueueStore,
        browserLaneDispatch,
        now,
      );
    }
  }

  if (input.kind === 'all' || input.kind === 'publish_handoff') {
    for (const artifact of browserHandoffArtifacts()) {
      reconcileBrowserHandoffArtifact(
        artifact,
        result,
        input.apply,
        jobQueueStore,
        browserLaneDispatch,
        now,
      );
    }
  }

  if (input.kind === 'all' || input.kind === 'inbox_reply_handoff') {
    for (const artifact of inboxReplyHandoffArtifacts()) {
      reconcileInboxReplyHandoffArtifact(
        artifact,
        result,
        input.apply,
        jobQueueStore,
        browserLaneDispatch,
        now,
      );
    }
  }

  return result;
}

function reconcileSessionRequestArtifact(
  artifact: SessionRequestArtifactSummary,
  result: BrowserLaneReconcileResult,
  apply: boolean,
  jobQueueStore: Pick<JobQueueStore, 'enqueue' | 'list'>,
  browserLaneDispatch: BrowserLaneDispatch,
  now: () => Date,
) {
  if (artifact.resolvedAt !== null) {
    appendSkippedEntry(result, {
      kind: 'session_request',
      artifactPath: artifact.artifactPath,
      reason: 'resolved',
    });
    return;
  }

  const hasPollJob = hasOutstandingSessionRequestPollJob(jobQueueStore, {
    accountId: artifact.channelAccountId,
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    action: artifact.action,
    requestJobId: artifact.jobId,
    currentJobId: undefined,
  });

  const resultArtifact = getSessionRequestResultArtifact({
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    action: artifact.action,
    requestJobId: artifact.jobId,
  });

  if (resultArtifact?.consumedAt === null) {
    const pollJobStatus = apply
      ? ensureSessionRequestPollJob(jobQueueStore, artifact, hasPollJob, now)
      : hasPollJob
        ? 'existing'
        : 'would_enqueue';

    appendSkippedEntry(result, {
      kind: 'session_request',
      artifactPath: artifact.artifactPath,
      reason: 'result_ready',
      pollJobStatus,
    });
    return;
  }

  const dryRunPollJobStatus = hasPollJob ? 'existing' : 'would_enqueue';
  if (!apply) {
    appendPlannedEntry(result, {
      kind: 'session_request',
      artifactPath: artifact.artifactPath,
      reason: 'unresolved',
      pollJobStatus: dryRunPollJobStatus,
    });
    return;
  }

  const dispatched = browserLaneDispatch({
    kind: 'session_request',
    artifactPath: artifact.artifactPath,
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    managedStorageStatePath: artifact.managedStorageStatePath,
    sessionAction: artifact.action,
    channelAccountId: artifact.channelAccountId,
    requestJobId: artifact.jobId,
  });

  if (!dispatched) {
    appendSkippedEntry(result, {
      kind: 'session_request',
      artifactPath: artifact.artifactPath,
      reason: 'dispatch_unconfigured',
      ...(hasPollJob ? { pollJobStatus: 'existing' as const } : {}),
    });
    return;
  }

  const pollJobStatus = ensureSessionRequestPollJob(jobQueueStore, artifact, hasPollJob, now);

  appendReplayedEntry(result, {
    kind: 'session_request',
    artifactPath: artifact.artifactPath,
    reason: 'unresolved',
    pollJobStatus,
  });
}

function reconcileBrowserHandoffArtifact(
  artifact: BrowserHandoffArtifactSummary,
  result: BrowserLaneReconcileResult,
  apply: boolean,
  jobQueueStore: Pick<JobQueueStore, 'enqueue' | 'list'>,
  browserLaneDispatch: BrowserLaneDispatch,
  now: () => Date,
) {
  if (artifact.status !== 'pending') {
    appendSkippedEntry(result, {
      kind: 'publish_handoff',
      artifactPath: artifact.artifactPath,
      reason: artifact.status,
    });
    return;
  }

  const hasPollJob = hasOutstandingBrowserHandoffPollJob(jobQueueStore, {
    artifactPath: artifact.artifactPath,
    handoffAttempt: artifact.handoffAttempt,
    currentJobId: undefined,
  });

  const resultArtifact = getBrowserHandoffResultArtifact({
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    draftId: artifact.draftId,
    handoffAttempt: artifact.handoffAttempt,
  });

  if (resultArtifact?.consumedAt === null) {
    const pollJobStatus = apply
      ? ensureBrowserHandoffPollJob(jobQueueStore, artifact, hasPollJob, now)
      : hasPollJob
        ? 'existing'
        : 'would_enqueue';

    appendSkippedEntry(result, {
      kind: 'publish_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'result_ready',
      pollJobStatus,
    });
    return;
  }

  if (artifact.readiness === 'blocked') {
    appendSkippedEntry(result, {
      kind: 'publish_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'blocked',
    });
    return;
  }

  const dryRunPollJobStatus = hasPollJob ? 'existing' : 'would_enqueue';
  if (!apply) {
    appendPlannedEntry(result, {
      kind: 'publish_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'ready',
      pollJobStatus: dryRunPollJobStatus,
    });
    return;
  }

  const dispatched = browserLaneDispatch({
    kind: 'publish_handoff',
    artifactPath: artifact.artifactPath,
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    draftId: artifact.draftId,
    handoffAttempt: artifact.handoffAttempt,
  });

  if (!dispatched) {
    appendSkippedEntry(result, {
      kind: 'publish_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'dispatch_unconfigured',
      ...(hasPollJob ? { pollJobStatus: 'existing' as const } : {}),
    });
    return;
  }

  const pollJobStatus = ensureBrowserHandoffPollJob(jobQueueStore, artifact, hasPollJob, now);

  appendReplayedEntry(result, {
    kind: 'publish_handoff',
    artifactPath: artifact.artifactPath,
    reason: 'ready',
    pollJobStatus,
  });
}

function reconcileInboxReplyHandoffArtifact(
  artifact: InboxReplyHandoffArtifactSummary,
  result: BrowserLaneReconcileResult,
  apply: boolean,
  jobQueueStore: Pick<JobQueueStore, 'enqueue' | 'list'>,
  browserLaneDispatch: BrowserLaneDispatch,
  now: () => Date,
) {
  if (artifact.status !== 'pending') {
    appendSkippedEntry(result, {
      kind: 'inbox_reply_handoff',
      artifactPath: artifact.artifactPath,
      reason: artifact.status,
    });
    return;
  }

  const hasPollJob = hasOutstandingInboxReplyHandoffPollJob(jobQueueStore, {
    artifactPath: artifact.artifactPath,
    handoffAttempt: artifact.handoffAttempt,
    currentJobId: undefined,
  });

  const resultArtifact = getInboxReplyHandoffResultArtifact({
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    itemId: artifact.itemId,
    handoffAttempt: artifact.handoffAttempt,
  });

  if (resultArtifact?.consumedAt === null) {
    const pollJobStatus = apply
      ? ensureInboxReplyHandoffPollJob(jobQueueStore, artifact, hasPollJob, now)
      : hasPollJob
        ? 'existing'
        : 'would_enqueue';

    appendSkippedEntry(result, {
      kind: 'inbox_reply_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'result_ready',
      pollJobStatus,
    });
    return;
  }

  if (artifact.readiness === 'blocked') {
    appendSkippedEntry(result, {
      kind: 'inbox_reply_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'blocked',
    });
    return;
  }

  const dryRunPollJobStatus = hasPollJob ? 'existing' : 'would_enqueue';
  if (!apply) {
    appendPlannedEntry(result, {
      kind: 'inbox_reply_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'ready',
      pollJobStatus: dryRunPollJobStatus,
    });
    return;
  }

  const dispatched = browserLaneDispatch({
    kind: 'inbox_reply_handoff',
    artifactPath: artifact.artifactPath,
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    itemId: artifact.itemId,
    handoffAttempt: artifact.handoffAttempt,
  });

  if (!dispatched) {
    appendSkippedEntry(result, {
      kind: 'inbox_reply_handoff',
      artifactPath: artifact.artifactPath,
      reason: 'dispatch_unconfigured',
      ...(hasPollJob ? { pollJobStatus: 'existing' as const } : {}),
    });
    return;
  }

  const pollJobStatus = ensureInboxReplyHandoffPollJob(jobQueueStore, artifact, hasPollJob, now);

  appendReplayedEntry(result, {
    kind: 'inbox_reply_handoff',
    artifactPath: artifact.artifactPath,
    reason: 'ready',
    pollJobStatus,
  });
}

function ensureSessionRequestPollJob(
  jobQueueStore: Pick<JobQueueStore, 'enqueue'>,
  artifact: SessionRequestArtifactSummary,
  hasPollJob: boolean,
  now: () => Date,
): BrowserLaneReconcilePollJobStatus {
  if (hasPollJob) {
    return 'existing';
  }

  jobQueueStore.enqueue({
    type: channelAccountSessionRequestPollJobType,
    payload: {
      accountId: artifact.channelAccountId,
      platform: artifact.platform,
      accountKey: artifact.accountKey,
      action: artifact.action,
      requestJobId: artifact.jobId,
      attempt: 0,
      maxAttempts: defaultSessionRequestPollMaxAttempts,
      pollDelayMs: defaultSessionRequestPollDelayMs,
    },
    runAt: new Date(now().getTime() + defaultSessionRequestPollDelayMs).toISOString(),
  });

  return 'enqueued';
}

function ensureBrowserHandoffPollJob(
  jobQueueStore: Pick<JobQueueStore, 'enqueue'>,
  artifact: BrowserHandoffArtifactSummary,
  hasPollJob: boolean,
  now: () => Date,
): BrowserLaneReconcilePollJobStatus {
  if (hasPollJob) {
    return 'existing';
  }

  jobQueueStore.enqueue({
    type: browserHandoffPollJobType,
    payload: {
      artifactPath: artifact.artifactPath,
      handoffAttempt: artifact.handoffAttempt,
      attempt: 0,
      maxAttempts: defaultBrowserHandoffPollMaxAttempts,
      pollDelayMs: defaultBrowserHandoffPollDelayMs,
    },
    runAt: new Date(now().getTime() + defaultBrowserHandoffPollDelayMs).toISOString(),
  });

  return 'enqueued';
}

function ensureInboxReplyHandoffPollJob(
  jobQueueStore: Pick<JobQueueStore, 'enqueue'>,
  artifact: InboxReplyHandoffArtifactSummary,
  hasPollJob: boolean,
  now: () => Date,
): BrowserLaneReconcilePollJobStatus {
  if (hasPollJob) {
    return 'existing';
  }

  jobQueueStore.enqueue({
    type: inboxReplyHandoffPollJobType,
    payload: {
      artifactPath: artifact.artifactPath,
      handoffAttempt: artifact.handoffAttempt,
      attempt: 0,
      maxAttempts: defaultInboxReplyHandoffPollMaxAttempts,
      pollDelayMs: defaultInboxReplyHandoffPollDelayMs,
    },
    runAt: new Date(now().getTime() + defaultInboxReplyHandoffPollDelayMs).toISOString(),
  });

  return 'enqueued';
}

function appendSkippedEntry(
  result: BrowserLaneReconcileResult,
  entry: Omit<BrowserLaneReconcileEntry, 'status'>,
) {
  result.counts.skipped += 1;
  recordPollJobStatus(result, entry.pollJobStatus);
  result.entries.push({
    ...entry,
    status: 'skipped',
  });
}

function appendPlannedEntry(
  result: BrowserLaneReconcileResult,
  input: {
    kind: BrowserLaneDispatchKind;
    artifactPath: string;
    reason: string;
    pollJobStatus: BrowserLaneReconcilePollJobStatus;
  },
) {
  result.counts.planned += 1;
  result.entries.push({
    kind: input.kind,
    artifactPath: input.artifactPath,
    status: 'planned',
    reason: input.reason,
    pollJobStatus: input.pollJobStatus,
  });
}

function appendReplayedEntry(
  result: BrowserLaneReconcileResult,
  input: {
    kind: BrowserLaneDispatchKind;
    artifactPath: string;
    reason: string;
    pollJobStatus: BrowserLaneReconcilePollJobStatus;
  },
) {
  result.counts.replayed += 1;
  recordPollJobStatus(result, input.pollJobStatus);
  result.entries.push({
    kind: input.kind,
    artifactPath: input.artifactPath,
    status: 'replayed',
    reason: input.reason,
    pollJobStatus: input.pollJobStatus,
  });
}

function recordPollJobStatus(
  result: BrowserLaneReconcileResult,
  pollJobStatus: BrowserLaneReconcilePollJobStatus | undefined,
) {
  if (pollJobStatus === 'enqueued') {
    result.counts.pollJobsEnqueued += 1;
  } else if (pollJobStatus === 'existing') {
    result.counts.pollJobsExisting += 1;
  }
}
