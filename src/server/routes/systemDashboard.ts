import { Router } from 'express';
import { createMonitorStore } from '../store/monitor';
import { createSQLiteDraftStore } from '../store/drafts';
import { createInboxStore } from '../store/inbox';
import { createChannelAccountStore } from '../store/channelAccounts';
import { withDatabase } from '../lib/persistence';

const monitorStore = createMonitorStore();
const draftStore = createSQLiteDraftStore();
const inboxStore = createInboxStore();
const channelAccountStore = createChannelAccountStore();

export const systemDashboardRouter = Router();

systemDashboardRouter.get('/dashboard', (_request, response) => {
  const monitorItems = monitorStore.list();
  const drafts = draftStore.list();
  const inboxItems = inboxStore.list();
  const channelAccounts = channelAccountStore.list();
  const followUpDrafts = drafts.filter((draft) => draft.title?.toLowerCase().includes('follow-up'));
  const unreadInboxItems = inboxItems.filter((item) => item.status !== 'handled');
  const connectedChannelAccounts = channelAccounts.filter((account) => account.status === 'healthy');
  const scheduledDraftCount = drafts.filter((draft) => draft.status === 'scheduled').length;
  const publishedDraftCount = drafts.filter((draft) => draft.status === 'published').length;
  const publishLogMetrics = withDatabase((database) => {
    const row = database
      .prepare(
        `
          SELECT COUNT(*) AS totalCount,
                 COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount
          FROM publish_logs
        `,
      )
      .get();

    return {
      totalCount: Number(row?.totalCount ?? 0),
      failedCount: Number(row?.failedCount ?? 0),
    };
  });

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
  });
});
