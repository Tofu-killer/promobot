export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | (string & {});

export type JobPayload = Record<string, unknown>;

export interface JobRecord {
  id: number;
  type: string;
  payload: string;
  status: JobStatus;
  runAt: string;
  attempts: number;
}

export interface CreateJobRecordInput {
  id: number;
  type: string;
  payload: JobPayload | string;
  status?: JobStatus;
  runAt: string;
  attempts?: number;
}

export interface JobExecutionResult {
  jobId: number;
  type: string;
  outcome: 'completed' | 'failed' | 'skipped';
  reason?: string;
}

export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
  job: JobRecord,
) => Promise<void>;

export interface JobStore {
  listDueJobs(nowIso: string): Promise<JobRecord[]>;
  markRunning(jobId: number, startedAtIso: string): Promise<boolean>;
  markDone(jobId: number, finishedAtIso: string): Promise<void>;
  markFailed(jobId: number, error: string, failedAtIso: string): Promise<void>;
}

export function createJobRecord(input: CreateJobRecordInput): JobRecord {
  return {
    id: input.id,
    type: input.type,
    payload:
      typeof input.payload === 'string'
        ? input.payload
        : JSON.stringify(input.payload),
    status: input.status ?? 'pending',
    runAt: input.runAt,
    attempts: input.attempts ?? 0,
  };
}

export function parseJobPayload<TPayload = unknown>(
  job: Pick<JobRecord, 'payload'>,
): TPayload {
  return JSON.parse(job.payload) as TPayload;
}

export function isJobDue(
  job: Pick<JobRecord, 'runAt'>,
  now: Date = new Date(),
): boolean {
  return new Date(job.runAt).getTime() <= now.getTime();
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
