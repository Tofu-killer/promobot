import { apiRequest } from './api';

export interface SystemJobRecord {
  id: number;
  type: string;
  status: string;
  runAt: string;
  attempts: number;
  lastError?: string;
  canRetry?: boolean;
  canCancel?: boolean;
}

export interface SystemJobQueueSummary {
  pending?: number;
  running?: number;
  done?: number;
  failed?: number;
  canceled?: number;
  duePending?: number;
  [key: string]: unknown;
}

export interface SystemJobsResponse {
  jobs: SystemJobRecord[];
  queue: SystemJobQueueSummary;
  recentJobs: SystemJobRecord[];
}

export interface SystemJobMutationResponse {
  job: SystemJobRecord;
  runtime: Record<string, unknown>;
}

export interface BrowserLaneRequestRecord {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: string;
  jobStatus: string;
  requestedAt: string;
  artifactPath: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserLaneRequestsResponse {
  requests: BrowserLaneRequestRecord[];
  total: number;
}

export interface BrowserLaneSessionSummary {
  hasSession: boolean;
  status: 'active' | 'expired' | 'missing' | string;
  validatedAt: string | null;
  storageStatePath: string | null;
  id?: string;
  notes?: string;
}

export interface BrowserLaneRequestImportResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  session: BrowserLaneSessionSummary | null;
  channelAccount: {
    id: number;
    metadata?: Record<string, unknown>;
    session?: BrowserLaneSessionSummary;
    [key: string]: unknown;
  };
}

export interface ImportBrowserLaneRequestResultInput {
  requestArtifactPath: string;
  storageState: Record<string, unknown>;
  notes?: string;
}

export interface EnqueueSystemJobInput {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: string;
}

export async function loadSystemJobsRequest<TResponse>(limit = 20): Promise<TResponse> {
  return apiRequest<TResponse>(`/api/system/jobs?limit=${limit}`);
}

export async function loadBrowserLaneRequestsRequest<TResponse>(limit = 20): Promise<TResponse> {
  return apiRequest<TResponse>(`/api/system/browser-lane-requests?limit=${limit}`);
}

export async function importBrowserLaneRequestResultRequest<TResponse>(
  input: ImportBrowserLaneRequestResultInput,
): Promise<TResponse> {
  return apiRequest<TResponse>('/api/system/browser-lane-requests/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestArtifactPath: input.requestArtifactPath,
      storageState: input.storageState,
      ...(input.notes !== undefined && input.notes.trim().length > 0 ? { notes: input.notes.trim() } : {}),
    }),
  });
}

export async function retrySystemJobRequest<TResponse>(jobId: number, runAt?: string): Promise<TResponse> {
  return apiRequest<TResponse>(`/api/system/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(runAt ? { runAt } : {}),
  });
}

export async function cancelSystemJobRequest<TResponse>(jobId: number): Promise<TResponse> {
  return apiRequest<TResponse>(`/api/system/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
}

export async function enqueueSystemJobRequest<TResponse>(input: EnqueueSystemJobInput): Promise<TResponse> {
  return apiRequest<TResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}
