import { useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface ProjectRecord {
  id: number;
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
  createdAt?: string;
}

export interface ProjectsResponse {
  projects: ProjectRecord[];
}

export interface CreateProjectPayload {
  name: string;
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  sellingPoints: string[];
}

export interface CreateProjectResponse {
  project: ProjectRecord;
}

export interface UpdateProjectPayload {
  name?: string;
  siteDescription?: string;
  sellingPoints?: string[];
}

export interface UpdateProjectResponse {
  project: ProjectRecord;
}

export async function loadProjectsRequest(): Promise<ProjectsResponse> {
  return apiRequest<ProjectsResponse>('/api/projects');
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

export async function updateProjectRequest(
  id: number,
  input: UpdateProjectPayload,
): Promise<UpdateProjectResponse> {
  return apiRequest<UpdateProjectResponse>(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

interface ProjectFormValue {
  name: string;
  siteDescription: string;
  sellingPoints: string;
}

interface ProjectsPageProps {
  loadProjectsAction?: () => Promise<ProjectsResponse>;
  createProjectAction?: (input: CreateProjectPayload) => Promise<CreateProjectResponse>;
  updateProjectAction?: (id: number, input: UpdateProjectPayload) => Promise<UpdateProjectResponse>;
  stateOverride?: AsyncState<CreateProjectResponse>;
  projectsStateOverride?: AsyncState<ProjectsResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export function ProjectsPage({
  loadProjectsAction = loadProjectsRequest,
  createProjectAction = createProjectRequest,
  updateProjectAction = updateProjectRequest,
  stateOverride,
  projectsStateOverride,
}: ProjectsPageProps) {
  const [name, setName] = useState('Acme Launch');
  const [siteName, setSiteName] = useState('Acme');
  const [siteUrl, setSiteUrl] = useState('https://acme.test');
  const [siteDescription, setSiteDescription] = useState('Launch week campaign');
  const [sellingPoints, setSellingPoints] = useState('Cheap, Fast');
  const { state, run } = useAsyncAction(createProjectAction);
  const { state: projectsState, reload } = useAsyncQuery(loadProjectsAction, [loadProjectsAction]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [projectForms, setProjectForms] = useState<Record<number, ProjectFormValue>>({});
  const displayState = stateOverride ?? state;
  const displayProjectsState = projectsStateOverride ?? projectsState;

  const projects = useMemo(() => {
    const loadedProjects =
      displayProjectsState.status === 'success' && displayProjectsState.data
        ? displayProjectsState.data.projects
        : [];
    const createdProject = displayState.status === 'success' && displayState.data ? displayState.data.project : null;

    if (createdProject && !loadedProjects.some((project) => project.id === createdProject.id)) {
      return [...loadedProjects, createdProject];
    }

    return loadedProjects;
  }, [displayProjectsState, displayState]);

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
    }).then(() => {
      reload();
    }).catch(() => undefined);
  }

  function getProjectForm(
    project: ProjectRecord,
    sourceForms: Record<number, ProjectFormValue> = projectForms,
  ): ProjectFormValue {
    return sourceForms[project.id] ?? {
      name: project.name,
      siteDescription: project.siteDescription,
      sellingPoints: project.sellingPoints.join(', '),
    };
  }

  function updateProjectForm(projectId: number, patch: Partial<ProjectFormValue>) {
    setProjectForms((currentForms) => ({
      ...currentForms,
      [projectId]: {
        ...getProjectForm(
          projects.find((project) => project.id === projectId) ?? {
            id: projectId,
            name: '',
            siteName: '',
            siteUrl: '',
            siteDescription: '',
            sellingPoints: [],
          },
          currentForms,
        ),
        ...patch,
      },
    }));
  }

  function handleSaveProject(projectId: number) {
    const form = getProjectForm(
      projects.find((project) => project.id === projectId) ?? {
        id: projectId,
        name: '',
        siteName: '',
        siteUrl: '',
        siteDescription: '',
        sellingPoints: [],
      },
    );

    void updateProjectAction(projectId, {
      name: form.name,
      siteDescription: form.siteDescription,
      sellingPoints: form.sellingPoints
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    }).then((result) => {
      setProjectForms((currentForms) => ({
        ...currentForms,
        [projectId]: {
          name: result.project.name,
          siteDescription: result.project.siteDescription,
          sellingPoints: result.project.sellingPoints.join(', '),
        },
      }));
      setSaveMessage('项目已保存');
      reload();
    }).catch(() => undefined);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Project Context"
        title="Projects"
        description="这里会管理不同品牌或站点的上下文、卖点、语气模板与渠道绑定。"
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

      <SectionCard title="项目列表" description="这里会展示真实项目列表，并支持最小字段编辑。">
        {displayProjectsState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载项目列表...</p> : null}
        {displayProjectsState.status === 'error' ? <p style={{ margin: 0, color: '#b91c1c' }}>项目列表加载失败：{displayProjectsState.error}</p> : null}
        {saveMessage ? <p style={{ margin: '0 0 12px', color: '#166534' }}>{saveMessage}</p> : null}

        {projects.length === 0 ? (
          <p style={{ margin: 0, color: '#475569' }}>暂无项目</p>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ fontWeight: 700 }}>已加载 {projects.length} 个项目</div>
            {projects.map((project) => {
              const form = getProjectForm(project);
              return (
                <article
                  key={project.id}
                  style={{
                    borderRadius: '16px',
                    border: '1px solid #dbe4f0',
                    background: '#f8fafc',
                    padding: '16px',
                    display: 'grid',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'grid', gap: '4px', color: '#334155' }}>
                    <div style={{ fontWeight: 700 }}>项目：{form.name}</div>
                    <div>{project.siteName}</div>
                    <div style={{ color: '#64748b', fontSize: '14px' }}>{project.siteUrl}</div>
                  </div>

                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontWeight: 700 }}>项目名</span>
                    <input
                      data-project-field={`name-${project.id}`}
                      name={`project-name-${project.id}`}
                      value={form.name}
                      onChange={(event) => updateProjectForm(project.id, { name: event.target.value })}
                      style={fieldStyle}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontWeight: 700 }}>站点描述</span>
                    <textarea
                      data-project-field={`description-${project.id}`}
                      name={`project-description-${project.id}`}
                      rows={3}
                      value={form.siteDescription}
                      onChange={(event) => updateProjectForm(project.id, { siteDescription: event.target.value })}
                      style={{ ...fieldStyle, resize: 'vertical' }}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontWeight: 700 }}>卖点</span>
                    <input
                      data-project-field={`selling-points-${project.id}`}
                      name={`project-selling-points-${project.id}`}
                      value={form.sellingPoints}
                      onChange={(event) => updateProjectForm(project.id, { sellingPoints: event.target.value })}
                      style={fieldStyle}
                    />
                  </label>

                  <button
                    type="button"
                    data-project-save-id={String(project.id)}
                    onClick={() => handleSaveProject(project.id)}
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
                    保存项目
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </section>
  );
}
