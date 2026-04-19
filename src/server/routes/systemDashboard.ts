import { Router } from 'express';
import { createMonitorStore } from '../store/monitor';
import { createSQLiteDraftStore } from '../store/drafts';

const monitorStore = createMonitorStore();
const draftStore = createSQLiteDraftStore();

export const systemDashboardRouter = Router();

systemDashboardRouter.get('/dashboard', (_request, response) => {
  const monitorItems = monitorStore.list();
  const drafts = draftStore.list();
  const followUpDrafts = drafts.filter((draft) => draft.title?.toLowerCase().includes('follow-up'));

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
  });
});
