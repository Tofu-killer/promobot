import { Router } from 'express';
import { createMonitorStore } from '../store/monitor';
import { createSQLiteDraftStore } from '../store/drafts';
import { createInboxStore } from '../store/inbox';
import { createChannelAccountStore } from '../store/channelAccounts';

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

  response.json({
    monitor: {
      total: monitorItems.length,
      new: monitorItems.filter((item) => item.status === 'new').length,
      followUpDrafts: followUpDrafts.length,
    },
    drafts: {
      total: drafts.length,
      review: drafts.filter((draft) => draft.status === 'review').length,
    },
    totals: {
      items: monitorItems.length + drafts.length,
      followUps: followUpDrafts.length,
    },
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
