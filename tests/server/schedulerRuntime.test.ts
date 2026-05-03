import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSchedulerRuntime } from '../../src/server/runtime/schedulerRuntime';
import { createProjectStore } from '../../src/server/store/projects';
import { createSettingsStore } from '../../src/server/store/settings';
import { createSourceConfigStore } from '../../src/server/store/sourceConfigs';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

let restoreCwd: (() => void) | null = null;

function readRecurringPayload(payload: unknown) {
  if (typeof payload !== 'string') {
    return payload as Record<string, unknown>;
  }

  return JSON.parse(payload) as Record<string, unknown>;
}

describe('scheduler runtime recurring source config jobs', () => {
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
  });

  it('reload enqueues recurring jobs scoped to enabled source configs', () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectStore = createProjectStore();
      const sourceConfigStore = createSourceConfigStore();
      const settingsStore = createSettingsStore();
      const jobQueueStore = createJobQueueStore();
      let nowIso = '2026-05-03T00:00:00.000Z';
      const now = () => new Date(nowIso);

      settingsStore.update({ schedulerIntervalMinutes: 15 });
      projectStore.create({
        name: 'Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://signals.example.com',
        siteDescription: 'Signals workspace',
        sellingPoints: ['fast'],
        brandVoice: '',
        ctas: [],
      });

      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'rss',
        platform: 'rss',
        label: 'RSS',
        configJson: {
          url: 'https://feeds.example.com/rss.xml',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Reddit',
        configJson: {
          keywords: ['promobot'],
        },
        enabled: true,
        pollIntervalMinutes: 45,
      });
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram',
        configJson: {
          profileUrl: 'https://www.instagram.com/openai/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      });

      const runtime = createSchedulerRuntime({
        settingsStore,
        jobQueueStore,
        sourceConfigStore,
        handlers: {},
        now,
      });

      runtime.reload();

      const jobs = jobQueueStore.list({ statuses: ['pending', 'running'] });
      expect(jobs).toHaveLength(5);
      expect(
        jobs.map((job) => ({
          type: job.type,
          payload: readRecurringPayload(job.payload),
          runAt: job.runAt,
        })),
      ).toEqual([
        {
          type: 'monitor_fetch',
          payload: {
            recurring: 'source_config_poll',
            projectId: 1,
            sourceConfigIds: [1],
            intervalMinutes: 30,
          },
          runAt: '2026-05-03T00:30:00.000Z',
        },
        {
          type: 'inbox_fetch',
          payload: {
            recurring: 'source_config_poll',
            projectId: 1,
            sourceConfigIds: [2],
            intervalMinutes: 45,
          },
          runAt: '2026-05-03T00:45:00.000Z',
        },
        {
          type: 'monitor_fetch',
          payload: {
            recurring: 'source_config_poll',
            projectId: 1,
            sourceConfigIds: [2],
            intervalMinutes: 45,
          },
          runAt: '2026-05-03T00:45:00.000Z',
        },
        {
          type: 'reputation_fetch',
          payload: {
            recurring: 'source_config_poll',
            projectId: 1,
            sourceConfigIds: [2],
            intervalMinutes: 45,
          },
          runAt: '2026-05-03T00:45:00.000Z',
        },
        {
          type: 'monitor_fetch',
          payload: {
            recurring: 'source_config_poll',
            projectId: 1,
            sourceConfigIds: [3],
            intervalMinutes: 60,
          },
          runAt: '2026-05-03T01:00:00.000Z',
        },
      ]);

      nowIso = '2026-05-03T00:01:00.000Z';
      runtime.reload();

      expect(jobQueueStore.list({ statuses: ['pending', 'running'] })).toHaveLength(5);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('tick completion re-enqueues the next recurring job instance', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectStore = createProjectStore();
      const sourceConfigStore = createSourceConfigStore();
      const settingsStore = createSettingsStore();
      const jobQueueStore = createJobQueueStore();
      const monitorFetchHandler = vi.fn().mockResolvedValue(undefined);
      let nowIso = '2026-05-03T00:00:00.000Z';
      const now = () => new Date(nowIso);

      settingsStore.update({ schedulerIntervalMinutes: 1 });
      projectStore.create({
        name: 'Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://signals.example.com',
        siteDescription: 'Signals workspace',
        sellingPoints: ['fast'],
        brandVoice: '',
        ctas: [],
      });
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'keyword+reddit',
        platform: 'reddit',
        label: 'Reddit',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 15,
      });

      const runtime = createSchedulerRuntime({
        settingsStore,
        sourceConfigStore,
        jobQueueStore,
        now,
        handlers: {
          monitor_fetch: monitorFetchHandler,
          inbox_fetch: vi.fn().mockResolvedValue(undefined),
          reputation_fetch: vi.fn().mockResolvedValue(undefined),
        },
      });

      runtime.reload();
      nowIso = '2026-05-03T00:16:00.000Z';
      await runtime.tickNow();

      expect(monitorFetchHandler).toHaveBeenCalledWith(
        {
          recurring: 'source_config_poll',
          projectId: 1,
          sourceConfigIds: [1],
          intervalMinutes: 15,
        },
        expect.objectContaining({
          type: 'monitor_fetch',
        }),
      );

      const jobs = jobQueueStore.list();
      const doneJobs = jobs.filter((job) => job.status === 'done' && job.type === 'monitor_fetch');
      const pendingJobs = jobs.filter((job) => job.status === 'pending' && job.type === 'monitor_fetch');

      expect(doneJobs).toHaveLength(1);
      expect(pendingJobs).toHaveLength(1);
      expect(readRecurringPayload(pendingJobs[0].payload)).toEqual({
        recurring: 'source_config_poll',
        projectId: 1,
        sourceConfigIds: [1],
        intervalMinutes: 15,
      });
      expect(pendingJobs[0].runAt).toBe('2026-05-03T00:31:00.000Z');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reload cancels stale recurring jobs when source config scheduling changes', () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectStore = createProjectStore();
      const sourceConfigStore = createSourceConfigStore();
      const settingsStore = createSettingsStore();
      const jobQueueStore = createJobQueueStore();
      const now = () => new Date('2026-05-03T00:00:00.000Z');

      settingsStore.update({ schedulerIntervalMinutes: 15 });
      projectStore.create({
        name: 'Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://signals.example.com',
        siteDescription: 'Signals workspace',
        sellingPoints: ['fast'],
        brandVoice: '',
        ctas: [],
      });
      sourceConfigStore.create({
        projectId: 1,
        sourceType: 'keyword+x',
        platform: 'x',
        label: 'X',
        configJson: {
          query: 'promobot',
        },
        enabled: true,
        pollIntervalMinutes: 30,
      });

      const runtime = createSchedulerRuntime({
        settingsStore,
        sourceConfigStore,
        jobQueueStore,
        handlers: {},
        now,
      });

      runtime.reload();
      const initialPending = jobQueueStore
        .list({ statuses: ['pending'] })
        .filter((job) => job.type === 'monitor_fetch');
      expect(initialPending).toHaveLength(1);
      expect(readRecurringPayload(initialPending[0].payload)).toEqual({
        recurring: 'source_config_poll',
        projectId: 1,
        sourceConfigIds: [1],
        intervalMinutes: 30,
      });

      sourceConfigStore.update(1, 1, {
        pollIntervalMinutes: 60,
      });
      runtime.reload();

      const jobs = jobQueueStore.list();
      const canceledMonitorJobs = jobs.filter(
        (job) => job.type === 'monitor_fetch' && job.status === 'canceled',
      );
      const pendingMonitorJobs = jobs.filter(
        (job) => job.type === 'monitor_fetch' && job.status === 'pending',
      );

      expect(canceledMonitorJobs).toHaveLength(1);
      expect(readRecurringPayload(canceledMonitorJobs[0].payload)).toEqual({
        recurring: 'source_config_poll',
        projectId: 1,
        sourceConfigIds: [1],
        intervalMinutes: 30,
      });
      expect(pendingMonitorJobs).toHaveLength(1);
      expect(readRecurringPayload(pendingMonitorJobs[0].payload)).toEqual({
        recurring: 'source_config_poll',
        projectId: 1,
        sourceConfigIds: [1],
        intervalMinutes: 60,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('reload scans recurring jobs beyond the first list page when canceling stale entries', () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const projectStore = createProjectStore();
      const sourceConfigStore = createSourceConfigStore();
      const settingsStore = createSettingsStore();
      const jobQueueStore = createJobQueueStore();
      const now = () => new Date('2026-05-03T00:00:00.000Z');

      settingsStore.update({ schedulerIntervalMinutes: 15 });
      projectStore.create({
        name: 'Signals',
        siteName: 'PromoBot',
        siteUrl: 'https://signals.example.com',
        siteDescription: 'Signals workspace',
        sellingPoints: ['fast'],
        brandVoice: '',
        ctas: [],
      });

      for (let index = 1; index <= 21; index += 1) {
        sourceConfigStore.create({
          projectId: 1,
          sourceType: 'rss',
          platform: 'rss',
          label: `RSS ${index}`,
          configJson: {
            url: `https://feeds.example.com/rss-${index}.xml`,
          },
          enabled: true,
          pollIntervalMinutes: 30,
        });
      }

      const runtime = createSchedulerRuntime({
        settingsStore,
        sourceConfigStore,
        jobQueueStore,
        handlers: {},
        now,
      });

      runtime.reload();
      expect(jobQueueStore.list({ limit: 100, statuses: ['pending'] })).toHaveLength(21);

      sourceConfigStore.update(1, 21, {
        enabled: false,
      });
      runtime.reload();

      const jobs = jobQueueStore.list({ limit: 100 });
      const canceledMonitorJobs = jobs.filter(
        (job) => job.type === 'monitor_fetch' && job.status === 'canceled',
      );

      expect(canceledMonitorJobs).toHaveLength(1);
      expect(readRecurringPayload(canceledMonitorJobs[0].payload)).toEqual({
        recurring: 'source_config_poll',
        projectId: 1,
        sourceConfigIds: [21],
        intervalMinutes: 30,
      });
      expect(
        jobs.filter(
          (job) =>
            job.type === 'monitor_fetch' &&
            job.status === 'pending' &&
            JSON.stringify(readRecurringPayload(job.payload).sourceConfigIds) === JSON.stringify([21]),
        ),
      ).toHaveLength(0);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
