import { createScheduler } from '../scheduler.js';
import type { JobExecutionResult, JobHandler } from '../lib/jobs.js';
import type { SettingsStore } from '../store/settings.js';
import { createSettingsStore } from '../store/settings.js';
import type {
  EnqueueJobInput,
  JobQueueEntry,
  JobQueueStats,
  JobQueueStore,
} from '../store/jobQueue.js';
import { createJobQueueStore } from '../store/jobQueue.js';
import type { SourceConfigStore } from '../store/sourceConfigs.js';
import { createSourceConfigStore } from '../store/sourceConfigs.js';
import { syncSourceConfigRecurringJobs } from './sourceConfigRecurringJobs.js';

export interface SchedulerRuntimeSnapshot {
  available: boolean;
  started: boolean;
  schedulerIntervalMinutes: number;
  pollMs: number;
  bootedAt: string | null;
  lastTickAt: string | null;
  lastTickResults: JobExecutionResult[];
  lastError: string | null;
  recoveredRunningJobs: number;
  handlers: string[];
  queue: JobQueueStats;
  recentJobs: JobQueueEntry[];
}

export interface SchedulerRuntimeJobListSnapshot {
  jobs: JobQueueEntry[];
  queue: JobQueueStats;
  recentJobs: JobQueueEntry[];
}

export interface SchedulerRuntime {
  getStatus(): SchedulerRuntimeSnapshot;
  listJobs(limit?: number): SchedulerRuntimeJobListSnapshot;
  getJob(jobId: number): JobQueueEntry | undefined;
  reload(): SchedulerRuntimeSnapshot;
  tickNow(): Promise<JobExecutionResult[]>;
  enqueueJob(input: EnqueueJobInput): JobQueueEntry;
  retryJob(jobId: number, runAt?: string): JobQueueEntry | undefined;
  cancelJob(jobId: number): JobQueueEntry | undefined;
  stop(): void;
}

export interface SchedulerRuntimeDependencies {
  settingsStore?: SettingsStore;
  jobQueueStore?: JobQueueStore;
  sourceConfigStore?: SourceConfigStore;
  handlers?: Record<string, JobHandler>;
  now?: () => Date;
}

export function createSchedulerRuntime(
  dependencies: SchedulerRuntimeDependencies = {},
): SchedulerRuntime {
  const settingsStore = dependencies.settingsStore ?? createSettingsStore();
  const jobQueueStore = dependencies.jobQueueStore ?? createJobQueueStore();
  const sourceConfigStore = dependencies.sourceConfigStore ?? createSourceConfigStore();
  const handlers = dependencies.handlers ?? {};
  const now = dependencies.now ?? (() => new Date());

  let scheduler = createSchedulerInstance(settingsStore.get().schedulerIntervalMinutes);
  let bootedAt: string | null = null;
  let lastTickAt: string | null = null;
  let lastTickResults: JobExecutionResult[] = [];
  let lastError: string | null = null;
  let recoveredRunningJobs = 0;

  function createSchedulerInstance(schedulerIntervalMinutes: number) {
    const pollMs = schedulerIntervalMinutes * 60_000;

    return createScheduler({
      pollMs,
      store: jobQueueStore,
      handlers,
      onTickComplete(results) {
        lastTickAt = now().toISOString();
        lastTickResults = results;
        lastError = null;
        syncSourceConfigRecurringJobs({
          jobQueueStore,
          sourceConfigStore,
          now,
        });
      },
      onTickError(error) {
        lastError = error instanceof Error ? error.message : String(error);
      },
    });
  }

  function rebuildScheduler(): SchedulerRuntimeSnapshot {
    const settings = settingsStore.get();
    scheduler.stop();
    scheduler = createSchedulerInstance(settings.schedulerIntervalMinutes);
    recoveredRunningJobs = jobQueueStore.requeueRunningJobs(now().toISOString());
    syncSourceConfigRecurringJobs({
      jobQueueStore,
      sourceConfigStore,
      now,
    });
    scheduler.start();
    bootedAt = now().toISOString();
    lastError = null;
    return getStatus();
  }

  async function tickNow(): Promise<JobExecutionResult[]> {
    if (!scheduler.isStarted()) {
      rebuildScheduler();
    }

    const results = await scheduler.tick();
    lastTickAt = now().toISOString();
    lastTickResults = results;
    return results;
  }

  function getStatus(): SchedulerRuntimeSnapshot {
    const settings = settingsStore.get();

    return {
      available: true,
      started: scheduler.isStarted(),
      schedulerIntervalMinutes: settings.schedulerIntervalMinutes,
      pollMs: settings.schedulerIntervalMinutes * 60_000,
      bootedAt,
      lastTickAt,
      lastTickResults,
      lastError,
      recoveredRunningJobs,
      handlers: Object.keys(handlers).sort(),
      queue: jobQueueStore.getStats(now().toISOString()),
      recentJobs: jobQueueStore.list({ limit: 12 }),
    };
  }

  function listJobs(limit = 50): SchedulerRuntimeJobListSnapshot {
    return {
      jobs: jobQueueStore.list({ limit }),
      queue: jobQueueStore.getStats(now().toISOString()),
      recentJobs: jobQueueStore.list({ limit: 12 }),
    };
  }

  return {
    getStatus,
    listJobs,
    getJob(jobId) {
      return jobQueueStore.get(jobId);
    },
    reload() {
      return rebuildScheduler();
    },
    tickNow,
    enqueueJob(input) {
      return jobQueueStore.enqueue(input);
    },
    retryJob(jobId, runAt) {
      return jobQueueStore.retry(jobId, runAt);
    },
    cancelJob(jobId) {
      return jobQueueStore.cancel(jobId);
    },
    stop() {
      scheduler.stop();
    },
  };
}
