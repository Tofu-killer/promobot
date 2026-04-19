import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction } from '../hooks/useAsyncRequest';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface CreateProjectPayload {
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
}

export interface CreateProjectResponse {
  project: CreateProjectPayload & {
    id: number;
  };
}

export async function createProjectRequest(input: CreateProjectPayload): Promise<CreateProjectResponse> {
  return apiRequest<CreateProjectResponse>('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

interface ProjectsPageProps {
  createProjectAction?: (input: CreateProjectPayload) => Promise<CreateProjectResponse>;
  stateOverride?: AsyncState<CreateProjectResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export function ProjectsPage({ createProjectAction = createProjectRequest, stateOverride }: ProjectsPageProps) {
  const [name, setName] = useState('Acme Launch');
  const [siteName, setSiteName] = useState('Acme');
  const [siteUrl, setSiteUrl] = useState('https://acme.test');
  const [siteDescription, setSiteDescription] = useState('Launch week campaign');
  const [sellingPoints, setSellingPoints] = useState('Cheap, Fast');
  const { state, run } = useAsyncAction(createProjectAction);

  const displayState = stateOverride ?? state;

  function handleCreateProject() {
    void run({
      name,
      siteName,
      siteUrl,
      siteDescription,
      sellingPoints: sellingPoints
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    });
  }

  return (
    <section>
      <PageHeader
        eyebrow="Project Context"
        title="Projects"
        description="这里会管理不同品牌或站点的上下文、卖点、语气模板与渠道绑定。现在直接调用真实 API 创建项目并回显返回结果。"
      />

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1fr) minmax(280px, 0.9fr)' }}>
        <SectionCard title="创建项目" description="提交最小项目信息后，页面会显示 `/api/projects` 的返回数据。">
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>项目名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>站点名</span>
              <input value={siteName} onChange={(event) => setSiteName(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>站点 URL</span>
              <input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>站点描述</span>
              <textarea
                rows={4}
                value={siteDescription}
                onChange={(event) => setSiteDescription(event.target.value)}
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>卖点</span>
              <input
                value={sellingPoints}
                onChange={(event) => setSellingPoints(event.target.value)}
                style={fieldStyle}
              />
            </label>

            <button
              type="button"
              onClick={handleCreateProject}
              style={{
                border: 'none',
                borderRadius: '12px',
                background: '#2563eb',
                color: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
                justifySelf: 'flex-start',
              }}
            >
              {displayState.status === 'loading' ? '正在创建项目...' : '创建项目'}
            </button>
          </div>
        </SectionCard>

        <SectionCard title="最近创建结果" description="加载、错误和成功状态都在这里落地。">
          {displayState.status === 'loading' ? (
            <p style={{ margin: 0, color: '#334155' }}>正在创建项目...</p>
          ) : null}

          {displayState.status === 'error' ? (
            <p style={{ margin: 0, color: '#b91c1c' }}>创建失败：{displayState.error}</p>
          ) : null}

          {displayState.status === 'success' && displayState.data ? (
            <div style={{ display: 'grid', gap: '10px', color: '#334155' }}>
              <div>
                <strong>项目：</strong>
                {displayState.data.project.name}
              </div>
              <div>
                <strong>站点：</strong>
                {displayState.data.project.siteName}
              </div>
              <div>
                <strong>URL：</strong>
                {displayState.data.project.siteUrl}
              </div>
              <div>
                <strong>描述：</strong>
                {displayState.data.project.siteDescription}
              </div>
              <div>
                <strong>卖点：</strong>
                {displayState.data.project.sellingPoints.join(', ')}
              </div>
            </div>
          ) : null}

          {displayState.status === 'idle' ? (
            <p style={{ margin: 0, color: '#475569' }}>提交表单后，这里会显示服务器返回的 project 数据。</p>
          ) : null}
        </SectionCard>
      </div>
    </section>
  );
}
