import { Router } from 'express';
import { createMonitorStore } from '../store/monitor.js';
import { createSQLiteDraftStore } from '../store/drafts.js';
import { createInboxStore } from '../store/inbox.js';
import { createChannelAccountStore } from '../store/channelAccounts.js';
import { createJobQueueStore } from '../store/jobQueue.js';
import { createSettingsStore } from '../store/settings.js';
import { createSourceConfigStore } from '../store/sourceConfigs.js';
import { listSessionRequestArtifacts } from '../services/browser/sessionRequestArtifacts.js';
import { listBrowserHandoffArtifacts } from '../services/publishers/browserHandoffArtifacts.js';
import { resolveSourceConfigInputs } from '../services/monitorFetch.js';
import { withDatabase } from '../lib/persistence.js';

const monitorStore = createMonitorStore();
const draftStore = createSQLiteDraftStore();
const inboxStore = createInboxStore();
const channelAccountStore = createChannelAccountStore();
const jobQueueStore = createJobQueueStore();
const settingsStore = createSettingsStore();
const sourceConfigStore = createSourceConfigStore();

export const systemDashboardRouter = Router();

systemDashboardRouter.get('/dashboard', (request, response) => {
  const projectId = parseProjectIdQuery(request.query.projectId);

  if (request.query.projectId !== undefined && projectId === undefined) {
    response.status(400).json({ error: 'invalid project id' });
    return;
  }

  const monitorItems = filterProjectAwareRecords(monitorStore.list(), projectId);
  const drafts = draftStore.list(undefined, projectId);
  const inboxItems = filterProjectAwareRecords(inboxStore.list(), projectId);
  const allChannelAccounts = channelAccountStore.list();
  const channelAccounts = filterProjectAwareRecords(allChannelAccounts, projectId);
  const followUpDrafts = drafts.filter((draft) => draft.title?.toLowerCase().includes('follow-up'));
  const unreadInboxItems = inboxItems.filter((item) => item.status !== 'handled');
  const connectedChannelAccounts = channelAccounts.filter((account) => account.status === 'healthy');
  const jobQueueStats = jobQueueStore.getStats(new Date().toISOString(), projectId);
  const scheduledDraftCount = drafts.filter((draft) => draft.status === 'scheduled').length;
  const publishedDraftCount = drafts.filter((draft) => draft.status === 'published').length;
  const publishLogMetrics = getPublishLogMetrics(projectId);
  const monitorConfigMetrics = getMonitorConfigMetrics(projectId);
  const allChannelAccountIds = new Set(allChannelAccounts.map((account) => account.id));
  const channelAccountKeyCounts = countDashboardChannelAccountKeys(allChannelAccounts);
  const scopedChannelAccountIds = new Set(channelAccounts.map((account) => account.id));
  const scopedChannelAccountKeys = new Set(
    channelAccounts.map((account) => `${normalizeDashboardPlatform(account.platform)}:${account.accountKey}`),
  );
  const browserLaneRequests = listSessionRequestArtifacts().filter((request) =>
    projectId === undefined
      ? true
      : scopedChannelAccountIds.has(request.channelAccountId)
        ? true
        : allChannelAccountIds.has(request.channelAccountId)
          ? false
          : (() => {
              const requestKey = `${normalizeDashboardPlatform(request.platform)}:${request.accountKey}`;
              return (
                scopedChannelAccountKeys.has(requestKey) &&
                (channelAccountKeyCounts.get(requestKey) ?? 0) === 1
              );
            })(),
  );
  const pendingBrowserLaneRequests = browserLaneRequests.filter((request) => request.resolvedAt === null).length;
  const resolvedBrowserLaneRequests = browserLaneRequests.filter((request) => request.resolvedAt !== null).length;
  const browserHandoffs = listBrowserHandoffArtifacts().filter((handoff) =>
    projectId === undefined
      ? true
      : typeof handoff.channelAccountId === 'number'
        ? scopedChannelAccountIds.has(handoff.channelAccountId)
        : scopedChannelAccountKeys.has(
            `${normalizeDashboardPlatform(handoff.platform)}:${handoff.accountKey}`,
          ),
  );
  const pendingBrowserHandoffs = browserHandoffs.filter((handoff) => handoff.status === 'pending').length;
  const resolvedBrowserHandoffs = browserHandoffs.filter((handoff) => handoff.status === 'resolved').length;
  const obsoleteBrowserHandoffs = browserHandoffs.filter((handoff) => handoff.status === 'obsolete').length;
  const unmatchedBrowserHandoffs = browserHandoffs.filter((handoff) => handoff.ownership === 'unmatched').length;

  response.json({
    monitor: {
      total: monitorItems.length,
      new: monitorItems.filter((item) => item.status === 'new').length,
      followUpDrafts: followUpDrafts.length,
    },
    drafts: {
      total: drafts.length,
      review: drafts.filter((draft) => draft.status === 'review').length,
      ...(scheduledDraftCount > 0 ? { scheduled: scheduledDraftCount } : {}),
      ...(publishedDraftCount > 0 ? { published: publishedDraftCount } : {}),
    },
    totals: {
      items: monitorItems.length + drafts.length,
      followUps: followUpDrafts.length,
    },
    ...(publishLogMetrics.totalCount > 0
      ? {
          publishLogs: {
            failedCount: publishLogMetrics.failedCount,
          },
        }
      : {}),
    monitorConfig: monitorConfigMetrics,
    ...(inboxItems.length > 0
      ? {
          inbox: {
            total: inboxItems.length,
            unread: unreadInboxItems.length,
          },
        }
      : {}),
    ...(channelAccounts.length > 0
      ? {
          channelAccounts: {
            total: channelAccounts.length,
            connected: connectedChannelAccounts.length,
          },
        }
      : {}),
    browserLaneRequests: {
      total: browserLaneRequests.length,
      pending: pendingBrowserLaneRequests,
      resolved: resolvedBrowserLaneRequests,
    },
    browserHandoffs: {
      total: browserHandoffs.length,
      pending: pendingBrowserHandoffs,
      resolved: resolvedBrowserHandoffs,
      obsolete: obsoleteBrowserHandoffs,
      unmatched: unmatchedBrowserHandoffs,
    },
    jobQueue: jobQueueStats,
  });
});

function parseProjectIdQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function normalizeDashboardPlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function countDashboardChannelAccountKeys(
  channelAccounts: Array<{ platform: string; accountKey: string }>,
) {
  const counts = new Map<string, number>();

  for (const channelAccount of channelAccounts) {
    const key = `${normalizeDashboardPlatform(channelAccount.platform)}:${channelAccount.accountKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function filterProjectAwareRecords<T extends { projectId?: number | null }>(
  records: T[],
  projectId?: number,
) {
  if (projectId === undefined) {
    return records;
  }

  return records.filter((record) => record.projectId === projectId);
}

function getPublishLogMetrics(projectId?: number) {
  return withDatabase((database) => {
    const row =
      projectId === undefined
        ? database
            .prepare(
              `
                SELECT COUNT(*) AS totalCount,
                       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount
                FROM publish_logs
              `,
            )
            .get()
        : database
            .prepare(
              `
                SELECT COUNT(*) AS totalCount,
                       COALESCE(
                         SUM(CASE WHEN publish_logs.status = 'failed' THEN 1 ELSE 0 END),
                         0
                       ) AS failedCount
                FROM publish_logs
                INNER JOIN drafts ON drafts.id = publish_logs.draft_id
                WHERE drafts.project_id = ?
              `,
            )
            .get([projectId]);

    return {
      totalCount: Number(row?.totalCount ?? 0),
      failedCount: Number(row?.failedCount ?? 0),
    };
  });
}

function getMonitorConfigMetrics(projectId?: number) {
  const enabledSourceConfigs =
    projectId === undefined
      ? sourceConfigStore.listEnabled()
      : sourceConfigStore.listByProject(projectId).filter((sourceConfig) => sourceConfig.enabled);
  const sourceConfigInputs = resolveSourceConfigInputs(enabledSourceConfigs);
  const parsedSourceConfigInputCount =
    sourceConfigInputs.rssFeeds.length +
    sourceConfigInputs.redditQueries.length +
    sourceConfigInputs.xQueries.length +
    sourceConfigInputs.v2exQueries.length;

  if (projectId !== undefined) {
    return {
      directFeeds: 0,
      directQueries: 0,
      enabledSourceConfigs: enabledSourceConfigs.length,
      totalInputs: parsedSourceConfigInputCount,
    };
  }

  const settings = settingsStore.get();
  const directFeeds = settings.monitorRssFeeds.length;
  const directQueries =
    settings.monitorXQueries.length +
    settings.monitorRedditQueries.length +
    settings.monitorV2exQueries.length;

  return {
    directFeeds,
    directQueries,
    enabledSourceConfigs: enabledSourceConfigs.length,
    totalInputs: directFeeds + directQueries + parsedSourceConfigInputCount,
  };
}
