import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig, type AppConfig } from './config.js';
import { requireAdminPassword } from './middleware/auth.js';
import { ipAllowlist } from './middleware/ipAllowlist.js';
import { channelAccountsRouter } from './routes/channelAccounts.js';
import { createContentRouter } from './routes/content.js';
import { discoveryRouter } from './routes/discovery.js';
import { createDraftStore, createDraftsRouter } from './routes/drafts.js';
import { inboxRouter } from './routes/inbox.js';
import { monitorRouter } from './routes/monitor.js';
import { createPublishRouter } from './routes/publish.js';
import { projectsRouter } from './routes/projects.js';
import { reputationRouter } from './routes/reputation.js';
import { createSettingsRouter } from './routes/settings.js';
import { systemDashboardRouter } from './routes/systemDashboard.js';
import { createSystemHealthPayload, createSystemRouter } from './routes/system.js';
import type { SchedulerRuntime } from './runtime/schedulerRuntime.js';

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
  app.get('/api/system/health', (_request, response) => {
    response.json(createSystemHealthPayload(dependencies.schedulerRuntime));
  });
  app.use('/api', requireAdminPassword(config.adminPassword));
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
          target: draft.target,
          metadata: draft.metadata,
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
