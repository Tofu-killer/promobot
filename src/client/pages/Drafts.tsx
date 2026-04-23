import { useEffect, useRef, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { DraftEditorCard } from '../components/DraftEditorCard';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import {
  createDraftFormValues,
  draftStatusOptions,
  type DraftFormValues,
  type DraftInteractionStateOverride,
  type DraftMutationState,
  type DraftRecord,
  type DraftsResponse,
  type DraftStatus,
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
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
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

type StatusFilter = 'all' | DraftStatus;
type BatchFeedback = {
  tone: 'success' | 'error';
  message: string;
};

const batchSelectableStatuses = new Set<DraftStatus>(['draft', 'review', 'approved']);

function isBatchSelectableDraft(draft: DraftRecord) {
  return batchSelectableStatuses.has(draft.status);
}

function createLoadingMutationState(): DraftMutationState {
  return {
    status: 'loading',
    message: null,
    error: null,
    publishUrl: null,
    contractMessage: null,
    contractStatus: null,
    contractDetails: null,
  };
}

function isPublishResultHandled(result: PublishDraftResponse) {
  return result.success || result.status === 'manual_required' || result.status === 'queued';
}

function createPublishMutationState(result: PublishDraftResponse, draftTitle: string): DraftMutationState {
  return {
    status: isPublishResultHandled(result) ? 'success' : 'error',
    message: result.success
      ? result.message
      : result.status === 'queued'
        ? `已入队等待发布：${draftTitle}`
        : result.status === 'manual_required'
          ? `已转入人工接管：${draftTitle}`
          : null,
    error: isPublishResultHandled(result) ? null : result.message,
    publishUrl: result.publishUrl,
    contractMessage: result.message,
    contractStatus: result.status ?? null,
    contractDetails:
      typeof result.details === 'object' && result.details !== null && !Array.isArray(result.details)
        ? (result.details as Record<string, unknown>)
        : null,
  };
}

function getBatchStatusSuccessMessage(status: DraftStatus, draftTitle: string) {
  switch (status) {
    case 'review':
      return `已送审：${draftTitle}`;
    case 'approved':
      return `已批准：${draftTitle}`;
    case 'scheduled':
      return `已排期：${draftTitle}`;
    default:
      return `状态已更新：${draftTitle}`;
  }
}

export function DraftsPage({
  loadDraftsAction = loadDraftsRequest,
  updateDraftAction = updateDraftRequest,
  publishDraftAction = publishDraftRequest,
  stateOverride,
  draftInteractionStateOverride,
}: DraftsPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const [activeStatusFilter, setActiveStatusFilter] = useState<StatusFilter>('all');
  const [selectedDraftIds, setSelectedDraftIds] = useState<number[]>([]);
  const [batchFeedback, setBatchFeedback] = useState<BatchFeedback | null>(null);
  const projectId = parseProjectId(projectIdDraft);
  const currentScopeKey = projectId === undefined ? '' : String(projectId);
  const { state, reload } = useAsyncQuery(
    () => (projectId === undefined ? loadDraftsAction() : loadDraftsAction(projectId)),
    [loadDraftsAction, projectId],
  );
  const [localDrafts, setLocalDrafts] = useState<DraftRecord[]>([]);
  const [formValuesById, setFormValuesById] = useState<Record<number, DraftFormValues>>({});
  const [saveStateById, setSaveStateById] = useState<Record<number, DraftMutationState>>({});
  const [publishStateById, setPublishStateById] = useState<Record<number, DraftMutationState>>({});
  const latestScopeKeyRef = useRef(currentScopeKey);
  latestScopeKeyRef.current = currentScopeKey;
  const displayState = stateOverride ?? state;
  const hasLiveDrafts =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as DraftsResponse).drafts);
  const visibleDrafts = hasLiveDrafts
    ? localDrafts.length > 0
      ? localDrafts
      : (displayState.data as DraftsResponse).drafts
    : [];
  const filteredDrafts =
    activeStatusFilter === 'all'
      ? visibleDrafts
      : visibleDrafts.filter((draft) => draft.status === activeStatusFilter);
  const selectableFilteredDrafts = filteredDrafts.filter(isBatchSelectableDraft);
  const selectedFilteredDrafts = selectableFilteredDrafts.filter((draft) => selectedDraftIds.includes(draft.id));
  const showBatchControls = visibleDrafts.length > 1;
  const displayFormValuesById = draftInteractionStateOverride?.formValuesById ?? formValuesById;
  const displaySaveStateById = draftInteractionStateOverride?.saveStateById ?? saveStateById;
  const displayPublishStateById = draftInteractionStateOverride?.publishStateById ?? publishStateById;

  useEffect(() => {
    setActiveStatusFilter('all');
    setSelectedDraftIds([]);
    setBatchFeedback(null);
    setLocalDrafts([]);
    setFormValuesById({});
    setSaveStateById({});
    setPublishStateById({});
  }, [projectId]);

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setLocalDrafts(displayState.data.drafts);
    setSelectedDraftIds((currentDraftIds) => {
      const nextVisibleDrafts =
        activeStatusFilter === 'all'
          ? displayState.data.drafts
          : displayState.data.drafts.filter((draft) => draft.status === activeStatusFilter);
      const nextSelectableIds = new Set(
        nextVisibleDrafts.filter(isBatchSelectableDraft).map((draft) => draft.id),
      );
      const nextSelectedDraftIds = currentDraftIds.filter((draftId) => nextSelectableIds.has(draftId));

      return nextSelectedDraftIds.length === currentDraftIds.length ? currentDraftIds : nextSelectedDraftIds;
    });
    setFormValuesById((currentFormValues) => {
      const nextFormValues = { ...currentFormValues };

      for (const draft of displayState.data.drafts) {
        nextFormValues[draft.id] = createDraftFormValues(draft);
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

  function applyUpdatedDraft(result: UpdateDraftResponse) {
    setLocalDrafts((currentDrafts) =>
      upsertDraftRecord(currentDrafts.length > 0 ? currentDrafts : visibleDrafts, result.draft),
    );
    setFormValuesById((currentValues) => ({
      ...currentValues,
      [result.draft.id]: createDraftFormValues(result.draft),
    }));
  }

  async function handleSaveDraft(draftId: number) {
    const scopeKeyAtStart = latestScopeKeyRef.current;
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ??
      displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    const formValues = getDraftFormValue(formValuesById, sourceDraft);

    setSaveStateById((currentState) => ({
      ...currentState,
      [draftId]: createLoadingMutationState(),
    }));

    try {
      const result = await updateDraftAction(draftId, formValues);
      if (scopeKeyAtStart !== latestScopeKeyRef.current) {
        return;
      }
      applyUpdatedDraft(result);
      setSaveStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: '草稿已保存',
          error: null,
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
          contractDetails: null,
        },
      }));
    } catch (error) {
      if (scopeKeyAtStart !== latestScopeKeyRef.current) {
        return;
      }
      setSaveStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          publishUrl: null,
          contractMessage: null,
          contractStatus: null,
          contractDetails: null,
        },
      }));
    }
  }

  async function handlePublishDraft(draftId: number) {
    const scopeKeyAtStart = latestScopeKeyRef.current;
    const sourceDraft =
      visibleDrafts.find((draft) => draft.id === draftId) ??
      displayState.data?.drafts.find((draft) => draft.id === draftId);

    if (!sourceDraft) {
      return;
    }

    const draftTitle = sourceDraft.title ?? `Draft #${draftId}`;

    setPublishStateById((currentState) => ({
      ...currentState,
      [draftId]: createLoadingMutationState(),
    }));

    try {
      const result = await publishDraftAction(draftId);
      if (scopeKeyAtStart !== latestScopeKeyRef.current) {
        return;
      }
      if (isPublishResultHandled(result)) {
        setFormValuesById((currentValues) => {
          const nextValues = { ...currentValues };
          delete nextValues[draftId];
          return nextValues;
        });
        reload();
      }
      setPublishStateById((currentState) => ({
        ...currentState,
        [draftId]: createPublishMutationState(result, draftTitle),
      }));
    } catch (error) {
      if (scopeKeyAtStart !== latestScopeKeyRef.current) {
        return;
      }
      setPublishStateById((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          publishUrl: null,
          contractMessage: getErrorMessage(error),
          contractStatus: 'failed',
          contractDetails: null,
        },
      }));
    }
  }

  function handleSelectStatusFilter(status: StatusFilter) {
    const nextFilteredDrafts =
      status === 'all' ? visibleDrafts : visibleDrafts.filter((draft) => draft.status === status);
    const nextSelectableIds = new Set(nextFilteredDrafts.filter(isBatchSelectableDraft).map((draft) => draft.id));

    setActiveStatusFilter(status);
    setSelectedDraftIds((currentDraftIds) =>
      currentDraftIds.filter((draftId) => nextSelectableIds.has(draftId)),
    );
    setBatchFeedback(null);
  }

  function handleToggleDraftSelection(draftId: number) {
    const sourceDraft = filteredDrafts.find((draft) => draft.id === draftId);

    if (!sourceDraft || !isBatchSelectableDraft(sourceDraft)) {
      return;
    }

    setBatchFeedback(null);
    setSelectedDraftIds((currentDraftIds) =>
      currentDraftIds.includes(draftId)
        ? currentDraftIds.filter((id) => id !== draftId)
        : [...currentDraftIds, draftId],
    );
  }

  async function handleBatchUpdateStatus(status: 'review' | 'approved' | 'scheduled') {
    const scopeKeyAtStart = latestScopeKeyRef.current;
    const draftsToUpdate = selectedFilteredDrafts;

    if (draftsToUpdate.length === 0) {
      return;
    }

    setBatchFeedback(null);

    let successCount = 0;
    let failureCount = 0;
    let firstErrorMessage: string | null = null;

    for (const draft of draftsToUpdate) {
      const draftId = draft.id;
      const draftTitle = draft.title ?? `Draft #${draftId}`;
      const formValues = getDraftFormValue(formValuesById, draft);

      setSaveStateById((currentState) => ({
        ...currentState,
        [draftId]: createLoadingMutationState(),
      }));

      try {
        const result = await updateDraftAction(draftId, {
          ...formValues,
          status,
        });
        if (scopeKeyAtStart !== latestScopeKeyRef.current) {
          return;
        }

        successCount += 1;
        applyUpdatedDraft(result);
        setSaveStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'success',
            message: getBatchStatusSuccessMessage(status, result.draft.title ?? draftTitle),
            error: null,
            publishUrl: null,
            contractMessage: null,
            contractStatus: null,
            contractDetails: null,
          },
        }));
      } catch (error) {
        if (scopeKeyAtStart !== latestScopeKeyRef.current) {
          return;
        }

        failureCount += 1;
        if (!firstErrorMessage) {
          firstErrorMessage = getErrorMessage(error);
        }
        setSaveStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'error',
            message: null,
            error: getErrorMessage(error),
            publishUrl: null,
            contractMessage: null,
            contractStatus: null,
            contractDetails: null,
          },
        }));
      }
    }

    if (scopeKeyAtStart !== latestScopeKeyRef.current) {
      return;
    }

    setSelectedDraftIds([]);
    setBatchFeedback(
      failureCount > 0
        ? {
            tone: 'error',
            message:
              successCount > 0
                ? `已批量处理 ${successCount} 条草稿，另有 ${failureCount} 条失败`
                : `批量更新失败：${firstErrorMessage ?? '请求失败'}`,
          }
        : {
            tone: 'success',
            message: `已批量处理 ${successCount} 条草稿，目标状态 ${status}`,
          },
    );
  }

  async function handleBatchPublish() {
    const scopeKeyAtStart = latestScopeKeyRef.current;
    const draftsToPublish = selectedFilteredDrafts;

    if (draftsToPublish.length === 0) {
      return;
    }

    setBatchFeedback(null);

    let successCount = 0;
    let failureCount = 0;
    let firstErrorMessage: string | null = null;
    let shouldReload = false;

    for (const draft of draftsToPublish) {
      const draftId = draft.id;
      const draftTitle = draft.title ?? `Draft #${draftId}`;

      setPublishStateById((currentState) => ({
        ...currentState,
        [draftId]: createLoadingMutationState(),
      }));

      try {
        const result = await publishDraftAction(draftId);
        if (scopeKeyAtStart !== latestScopeKeyRef.current) {
          return;
        }

        if (isPublishResultHandled(result)) {
          successCount += 1;
          shouldReload = true;
          setFormValuesById((currentValues) => {
            const nextValues = { ...currentValues };
            delete nextValues[draftId];
            return nextValues;
          });
        } else {
          failureCount += 1;
          if (!firstErrorMessage) {
            firstErrorMessage = result.message;
          }
        }

        setPublishStateById((currentState) => ({
          ...currentState,
          [draftId]: createPublishMutationState(result, draftTitle),
        }));
      } catch (error) {
        if (scopeKeyAtStart !== latestScopeKeyRef.current) {
          return;
        }

        failureCount += 1;
        if (!firstErrorMessage) {
          firstErrorMessage = getErrorMessage(error);
        }
        setPublishStateById((currentState) => ({
          ...currentState,
          [draftId]: {
            status: 'error',
            message: null,
            error: getErrorMessage(error),
            publishUrl: null,
            contractMessage: getErrorMessage(error),
            contractStatus: 'failed',
            contractDetails: null,
          },
        }));
      }
    }

    if (scopeKeyAtStart !== latestScopeKeyRef.current) {
      return;
    }

    setSelectedDraftIds([]);
    setBatchFeedback(
      failureCount > 0
        ? {
            tone: 'error',
            message:
              successCount > 0
                ? `已批量处理 ${successCount} 条草稿发布，另有 ${failureCount} 条失败`
                : `批量发布失败：${firstErrorMessage ?? '请求失败'}`,
          }
        : {
            tone: 'success',
            message: `已批量处理 ${successCount} 条草稿发布`,
          },
    );

    if (shouldReload) {
      reload();
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Content Queue"
        title="Drafts"
        description="草稿列表会集中展示不同项目和渠道的候选内容，并支持审核与人工接管前的内容整理。"
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

        {hasLiveDrafts ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'grid', gap: '4px' }}>
              <div style={{ fontWeight: 700 }}>已加载 {visibleDrafts.length} 条草稿</div>
              <div style={{ color: '#475569' }}>
                当前筛选下 {filteredDrafts.length} 条 / 总计 {visibleDrafts.length} 条草稿
                {`（已筛选 ${filteredDrafts.length} / ${visibleDrafts.length} 条草稿）`}
              </div>
            </div>
            {showBatchControls ? (
              <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ display: 'grid', gap: '8px' }}>
                <div style={{ fontWeight: 700 }}>按状态筛选</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {(['all', ...draftStatusOptions] as const).map((statusOption) => (
                    <button
                      key={statusOption}
                      type="button"
                      data-drafts-status-filter={statusOption}
                      aria-pressed={activeStatusFilter === statusOption ? 'true' : 'false'}
                      onClick={() => handleSelectStatusFilter(statusOption)}
                      style={{
                        borderRadius: '999px',
                        border: '1px solid #cbd5e1',
                        background: activeStatusFilter === statusOption ? '#dbeafe' : '#ffffff',
                        color: activeStatusFilter === statusOption ? '#1d4ed8' : '#334155',
                        padding: '8px 12px',
                        fontWeight: 700,
                      }}
                    >
                      {statusOption}
                    </button>
                  ))}
                </div>
                <label style={{ display: 'grid', gap: '8px', maxWidth: '240px' }}>
                  <span style={{ fontWeight: 700 }}>状态筛选</span>
                  <select
                    data-drafts-status-filter="true"
                    value={activeStatusFilter}
                    onChange={(event) => handleSelectStatusFilter(event.target.value as StatusFilter)}
                    style={{
                      borderRadius: '12px',
                      border: '1px solid #cbd5e1',
                      padding: '10px 12px',
                      font: 'inherit',
                      background: '#ffffff',
                    }}
                  >
                    {(['all', ...draftStatusOptions] as const).map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div
                style={{
                  borderRadius: '14px',
                  border: '1px solid #dbe4f0',
                  background: '#f8fafc',
                  padding: '14px',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#0f172a' }}>
                  已选 {selectedFilteredDrafts.length} 条草稿
                  {`（已选择 ${selectedFilteredDrafts.length} 条草稿）`}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-drafts-batch-review="true"
                    data-drafts-batch-status="review"
                    disabled={selectedFilteredDrafts.length === 0}
                    onClick={() => {
                      void handleBatchUpdateStatus('review');
                    }}
                    style={{
                      borderRadius: '12px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: selectedFilteredDrafts.length === 0 ? '#475569' : '#334155',
                      padding: '12px 16px',
                      fontWeight: 700,
                      cursor: selectedFilteredDrafts.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: selectedFilteredDrafts.length === 0 ? 0.8 : 1,
                    }}
                  >
                    批量送审
                  </button>
                  <button
                    type="button"
                    data-drafts-batch-status="approved"
                    disabled={selectedFilteredDrafts.length === 0}
                    onClick={() => {
                      void handleBatchUpdateStatus('approved');
                    }}
                    style={{
                      borderRadius: '12px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: selectedFilteredDrafts.length === 0 ? '#475569' : '#334155',
                      padding: '12px 16px',
                      fontWeight: 700,
                      cursor: selectedFilteredDrafts.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: selectedFilteredDrafts.length === 0 ? 0.8 : 1,
                    }}
                  >
                    批量设为 approved
                  </button>
                  <button
                    type="button"
                    data-drafts-batch-status="scheduled"
                    disabled={selectedFilteredDrafts.length === 0}
                    onClick={() => {
                      void handleBatchUpdateStatus('scheduled');
                    }}
                    style={{
                      borderRadius: '12px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: selectedFilteredDrafts.length === 0 ? '#475569' : '#334155',
                      padding: '12px 16px',
                      fontWeight: 700,
                      cursor: selectedFilteredDrafts.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: selectedFilteredDrafts.length === 0 ? 0.8 : 1,
                    }}
                  >
                    批量设为 scheduled
                  </button>
                  <button
                    type="button"
                    data-drafts-batch-publish="true"
                    disabled={selectedFilteredDrafts.length === 0}
                    onClick={() => {
                      void handleBatchPublish();
                    }}
                    style={{
                      borderRadius: '12px',
                      border: 'none',
                      background: selectedFilteredDrafts.length === 0 ? '#bfdbfe' : '#2563eb',
                      color: selectedFilteredDrafts.length === 0 ? '#475569' : '#ffffff',
                      padding: '12px 16px',
                      fontWeight: 700,
                      boxShadow:
                        selectedFilteredDrafts.length === 0 ? 'none' : '0 12px 24px rgba(37, 99, 235, 0.18)',
                      cursor: selectedFilteredDrafts.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: selectedFilteredDrafts.length === 0 ? 0.8 : 1,
                    }}
                  >
                    批量发布
                  </button>
                </div>
                {batchFeedback ? (
                  <div
                    style={{
                      color: batchFeedback.tone === 'error' ? '#b91c1c' : '#166534',
                      fontWeight: 700,
                    }}
                  >
                    {batchFeedback.message}
                  </div>
                ) : null}
              </div>
              </div>
            ) : null}

            {filteredDrafts.length === 0 ? (
              <p style={{ margin: 0, color: '#475569' }}>暂无草稿</p>
            ) : (
              filteredDrafts.map((draft) => (
                <div key={draft.id} style={{ display: 'grid', gap: '8px' }}>
                  {isBatchSelectableDraft(draft) ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        data-drafts-select-id={String(draft.id)}
                        aria-pressed={selectedDraftIds.includes(draft.id) ? 'true' : 'false'}
                        onClick={() => handleToggleDraftSelection(draft.id)}
                        style={{
                          width: 'fit-content',
                          borderRadius: '999px',
                          border: '1px solid #cbd5e1',
                          background: selectedDraftIds.includes(draft.id) ? '#dbeafe' : '#ffffff',
                          color: selectedDraftIds.includes(draft.id) ? '#1d4ed8' : '#334155',
                          padding: '8px 12px',
                          fontWeight: 700,
                        }}
                      >
                        {selectedDraftIds.includes(draft.id) ? '已加入批量' : '加入批量'}
                      </button>
                      <input
                        type="checkbox"
                        checked={selectedDraftIds.includes(draft.id)}
                        data-draft-select-item={String(draft.id)}
                        aria-pressed={selectedDraftIds.includes(draft.id) ? 'true' : 'false'}
                        onChange={() => {
                          handleToggleDraftSelection(draft.id);
                        }}
                      />
                    </div>
                  ) : null}
                  <DraftEditorCard
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
                </div>
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
