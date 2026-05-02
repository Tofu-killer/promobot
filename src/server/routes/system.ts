import { Router } from 'express';
import { createBrowserArtifactHealthSummary } from '../services/browser/artifactHealth.js';
import { listSessionRequestArtifacts } from '../services/browser/sessionRequestArtifacts.js';
import {
  importInlineSessionRequestResult,
  importSessionRequestResultArtifact,
  SessionRequestResultImportError,
} from '../services/browser/sessionResultImporter.js';
import {
  BrowserHandoffImportError,
  importBrowserHandoffResult,
} from '../services/publishers/browserHandoffResultImporter.js';
import { listBrowserHandoffArtifacts } from '../services/publishers/browserHandoffArtifacts.js';
import {
  InboxReplyHandoffImportError,
  importInboxReplyHandoffResult,
} from '../services/inbox/replyHandoffResultImporter.js';
import { listInboxReplyHandoffArtifacts } from '../services/inbox/replyHandoffArtifacts.js';
import type { SchedulerRuntime } from '../runtime/schedulerRuntime.js';

export interface SystemRouteDependencies {
  schedulerRuntime?: SchedulerRuntime;
}

export function createSystemRouter(dependencies: SystemRouteDependencies = {}) {
  const systemRouter = Router();
  const schedulerRuntime = dependencies.schedulerRuntime;

  systemRouter.get('/health', (_request, response) => {
    response.json(createSystemHealthPayload(schedulerRuntime));
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

    if (request.body !== undefined && !isPlainObject(request.body)) {
      response.status(400).json({ error: 'invalid job payload' });
      return;
    }

    const { type, payload, runAt } = request.body ?? {};
    if (typeof type !== 'string' || type.trim().length === 0) {
      response.status(400).json({ error: 'invalid job type' });
      return;
    }

    if (payload !== undefined && !isPlainObject(payload)) {
      response.status(400).json({ error: 'invalid job payload' });
      return;
    }

    if (
      runAt !== undefined &&
      (typeof runAt !== 'string' || !isValidJobRunAt(runAt))
    ) {
      response.status(400).json({ error: 'invalid job runAt' });
      return;
    }

    const normalizedRunAt =
      typeof runAt === 'string' && isValidJobRunAt(runAt)
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

  systemRouter.get('/browser-lane-requests', (request, response) => {
    const limit = parseOptionalPositiveInteger(request.query.limit);
    const requests = listSessionRequestArtifacts(limit);

    response.json({
      requests,
      total: listSessionRequestArtifacts().length,
    });
  });

  systemRouter.post('/browser-lane-requests/import', async (request, response, next) => {
    if (request.body !== undefined && !isPlainObject(request.body)) {
      response.status(400).json({ error: 'invalid browser lane result payload' });
      return;
    }

    try {
      if (typeof request.body?.artifactPath === 'string' && request.body.artifactPath.trim()) {
        const result = await importSessionRequestResultArtifact(request.body.artifactPath.trim());
        response.json(result);
        return;
      }

      if (
        typeof request.body?.requestArtifactPath !== 'string' ||
        !request.body.requestArtifactPath.trim() ||
        !isPlainObject(request.body?.storageState)
      ) {
        response.status(400).json({ error: 'invalid browser lane result payload' });
        return;
      }

      const result = await importInlineSessionRequestResult({
        requestArtifactPath: request.body.requestArtifactPath.trim(),
        storageState: request.body.storageState,
        ...(isSessionStatusValue(request.body?.sessionStatus)
          ? { sessionStatus: request.body.sessionStatus }
          : {}),
        ...(request.body?.validatedAt === null ||
        typeof request.body?.validatedAt === 'string'
          ? { validatedAt: request.body.validatedAt as string | null | undefined }
          : {}),
        ...(typeof request.body?.notes === 'string' ? { notes: request.body.notes } : {}),
        ...(typeof request.body?.completedAt === 'string'
          ? { completedAt: request.body.completedAt }
          : {}),
      });
      response.json(result);
    } catch (error) {
      if (error instanceof SessionRequestResultImportError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  systemRouter.get('/browser-handoffs', (request, response) => {
    const limit = parseOptionalPositiveInteger(request.query.limit);
    const handoffs = listBrowserHandoffArtifacts(limit);

    response.json({
      handoffs,
      total: listBrowserHandoffArtifacts().length,
    });
  });

  systemRouter.post('/browser-handoffs/import', async (request, response, next) => {
    if (request.body !== undefined && !isPlainObject(request.body)) {
      response.status(400).json({ error: 'invalid browser handoff payload' });
      return;
    }

    const artifactPath =
      typeof request.body?.artifactPath === 'string' ? request.body.artifactPath.trim() : '';
    const message =
      typeof request.body?.message === 'string' ? request.body.message.trim() : '';
    const handoffAttempt = parseOptionalPositiveInteger(request.body?.handoffAttempt);
    const hasHandoffAttempt =
      request.body !== undefined &&
      Object.prototype.hasOwnProperty.call(request.body, 'handoffAttempt');

    if (
      !artifactPath ||
      !message ||
      (hasHandoffAttempt && handoffAttempt === undefined) ||
      !isBrowserHandoffPublishStatus(request.body?.publishStatus)
    ) {
      response.status(400).json({ error: 'invalid browser handoff payload' });
      return;
    }

    try {
      const result = await importBrowserHandoffResult({
        artifactPath,
        publishStatus: request.body.publishStatus,
        message,
        ...(request.body?.publishUrl === null || typeof request.body?.publishUrl === 'string'
          ? { publishUrl: request.body.publishUrl as string | null | undefined }
          : {}),
        ...(request.body?.externalId === null || typeof request.body?.externalId === 'string'
          ? { externalId: request.body.externalId as string | null | undefined }
          : {}),
        ...(request.body?.publishedAt === null || typeof request.body?.publishedAt === 'string'
          ? { publishedAt: request.body.publishedAt as string | null | undefined }
          : {}),
        ...(handoffAttempt !== undefined ? { handoffAttempt } : {}),
      });
      response.json(result);
    } catch (error) {
      if (error instanceof BrowserHandoffImportError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  systemRouter.get('/inbox-reply-handoffs', (request, response) => {
    const limit = parseOptionalPositiveInteger(request.query.limit);
    const handoffs = listInboxReplyHandoffArtifacts(limit);

    response.json({
      handoffs,
      total: listInboxReplyHandoffArtifacts().length,
    });
  });

  systemRouter.post('/inbox-reply-handoffs/import', async (request, response, next) => {
    if (request.body !== undefined && !isPlainObject(request.body)) {
      response.status(400).json({ error: 'invalid inbox reply handoff payload' });
      return;
    }

    const artifactPath =
      typeof request.body?.artifactPath === 'string' ? request.body.artifactPath.trim() : '';
    const message =
      typeof request.body?.message === 'string' ? request.body.message.trim() : '';
    const handoffAttempt = parseOptionalPositiveInteger(request.body?.handoffAttempt);
    const hasHandoffAttempt =
      request.body !== undefined &&
      Object.prototype.hasOwnProperty.call(request.body, 'handoffAttempt');

    if (
      !artifactPath ||
      !message ||
      (hasHandoffAttempt && handoffAttempt === undefined) ||
      !isInboxReplyHandoffReplyStatus(request.body?.replyStatus)
    ) {
      response.status(400).json({ error: 'invalid inbox reply handoff payload' });
      return;
    }

    try {
      const result = await importInboxReplyHandoffResult({
        artifactPath,
        replyStatus: request.body.replyStatus,
        message,
        ...(request.body?.deliveryUrl === null || typeof request.body?.deliveryUrl === 'string'
          ? { deliveryUrl: request.body.deliveryUrl as string | null | undefined }
          : {}),
        ...(request.body?.externalId === null || typeof request.body?.externalId === 'string'
          ? { externalId: request.body.externalId as string | null | undefined }
          : {}),
        ...(request.body?.deliveredAt === null || typeof request.body?.deliveredAt === 'string'
          ? { deliveredAt: request.body.deliveredAt as string | null | undefined }
          : {}),
        ...(handoffAttempt !== undefined ? { handoffAttempt } : {}),
      });
      response.json(result);
    } catch (error) {
      if (error instanceof InboxReplyHandoffImportError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }

      next(error);
    }
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

    if (request.body !== undefined && !isPlainObject(request.body)) {
      response.status(400).json({ error: 'invalid job runAt' });
      return;
    }

    if (
      request.body?.runAt !== undefined &&
      (typeof request.body.runAt !== 'string' || !isValidJobRunAt(request.body.runAt))
    ) {
      response.status(400).json({ error: 'invalid job runAt' });
      return;
    }

    const runAt =
      typeof request.body?.runAt === 'string' && isValidJobRunAt(request.body.runAt)
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSessionStatusValue(value: unknown): value is 'active' | 'expired' | 'missing' {
  return value === 'active' || value === 'expired' || value === 'missing';
}

function isBrowserHandoffPublishStatus(value: unknown): value is 'published' | 'failed' {
  return value === 'published' || value === 'failed';
}

function isInboxReplyHandoffReplyStatus(value: unknown): value is 'sent' | 'failed' {
  return value === 'sent' || value === 'failed';
}

function buildSchedulerHealthSnapshot(schedulerRuntime: SchedulerRuntime | undefined) {
  if (!schedulerRuntime) {
    return {
      available: false,
      started: false,
    };
  }

  const status = schedulerRuntime.getStatus();
  const queue = isPlainObject(status.queue)
    ? {
        pending: readHealthNumber(status.queue.pending),
        running: readHealthNumber(status.queue.running),
        failed: readHealthNumber(status.queue.failed),
        duePending: readHealthNumber(status.queue.duePending),
      }
    : null;

  return {
    available: status.available === true,
    started: status.started === true,
    ...(queue ? { queue } : {}),
  };
}

export function createSystemHealthPayload(schedulerRuntime: SchedulerRuntime | undefined) {
  return {
    ok: true,
    service: 'promobot',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    scheduler: buildSchedulerHealthSnapshot(schedulerRuntime),
    browserArtifacts: createBrowserArtifactHealthSummary(),
  };
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  const normalizedValue =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  if (normalizedValue.length === 0) {
    return undefined;
  }

  const parsed = Number(normalizedValue);
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

function readHealthNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isValidJobRunAt(value: string) {
  const calendarDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (calendarDateMatch) {
    const [, yearValue, monthValue, dayValue] = calendarDateMatch;
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));

    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    ) {
      return false;
    }
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return new Date(value).toISOString() === value;
  }

  return true;
}
