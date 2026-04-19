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
  publishUrl: string | null;
  message: string;
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
