import { useState } from 'react';
import { loadDiscoveryRequest, type DiscoveryItem, type DiscoveryResponse } from '../lib/discovery';
import { apiRequest, getErrorMessage } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';
import {
  generateDraftsRequest,
  type GenerateDraftsPayload,
  type GenerateDraftsResponse,
} from './Generate';

interface DiscoveryPageProps {
  loadDiscoveryAction?: (projectId?: number) => Promise<DiscoveryResponse>;
  generateAction?: (input: GenerateDraftsPayload) => Promise<GenerateDraftsResponse>;
  stateOverride?: AsyncState<DiscoveryResponse>;
}

interface DiscoveryDraftState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: GenerateDraftsResponse;
  error?: string | null;
}

function createIdleDraftState(): DiscoveryDraftState {
  return {
    status: 'idle',
    error: null,
  };
}

function buildDraftTopic(item: DiscoveryItem) {
  return [item.title, item.summary].filter((value) => value.trim().length > 0).join('\n\n');
}

function resolveDraftPlatform(source: string) {
  const normalizedSource = source.trim().toLowerCase();

  if (normalizedSource.includes('reddit')) {
    return 'reddit';
  }

  if (normalizedSource === 'x' || normalizedSource.includes('twitter')) {
    return 'x';
  }

  if (normalizedSource.includes('facebook')) {
    return 'facebook-group';
  }

  if (normalizedSource.includes('xiaohongshu') || source.includes('小红书')) {
    return 'xiaohongshu';
  }

  if (normalizedSource.includes('weibo') || source.includes('微博')) {
    return 'weibo';
  }

  return 'blog';
}

function parseProjectId(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return undefined;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function buildProjectScopedPath(path: string, projectId?: number) {
  return projectId === undefined ? path : `${path}?projectId=${projectId}`;
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

export async function loadDiscoveryPageRequest(projectId?: number): Promise<DiscoveryResponse> {
  if (projectId === undefined) {
    return loadDiscoveryRequest();
  }

  return apiRequest<DiscoveryResponse>(buildProjectScopedPath('/api/discovery', projectId));
}

export function DiscoveryPage({
  loadDiscoveryAction = loadDiscoveryPageRequest,
  generateAction = generateDraftsRequest,
  stateOverride,
}: DiscoveryPageProps) {
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const projectId = parseProjectId(projectIdDraft);
  const { state } = useAsyncQuery(
    () => (projectId === undefined ? loadDiscoveryAction() : loadDiscoveryAction(projectId)),
    [loadDiscoveryAction, projectId],
  );
  const [draftStateByItemId, setDraftStateByItemId] = useState<Record<string, DiscoveryDraftState>>({});
  const displayState = stateOverride ?? state;
  const fallbackData: DiscoveryResponse = {
    items: [
      {
        id: 'preview-1',
        source: 'Reddit',
        title: 'AI 短视频脚本切题',
        summary: '近 24 小时讨论增长明显，适合做教程向内容。',
        status: 'new',
        score: 92,
        createdAt: 'preview',
      },
    ],
    total: 1,
    stats: {
      sources: 1,
      averageScore: 92,
    },
  };
  const viewData = displayState.status === 'success' && displayState.data ? displayState.data : fallbackData;

  function getDraftState(itemId: string | number) {
    return draftStateByItemId[String(itemId)] ?? createIdleDraftState();
  }

  async function handleGenerateDraft(item: DiscoveryItem) {
    const itemKey = String(item.id);

    setDraftStateByItemId((currentState) => ({
      ...currentState,
      [itemKey]: {
        status: 'loading',
        error: null,
      },
    }));

    try {
      const result = await generateAction({
        topic: buildDraftTopic(item),
        tone: 'professional',
        platforms: [resolveDraftPlatform(item.source)],
        saveAsDraft: true,
      });

      setDraftStateByItemId((currentState) => ({
        ...currentState,
        [itemKey]: {
          status: 'success',
          data: result,
          error: null,
        },
      }));
    } catch (error) {
      setDraftStateByItemId((currentState) => ({
        ...currentState,
        [itemKey]: {
          status: 'error',
          error: getErrorMessage(error),
        },
      }));
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Signals"
        title="Discovery Pool"
        description="发现池会汇总趋势、竞品动态和候选选题，并把不同来源统一成一套可操作条目。"
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

      {displayState.status === 'loading' ? <p style={{ color: '#334155' }}>正在加载发现池...</p> : null}
      {displayState.status === 'error' ? <p style={{ color: '#b91c1c' }}>发现池加载失败：{displayState.error}</p> : null}

      {displayState.status === 'success' || displayState.status === 'idle' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <StatCard label="候选条目" value={String(viewData.total)} detail="当前统一发现池中的条目数" />
            <StatCard
              label="数据源"
              value={String(viewData.stats.sources)}
              detail="聚合后的来源渠道数"
            />
            <StatCard
              label="平均评分"
              value={viewData.stats.averageScore === null ? 'N/A' : String(viewData.stats.averageScore)}
              detail="基于发现池数据估算的平均优先级"
            />
          </div>

          <div style={{ marginTop: '20px', display: 'grid', gap: '16px' }}>
            {viewData.items.map((item) => {
              const draftState = getDraftState(item.id);

              return (
                <SectionCard
                  key={item.id}
                  title={item.title}
                  description={`${item.source} · ${item.status} · ${item.createdAt ?? 'unknown'}`}
                >
                  <div style={{ display: 'grid', gap: '16px' }}>
                    <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{item.summary}</p>

                    <div style={{ display: 'grid', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <ActionButton
                          label={draftState.status === 'loading' ? '正在生成草稿...' : '生成草稿'}
                          tone="primary"
                          onClick={() => {
                            void handleGenerateDraft(item);
                          }}
                        />
                      </div>

                      {draftState.status === 'success' && draftState.data ? (
                        <div
                          style={{
                            display: 'grid',
                            gap: '8px',
                            borderRadius: '14px',
                            border: '1px solid #bfdbfe',
                            background: '#eff6ff',
                            padding: '14px',
                          }}
                        >
                          <div style={{ color: '#1d4ed8', fontWeight: 700 }}>草稿已生成</div>
                          {draftState.data.results.map((result, index) => (
                            <div key={`${result.platform}-${result.draftId ?? index}`} style={{ color: '#1e3a8a' }}>
                              draftId: {result.draftId ?? '未保存'} · platform: {result.platform}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {draftState.status === 'error' ? (
                        <p style={{ margin: 0, color: '#b91c1c' }}>草稿生成失败：{draftState.error}</p>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
