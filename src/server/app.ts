import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig, type AppConfig } from './config.js';
import {
  createAdminSessionStore,
  hasValidAdminPassword,
  readAdminSessionToken,
  requireAdminPassword,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie,
} from './middleware/auth.js';
import { ipAllowlist } from './middleware/ipAllowlist.js';
import { channelAccountsRouter } from './routes/channelAccounts.js';
import { createContentRouter } from './routes/content.js';
import { discoveryRouter } from './routes/discovery.js';
import { createDraftStore, createDraftsRouter } from './routes/drafts.js';
import { inboxRouter } from './routes/inbox.js';
import { monitorRouter } from './routes/monitor.js';
import { createPublishRouter } from './routes/publish.js';
import { createProjectsRouter } from './routes/projects.js';
import { reputationRouter } from './routes/reputation.js';
import { createSettingsRouter } from './routes/settings.js';
import { createSystemHealthPayload, createSystemRouter } from './routes/system.js';
import { createSettingsStore } from './store/settings.js';
import type { SchedulerRuntime } from './runtime/schedulerRuntime.js';

export interface AppDependencies {
  schedulerRuntime?: SchedulerRuntime;
  clientDistPath?: string;
}

export function createApp(config: AppConfig = loadConfig(), dependencies: AppDependencies = {}) {
  const app = express();
  const draftStore = createDraftStore();
  const clientBuild = resolveClientBuild(dependencies.clientDistPath);
  const settingsStore = createSettingsStore({
    defaultSettings: {
      allowlist: config.allowedIps,
    },
  });
  const adminSessionStore = createAdminSessionStore({
    passwordFingerprint: config.adminPassword,
  });
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(ipAllowlist(() => settingsStore.get().allowlist));
  app.get('/api/system/health', (_request, response) => {
    response.json(createSystemHealthPayload(dependencies.schedulerRuntime));
  });
  app.post('/api/auth/login', (request, response) => {
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const remember = request.body?.remember === true;

    if (!password.trim()) {
      response.status(400).json({ error: 'invalid auth payload' });
      return;
    }

    if (!config.adminPassword || password !== config.adminPassword) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    const session = adminSessionStore.createSession({ remember });
    response.setHeader(
      'Set-Cookie',
      serializeAdminSessionCookie(session.token, {
        remember,
        expiresAt: session.expiresAt,
      }),
    );
    response.status(204).end();
  });
  app.get('/api/auth/probe', (_request, response) => {
    const authMiddleware = requireAdminPassword({
      adminPassword: config.adminPassword,
      sessionStore: adminSessionStore,
      allowHeaderFallback: true,
    });

    authMiddleware(_request, response, () => {
      response.status(204).end();
    });
  });
  app.post('/api/auth/logout', (request, response) => {
    const token = readAdminSessionToken(request);
    if (token) {
      adminSessionStore.revokeSession(token);
    }

    response.setHeader('Set-Cookie', serializeClearedAdminSessionCookie());
    response.status(204).end();
  });
  app.use(
    '/api',
    requireAdminPassword({
      adminPassword: config.adminPassword,
      sessionStore: adminSessionStore,
      allowHeaderFallback: true,
    }),
  );
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
  app.use('/api/projects', createProjectsRouter({ schedulerRuntime: dependencies.schedulerRuntime }));
  app.use('/api/inbox', inboxRouter);
  app.use('/api/monitor', monitorRouter);
  app.use('/api/reputation', reputationRouter);
  app.use('/api/channel-accounts', channelAccountsRouter);
  app.use(
    '/api/settings',
    createSettingsRouter({
      schedulerRuntime: dependencies.schedulerRuntime,
      settingsStore,
    }),
  );

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
