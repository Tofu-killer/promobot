import { apiRequest } from './api';
import { withProjectIdQuery } from './projectId';

export type DraftStatus = 'approved' | 'draft' | 'failed' | 'published' | 'queued' | 'review' | 'scheduled';

export interface DraftRecord {
  id: number;
  platform: string;
  title?: string;
  content: string;
  hashtags: string[];
  status: DraftStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftsResponse {
  drafts: DraftRecord[];
}

export interface UpdateDraftPayload {
  title: string;
  content: string;
  status: DraftStatus;
}

export interface UpdateDraftResponse {
  draft: DraftRecord;
}

export interface PublishDraftResponse {
  success: boolean;
  status?: string;
  publishUrl: string | null;
  message: string;
  details?: Record<string, unknown>;
}

export async function loadDraftsRequest(projectId?: number, status?: DraftStatus): Promise<DraftsResponse> {
  const draftsPath = status === undefined ? '/api/drafts' : `/api/drafts?status=${status}`;
  return apiRequest<DraftsResponse>(withProjectIdQuery(draftsPath, projectId));
}

export async function updateDraftRequest(id: number, input: Record<string, unknown>): Promise<UpdateDraftResponse> {
  return apiRequest<UpdateDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function publishDraftRequest(id: number): Promise<PublishDraftResponse> {
  return apiRequest<PublishDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

export interface DraftFormValues {
  title: string;
  content: string;
  status: DraftStatus;
}

export interface DraftMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string | null;
  error?: string | null;
  publishUrl?: string | null;
  contractMessage?: string | null;
  contractStatus?: string | null;
  contractDetails?: Record<string, unknown> | null;
}

export interface DraftInteractionStateOverride {
  formValuesById?: Record<number, DraftFormValues>;
  saveStateById?: Record<number, DraftMutationState>;
  publishStateById?: Record<number, DraftMutationState>;
}

export const draftStatusOptions: DraftStatus[] = [
  'draft',
  'review',
  'approved',
  'queued',
  'scheduled',
  'published',
  'failed',
];

export function createDraftFormValues(draft: DraftRecord): DraftFormValues {
  return {
    title: draft.title ?? '',
    content: draft.content,
    status: draft.status,
  };
}

export function upsertDraftRecord(drafts: DraftRecord[], updatedDraft: DraftRecord): DraftRecord[] {
  const existingIndex = drafts.findIndex((draft) => draft.id === updatedDraft.id);

  if (existingIndex === -1) {
    return [updatedDraft, ...drafts];
  }

  return drafts.map((draft) => (draft.id === updatedDraft.id ? updatedDraft : draft));
}
