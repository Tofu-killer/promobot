import { Router } from 'express';
import type { SchedulerRuntime } from '../runtime/schedulerRuntime';

export interface SystemRouteDependencies {
  schedulerRuntime?: SchedulerRuntime;
}

export function createSystemRouter(dependencies: SystemRouteDependencies = {}) {
  const systemRouter = Router();
  const schedulerRuntime = dependencies.schedulerRuntime;

  systemRouter.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  systemRouter.get('/runtime', (_request, response) => {
    response.json({
      runtime: schedulerRuntime
        ? schedulerRuntime.getStatus()
        : {
            available: false,
            started: false,
          },
    });
  });

  systemRouter.post('/runtime/reload', (_request, response) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    response.json({ runtime: schedulerRuntime.reload() });
  });

  systemRouter.post('/runtime/tick', async (_request, response, next) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    try {
      const results = await schedulerRuntime.tickNow();
      response.json({
        results,
        runtime: schedulerRuntime.getStatus(),
      });
    } catch (error) {
      next(error);
    }
  });

  systemRouter.post('/jobs', (request, response) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    const { type, payload, runAt } = request.body ?? {};
    if (typeof type !== 'string' || type.trim().length === 0) {
      response.status(400).json({ error: 'invalid job type' });
      return;
    }

    const normalizedRunAt =
      typeof runAt === 'string' && !Number.isNaN(new Date(runAt).getTime())
        ? runAt
        : new Date().toISOString();

    const job = schedulerRuntime.enqueueJob({
      type: type.trim(),
      payload: isPlainObject(payload) ? payload : {},
      runAt: normalizedRunAt,
    });

    response.status(201).json({
      job,
      runtime: schedulerRuntime.getStatus(),
    });
  });

  systemRouter.get('/jobs', (request, response) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    const limit = parseOptionalPositiveInteger(request.query.limit);
    const snapshot = schedulerRuntime.listJobs(limit);

    response.json(snapshot);
  });

  systemRouter.get('/jobs/:jobId', (request, response) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    const jobId = parseJobId(request.params.jobId);
    if (jobId === undefined) {
      response.status(400).json({ error: 'invalid job id' });
      return;
    }

    const job = schedulerRuntime.getJob(jobId);
    if (!job) {
      response.status(404).json({ error: 'job not found' });
      return;
    }

    response.json({ job });
  });

  systemRouter.post('/jobs/:jobId/retry', (request, response) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    const jobId = parseJobId(request.params.jobId);
    if (jobId === undefined) {
      response.status(400).json({ error: 'invalid job id' });
      return;
    }

    const runAt =
      typeof request.body?.runAt === 'string' && !Number.isNaN(new Date(request.body.runAt).getTime())
        ? request.body.runAt
        : new Date().toISOString();

    const job = schedulerRuntime.retryJob(jobId, runAt);
    if (!job) {
      response.status(409).json({ error: 'job not retryable' });
      return;
    }

    response.json({ job, runtime: schedulerRuntime.getStatus() });
  });

  systemRouter.post('/jobs/:jobId/cancel', (request, response) => {
    if (!schedulerRuntime) {
      response.status(503).json({ error: 'scheduler runtime unavailable' });
      return;
    }

    const jobId = parseJobId(request.params.jobId);
    if (jobId === undefined) {
      response.status(400).json({ error: 'invalid job id' });
      return;
    }

    const job = schedulerRuntime.cancelJob(jobId);
    if (!job) {
      response.status(409).json({ error: 'job not cancelable' });
      return;
    }

    response.json({ job, runtime: schedulerRuntime.getStatus() });
  });

  return systemRouter;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseJobId(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
