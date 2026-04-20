import { useEffect, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { DraftEditorCard } from '../components/DraftEditorCard';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import {
  createDraftFormValues,
  type DraftFormValues,
  type DraftInteractionStateOverride,
  type DraftMutationState,
  type DraftRecord,
  type DraftsResponse,
  type PublishDraftResponse,
  type UpdateDraftPayload,
  type UpdateDraftResponse,
  upsertDraftRecord,
} from '../lib/drafts';

export type {
  DraftFormValues,
  DraftInteractionStateOverride,
  DraftRecord,
  DraftsResponse,
  PublishDraftResponse,
  UpdateDraftPayload,
  UpdateDraftResponse,
} from '../lib/drafts';

function parseProjectId(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function buildDraftsPath(projectId?: number) {
  return projectId === undefined ? '/api/drafts' : `/api/drafts?projectId=${projectId}`;
}

const projectInputStyle = {
  width: '100%',
  maxWidth: '240px',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export async function loadDraftsRequest(projectId?: number): Promise<DraftsResponse> {
  return apiRequest<DraftsResponse>(buildDraftsPath(projectId));
}

export async function updateDraftRequest(id: number, input: UpdateDraftPayload): Promise<UpdateDraftResponse> {
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

interface DraftsPageProps {
  loadDraftsAction?: (projectId?: number) => Promise<DraftsResponse>;
  updateDraftAction?: (id: number, input: UpdateDraftPayload) => Promise<UpdateDraftResponse>;
  publishDraftAction?: (id: number) => Promise<PublishDraftResponse>;
  stateOverride?: AsyncState<DraftsResponse>;
  draftInteractionStateOverride?: DraftInteractionStateOverride;
}

function createIdleMutationState(): DraftMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
    publishUrl: null,
  };
}

function getDraftFormValue(
  formValuesById: Record<number, DraftFormValues>,
  draft: DraftRecord,
): DraftFormValues {
  return formValuesById[draft.id] ?? createDraftFormValues(draft);
}

function getDraftMutationValue(
  mutationStateById: Record<number, DraftMutationState>,
  draftId: number,
): DraftMutationState {
  return mutationStateById[draftId] ?? createIdleMutationState();
}

export function DraftsPage({
  loadDraftsAction = loadDraftsRequest,
  updateDraftAction = updateDraftRequest,
  publishDraftAction = publishDraftRequest,
  stateOverride,
  draftInteractionStateOverride,
}: DraftsPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadDraftsAction() : loadDraftsAction(projectId)),
    [loadDraftsAction, projectId],
  );
  const [localDrafts, setLocalDrafts] = useState<DraftRecord[]>([]);
  const [formValuesById, setFormValuesById] = useState<Record<number, DraftFormValues>>({});
  const [saveStateById, setSaveStateById] = useState<Record<number, DraftMutationState>>({});
  const [publishStateById, setPublishStateById] = useState<Record<number, DraftMutationState>>({});
  const displayState = stateOverride ?? state;
  const visibleDrafts =
    displayState.status === 'success' && displayState.data
      ? localDrafts.length > 0
        ? localDrafts
        : displayState.data.drafts
      : [];
  const displayFormValuesById = draftInteractionStateOverride?.formValuesById ?? formValuesById;
  const displaySaveStateById = draftInteractionStateOverride?.saveStateById ?? saveStateById;
  const displayPublishStateById = draftInteractionStateOverride?.publishStateById ?? publishStateById;

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setLocalDrafts(displayState.data.drafts);
    setFormValuesById((currentFormValues) => {
      const nextFormValues = { ...currentFormValues };

      for (const draft of displayState.data.drafts) {
        if (!nextFormValues[draft.id]) {
          nextFormValues[draft.id] = createDraftFormValues(draft);
        }
      }

      return nextFormValues;
    });
  }, [displayState]);

  function updateFormValues(draftId: number, updater: (currentValues: DraftFormValues) => DraftFormValues) {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ??
      displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    setFormValuesById((currentValues) => ({
      ...currentValues,
      [draftId]: updater(getDraftFormValue(currentValues, sourceDraft)),
    }));
    setSaveStateById((currentState) => ({
      ...currentState,
      [draftId]: createIdleMutationState(),
    }));
  }

  async function handleSaveDraft(draftId: number) {
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ??
      displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    const formValues = getDraftFormValue(formValuesById, sourceDraft);

    setSaveStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        publishUrl: null,
      },
    }));

    try {
      const result = await updateDraftAction(draftId, formValues);
      setLocalDrafts((currentDrafts) =>
        upsertDraftRecord(currentDrafts.length > 0 ? currentDrafts : visibleDrafts, result.draft),
      );
      setFormValuesById((currentValues) => ({
        ...currentValues,
        [draftId]: createDraftFormValues(result.draft),
      }));
      setSaveStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: '草稿已保存',
          error: null,
          publishUrl: null,
        },
      }));
    } catch (error) {
      setSaveStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          publishUrl: null,
        },
      }));
    }
  }

  async function handlePublishDraft(draftId: number) {
    setPublishStateById((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        publishUrl: null,
      },
    }));

    try {
      const result = await publishDraftAction(draftId);
      setPublishStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status:
            result.success || result.status === 'manual_required'
              ? 'success'
              : 'error',
          message:
            result.success
              ? result.message
              : result.status === 'manual_required'
                ? `已转入人工接管：${
                    visibleDrafts.find((draft) => draft.id === draftId)?.title ??
                    `Draft #${draftId}`
                  }`
                : null,
          error:
            result.success || result.status === 'manual_required'
              ? null
              : result.message,
          publishUrl: result.publishUrl,
        },
      }));
    } catch (error) {
      setPublishStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          publishUrl: null,
        },
      }));
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Content Queue"
        title="Drafts"
        description="草稿列表会集中展示不同项目和渠道的候选内容，支持审核、定时和快速发布。"
        actions={<ActionButton label="重新加载" onClick={reload} />}
      />

      <label style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
        <input
          value={projectIdDraft}
          onChange={(event) => setProjectIdDraft(event.target.value)}
          placeholder="例如 12"
          style={projectInputStyle}
        />
      </label>

      <SectionCard title="草稿列表" description="页面加载时直接请求 `/api/drafts`。">
        {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载草稿...</p> : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>草稿加载失败：{displayState.error}</p>
        ) : null}

        {displayState.status === 'success' && displayState.data ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontWeight: 700 }}>已加载 {displayState.data.drafts.length} 条草稿</div>

            {visibleDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无草稿</p>
            ) : (
              visibleDrafts.map((draft) => (
                <DraftEditorCard
                  key={draft.id}
                  draft={draft}
                  formValues={getDraftFormValue(displayFormValuesById, draft)}
                  saveState={getDraftMutationValue(displaySaveStateById, draft.id)}
                  publishState={getDraftMutationValue(displayPublishStateById, draft.id)}
                  onTitleChange={(value) =>
                    updateFormValues(draft.id, (currentValues) => ({
                      ...currentValues,
                      title: value,
                    }))
                  }
                  onContentChange={(value) =>
                    updateFormValues(draft.id, (currentValues) => ({
                      ...currentValues,
                      content: value,
                    }))
                  }
                  onStatusChange={(value) =>
                    updateFormValues(draft.id, (currentValues) => ({
                      ...currentValues,
                      status: value,
                    }))
                  }
                  onSave={() => {
                    void handleSaveDraft(draft.id);
                  }}
                  onPublish={() => {
                    void handlePublishDraft(draft.id);
                  }}
                />
              ))
            )}
          </div>
        ) : null}

        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>初始化后会自动加载真实草稿列表。</p>
        ) : null}
      </SectionCard>
    </section>
  );
}
