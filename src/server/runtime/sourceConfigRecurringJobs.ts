import type { EnqueueJobInput, JobQueueEntry, JobQueueStore } from '../store/jobQueue.js';
import type { SourceConfigRecord, SourceConfigStore } from '../store/sourceConfigs.js';

export interface SourceConfigRecurringJobPayload {
  recurring: 'source_config_poll';
  projectId: number;
  sourceConfigIds: number[];
  intervalMinutes: number;
}

type SourceConfigRecurringJobPayloadRecord = SourceConfigRecurringJobPayload & Record<string, unknown>;

export interface SourceConfigRecurringJobPlan {
  type: string;
  projectId: number;
  intervalMinutes: number;
  sourceConfigIds: number[];
  key: string;
  payload: SourceConfigRecurringJobPayloadRecord;
}

export interface SourceConfigRecurringJobSyncDependencies {
  jobQueueStore: Pick<JobQueueStore, 'cancel' | 'enqueue' | 'list'>;
  sourceConfigStore: Pick<SourceConfigStore, 'listEnabled'>;
  now?: () => Date;
}

const recurringJobTypes = ['monitor_fetch', 'inbox_fetch', 'reputation_fetch'] as const;
const recurringJobPageSize = 100;

type RecurringJobType = (typeof recurringJobTypes)[number];

interface ParsedRecurringJob {
  id: number;
  type: string;
  status: string;
  key: string;
}

export function syncSourceConfigRecurringJobs(
  dependencies: SourceConfigRecurringJobSyncDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const plans = buildSourceConfigRecurringJobPlans(dependencies.sourceConfigStore.listEnabled());
  const desiredKeys = new Set(plans.map((plan) => plan.key));
  const existingJobs = listRecurringJobs(dependencies.jobQueueStore)
    .map(parseRecurringJob)
    .filter((job): job is ParsedRecurringJob => job !== undefined);
  const existingByKey = new Map(existingJobs.map((job) => [job.key, job]));

  for (const existingJob of existingJobs) {
    if (!desiredKeys.has(existingJob.key)) {
      dependencies.jobQueueStore.cancel(existingJob.id, now().toISOString());
    }
  }

  for (const plan of plans) {
    if (existingByKey.has(plan.key)) {
      continue;
    }

    dependencies.jobQueueStore.enqueue({
      type: plan.type,
      payload: plan.payload,
      runAt: nextRunAtIso(plan.intervalMinutes, now()),
      status: 'pending',
    });
  }
}

function listRecurringJobs(jobQueueStore: Pick<JobQueueStore, 'list'>) {
  const jobs: JobQueueEntry[] = [];
  let offset = 0;

  while (true) {
    const page = jobQueueStore.list({
      statuses: ['pending', 'running'],
      limit: recurringJobPageSize,
      offset,
    });
    jobs.push(...page);

    if (page.length < recurringJobPageSize) {
      return jobs;
    }

    offset += page.length;
  }
}

export function buildSourceConfigRecurringJobPlans(
  sourceConfigs: SourceConfigRecord[],
): SourceConfigRecurringJobPlan[] {
  const groups = new Map<string, SourceConfigRecurringJobPlan>();

  for (const sourceConfig of sourceConfigs) {
    for (const type of resolveRecurringJobTypes(sourceConfig)) {
      const key = `${type}:${sourceConfig.projectId}:${sourceConfig.pollIntervalMinutes}:${sourceConfig.id}`;
      groups.set(key, {
        type,
        projectId: sourceConfig.projectId,
        intervalMinutes: sourceConfig.pollIntervalMinutes,
        sourceConfigIds: [sourceConfig.id],
        key,
        payload: {
          recurring: 'source_config_poll',
          projectId: sourceConfig.projectId,
          sourceConfigIds: [sourceConfig.id],
          intervalMinutes: sourceConfig.pollIntervalMinutes,
        },
      });
    }
  }

  return Array.from(groups.values()).sort(compareRecurringPlan);
}

export function isSourceConfigRecurringJobPayload(
  payload: unknown,
): payload is SourceConfigRecurringJobPayload {
  if (!isPlainObject(payload) || payload.recurring !== 'source_config_poll') {
    return false;
  }

  const projectId = normalizePositiveInteger(payload.projectId);
  const intervalMinutes = normalizePositiveInteger(payload.intervalMinutes);
  const sourceConfigIds = normalizeSourceConfigIds(payload.sourceConfigIds);

  return (
    projectId !== undefined &&
    intervalMinutes !== undefined &&
    sourceConfigIds.length > 0
  );
}

export function readRecurringSourceConfigIds(payload: unknown) {
  if (!isSourceConfigRecurringJobPayload(payload)) {
    return undefined;
  }

  return payload.sourceConfigIds;
}

function parseRecurringJob(job: JobQueueEntry): ParsedRecurringJob | undefined {
  if (!recurringJobTypes.includes(job.type as RecurringJobType)) {
    return undefined;
  }

  const payload = parsePayloadObject(job.payload);
  if (!isSourceConfigRecurringJobPayload(payload)) {
    return undefined;
  }

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    key: buildRecurringJobKey(job.type, payload.projectId, payload.intervalMinutes, payload.sourceConfigIds),
  };
}

function resolveRecurringJobTypes(sourceConfig: SourceConfigRecord): RecurringJobType[] {
  const types: RecurringJobType[] = [];

  if (supportsMonitorRecurring(sourceConfig)) {
    types.push('monitor_fetch');
  }

  if (supportsInboxAndReputationRecurring(sourceConfig)) {
    types.push('inbox_fetch', 'reputation_fetch');
  }

  return types;
}

function supportsMonitorRecurring(sourceConfig: SourceConfigRecord) {
  if (sourceConfig.sourceType === 'rss' || sourceConfig.sourceType === 'v2ex_search') {
    return true;
  }

  if (
    sourceConfig.sourceType === 'keyword' ||
    sourceConfig.sourceType === 'keyword+reddit' ||
    sourceConfig.sourceType === 'keyword+x'
  ) {
    return sourceConfig.platform === 'reddit' || sourceConfig.platform === 'x';
  }

  if (sourceConfig.sourceType === 'profile+instagram' || sourceConfig.sourceType === 'profile') {
    return sourceConfig.platform === 'instagram';
  }

  if (sourceConfig.sourceType === 'profile+tiktok' || sourceConfig.sourceType === 'profile') {
    return sourceConfig.platform === 'tiktok';
  }

  return false;
}

function supportsInboxAndReputationRecurring(sourceConfig: SourceConfigRecord) {
  if (
    (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+reddit') &&
    sourceConfig.platform === 'reddit'
  ) {
    return true;
  }

  if (
    (sourceConfig.sourceType === 'keyword' || sourceConfig.sourceType === 'keyword+x') &&
    sourceConfig.platform === 'x'
  ) {
    return true;
  }

  return sourceConfig.sourceType === 'v2ex_search';
}

function compareRecurringPlan(left: SourceConfigRecurringJobPlan, right: SourceConfigRecurringJobPlan) {
  return (
    left.type.localeCompare(right.type) ||
    left.projectId - right.projectId ||
    left.intervalMinutes - right.intervalMinutes ||
    left.sourceConfigIds[0] - right.sourceConfigIds[0]
  );
}

function nextRunAtIso(intervalMinutes: number, now: Date) {
  return new Date(now.getTime() + intervalMinutes * 60_000).toISOString();
}

function buildRecurringJobKey(
  type: string,
  projectId: number,
  intervalMinutes: number,
  sourceConfigIds: number[],
) {
  return `${type}:${projectId}:${intervalMinutes}:${sourceConfigIds.join(',')}`;
}

function parsePayloadObject(value: unknown) {
  if (typeof value === 'string') {
    try {
      return parsePayloadObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  return isPlainObject(value) ? value : undefined;
}

function normalizePositiveInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : undefined;
}

function normalizeSourceConfigIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => normalizePositiveInteger(item))
        .filter((item): item is number => item !== undefined),
    ),
  ).sort((left, right) => left - right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
