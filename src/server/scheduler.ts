import {
  getErrorMessage,
  isJobDue,
  parseJobPayload,
  type JobExecutionResult,
  type JobHandler,
  type JobRecord,
  type JobStore,
} from './lib/jobs.js';

export interface SchedulerOptions {
  pollMs: number;
  handlers: Record<string, JobHandler>;
  store?: JobStore;
  now?: () => Date;
  onTickError?: (error: unknown) => void;
  onTickComplete?: (results: JobExecutionResult[]) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export function createScheduler(options: SchedulerOptions) {
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  let timer: ReturnType<typeof setInterval> | undefined;
  let activeTick: Promise<JobExecutionResult[]> | undefined;

  async function runDueJobs(jobs: JobRecord[]): Promise<JobExecutionResult[]> {
    const results: JobExecutionResult[] = [];

    for (const job of jobs) {
      if (job.status !== 'pending') {
        results.push({
          jobId: job.id,
          type: job.type,
          outcome: 'skipped',
          reason: `status:${job.status}`,
        });
        continue;
      }

      if (!isJobDue(job, now())) {
        results.push({
          jobId: job.id,
          type: job.type,
          outcome: 'skipped',
          reason: 'not_due',
        });
        continue;
      }

      const handler = options.handlers[job.type];
      if (!handler) {
        results.push({
          jobId: job.id,
          type: job.type,
          outcome: 'skipped',
          reason: 'missing_handler',
        });
        continue;
      }

      if (options.store) {
        const claimed = await options.store.markRunning(job.id, now().toISOString());
        if (!claimed) {
          results.push({
            jobId: job.id,
            type: job.type,
            outcome: 'skipped',
            reason: 'not_claimed',
          });
          continue;
        }
      }

      try {
        await handler(parseJobPayload(job), job);
        await options.store?.markDone(job.id, now().toISOString());
        results.push({
          jobId: job.id,
          type: job.type,
          outcome: 'completed',
        });
      } catch (error) {
        const message = getErrorMessage(error);
        await options.store?.markFailed(job.id, message, now().toISOString());
        results.push({
          jobId: job.id,
          type: job.type,
          outcome: 'failed',
          reason: message,
        });
      }
    }

    return results;
  }

  async function tick(): Promise<JobExecutionResult[]> {
    if (activeTick) {
      return activeTick;
    }

    activeTick = (async () => {
      try {
        const jobs = options.store
          ? await options.store.listDueJobs(now().toISOString())
          : [];
        const results = await runDueJobs(jobs);
        options.onTickComplete?.(results);
        return results;
      } finally {
        activeTick = undefined;
      }
    })();

    return activeTick;
  }

  function start(): void {
    if (timer) {
      return;
    }

    timer = setIntervalFn(() => {
      void tick().catch((error) => {
        options.onTickError?.(error);
      });
    }, options.pollMs);
  }

  function stop(): void {
    if (!timer) {
      return;
    }

    clearIntervalFn(timer);
    timer = undefined;
  }

  function isStarted(): boolean {
    return timer !== undefined;
  }

  function isTicking(): boolean {
    return activeTick !== undefined;
  }

  return {
    runDueJobs,
    tick,
    start,
    stop,
    isStarted,
    isTicking,
  };
}
