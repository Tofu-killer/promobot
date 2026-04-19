import express from 'express';
import { loadConfig, type AppConfig } from './config';
import { ipAllowlist } from './middleware/ipAllowlist';
import { channelAccountsRouter } from './routes/channelAccounts';
import { createContentRouter } from './routes/content';
import { discoveryRouter } from './routes/discovery';
import { createDraftStore, createDraftsRouter } from './routes/drafts';
import { inboxRouter } from './routes/inbox';
import { monitorRouter } from './routes/monitor';
import { createPublishRouter } from './routes/publish';
import { projectsRouter } from './routes/projects';
import { reputationRouter } from './routes/reputation';
import { createSettingsRouter } from './routes/settings';
import { systemDashboardRouter } from './routes/systemDashboard';
import { createSystemRouter } from './routes/system';
import type { SchedulerRuntime } from './runtime/schedulerRuntime';

export interface AppDependencies {
  schedulerRuntime?: SchedulerRuntime;
}

export function createApp(config: AppConfig = loadConfig(), dependencies: AppDependencies = {}) {
  const app = express();
  const draftStore = createDraftStore();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(ipAllowlist(config.allowedIps));
  app.use('/api/system', createSystemRouter({ schedulerRuntime: dependencies.schedulerRuntime }));
  app.use('/api/content', createContentRouter(draftStore));
  app.use('/api/discovery', discoveryRouter);
  app.use('/api/drafts', createDraftsRouter(draftStore));
  app.use(
    '/api/drafts',
    createPublishRouter({
      lookupDraft(id) {
        const draft = draftStore.getById(id);
        if (!draft) {
          return undefined;
        }

        return {
          id: draft.id,
          platform: draft.platform,
          title: draft.title,
          content: draft.content,
        };
      },
    }),
  );
  app.use('/api/projects', projectsRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/monitor', systemDashboardRouter);
  app.use('/api/monitor', monitorRouter);
  app.use('/api/reputation', reputationRouter);
  app.use('/api/channel-accounts', channelAccountsRouter);
  app.use('/api/settings', createSettingsRouter({ schedulerRuntime: dependencies.schedulerRuntime }));

  return app;
}
