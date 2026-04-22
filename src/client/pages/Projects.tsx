import { useEffect, useMemo, useState } from 'react';
import { apiRequest, getErrorMessage } from '../lib/api';
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

export interface SourceConfigRecord {
  id: number;
  projectId: number;
  sourceType: string;
  platform: string;
  label: string;
  configJson: Record<string, unknown>;
  enabled: boolean;
  pollIntervalMinutes: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SourceConfigsResponse {
  sourceConfigs: SourceConfigRecord[];
}

interface SourceConfigsByProjectResponse {
  sourceConfigsByProject: Record<number, SourceConfigRecord[]>;
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

export interface CreateSourceConfigPayload {
  projectId: number;
  sourceType: string;
  platform: string;
  label: string;
  configJson: Record<string, unknown>;
  enabled: boolean;
  pollIntervalMinutes: number;
}

export interface CreateSourceConfigResponse {
  sourceConfig: SourceConfigRecord;
}

export interface UpdateSourceConfigPayload {
  projectId?: number;
  sourceType?: string;
  platform?: string;
  label?: string;
  configJson?: Record<string, unknown>;
  enabled?: boolean;
  pollIntervalMinutes?: number;
}

export interface UpdateSourceConfigResponse {
  sourceConfig: SourceConfigRecord;
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

export async function loadSourceConfigsRequest(projectId: number): Promise<SourceConfigsResponse> {
  return apiRequest<SourceConfigsResponse>(`/api/projects/${projectId}/source-configs`);
}

export async function createSourceConfigRequest(
  projectId: number,
  input: CreateSourceConfigPayload,
): Promise<CreateSourceConfigResponse> {
  return apiRequest<CreateSourceConfigResponse>(`/api/projects/${projectId}/source-configs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function updateSourceConfigRequest(
  projectId: number,
  sourceConfigId: number,
  input: UpdateSourceConfigPayload,
): Promise<UpdateSourceConfigResponse> {
  return apiRequest<UpdateSourceConfigResponse>(
    `/api/projects/${projectId}/source-configs/${sourceConfigId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );
}

interface ProjectFormValue {
  name: string;
  siteDescription: string;
  sellingPoints: string;
}

interface SourceConfigFormValue {
  sourceType: string;
  platform: string;
  label: string;
  configJson: string;
  enabled: boolean;
  pollIntervalMinutes: string;
}

interface ProjectsPageProps {
  loadProjectsAction?: () => Promise<ProjectsResponse>;
  createProjectAction?: (input: CreateProjectPayload) => Promise<CreateProjectResponse>;
  updateProjectAction?: (id: number, input: UpdateProjectPayload) => Promise<UpdateProjectResponse>;
  loadSourceConfigsAction?: (projectId: number) => Promise<SourceConfigsResponse>;
  createSourceConfigAction?: (
    projectId: number,
    input: CreateSourceConfigPayload,
  ) => Promise<CreateSourceConfigResponse>;
  updateSourceConfigAction?: (
    projectId: number,
    sourceConfigId: number,
    input: UpdateSourceConfigPayload,
  ) => Promise<UpdateSourceConfigResponse>;
  stateOverride?: AsyncState<CreateProjectResponse>;
  projectsStateOverride?: AsyncState<ProjectsResponse>;
  sourceConfigsStateOverride?: AsyncState<SourceConfigsByProjectResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

function mergeSourceConfigLists(currentList: SourceConfigRecord[], nextList: SourceConfigRecord[]) {
  const sourceConfigMap = new Map<number, SourceConfigRecord>();

  for (const sourceConfig of currentList) {
    sourceConfigMap.set(sourceConfig.id, sourceConfig);
  }

  for (const sourceConfig of nextList) {
    sourceConfigMap.set(sourceConfig.id, sourceConfig);
  }

  return [...sourceConfigMap.values()].sort((left, right) => left.id - right.id);
}

function mergeSourceConfigsByProject(
  currentMap: Record<number, SourceConfigRecord[]>,
  nextMap: Record<number, SourceConfigRecord[]>,
): Record<number, SourceConfigRecord[]> {
  const mergedMap: Record<number, SourceConfigRecord[]> = { ...currentMap };
  const projectIds = new Set([...Object.keys(currentMap), ...Object.keys(nextMap)]);

  for (const projectIdValue of projectIds) {
    const projectId = Number(projectIdValue);
    const currentList = currentMap[projectId] ?? [];
    const nextList = nextMap[projectId];

    mergedMap[projectId] = nextList ? mergeSourceConfigLists(currentList, nextList) : currentList;
  }

  return mergedMap;
}

async function loadSourceConfigsByProjectRequest(
  projects: ProjectRecord[],
  loadSourceConfigsAction: (projectId: number) => Promise<SourceConfigsResponse>,
): Promise<SourceConfigsByProjectResponse> {
  const entries = await Promise.all(
    projects.map(async (project) => [project.id, (await loadSourceConfigsAction(project.id)).sourceConfigs] as const),
  );

  return {
    sourceConfigsByProject: Object.fromEntries(entries) as Record<number, SourceConfigRecord[]>,
  };
}

export function ProjectsPage({
  loadProjectsAction = loadProjectsRequest,
  createProjectAction = createProjectRequest,
  updateProjectAction = updateProjectRequest,
  loadSourceConfigsAction = loadSourceConfigsRequest,
  createSourceConfigAction = createSourceConfigRequest,
  updateSourceConfigAction = updateSourceConfigRequest,
  stateOverride,
  projectsStateOverride,
  sourceConfigsStateOverride,
}: ProjectsPageProps) {
  const [name, setName] = useState('Acme Launch');
  const [siteName, setSiteName] = useState('Acme');
  const [siteUrl, setSiteUrl] = useState('https://acme.test');
  const [siteDescription, setSiteDescription] = useState('Launch week campaign');
  const [sellingPoints, setSellingPoints] = useState('Cheap, Fast');
  const { state, run } = useAsyncAction(createProjectAction);
  const { state: projectsState, reload } = useAsyncQuery(loadProjectsAction, [loadProjectsAction]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pendingProjectSaveId, setPendingProjectSaveId] = useState<number | null>(null);
  const [pendingSourceConfigCreateProjectId, setPendingSourceConfigCreateProjectId] = useState<number | null>(null);
  const [pendingSourceConfigSaveId, setPendingSourceConfigSaveId] = useState<number | null>(null);
  const [projectForms, setProjectForms] = useState<Record<number, ProjectFormValue>>({});
  const [sourceConfigsState, setSourceConfigsState] = useState<AsyncState<SourceConfigsByProjectResponse>>({
    status: 'idle',
    data: {
      sourceConfigsByProject: {},
    },
    error: null,
  });
  const [sourceConfigsByProject, setSourceConfigsByProject] = useState<Record<number, SourceConfigRecord[]>>({});
  const [sourceConfigForms, setSourceConfigForms] = useState<Record<string, SourceConfigFormValue>>({});
  const displayState = stateOverride ?? state;
  const displayProjectsState = projectsStateOverride ?? projectsState;
  const displaySourceConfigsState = sourceConfigsStateOverride ?? sourceConfigsState;
  const visibleSourceConfigsByProject = useMemo(
    () =>
      mergeSourceConfigsByProject(
        displaySourceConfigsState.data?.sourceConfigsByProject ?? {},
        sourceConfigsByProject,
      ),
    [displaySourceConfigsState.data, sourceConfigsByProject],
  );

  const loadedProjects = useMemo(
    () => displayProjectsState.data?.projects ?? [],
    [displayProjectsState],
  );

  const projects = useMemo(() => {
    const createdProject = displayState.status === 'success' && displayState.data ? displayState.data.project : null;

    if (createdProject && !loadedProjects.some((project) => project.id === createdProject.id)) {
      return [...loadedProjects, createdProject];
    }

    return loadedProjects;
  }, [displayState, loadedProjects]);

  const loadedProjectIdsKey = useMemo(
    () => loadedProjects.map((project) => String(project.id)).join(','),
    [loadedProjects],
  );

  useEffect(() => {
    let cancelled = false;

    setSourceConfigsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    if (loadedProjects.length === 0) {
      setSourceConfigsState({
        status: 'success',
        data: {
          sourceConfigsByProject: {},
        },
        error: null,
      });

      return () => {
        cancelled = true;
      };
    }

    void loadSourceConfigsByProjectRequest(loadedProjects, loadSourceConfigsAction)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setSourceConfigsState({
          status: 'success',
          data: {
            sourceConfigsByProject: result.sourceConfigsByProject,
          },
          error: null,
        });
        setSourceConfigsByProject(result.sourceConfigsByProject);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSourceConfigsState((current) => ({
          status: 'error',
          data: current.data,
          error: getErrorMessage(error),
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [loadProjectsAction, loadSourceConfigsAction, loadedProjectIdsKey, loadedProjects]);

  useEffect(() => {
    if (sourceConfigsStateOverride) {
      setSourceConfigsByProject(sourceConfigsStateOverride.data?.sourceConfigsByProject ?? {});
      return;
    }

    setSourceConfigsByProject(displaySourceConfigsState.data?.sourceConfigsByProject ?? {});
  }, [displaySourceConfigsState.data, sourceConfigsStateOverride]);

  function handleCreateProject() {
    setSaveMessage(null);
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

    setSaveMessage(null);
    setPendingProjectSaveId(projectId);
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

      return loadSourceConfigsAction(projectId)
        .then((reloaded) => {
          setProjectSourceConfigs(projectId, reloaded.sourceConfigs);
        })
        .catch(() => undefined);
    }).catch(() => undefined)
      .finally(() => {
        setPendingProjectSaveId((current) => (current === projectId ? null : current));
      });
  }

  function getSourceConfigFormValue(
    sourceConfig: SourceConfigRecord,
    currentForms: Record<string, SourceConfigFormValue> = sourceConfigForms,
  ) {
    const formKey = String(sourceConfig.id);
    return currentForms[formKey] ?? {
      sourceType: sourceConfig.sourceType,
      platform: sourceConfig.platform,
      label: sourceConfig.label,
      configJson: JSON.stringify(sourceConfig.configJson),
      enabled: sourceConfig.enabled,
      pollIntervalMinutes: String(sourceConfig.pollIntervalMinutes),
    };
  }

  function getNewSourceConfigForm(projectId: number) {
    const formKey = `new-${projectId}`;
    return sourceConfigForms[formKey] ?? {
      sourceType: 'keyword+reddit',
      platform: 'reddit',
      label: '',
      configJson: '{}',
      enabled: true,
      pollIntervalMinutes: '30',
    };
  }

  function updateSourceConfigForm(
    formKey: string,
    patch: Partial<SourceConfigFormValue>,
    baseFormValue?: SourceConfigFormValue,
  ) {
    setSourceConfigForms((current) => ({
      ...current,
      [formKey]: {
        ...(current[formKey] ??
          baseFormValue ?? {
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: '',
            configJson: '{}',
            enabled: true,
            pollIntervalMinutes: '30',
          }),
        ...patch,
      },
    }));
  }

  function parseSourceConfigJson(value: string) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  function setProjectSourceConfigs(projectId: number, nextSourceConfigs: SourceConfigRecord[]) {
    setSourceConfigsState((current) => ({
      status: 'success',
      data: {
        sourceConfigsByProject: {
          ...(current.data?.sourceConfigsByProject ?? {}),
          [projectId]: nextSourceConfigs,
        },
      },
      error: null,
    }));
    setSourceConfigsByProject((current) => ({
      ...current,
      [projectId]: nextSourceConfigs,
    }));
  }

  function handleCreateSourceConfig(projectId: number) {
    const form = getNewSourceConfigForm(projectId);

    setSaveMessage(null);
    setPendingSourceConfigCreateProjectId(projectId);
    void createSourceConfigAction(projectId, {
      projectId,
      sourceType: form.sourceType,
      platform: form.platform,
      label: form.label,
      configJson: parseSourceConfigJson(form.configJson),
      enabled: form.enabled,
      pollIntervalMinutes: Number(form.pollIntervalMinutes),
    })
      .then((result) => {
        const nextSourceConfigs = mergeSourceConfigLists(
          visibleSourceConfigsByProject[projectId] ?? [],
          [result.sourceConfig],
        );

        setProjectSourceConfigs(projectId, nextSourceConfigs);
        setSaveMessage('SourceConfig 已保存');

        return loadSourceConfigsAction(projectId)
          .then((reloaded) => {
            const mergedSourceConfigs = mergeSourceConfigLists(nextSourceConfigs, reloaded.sourceConfigs);
            setProjectSourceConfigs(projectId, mergedSourceConfigs);
            setSourceConfigsState((current) => ({
              status: 'success',
              data: {
                sourceConfigsByProject: {
                  ...(current.data?.sourceConfigsByProject ?? {}),
                  [projectId]: mergedSourceConfigs,
                },
              },
              error: null,
            }));
          })
          .catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        setPendingSourceConfigCreateProjectId((current) => (current === projectId ? null : current));
      });
  }

  function handleSaveSourceConfig(projectId: number, sourceConfigId: number) {
    const currentSourceConfigs = visibleSourceConfigsByProject[projectId] ?? [];
    const sourceConfig = currentSourceConfigs.find((item) => item.id === sourceConfigId);
    if (!sourceConfig) {
      return;
    }

    const form = getSourceConfigFormValue(sourceConfig);

    setSaveMessage(null);
    setPendingSourceConfigSaveId(sourceConfigId);
    void updateSourceConfigAction(projectId, sourceConfigId, {
      projectId,
      sourceType: form.sourceType,
      platform: form.platform,
      label: form.label,
      configJson: parseSourceConfigJson(form.configJson),
      enabled: form.enabled,
      pollIntervalMinutes: Number(form.pollIntervalMinutes),
    })
      .then((result) => {
        const nextSourceConfigs = mergeSourceConfigLists(
          (visibleSourceConfigsByProject[projectId] ?? []).filter((item) => item.id !== sourceConfigId),
          [result.sourceConfig],
        );

        setProjectSourceConfigs(projectId, nextSourceConfigs);
        setSourceConfigForms((current) => ({
          ...current,
          [String(sourceConfigId)]: {
            sourceType: result.sourceConfig.sourceType,
            platform: result.sourceConfig.platform,
            label: result.sourceConfig.label,
            configJson: JSON.stringify(result.sourceConfig.configJson),
            enabled: result.sourceConfig.enabled,
            pollIntervalMinutes: String(result.sourceConfig.pollIntervalMinutes),
          },
        }));
        setSourceConfigsState((current) => ({
          status: 'success',
          data: {
            sourceConfigsByProject: {
              ...(current.data?.sourceConfigsByProject ?? {}),
              [projectId]: nextSourceConfigs,
            },
          },
          error: null,
        }));
        setSaveMessage('SourceConfig 已保存');
      })
      .catch(() => undefined)
      .finally(() => {
        setPendingSourceConfigSaveId((current) => (current === sourceConfigId ? null : current));
      });
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
              disabled={displayState.status === 'loading'}
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

        {displayProjectsState.status === 'success' && projects.length === 0 ? (
          <p style={{ margin: 0, color: '#475569' }}>暂无项目</p>
        ) : projects.length > 0 ? (
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
                    disabled={pendingProjectSaveId === project.id}
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
                    {pendingProjectSaveId === project.id ? '正在保存项目...' : '保存项目'}
                  </button>

                  <SectionCard title="Source Configs" description="项目级监控源配置，驱动 monitor / inbox / reputation 抓取。">
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {displaySourceConfigsState.status === 'loading' ? (
                        <div style={{ color: '#334155' }}>正在加载 SourceConfig...</div>
                      ) : null}
                      {displaySourceConfigsState.status === 'error' ? (
                        <div style={{ color: '#b91c1c' }}>SourceConfig 加载失败：{displaySourceConfigsState.error}</div>
                      ) : null}

                      {displaySourceConfigsState.status === 'success' &&
                      (visibleSourceConfigsByProject[project.id] ?? []).length === 0 ? (
                        <div style={{ color: '#64748b' }}>暂无 SourceConfig</div>
                      ) : null}

                      {(visibleSourceConfigsByProject[project.id] ?? []).map((sourceConfig) => {
                        const form = getSourceConfigFormValue(sourceConfig);
                        return (
                          <div
                            key={sourceConfig.id}
                            style={{
                              borderRadius: '14px',
                              border: '1px solid #dbe4f0',
                              background: '#ffffff',
                              padding: '12px',
                              display: 'grid',
                              gap: '10px',
                            }}
                          >
                            <div style={{ display: 'grid', gap: '4px', color: '#334155' }}>
                              <div style={{ fontWeight: 700 }}>{form.label || `SourceConfig #${sourceConfig.id}`}</div>
                              <div style={{ color: '#64748b', fontSize: '14px' }}>
                                {form.platform} / {form.sourceType}
                              </div>
                              <div style={{ color: '#64748b', fontSize: '14px' }}>
                                {form.enabled ? 'Enabled' : 'Disabled'} / {form.pollIntervalMinutes} 分钟
                              </div>
                            </div>

                            <label style={{ display: 'grid', gap: '8px' }}>
                              <span style={{ fontWeight: 700 }}>Source Type</span>
                              <input
                                data-source-config-field={`source-type-${sourceConfig.id}`}
                                value={form.sourceType}
                                onChange={(event) =>
                                  updateSourceConfigForm(
                                    String(sourceConfig.id),
                                    { sourceType: event.target.value },
                                    form,
                                  )
                                }
                                style={fieldStyle}
                              />
                            </label>

                            <label style={{ display: 'grid', gap: '8px' }}>
                              <span style={{ fontWeight: 700 }}>Platform</span>
                              <input
                                data-source-config-field={`platform-${sourceConfig.id}`}
                                value={form.platform}
                                onChange={(event) =>
                                  updateSourceConfigForm(
                                    String(sourceConfig.id),
                                    { platform: event.target.value },
                                    form,
                                  )
                                }
                                style={fieldStyle}
                              />
                            </label>

                            <label style={{ display: 'grid', gap: '8px' }}>
                              <span style={{ fontWeight: 700 }}>Label</span>
                              <input
                                data-source-config-field={`label-${sourceConfig.id}`}
                                value={form.label}
                                onChange={(event) =>
                                  updateSourceConfigForm(String(sourceConfig.id), { label: event.target.value }, form)
                                }
                                style={fieldStyle}
                              />
                            </label>

                            <label style={{ display: 'grid', gap: '8px' }}>
                              <span style={{ fontWeight: 700 }}>Config JSON</span>
                              <textarea
                                data-source-config-field={`config-json-${sourceConfig.id}`}
                                rows={3}
                                value={form.configJson}
                                onChange={(event) =>
                                  updateSourceConfigForm(
                                    String(sourceConfig.id),
                                    { configJson: event.target.value },
                                    form,
                                  )
                                }
                                style={{ ...fieldStyle, resize: 'vertical' }}
                              />
                            </label>

                            <label style={{ display: 'grid', gap: '8px' }}>
                              <span style={{ fontWeight: 700 }}>Poll Minutes</span>
                              <input
                                data-source-config-field={`poll-${sourceConfig.id}`}
                                value={form.pollIntervalMinutes}
                                onChange={(event) =>
                                  updateSourceConfigForm(String(sourceConfig.id), {
                                    pollIntervalMinutes: event.target.value,
                                  }, form)
                                }
                                style={fieldStyle}
                              />
                            </label>

                            <label style={{ display: 'grid', gap: '8px' }}>
                              <span style={{ fontWeight: 700 }}>Enabled</span>
                              <input
                                data-source-config-field={`enabled-${sourceConfig.id}`}
                                value={form.enabled ? 'true' : 'false'}
                                onChange={(event) =>
                                  updateSourceConfigForm(String(sourceConfig.id), {
                                    enabled: event.target.value === 'true',
                                  }, form)
                                }
                                style={fieldStyle}
                              />
                            </label>

                            <button
                              type="button"
                              data-source-config-save-id={String(sourceConfig.id)}
                              onClick={() => handleSaveSourceConfig(project.id, sourceConfig.id)}
                              disabled={pendingSourceConfigSaveId === sourceConfig.id}
                              style={{
                                border: 'none',
                                borderRadius: '12px',
                                background: '#0f172a',
                                color: '#ffffff',
                                padding: '10px 14px',
                                fontWeight: 700,
                                justifySelf: 'flex-start',
                              }}
                            >
                              {pendingSourceConfigSaveId === sourceConfig.id
                                ? '正在保存 SourceConfig...'
                                : '保存 SourceConfig'}
                            </button>
                          </div>
                        );
                      })}

                      <div
                        style={{
                          borderRadius: '14px',
                          border: '1px dashed #cbd5e1',
                          background: '#ffffff',
                          padding: '12px',
                          display: 'grid',
                          gap: '10px',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>新建 Source Config</div>

                        <label style={{ display: 'grid', gap: '8px' }}>
                          <span style={{ fontWeight: 700 }}>Source Type</span>
                          <input
                            data-source-config-field={`new-source-type-${project.id}`}
                            value={getNewSourceConfigForm(project.id).sourceType}
                            onChange={(event) =>
                              updateSourceConfigForm(
                                `new-${project.id}`,
                                { sourceType: event.target.value },
                                getNewSourceConfigForm(project.id),
                              )
                            }
                            style={fieldStyle}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: '8px' }}>
                          <span style={{ fontWeight: 700 }}>Platform</span>
                          <input
                            data-source-config-field={`new-platform-${project.id}`}
                            value={getNewSourceConfigForm(project.id).platform}
                            onChange={(event) =>
                              updateSourceConfigForm(
                                `new-${project.id}`,
                                { platform: event.target.value },
                                getNewSourceConfigForm(project.id),
                              )
                            }
                            style={fieldStyle}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: '8px' }}>
                          <span style={{ fontWeight: 700 }}>Label</span>
                          <input
                            data-source-config-field={`new-label-${project.id}`}
                            value={getNewSourceConfigForm(project.id).label}
                            onChange={(event) =>
                              updateSourceConfigForm(
                                `new-${project.id}`,
                                { label: event.target.value },
                                getNewSourceConfigForm(project.id),
                              )
                            }
                            style={fieldStyle}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: '8px' }}>
                          <span style={{ fontWeight: 700 }}>Config JSON</span>
                          <textarea
                            data-source-config-field={`new-config-json-${project.id}`}
                            rows={3}
                            value={getNewSourceConfigForm(project.id).configJson}
                            onChange={(event) =>
                              updateSourceConfigForm(
                                `new-${project.id}`,
                                { configJson: event.target.value },
                                getNewSourceConfigForm(project.id),
                              )
                            }
                            style={{ ...fieldStyle, resize: 'vertical' }}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: '8px' }}>
                          <span style={{ fontWeight: 700 }}>Poll Minutes</span>
                          <input
                            data-source-config-field={`new-poll-${project.id}`}
                            value={getNewSourceConfigForm(project.id).pollIntervalMinutes}
                            onChange={(event) =>
                              updateSourceConfigForm(`new-${project.id}`, {
                                pollIntervalMinutes: event.target.value,
                              }, getNewSourceConfigForm(project.id))
                            }
                            style={fieldStyle}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: '8px' }}>
                          <span style={{ fontWeight: 700 }}>Enabled</span>
                          <input
                            data-source-config-field={`new-enabled-${project.id}`}
                            value={getNewSourceConfigForm(project.id).enabled ? 'true' : 'false'}
                            onChange={(event) =>
                              updateSourceConfigForm(`new-${project.id}`, {
                                enabled: event.target.value === 'true',
                              }, getNewSourceConfigForm(project.id))
                            }
                            style={fieldStyle}
                          />
                        </label>

                        <button
                          type="button"
                          data-source-config-create-id={String(project.id)}
                          onClick={() => handleCreateSourceConfig(project.id)}
                          disabled={pendingSourceConfigCreateProjectId === project.id}
                          style={{
                            border: 'none',
                            borderRadius: '12px',
                            background: '#2563eb',
                            color: '#ffffff',
                            padding: '10px 14px',
                            fontWeight: 700,
                            justifySelf: 'flex-start',
                          }}
                        >
                          {pendingSourceConfigCreateProjectId === project.id
                            ? '正在创建 SourceConfig...'
                            : '创建 SourceConfig'}
                        </button>
                      </div>
                    </div>
                  </SectionCard>
                </article>
              );
            })}
          </div>
        ) : null}
      </SectionCard>
    </section>
  );
}
