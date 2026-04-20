import { Router } from 'express';
import { createMonitorStore } from '../store/monitor.js';
import { createSQLiteDraftStore } from '../store/drafts.js';
import { createInboxStore } from '../store/inbox.js';
import { createChannelAccountStore } from '../store/channelAccounts.js';
import { createJobQueueStore } from '../store/jobQueue.js';
import { withDatabase } from '../lib/persistence.js';

const monitorStore = createMonitorStore();
const draftStore = createSQLiteDraftStore();
const inboxStore = createInboxStore();
const channelAccountStore = createChannelAccountStore();
const jobQueueStore = createJobQueueStore();

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
  const channelAccounts = filterProjectAwareRecords(channelAccountStore.list(), projectId);
  const followUpDrafts = drafts.filter((draft) => draft.title?.toLowerCase().includes('follow-up'));
  const unreadInboxItems = inboxItems.filter((item) => item.status !== 'handled');
  const connectedChannelAccounts = channelAccounts.filter((account) => account.status === 'healthy');
  const jobQueueStats = jobQueueStore.getStats(new Date().toISOString());
  const scheduledDraftCount = drafts.filter((draft) => draft.status === 'scheduled').length;
  const publishedDraftCount = drafts.filter((draft) => draft.status === 'published').length;
  const publishLogMetrics = getPublishLogMetrics(projectId);

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
