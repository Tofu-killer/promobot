import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  clientDistPath?: string;
}

export function createApp(config: AppConfig = loadConfig(), dependencies: AppDependencies = {}) {
  const app = express();
  const draftStore = createDraftStore();
  const clientBuild = resolveClientBuild(dependencies.clientDistPath);

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

  if (clientBuild) {
    app.use((request, response, next) => {
      if ((request.method !== 'GET' && request.method !== 'HEAD') || request.path.startsWith('/api')) {
        next();
        return;
      }

      const assetPath = resolveClientAssetPath(clientBuild, request.path);

      if (assetPath) {
        response.type(assetPath);
        response.send(fs.readFileSync(assetPath));
        return;
      }

      if (path.extname(request.path)) {
        next();
        return;
      }

      response.type('html');
      response.send(fs.readFileSync(clientBuild.indexPath, 'utf8'));
    });
  }

  return app;
}

function resolveClientBuild(explicitClientDistPath?: string) {
  const candidate = path.resolve(
    explicitClientDistPath ?? fileURLToPath(new URL('../../dist/client/', import.meta.url)),
  );
  const indexPath = path.join(candidate, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return null;
  }

  return {
    clientDistPath: candidate,
    clientDistPrefix: `${candidate}${path.sep}`,
    indexPath,
  };
}

function resolveClientAssetPath(
  clientBuild: NonNullable<ReturnType<typeof resolveClientBuild>>,
  requestPath: string,
) {
  const pathSegments = requestPath.split('/').filter(Boolean);

  if (pathSegments.length === 0) {
    return undefined;
  }

  const assetPath = path.resolve(clientBuild.clientDistPath, ...pathSegments);

  if (!assetPath.startsWith(clientBuild.clientDistPrefix)) {
    return undefined;
  }

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    return undefined;
  }

  return assetPath;
}
