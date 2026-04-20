import { Router } from 'express';
import { listPlatformReadiness } from '../services/platformReadiness';
import type { SchedulerRuntime } from '../runtime/schedulerRuntime';
import { createSettingsStore } from '../store/settings';

const settingsStore = createSettingsStore();

export interface SettingsRouteDependencies {
  schedulerRuntime?: SchedulerRuntime;
}

export function createSettingsRouter(dependencies: SettingsRouteDependencies = {}) {
  const settingsRouter = Router();

  settingsRouter.get('/', (_request, response) => {
    response.json({
      settings: settingsStore.get(),
      platforms: listPlatformReadiness(),
      ...(dependencies.schedulerRuntime
        ? { runtime: dependencies.schedulerRuntime.getStatus() }
        : {}),
    });
  });

  settingsRouter.patch('/', (request, response) => {
    const input = request.body ?? {};
    const settings = settingsStore.update({
      allowlist: Array.isArray(input.allowlist)
        ? input.allowlist.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      schedulerIntervalMinutes:
        typeof input.schedulerIntervalMinutes === 'number'
          ? input.schedulerIntervalMinutes
          : typeof input.schedulerIntervalMinutes === 'string' && input.schedulerIntervalMinutes.trim()
            ? Number(input.schedulerIntervalMinutes)
            : undefined,
      rssDefaults: Array.isArray(input.rssDefaults)
        ? input.rssDefaults.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      monitorRssFeeds: Array.isArray(input.monitorRssFeeds)
        ? input.monitorRssFeeds.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      monitorXQueries: Array.isArray(input.monitorXQueries)
        ? input.monitorXQueries.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      monitorRedditQueries: Array.isArray(input.monitorRedditQueries)
        ? input.monitorRedditQueries.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : undefined,
      monitorV2exQueries: Array.isArray(input.monitorV2exQueries)
        ? input.monitorV2exQueries.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
    });

    response.json({
      settings,
      platforms: listPlatformReadiness(),
      ...(dependencies.schedulerRuntime
        ? { runtime: dependencies.schedulerRuntime.reload() }
        : {}),
    });
  });

  return settingsRouter;
}
