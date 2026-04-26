import { useEffect, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction } from '../hooks/useAsyncRequest';
import { SectionCard } from '../components/SectionCard';

interface PlatformOption {
  label: string;
  value: string;
  launchStatus: 'ready' | 'manual' | 'later';
  launchBadge: string;
}

const platformOptions: PlatformOption[] = [
  { label: 'X / Twitter', value: 'x', launchStatus: 'ready', launchBadge: '首发可用' },
  { label: 'Reddit', value: 'reddit', launchStatus: 'ready', launchBadge: '首发可用' },
  { label: 'Blog', value: 'blog', launchStatus: 'ready', launchBadge: '首发可用' },
  { label: 'Facebook Group', value: 'facebook-group', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: 'Instagram', value: 'instagram', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: 'TikTok', value: 'tiktok', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: '小红书', value: 'xiaohongshu', launchStatus: 'manual', launchBadge: '人工接管' },
  { label: '微博', value: 'weibo', launchStatus: 'manual', launchBadge: '人工接管' },
];

const defaultLaunchPlatforms = platformOptions
  .filter((platform) => platform.launchStatus === 'ready')
  .map((platform) => platform.value);

const toneOptions = [
  { label: '专业', value: 'professional' },
  { label: '轻松', value: 'casual' },
  { label: '激动人心', value: 'exciting' },
] as const;

const generationProgressStages = [
  {
    title: '已接收生成请求',
    description: '正在校验输入并锁定本次生成配置。',
  },
  {
    title: '正在拆解平台策略',
    description: '按渠道语气和发布方式组织这一轮生成上下文。',
  },
  {
    title: '正在生成平台草稿',
    description: '逐个平台写入标题、正文和 hashtags。',
  },
] as const;

function parseProjectId(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function getProjectIdValidationError(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return null;
  }

  return parseProjectId(value) === undefined ? '项目 ID 必须是大于 0 的整数' : null;
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

export interface GenerateDraftsPayload {
  topic: string;
  tone: string;
  platforms: string[];
  saveAsDraft?: boolean;
  projectId?: number;
}

export interface GenerateDraftsResponse {
  results: Array<{
    platform: string;
    title?: string;
    content: string;
    hashtags: string[];
    draftId?: number;
  }>;
}

export interface SendDraftToReviewResponse {
  draft: {
    id: number;
    platform: string;
    title?: string;
    content: string;
    hashtags: string[];
    status: string;
  };
}

export interface PublishGeneratedDraftResponse {
  success: boolean;
  status?: string;
  publishUrl: string | null;
  message: string;
}

export interface ScheduleGeneratedDraftResponse {
  draft: {
    id: number;
    status: string;
    scheduledAt?: string | null;
  };
}

export async function generateDraftsRequest(input: GenerateDraftsPayload): Promise<GenerateDraftsResponse> {
  return apiRequest<GenerateDraftsResponse>('/api/content/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function publishGeneratedDraftRequest(id: number): Promise<PublishGeneratedDraftResponse> {
  return apiRequest<PublishGeneratedDraftResponse>(`/api/drafts/${id}/publish`, {
    method: 'POST',
  });
}

export async function scheduleGeneratedDraftRequest(
  id: number,
  input: { scheduledAt: string | null },
): Promise<ScheduleGeneratedDraftResponse> {
  return apiRequest<ScheduleGeneratedDraftResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function sendDraftToReviewRequest(id: number): Promise<SendDraftToReviewResponse> {
  return apiRequest<SendDraftToReviewResponse>(`/api/drafts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'review' }),
  });
}

interface ReviewMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  reviewStatus: string | null;
}

interface PublishMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
  publishUrl: string | null;
  contractStatus: string | null;
}

interface ScheduleMutationState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string | null;
  error: string | null;
}

interface GeneratePageProps {
  generateAction?: (input: GenerateDraftsPayload) => Promise<GenerateDraftsResponse>;
  sendDraftToReviewAction?: (id: number) => Promise<SendDraftToReviewResponse>;
  publishGeneratedDraftAction?: (id: number) => Promise<PublishGeneratedDraftResponse>;
  scheduleGeneratedDraftAction?: (
    id: number,
    input: { scheduledAt: string | null },
  ) => Promise<ScheduleGeneratedDraftResponse>;
  stateOverride?: AsyncState<GenerateDraftsResponse>;
  projectIdDraft?: string;
  onProjectIdDraftChange?: (value: string) => void;
}

function createIdleReviewMutationState(): ReviewMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
    reviewStatus: null,
  };
}

function createIdlePublishMutationState(): PublishMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
    publishUrl: null,
    contractStatus: null,
  };
}

function createIdleScheduleMutationState(): ScheduleMutationState {
  return {
    status: 'idle',
    message: null,
    error: null,
  };
}

function normalizeScheduledAtInput(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

function createScheduleSuccessState(scheduledAt: string | null): ScheduleMutationState {
  return {
    status: 'success',
    message: scheduledAt ? '排程已保存' : '排程已清空',
    error: null,
  };
}

export function GeneratePage({
  generateAction = generateDraftsRequest,
  sendDraftToReviewAction = sendDraftToReviewRequest,
  publishGeneratedDraftAction = publishGeneratedDraftRequest,
  scheduleGeneratedDraftAction = scheduleGeneratedDraftRequest,
  stateOverride,
  projectIdDraft,
  onProjectIdDraftChange,
}: GeneratePageProps) {
  const [topic, setTopic] = useState('We added a cheaper Claude-compatible endpoint for Australian customers.');
  const [localProjectIdDraft, setLocalProjectIdDraft] = useState('');
  const activeProjectIdDraft = projectIdDraft ?? localProjectIdDraft;
  const projectId = parseProjectId(activeProjectIdDraft);
  const projectIdValidationError = getProjectIdValidationError(activeProjectIdDraft);
  const [tone, setTone] = useState<(typeof toneOptions)[number]['value']>('professional');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(defaultLaunchPlatforms);
  const [reviewStateByDraftId, setReviewStateByDraftId] = useState<Record<number, ReviewMutationState>>({});
  const [publishStateByDraftId, setPublishStateByDraftId] = useState<Record<number, PublishMutationState>>({});
  const [scheduleStateByDraftId, setScheduleStateByDraftId] = useState<Record<number, ScheduleMutationState>>({});
  const [scheduledAtByDraftId, setScheduledAtByDraftId] = useState<Record<number, string>>({});
  const [draftStatusById, setDraftStatusById] = useState<Record<number, string>>({});
  const [generationProgressStep, setGenerationProgressStep] = useState(0);
  const { state, run } = useAsyncAction(generateAction);

  const displayState = stateOverride ?? state;
  const generateControlsDisabled = displayState.status === 'loading' || projectIdValidationError !== null;
  const hasGeneratedResults =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as GenerateDraftsResponse).results);
  const activeGenerationProgressStage = generationProgressStages[generationProgressStep] ?? generationProgressStages[0];

  useEffect(() => {
    if (displayState.status !== 'success' || !displayState.data) {
      return;
    }

    setReviewStateByDraftId({});
    setPublishStateByDraftId({});
    setScheduleStateByDraftId({});
    setScheduledAtByDraftId({});
    setDraftStatusById({});
  }, [displayState]);

  useEffect(() => {
    if (displayState.status !== 'loading') {
      setGenerationProgressStep(0);
      return;
    }

    setGenerationProgressStep(0);
    const timers = generationProgressStages.slice(1).map((_, index) =>
      setTimeout(() => {
        setGenerationProgressStep(index + 1);
      }, (index + 1) * 1200),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [displayState.status]);

  function togglePlatform(platformValue: string) {
    setSelectedPlatforms((currentPlatforms) =>
      currentPlatforms.includes(platformValue)
        ? currentPlatforms.filter((value) => value !== platformValue)
        : [...currentPlatforms, platformValue],
    );
  }

  function handleGenerate(saveAsDraft: boolean) {
    if (projectIdValidationError) {
      return;
    }

    void run({
      topic,
      tone,
      platforms: selectedPlatforms,
      saveAsDraft,
      ...(projectId === undefined ? {} : { projectId }),
    });
  }

  function getReviewState(draftId: number): ReviewMutationState {
    return reviewStateByDraftId[draftId] ?? createIdleReviewMutationState();
  }

  function getPublishState(draftId: number): PublishMutationState {
    return publishStateByDraftId[draftId] ?? createIdlePublishMutationState();
  }

  function getScheduleState(draftId: number): ScheduleMutationState {
    return scheduleStateByDraftId[draftId] ?? createIdleScheduleMutationState();
  }

  function getScheduledAtValue(draftId: number) {
    return scheduledAtByDraftId[draftId] ?? '';
  }

  function getDisplayedDraftStatus(draftId: number) {
    return draftStatusById[draftId] ?? getReviewState(draftId).reviewStatus ?? 'draft';
  }

  function updateScheduledAtDraftInput(draftId: number, value: string) {
    setScheduledAtByDraftId((currentState) => ({
      ...currentState,
      [draftId]: value,
    }));
    setScheduleStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: createIdleScheduleMutationState(),
    }));
  }

  async function handleSendDraftToReview(draftId: number) {
    setReviewStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        reviewStatus: null,
      },
    }));

    try {
      const result = await sendDraftToReviewAction(draftId);

      setReviewStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'success',
          message: '已送审',
          error: null,
          reviewStatus: result.draft.status,
        },
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: result.draft.status,
      }));
    } catch (error) {
      setReviewStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
          reviewStatus: null,
        },
      }));
    }
  }

  async function handlePublishGeneratedDraft(draftId: number, draftTitle: string) {
    setPublishStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
        publishUrl: null,
        contractStatus: null,
      },
    }));

    try {
      const result = await publishGeneratedDraftAction(draftId);
      const publishSucceeded = result.success || result.status === 'manual_required' || result.status === 'queued';
      const nextStatus = result.status ?? (result.success ? 'published' : 'failed');

      setPublishStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: publishSucceeded ? 'success' : 'error',
          message: result.success
            ? result.message
            : result.status === 'queued'
              ? `已入队等待发布：${draftTitle}`
              : result.status === 'manual_required'
                ? `已转入人工接管：${draftTitle}`
                : null,
          error: publishSucceeded ? null : result.message,
          publishUrl: result.publishUrl,
          contractStatus: nextStatus,
        },
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: nextStatus,
      }));
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      setPublishStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: errorMessage,
          publishUrl: null,
          contractStatus: 'failed',
        },
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: 'failed',
      }));
    }
  }

  async function handleScheduleGeneratedDraft(draftId: number) {
    const scheduledAt = normalizeScheduledAtInput(getScheduledAtValue(draftId));

    setScheduleStateByDraftId((currentState) => ({
      ...currentState,
      [draftId]: {
        status: 'loading',
        message: null,
        error: null,
      },
    }));

    try {
      const result = await scheduleGeneratedDraftAction(draftId, { scheduledAt });
      const resultScheduledAt = result.draft.scheduledAt ?? null;

      setScheduledAtByDraftId((currentState) => ({
        ...currentState,
        [draftId]: resultScheduledAt ?? '',
      }));
      setScheduleStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: createScheduleSuccessState(resultScheduledAt),
      }));
      setDraftStatusById((currentState) => ({
        ...currentState,
        [draftId]: result.draft.status,
      }));
    } catch (error) {
      setScheduleStateByDraftId((currentState) => ({
        ...currentState,
        [draftId]: {
          status: 'error',
          message: null,
          error: getErrorMessage(error),
        },
      }));
    }
  }

  return (
    <section>
      <header style={{ marginBottom: '24px' }}>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>Content Studio</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>Generate Center</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px' }}>
          从一个话题同时生成多平台草稿，并为审核与定时发布留出空间。
        </p>
      </header>

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
        <section
          style={{
            borderRadius: '20px',
            background: '#ffffff',
            padding: '24px',
            border: '1px solid #dbe4f0',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>话题输入</h3>
          <label style={{ display: 'grid', gap: '10px' }}>
            <span style={{ fontWeight: 700 }}>输入原始话题、功能更新或竞品动态</span>
            <textarea
              rows={8}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              style={{
                width: '100%',
                borderRadius: '14px',
                border: '1px solid #cbd5e1',
                padding: '14px',
                font: 'inherit',
                resize: 'vertical',
              }}
            />
          </label>

          <label style={{ marginTop: '18px', display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>项目 ID（可选）</span>
            <input
              value={activeProjectIdDraft}
              onChange={(event) => {
                if (projectIdDraft === undefined) {
                  setLocalProjectIdDraft(event.target.value);
                }
                onProjectIdDraftChange?.(event.target.value);
              }}
              placeholder="例如 12"
              style={projectInputStyle}
            />
          </label>
          {projectIdValidationError ? (
            <div style={{ marginTop: '8px', color: '#b91c1c', fontWeight: 700 }}>{projectIdValidationError}</div>
          ) : null}

          <div style={{ marginTop: '18px', display: 'grid', gap: '10px' }}>
            <div style={{ fontWeight: 700 }}>语气</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {toneOptions.map((toneOption) => (
                <button
                  key={toneOption.value}
                  type="button"
                  onClick={() => setTone(toneOption.value)}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid #cbd5e1',
                    background: tone === toneOption.value ? '#dbeafe' : '#f8fafc',
                    color: '#1e3a8a',
                    padding: '8px 12px',
                  }}
                >
                  {toneOption.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section
          style={{
            borderRadius: '20px',
            background: '#ffffff',
            padding: '24px',
            border: '1px solid #dbe4f0',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>选择渠道</h3>
          <p style={{ margin: '0 0 16px', color: '#475569', lineHeight: 1.6 }}>
            当前开放首发可用和人工接管平台生成文案；生成并不等于自动发布，人工接管平台仍需后续手动完成发布。
          </p>
          <div style={{ display: 'grid', gap: '10px' }}>
            {platformOptions.map((platform) => (
              <label
                key={platform.value}
                data-generate-platform={platform.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderRadius: '12px',
                  border: '1px solid #dbe4f0',
                  padding: '10px 12px',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform.value)}
                  disabled={platform.launchStatus === 'later'}
                  onChange={() => togglePlatform(platform.value)}
                />
                <span style={{ fontWeight: 600 }}>{platform.label}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    borderRadius: '999px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    background:
                      platform.launchStatus === 'ready'
                        ? '#dcfce7'
                        : platform.launchStatus === 'manual'
                          ? '#fef3c7'
                          : '#e2e8f0',
                    color:
                      platform.launchStatus === 'ready'
                        ? '#166534'
                        : platform.launchStatus === 'manual'
                          ? '#92400e'
                          : '#475569',
                  }}
                >
                  {platform.launchBadge}
                </span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={generateControlsDisabled}
              style={{
                border: 'none',
                borderRadius: '12px',
                background: '#2563eb',
                color: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
              }}
            >
              {displayState.status === 'loading' ? '正在生成草稿...' : '一键生成'}
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(true)}
              disabled={generateControlsDisabled}
              style={{
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
              }}
            >
              保存为草稿
            </button>
          </div>
        </section>
      </div>

      <SectionCard title="生成结果" description="生成结果将在这里出现，并按平台拆分为可编辑卡片。">
        {displayState.status === 'idle' ? (
          <p style={{ margin: 0, color: '#475569' }}>生成结果将在这里出现，并按平台拆分为可编辑卡片。</p>
        ) : null}

        {displayState.status === 'loading' ? (
          <div
            style={{
              display: 'grid',
              gap: '12px',
              borderRadius: '18px',
              border: '1px solid #bfdbfe',
              background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#1d4ed8', fontWeight: 700 }}>生成进行中</div>
                <div style={{ marginTop: '4px', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  {activeGenerationProgressStage.title}
                </div>
              </div>
              <div
                style={{
                  borderRadius: '999px',
                  background: '#dbeafe',
                  color: '#1d4ed8',
                  fontWeight: 700,
                  padding: '6px 10px',
                  whiteSpace: 'nowrap',
                }}
              >
                {generationProgressStep + 1}/{generationProgressStages.length}
              </div>
            </div>
            <p style={{ margin: 0, color: '#334155', lineHeight: 1.6 }}>{activeGenerationProgressStage.description}</p>
            <div style={{ display: 'grid', gap: '8px' }}>
              {generationProgressStages.map((stage, index) => {
                const stageStatus =
                  index < generationProgressStep ? '已完成' : index === generationProgressStep ? '进行中' : '待执行';

                return (
                  <div
                    key={stage.title}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      alignItems: 'center',
                      borderRadius: '12px',
                      border: '1px solid #dbe4f0',
                      background: index === generationProgressStep ? '#ffffff' : '#f8fafc',
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{stage.title}</div>
                    <div
                      style={{
                        color: index <= generationProgressStep ? '#2563eb' : '#64748b',
                        fontWeight: 700,
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stageStatus}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>生成失败：{displayState.error}</p>
        ) : null}

        {hasGeneratedResults ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>
              已返回 {(displayState.data as GenerateDraftsResponse).results.length} 条生成结果
            </div>
            {(displayState.data as GenerateDraftsResponse).results.map((result, index) => (
              (() => {
                const reviewState = result.draftId !== undefined ? getReviewState(result.draftId) : null;
                const publishState = result.draftId !== undefined ? getPublishState(result.draftId) : null;
                const scheduleState = result.draftId !== undefined ? getScheduleState(result.draftId) : null;
                const scheduledAt = result.draftId !== undefined ? getScheduledAtValue(result.draftId) : '';
                const displayedDraftStatus = result.draftId !== undefined ? getDisplayedDraftStatus(result.draftId) : null;
                const reviewActionDisabled =
                  reviewState !== null &&
                  (reviewState.status === 'loading' || displayedDraftStatus !== 'draft');
                const publishActionDisabled =
                  publishState !== null &&
                  (publishState.status === 'loading' || displayedDraftStatus !== 'draft');
                const draftTitle = result.title ?? `${result.platform} draft #${result.draftId}`;

                return (
                  <article
                    key={`${result.platform}-${index}`}
                    style={{
                      borderRadius: '16px',
                      border: '1px solid #dbe4f0',
                      background: '#f8fafc',
                      padding: '16px',
                    }}
                  >
                    <div style={{ fontSize: '13px', color: '#2563eb', textTransform: 'uppercase' }}>{result.platform}</div>
                    <div style={{ marginTop: '8px', fontWeight: 700 }}>{result.title ?? 'Untitled draft'}</div>
                    <p style={{ margin: '8px 0 0', color: '#475569', lineHeight: 1.5 }}>{result.content}</p>
                    <div style={{ marginTop: '8px', color: '#64748b' }}>
                      Hashtags: {result.hashtags.length > 0 ? result.hashtags.join(', ') : 'None'}
                    </div>
                    {result.draftId !== undefined ? (
                      <>
                        <div style={{ marginTop: '6px', color: '#64748b' }}>draftId: {result.draftId}</div>
                        <div style={{ marginTop: '6px', color: '#64748b' }}>status: {displayedDraftStatus}</div>
                        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
                          <button
                            data-publish-draft-id={String(result.draftId)}
                            type="button"
                            onClick={() => {
                              void handlePublishGeneratedDraft(result.draftId as number, draftTitle);
                            }}
                            disabled={publishActionDisabled}
                            style={{
                              width: 'fit-content',
                              borderRadius: '10px',
                              border: 'none',
                              background: '#2563eb',
                              color: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {publishState?.status === 'loading' ? '正在发布...' : '立即发布'}
                          </button>
                          {publishState?.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {publishState.message}
                              {publishState.contractStatus ? `，当前状态：${publishState.contractStatus}` : ''}
                              {publishState.publishUrl ? `，发布链接：${publishState.publishUrl}` : ''}
                            </div>
                          ) : null}
                          {publishState?.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                              发布失败：{publishState.error}
                            </div>
                          ) : null}
                          <label style={{ display: 'grid', gap: '6px', maxWidth: '360px' }}>
                            <span style={{ fontWeight: 700 }}>排程时间</span>
                            <input
                              data-generate-scheduled-at-id={String(result.draftId)}
                              value={scheduledAt}
                              onChange={(event) =>
                                updateScheduledAtDraftInput(result.draftId as number, event.target.value)
                              }
                              placeholder="2026-04-20T09:30:00.000Z"
                              style={{
                                borderRadius: '10px',
                                border: '1px solid #cbd5e1',
                                padding: '10px 12px',
                                font: 'inherit',
                                background: '#ffffff',
                              }}
                            />
                          </label>
                          <button
                            data-schedule-draft-id={String(result.draftId)}
                            type="button"
                            onClick={() => {
                              void handleScheduleGeneratedDraft(result.draftId as number);
                            }}
                            disabled={scheduleState?.status === 'loading'}
                            style={{
                              width: 'fit-content',
                              borderRadius: '10px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {scheduleState?.status === 'loading' ? '正在推入排程...' : '推入排程'}
                          </button>
                          {scheduleState?.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {scheduleState.message}
                              {scheduledAt ? `，计划发布时间：${scheduledAt}` : ''}
                            </div>
                          ) : null}
                          {scheduleState?.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                              排程保存失败：{scheduleState.error}
                              {scheduledAt ? `。待保存时间：${scheduledAt}` : '。待保存操作：清空排程'}
                            </div>
                          ) : null}
                          <button
                            data-review-draft-id={String(result.draftId)}
                            type="button"
                            onClick={() => {
                              void handleSendDraftToReview(result.draftId as number);
                            }}
                            disabled={reviewActionDisabled}
                            style={{
                              width: 'fit-content',
                              borderRadius: '10px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              padding: '10px 14px',
                              fontWeight: 700,
                            }}
                          >
                            {reviewState?.status === 'loading'
                              ? '正在送审...'
                              : displayedDraftStatus === 'review'
                                ? '已送审'
                                : '送审'}
                          </button>
                          {reviewState?.status === 'success' ? (
                            <div style={{ color: '#166534', fontWeight: 700 }}>
                              {reviewState.message}
                              {reviewState.reviewStatus ? `，当前状态：${reviewState.reviewStatus}` : ''}
                            </div>
                          ) : null}
                          {reviewState?.status === 'error' ? (
                            <div style={{ color: '#b91c1c', fontWeight: 700 }}>送审失败：{reviewState.error}</div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </article>
                );
              })()
            ))}
          </div>
        ) : null}
      </SectionCard>
    </section>
  );
}
