import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction } from '../hooks/useAsyncRequest';
import { SectionCard } from '../components/SectionCard';

interface PlatformOption {
  label: string;
  value: string;
}

const platformOptions: PlatformOption[] = [
  { label: 'X / Twitter', value: 'x' },
  { label: 'Reddit', value: 'reddit' },
  { label: 'Facebook Group', value: 'facebook-group' },
  { label: '小红书', value: 'xiaohongshu' },
  { label: '微博', value: 'weibo' },
  { label: 'Blog', value: 'blog' },
];

const toneOptions = [
  { label: '专业', value: 'professional' },
  { label: '轻松', value: 'casual' },
  { label: '激动人心', value: 'exciting' },
] as const;

export interface GenerateDraftsPayload {
  topic: string;
  tone: string;
  platforms: string[];
  saveAsDraft?: boolean;
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

export async function generateDraftsRequest(input: GenerateDraftsPayload): Promise<GenerateDraftsResponse> {
  return apiRequest<GenerateDraftsResponse>('/api/content/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

interface GeneratePageProps {
  generateAction?: (input: GenerateDraftsPayload) => Promise<GenerateDraftsResponse>;
  stateOverride?: AsyncState<GenerateDraftsResponse>;
}

export function GeneratePage({ generateAction = generateDraftsRequest, stateOverride }: GeneratePageProps) {
  const [topic, setTopic] = useState('We added a cheaper Claude-compatible endpoint for Australian customers.');
  const [tone, setTone] = useState<(typeof toneOptions)[number]['value']>('professional');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(platformOptions.map((platform) => platform.value));
  const { state, run } = useAsyncAction(generateAction);

  const displayState = stateOverride ?? state;

  function togglePlatform(platformValue: string) {
    setSelectedPlatforms((currentPlatforms) =>
      currentPlatforms.includes(platformValue)
        ? currentPlatforms.filter((value) => value !== platformValue)
        : [...currentPlatforms, platformValue],
    );
  }

  function handleGenerate(saveAsDraft: boolean) {
    void run({
      topic,
      tone,
      platforms: selectedPlatforms,
      saveAsDraft,
    });
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
          <div style={{ display: 'grid', gap: '10px' }}>
            {platformOptions.map((platform) => (
              <label
                key={platform.value}
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
                  onChange={() => togglePlatform(platform.value)}
                />
                <span>{platform.label}</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
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
          <p style={{ margin: 0, color: '#334155' }}>正在生成草稿...</p>
        ) : null}

        {displayState.status === 'error' ? (
          <p style={{ margin: 0, color: '#b91c1c' }}>生成失败：{displayState.error}</p>
        ) : null}

        {displayState.status === 'success' && displayState.data ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>已返回 {displayState.data.results.length} 条生成结果</div>
            {displayState.data.results.map((result, index) => (
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
                {result.draftId !== undefined ? <div style={{ marginTop: '6px', color: '#64748b' }}>draftId: {result.draftId}</div> : null}
              </article>
            ))}
          </div>
        ) : null}
      </SectionCard>
    </section>
  );
}
