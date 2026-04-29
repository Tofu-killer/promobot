import type { DraftRecord, DraftStore } from '../../routes/drafts.js';
import type { ChannelAccountRecord } from '../../store/channelAccounts.js';
import { createSQLiteDraftStore } from '../../store/drafts.js';
import type { JobQueueEntry, JobQueueStore } from '../../store/jobQueue.js';
import { createJobQueueStore } from '../../store/jobQueue.js';
import type { PublishLogRecord, PublishLogStore } from '../../store/publishLogs.js';
import { createSQLitePublishLogStore } from '../../store/publishLogs.js';

type ResumableSessionSummary = {
  hasSession?: boolean;
  status?: string | null;
} | null;

export interface ResumeBlockedBrowserPublishesDependencies {
  draftStore?: Pick<DraftStore, 'list'>;
  publishLogStore?: Pick<PublishLogStore, 'listByDraftId'>;
  jobQueueStore?: Pick<JobQueueStore, 'schedulePublishJob'>;
  now?: () => Date;
}

export function resumeBlockedBrowserPublishesForChannelAccount(
  channelAccount: Pick<ChannelAccountRecord, 'projectId' | 'platform' | 'accountKey'>,
  session: ResumableSessionSummary,
  dependencies: ResumeBlockedBrowserPublishesDependencies = {},
): JobQueueEntry[] {
  if (!isResumableSession(session)) {
    return [];
  }

  const draftStore = dependencies.draftStore ?? createSQLiteDraftStore();
  const publishLogStore = dependencies.publishLogStore ?? createSQLitePublishLogStore();
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const nowIso = (dependencies.now ?? (() => new Date()))().toISOString();
  const drafts = draftStore.list('review', channelAccount.projectId ?? undefined);
  const resumedJobs: JobQueueEntry[] = [];

  for (const draft of drafts) {
    if (!matchesChannelAccountDraft(channelAccount, draft)) {
      continue;
    }

    const latestPublishLog = getLatestPublishLog(publishLogStore.listByDraftId(draft.id));
    if (!isSessionBlockedPublishLog(latestPublishLog, draft)) {
      continue;
    }

    resumedJobs.push(jobQueueStore.schedulePublishJob(draft.id, nowIso, draft.projectId));
  }

  return resumedJobs;
}

function isResumableSession(session: ResumableSessionSummary) {
  return session?.hasSession === true && session.status === 'active';
}

function matchesChannelAccountDraft(
  channelAccount: Pick<ChannelAccountRecord, 'platform' | 'accountKey'>,
  draft: DraftRecord,
) {
  return (
    normalizePlatform(channelAccount.platform) === normalizePlatform(draft.platform) &&
    readDraftAccountKey(draft.metadata) === channelAccount.accountKey
  );
}

function getLatestPublishLog(logs: PublishLogRecord[]) {
  return logs.at(-1);
}

function isSessionBlockedPublishLog(log: PublishLogRecord | undefined, draft: DraftRecord) {
  if (!log || log.status !== 'manual_required') {
    return false;
  }

  const platform = normalizePlatform(draft.platform);
  return (
    log.message ===
      `${platform} draft ${draft.id} requires a saved browser session before manual handoff.` ||
    log.message ===
      `${platform} draft ${draft.id} requires the browser session to be refreshed before manual handoff.`
  );
}

function readDraftAccountKey(metadata: DraftRecord['metadata']) {
  return (
    readString(metadata.accountKey) ??
    readNestedString(metadata, ['channelAccount', 'accountKey']) ??
    readNestedString(metadata, ['browserSession', 'accountKey'])
  );
}

function normalizePlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function readNestedString(
  value: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = value;

  for (const segment of path) {
    if (!isPlainObject(current)) {
      return null;
    }

    current = current[segment];
  }

  return readString(current);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
