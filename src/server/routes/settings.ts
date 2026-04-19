import { Router } from 'express';
import { createSettingsStore } from '../store/settings';

const settingsStore = createSettingsStore();

export const settingsRouter = Router();

settingsRouter.get('/', (_request, response) => {
  response.json({ settings: settingsStore.get() });
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
  });

  response.json({ settings });
});
