import type { ChannelAccountRecord } from '../../store/channelAccounts.js';
import type { JobQueueEntry, JobQueueStore } from '../../store/jobQueue.js';
import { createJobQueueStore } from '../../store/jobQueue.js';
import {
  createBrowserLaneDispatch,
  type BrowserLaneDispatch,
} from './browserLaneDispatch.js';
import type { SessionSummary } from './sessionStore.js';
import {
  listInboxReplyHandoffArtifacts,
  promoteInboxReplyHandoffArtifactToReady,
} from '../inbox/replyHandoffArtifacts.js';
import {
  defaultInboxReplyHandoffPollDelayMs,
  defaultInboxReplyHandoffPollMaxAttempts,
  hasOutstandingInboxReplyHandoffPollJob,
  inboxReplyHandoffPollJobType,
} from '../inbox/replyHandoffPollHandler.js';

export interface ResumeBlockedInboxReplyHandoffsDependencies {
  jobQueueStore?: Pick<JobQueueStore, 'enqueue' | 'list'>;
  now?: () => Date;
  browserLaneDispatch?: BrowserLaneDispatch;
}

export function resumeBlockedInboxReplyHandoffsForChannelAccount(
  channelAccount: Pick<ChannelAccountRecord, 'id' | 'projectId' | 'platform' | 'accountKey'>,
  session: SessionSummary | null,
  dependencies: ResumeBlockedInboxReplyHandoffsDependencies = {},
): JobQueueEntry[] {
  if (!isResumableSession(session)) {
    return [];
  }

  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const now = dependencies.now ?? (() => new Date());
  const browserLaneDispatch = dependencies.browserLaneDispatch ?? createBrowserLaneDispatch();
  const resumedJobs: JobQueueEntry[] = [];
  const matchingArtifacts = listInboxReplyHandoffArtifacts().filter((artifact) =>
    matchesBlockedHandoffArtifact(channelAccount, artifact),
  );

  for (const artifact of matchingArtifacts) {
    const promotedArtifact = promoteInboxReplyHandoffArtifactToReady({
      artifactPath: artifact.artifactPath,
      session,
    });
    if (!promotedArtifact) {
      continue;
    }

    if (
      hasOutstandingInboxReplyHandoffPollJob(jobQueueStore, {
        artifactPath: artifact.artifactPath,
        currentJobId: undefined,
      })
    ) {
      continue;
    }

    resumedJobs.push(
      jobQueueStore.enqueue({
        type: inboxReplyHandoffPollJobType,
        payload: {
          artifactPath: artifact.artifactPath,
          attempt: 0,
          maxAttempts: defaultInboxReplyHandoffPollMaxAttempts,
          pollDelayMs: defaultInboxReplyHandoffPollDelayMs,
        },
        runAt: new Date(now().getTime() + defaultInboxReplyHandoffPollDelayMs).toISOString(),
      }),
    );
    browserLaneDispatch({
      kind: 'inbox_reply_handoff',
      artifactPath: artifact.artifactPath,
      platform: artifact.platform,
      accountKey: artifact.accountKey,
      channelAccountId: channelAccount.id,
      itemId: artifact.itemId,
    });
  }

  return resumedJobs;
}

function isResumableSession(session: SessionSummary | null): session is SessionSummary & {
  hasSession: true;
  status: 'active';
} {
  return session?.hasSession === true && session.status === 'active';
}

function matchesBlockedHandoffArtifact(
  channelAccount: Pick<ChannelAccountRecord, 'id' | 'projectId' | 'platform' | 'accountKey'>,
  artifact: ReturnType<typeof listInboxReplyHandoffArtifacts>[number],
) {
  if (
    artifact.status !== 'pending' ||
    artifact.readiness !== 'blocked' ||
    artifact.resolvedAt !== null ||
    normalizePlatform(artifact.platform) !== normalizePlatform(channelAccount.platform) ||
    artifact.accountKey !== channelAccount.accountKey
  ) {
    return false;
  }

  if (artifact.channelAccountId === channelAccount.id) {
    return true;
  }

  return (
    artifact.channelAccountId === undefined &&
    typeof artifact.projectId === 'number' &&
    artifact.projectId === channelAccount.projectId
  );
}

function normalizePlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}
