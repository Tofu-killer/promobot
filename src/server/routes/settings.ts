import { Router } from 'express';
import { isSupportedAllowlistEntry } from '../middleware/ipAllowlist.js';
import { listPlatformReadiness } from '../services/platformReadiness.js';
import type { SchedulerRuntime } from '../runtime/schedulerRuntime.js';
import { createSettingsStore, type SettingsStore } from '../store/settings.js';

export interface SettingsRouteDependencies {
  schedulerRuntime?: SchedulerRuntime;
  settingsStore?: SettingsStore;
  onAllowlistUpdated?: (allowlist: string[]) => void;
}

export function createSettingsRouter(dependencies: SettingsRouteDependencies = {}) {
  const settingsRouter = Router();
  const settingsStore = dependencies.settingsStore ?? createSettingsStore();

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
    if (request.body !== undefined && !isPlainObject(request.body)) {
      response.status(400).json({ error: 'invalid settings payload' });
      return;
    }

    const input = request.body ?? {};
    const schedulerIntervalMinutes = parseSchedulerIntervalMinutes(input.schedulerIntervalMinutes);
    if (input.schedulerIntervalMinutes !== undefined && schedulerIntervalMinutes === undefined) {
      response.status(400).json({ error: 'invalid scheduler interval' });
      return;
    }
    const allowlist =
      Array.isArray(input.allowlist)
        ? input.allowlist.filter((value: unknown): value is string => typeof value === 'string')
        : undefined;

    if (allowlist && allowlist.some((value: string) => !isSupportedAllowlistEntry(value))) {
      response.status(400).json({ error: 'invalid allowlist' });
      return;
    }

    const settings = settingsStore.update({
      allowlist,
      schedulerIntervalMinutes,
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
    if (allowlist !== undefined) {
      dependencies.onAllowlistUpdated?.(settings.allowlist);
    }

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSchedulerIntervalMinutes(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : undefined;

  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
