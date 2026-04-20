import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { JsonPreview } from '../components/JsonPreview';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface SettingsRecord {
  allowlist: string[];
  schedulerIntervalMinutes: number;
  rssDefaults: string[];
  monitorRssFeeds?: string[];
  monitorXQueries?: string[];
  monitorRedditQueries?: string[];
  monitorV2exQueries?: string[];
}

export interface SettingsResponse {
  settings?: SettingsRecord;
  scheduler?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  rss?: Record<string, unknown>;
  platformReadiness?: Array<Record<string, unknown>>;
  readiness?: Array<Record<string, unknown>>;
  platforms?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export async function loadSettingsRequest(): Promise<SettingsResponse> {
  return apiRequest<SettingsResponse>('/api/settings');
}

export interface UpdateSettingsPayload {
  allowlist: string[];
  schedulerIntervalMinutes: number;
  rssDefaults: string[];
  monitorRssFeeds: string[];
  monitorXQueries: string[];
  monitorRedditQueries: string[];
  monitorV2exQueries: string[];
}

export async function updateSettingsRequest(input: UpdateSettingsPayload): Promise<SettingsResponse> {
  return apiRequest<SettingsResponse>('/api/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export interface RuntimeControlResponse {
  runtime: Record<string, unknown>;
  results?: Array<Record<string, unknown>>;
}

export interface FetchControlResponse {
  items: Array<Record<string, unknown>>;
  inserted: number;
  total: number;
  unread?: number;
}

export interface SystemJobRecord {
  id: number;
  type: string;
  status: string;
  runAt: string;
  attempts: number;
  lastError?: string;
  canRetry?: boolean;
  canCancel?: boolean;
}

export interface SystemJobsResponse {
  jobs: SystemJobRecord[];
  queue: Record<string, unknown>;
  recentJobs: SystemJobRecord[];
}

export interface SystemJobMutationResponse {
  job: SystemJobRecord;
  runtime: Record<string, unknown>;
}

export interface EnqueueSystemJobPayload {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: string;
}

export async function reloadSchedulerRuntimeRequest(): Promise<RuntimeControlResponse> {
  return apiRequest<RuntimeControlResponse>('/api/system/runtime/reload', {
    method: 'POST',
  });
}

export async function tickSchedulerRuntimeRequest(): Promise<RuntimeControlResponse> {
  return apiRequest<RuntimeControlResponse>('/api/system/runtime/tick', {
    method: 'POST',
  });
}

export async function fetchMonitorSignalsRequest(): Promise<FetchControlResponse> {
  return apiRequest<FetchControlResponse>('/api/monitor/fetch', {
    method: 'POST',
  });
}

export async function fetchInboxSignalsRequest(): Promise<FetchControlResponse> {
  return apiRequest<FetchControlResponse>('/api/inbox/fetch', {
    method: 'POST',
  });
}

export async function fetchReputationSignalsRequest(): Promise<FetchControlResponse> {
  return apiRequest<FetchControlResponse>('/api/reputation/fetch', {
    method: 'POST',
  });
}

export async function loadSystemJobsRequest(limit = 20): Promise<SystemJobsResponse> {
  return apiRequest<SystemJobsResponse>(`/api/system/jobs?limit=${limit}`);
}

export async function retrySystemJobRequest(
  jobId: number,
  runAt?: string,
): Promise<SystemJobMutationResponse> {
  return apiRequest<SystemJobMutationResponse>(`/api/system/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(runAt ? { runAt } : {}),
  });
}

export async function cancelSystemJobRequest(jobId: number): Promise<SystemJobMutationResponse> {
  return apiRequest<SystemJobMutationResponse>(`/api/system/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
}

export async function enqueueSystemJobRequest(
  input: EnqueueSystemJobPayload,
): Promise<SystemJobMutationResponse> {
  return apiRequest<SystemJobMutationResponse>('/api/system/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function submitSettingsForm(
  formValues: {
    allowlist: string;
    schedulerIntervalMinutes: string;
    rssDefaults: string;
    monitorRssFeeds: string;
    monitorXQueries: string;
    monitorRedditQueries: string;
    monitorV2exQueries: string;
  },
  action: (payload: UpdateSettingsPayload) => Promise<unknown>,
): Promise<{ ok: boolean; error?: string; payload?: UpdateSettingsPayload }> {
  const allowlist = parseListInput(formValues.allowlist);
  const schedulerIntervalMinutes = Number(formValues.schedulerIntervalMinutes);
  const rssDefaults = parseListInput(formValues.rssDefaults);
  const monitorRssFeeds = parseListInput(formValues.monitorRssFeeds);
  const monitorXQueries = parseListInput(formValues.monitorXQueries);
  const monitorRedditQueries = parseListInput(formValues.monitorRedditQueries);
  const monitorV2exQueries = parseListInput(formValues.monitorV2exQueries);

  if (allowlist.length === 0) {
    return { ok: false, error: 'allowlist 不能为空' };
  }

  if (allowlist.some((entry) => entry.includes('/'))) {
    return { ok: false, error: 'allowlist 只支持精确 IP 或 *，不支持 CIDR' };
  }

  if (!Number.isInteger(schedulerIntervalMinutes) || schedulerIntervalMinutes <= 0) {
    return { ok: false, error: 'schedulerIntervalMinutes 必须是大于 0 的整数' };
  }

  const payload = {
    allowlist,
    schedulerIntervalMinutes,
    rssDefaults,
    monitorRssFeeds,
    monitorXQueries,
    monitorRedditQueries,
    monitorV2exQueries,
  };

  await action(payload);

  return {
    ok: true,
    payload,
  };
}

interface SettingsPageProps {
  loadSettingsAction?: () => Promise<SettingsResponse>;
  loadSystemJobsAction?: () => Promise<SystemJobsResponse>;
  reloadSchedulerAction?: () => Promise<RuntimeControlResponse>;
  tickSchedulerAction?: () => Promise<RuntimeControlResponse>;
  fetchMonitorAction?: () => Promise<FetchControlResponse>;
  fetchInboxAction?: () => Promise<FetchControlResponse>;
  fetchReputationAction?: () => Promise<FetchControlResponse>;
  enqueueSystemJobAction?: (input: EnqueueSystemJobPayload) => Promise<SystemJobMutationResponse>;
  retrySystemJobAction?: (jobId: number, runAt?: string) => Promise<SystemJobMutationResponse>;
  cancelSystemJobAction?: (jobId: number) => Promise<SystemJobMutationResponse>;
  stateOverride?: AsyncState<SettingsResponse>;
  jobsStateOverride?: AsyncState<SystemJobsResponse>;
  updateStateOverride?: AsyncState<SettingsResponse>;
  validationMessageOverride?: string;
}

const defaultSettingsFormValues = {
  allowlist: '127.0.0.1, ::1',
  schedulerIntervalMinutes: '15',
  rssDefaults: 'OpenAI blog, Anthropic news',
  monitorRssFeeds: '',
  monitorXQueries: '',
  monitorRedditQueries: '',
  monitorV2exQueries: '',
} as const;

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

const cardGridStyle = {
  display: 'grid',
  gap: '20px',
  gridTemplateColumns: 'repeat(2, minmax(320px, 1fr))',
} as const;

const statusPillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  borderRadius: '999px',
  padding: '8px 12px',
  background: '#e2e8f0',
  color: '#0f172a',
  fontWeight: 700,
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function formatList(entries: string[]) {
  return entries.join(', ');
}

function formatMultilineList(entries: string[]) {
  return entries.join('\n');
}

function parseListInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readSettingsList(value: string[] | undefined) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function formatBooleanLabel(value: boolean | null) {
  if (value === true) {
    return '已启用';
  }

  if (value === false) {
    return '未启用';
  }

  return '未提供';
}

function formatStatusLabel(status: string | null, enabled: boolean | null) {
  if (status) {
    switch (status.toLowerCase()) {
      case 'healthy':
        return '健康';
      case 'running':
        return '运行中';
      case 'paused':
        return '已暂停';
      case 'disabled':
        return '已停用';
      case 'degraded':
        return '降级';
      default:
        return status;
    }
  }

  if (enabled === true) {
    return '已启用';
  }

  if (enabled === false) {
    return '已停用';
  }

  return '未提供';
}

function formatContractValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((entry) => String(entry)).join(', ') : '未提供';
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return '未提供';
}

function formatPlatformStatus(value: unknown) {
  if (value === 'ready') return '已就绪';
  if (value === 'needs_config') return '待配置';
  if (value === 'needs_session') return '人工接管待准备';
  if (value === 'needs_relogin') return '人工接管需重登';
  return formatContractValue(value);
}

function formatPlatformName(value: unknown) {
  if (value === 'x') return 'X';
  if (value === 'reddit') return 'Reddit';
  if (value === 'facebookGroup' || value === 'facebook-group') return 'Facebook Group';
  return formatContractValue(value);
}

function formatPlatformMode(value: unknown) {
  if (value === 'api') return 'API';
  if (value === 'browser') return '人工浏览器接管';
  if (value === 'manual') return '人工处理';
  return formatContractValue(value);
}

function formatPlatformAction(value: unknown) {
  if (value === 'configure_credentials') return '配置凭证';
  if (value === 'request_session') return '准备人工接管';
  if (value === 'relogin') return '刷新接管会话';
  return formatContractValue(value);
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

function getLoadedFormValues(settings?: SettingsRecord) {
  if (!settings) {
    return defaultSettingsFormValues;
  }

  const monitorRssFeeds = readSettingsList(settings.monitorRssFeeds);
  const monitorXQueries = readSettingsList(settings.monitorXQueries);
  const monitorRedditQueries = readSettingsList(settings.monitorRedditQueries);
  const monitorV2exQueries = readSettingsList(settings.monitorV2exQueries);

  return {
    allowlist: settings.allowlist.length > 0 ? formatList(settings.allowlist) : defaultSettingsFormValues.allowlist,
    schedulerIntervalMinutes:
      settings.schedulerIntervalMinutes > 0
        ? String(settings.schedulerIntervalMinutes)
        : defaultSettingsFormValues.schedulerIntervalMinutes,
    rssDefaults: settings.rssDefaults.length > 0 ? formatList(settings.rssDefaults) : '',
    monitorRssFeeds: monitorRssFeeds.length > 0 ? formatMultilineList(monitorRssFeeds) : '',
    monitorXQueries: monitorXQueries.length > 0 ? formatMultilineList(monitorXQueries) : '',
    monitorRedditQueries:
      monitorRedditQueries.length > 0 ? formatMultilineList(monitorRedditQueries) : '',
    monitorV2exQueries: monitorV2exQueries.length > 0 ? formatMultilineList(monitorV2exQueries) : '',
  };
}

function mergeSettingsRecords(loaded?: SettingsRecord, saved?: SettingsRecord): SettingsRecord | undefined {
  if (!loaded && !saved) {
    return undefined;
  }

  const base = loaded ?? {
    allowlist: [],
    schedulerIntervalMinutes: 0,
    rssDefaults: [],
  };

  return {
    allowlist: saved?.allowlist ?? base.allowlist,
    schedulerIntervalMinutes: saved?.schedulerIntervalMinutes ?? base.schedulerIntervalMinutes,
    rssDefaults: saved?.rssDefaults ?? base.rssDefaults,
    monitorRssFeeds:
      saved && Object.prototype.hasOwnProperty.call(saved, 'monitorRssFeeds')
        ? readSettingsList(saved.monitorRssFeeds)
        : readSettingsList(base.monitorRssFeeds),
    monitorXQueries:
      saved && Object.prototype.hasOwnProperty.call(saved, 'monitorXQueries')
        ? readSettingsList(saved.monitorXQueries)
        : readSettingsList(base.monitorXQueries),
    monitorRedditQueries:
      saved && Object.prototype.hasOwnProperty.call(saved, 'monitorRedditQueries')
        ? readSettingsList(saved.monitorRedditQueries)
        : readSettingsList(base.monitorRedditQueries),
    monitorV2exQueries:
      saved && Object.prototype.hasOwnProperty.call(saved, 'monitorV2exQueries')
        ? readSettingsList(saved.monitorV2exQueries)
        : readSettingsList(base.monitorV2exQueries),
  };
}

function renderInfoRows(rows: Array<{ label: string; value: string }>) {
  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'grid',
            gap: '4px',
            borderRadius: '14px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            padding: '12px 14px',
          }}
        >
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 700 }}>{row.label}</span>
          <span style={{ color: '#0f172a' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function SettingsPage({
  loadSettingsAction = loadSettingsRequest,
  loadSystemJobsAction = () => loadSystemJobsRequest(20),
  reloadSchedulerAction = reloadSchedulerRuntimeRequest,
  tickSchedulerAction = tickSchedulerRuntimeRequest,
  fetchMonitorAction = fetchMonitorSignalsRequest,
  fetchInboxAction = fetchInboxSignalsRequest,
  fetchReputationAction = fetchReputationSignalsRequest,
  enqueueSystemJobAction = enqueueSystemJobRequest,
  retrySystemJobAction = retrySystemJobRequest,
  cancelSystemJobAction = cancelSystemJobRequest,
  stateOverride,
  jobsStateOverride,
  updateStateOverride,
  validationMessageOverride,
}: SettingsPageProps) {
  const { state, reload } = useAsyncQuery(loadSettingsAction, [loadSettingsAction]);
  const { state: jobsState, reload: reloadJobs } = useAsyncQuery(loadSystemJobsAction, [loadSystemJobsAction]);
  const { state: updateState, run: saveSettings } = useAsyncAction(updateSettingsRequest);
  const { run: enqueueJob } = useAsyncAction(enqueueSystemJobAction);
  const { run: mutateJob } = useAsyncAction(
    ({ action, jobId }: { action: 'retry' | 'cancel'; jobId: number }) =>
      action === 'retry' ? retrySystemJobAction(jobId) : cancelSystemJobAction(jobId),
  );
  const displayState = stateOverride ?? state;
  const displayJobsState = jobsStateOverride ?? jobsState;
  const displayUpdateState = updateStateOverride ?? updateState;
  const loadedData = displayState.status === 'success' ? displayState.data : undefined;
  const savedData = displayUpdateState.status === 'success' ? displayUpdateState.data : undefined;
  const effectiveSettings = mergeSettingsRecords(loadedData?.settings, savedData?.settings);
  const loadedFormValues = getLoadedFormValues(effectiveSettings);

  const [allowlistDraft, setAllowlistDraft] = useState<string | null>(null);
  const [schedulerIntervalMinutesDraft, setSchedulerIntervalMinutesDraft] = useState<string | null>(null);
  const [rssDefaultsDraft, setRssDefaultsDraft] = useState<string | null>(null);
  const [monitorRssFeedsDraft, setMonitorRssFeedsDraft] = useState<string | null>(null);
  const [monitorXQueriesDraft, setMonitorXQueriesDraft] = useState<string | null>(null);
  const [monitorRedditQueriesDraft, setMonitorRedditQueriesDraft] = useState<string | null>(null);
  const [monitorV2exQueriesDraft, setMonitorV2exQueriesDraft] = useState<string | null>(null);
  const [enqueueRunAtDraft, setEnqueueRunAtDraft] = useState<string>('2026-04-20T09:00');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [activeControl, setActiveControl] = useState<string | null>(null);
  const displayValidationMessage = validationMessageOverride ?? validationMessage;

  const allowlist = allowlistDraft ?? loadedFormValues.allowlist;
  const schedulerIntervalMinutes = schedulerIntervalMinutesDraft ?? loadedFormValues.schedulerIntervalMinutes;
  const rssDefaults = rssDefaultsDraft ?? loadedFormValues.rssDefaults;
  const monitorRssFeeds = monitorRssFeedsDraft ?? loadedFormValues.monitorRssFeeds;
  const monitorXQueries = monitorXQueriesDraft ?? loadedFormValues.monitorXQueries;
  const monitorRedditQueries = monitorRedditQueriesDraft ?? loadedFormValues.monitorRedditQueries;
  const monitorV2exQueries = monitorV2exQueriesDraft ?? loadedFormValues.monitorV2exQueries;

  const schedulerContract = asRecord(savedData?.scheduler ?? loadedData?.scheduler);
  const runtimeContract = asRecord(savedData?.runtime ?? loadedData?.runtime) ?? asRecord(schedulerContract?.runtime);
  const aiContract = asRecord(savedData?.ai ?? loadedData?.ai);
  const rssContract = asRecord(savedData?.rss ?? loadedData?.rss);
  const platformReadiness = readRecordArray(
    savedData?.platformReadiness ??
      savedData?.readiness ??
      savedData?.platforms ??
      loadedData?.platformReadiness ??
      loadedData?.readiness ??
      loadedData?.platforms,
  );

  const schedulerEnabled = readBoolean(schedulerContract?.enabled);
  const schedulerStatus = formatStatusLabel(readString(schedulerContract?.status), schedulerEnabled);
  const runtimeMode = readString(runtimeContract?.mode) ?? readString(asRecord(schedulerContract?.runtime)?.mode);
  const runtimeEnvironment = readString(runtimeContract?.environment);
  const runtimeQueueDepth =
    readNumber(runtimeContract?.queueDepth) ?? readNumber(asRecord(schedulerContract?.runtime)?.queueDepth);
  const runtimeQueue = asRecord(runtimeContract?.queue);
  const recentJobs =
    displayJobsState.status === 'success' && displayJobsState.data?.jobs.length > 0
      ? displayJobsState.data.jobs
      : readRecordArray(runtimeContract?.recentJobs);

  function handleSaveSettings() {
    void submitSettingsForm(
      {
        allowlist,
        schedulerIntervalMinutes,
        rssDefaults,
        monitorRssFeeds,
        monitorXQueries,
        monitorRedditQueries,
        monitorV2exQueries,
      },
      async (payload) => {
        setValidationMessage(null);
        await saveSettings(payload);
      },
    ).then((result) => {
      if (!result.ok) {
        setValidationMessage(result.error ?? '保存前校验失败');
      }
    });
  }

  async function runControlAction(
    actionLabel: string,
    action: () => Promise<RuntimeControlResponse | FetchControlResponse>,
    successBuilder: (result: RuntimeControlResponse | FetchControlResponse) => string,
  ) {
    setControlError(null);
    setControlMessage(null);
    setActiveControl(actionLabel);

    try {
      const result = await action();
      setControlMessage(successBuilder(result));
      reload();
      reloadJobs();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    } finally {
      setActiveControl(null);
    }
  }

  function handleJobAction(jobId: number, action: 'retry' | 'cancel') {
    setControlError(null);
    setControlMessage(null);
    setActiveControl(`${action}:${jobId}`);

    void mutateJob({ action, jobId })
      .then((result) => {
        setControlMessage(action === 'retry' ? `作业 #${result.job.id} 已重试` : `作业 #${result.job.id} 已取消`);
        reload();
        reloadJobs();
      })
      .catch((error) => {
        setControlError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setActiveControl(null);
      });
  }

  function handleEnqueueJob(type: 'monitor_fetch' | 'inbox_fetch' | 'reputation_fetch') {
    setControlError(null);
    setControlMessage(null);
    setActiveControl(`enqueue:${type}`);

    void enqueueJob({
      type,
      runAt: enqueueRunAtDraft.trim().length > 0 ? enqueueRunAtDraft : undefined,
      payload: {},
    })
      .then((result) => {
        setControlMessage(`已将 ${result.job.type} 加入队列，job #${result.job.id}`);
        reload();
        reloadJobs();
      })
      .catch((error) => {
        setControlError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setActiveControl(null);
      });
  }

  return (
    <section>
      <PageHeader
        eyebrow="Control Plane"
        title="Settings"
        description="更贴近真实中文版控制台的系统设置页：继续兼容 `/api/settings`，同时预留 scheduler、runtime、AI 和 RSS contract 的消费位。"
        actions={
          <>
            <ActionButton label="重新加载默认源" onClick={reload} />
            <ActionButton
              label={displayUpdateState.status === 'loading' ? '正在保存设置...' : '保存设置'}
              tone="primary"
              onClick={handleSaveSettings}
            />
          </>
        }
      />

      <div style={cardGridStyle}>
        <SectionCard title="设置总览" description="当前生效设置、接口兼容状态和最近一次拉取结果都会集中显示在这里。">
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ ...statusPillStyle, background: '#dbeafe', color: '#1d4ed8' }}>兼容接口 `/api/settings`</span>
              <span style={{ ...statusPillStyle, background: '#ecfdf5', color: '#047857' }}>
                拉取状态：{displayState.status === 'success' ? '已同步' : displayState.status === 'error' ? '失败' : '等待同步'}
              </span>
              <span style={{ ...statusPillStyle, background: '#fef3c7', color: '#92400e' }}>
                保存状态：{displayUpdateState.status === 'success' ? '已保存' : displayUpdateState.status === 'error' ? '失败' : '未提交'}
              </span>
            </div>

            {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载设置...</p> : null}

            {displayState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>设置加载失败：{displayState.error}</p>
            ) : null}

            {effectiveSettings ? (
              <div style={{ display: 'grid', gap: '8px', color: '#334155' }}>
                <div style={{ fontWeight: 700 }}>当前生效设置</div>
                <div>schedulerIntervalMinutes: {effectiveSettings.schedulerIntervalMinutes}</div>
                <div>allowlist: {effectiveSettings.allowlist.length > 0 ? formatList(effectiveSettings.allowlist) : '未提供'}</div>
                <div>rssDefaults: {effectiveSettings.rssDefaults.length > 0 ? formatList(effectiveSettings.rssDefaults) : '未提供'}</div>
                <div>
                  monitorRssFeeds:{' '}
                  {readSettingsList(effectiveSettings.monitorRssFeeds).length > 0
                    ? formatList(readSettingsList(effectiveSettings.monitorRssFeeds))
                    : '未提供'}
                </div>
                <div>
                  monitorXQueries:{' '}
                  {readSettingsList(effectiveSettings.monitorXQueries).length > 0
                    ? formatList(readSettingsList(effectiveSettings.monitorXQueries))
                    : '未提供'}
                </div>
                <div>
                  monitorRedditQueries:{' '}
                  {readSettingsList(effectiveSettings.monitorRedditQueries).length > 0
                    ? formatList(readSettingsList(effectiveSettings.monitorRedditQueries))
                    : '未提供'}
                </div>
                <div>
                  monitorV2exQueries:{' '}
                  {readSettingsList(effectiveSettings.monitorV2exQueries).length > 0
                    ? formatList(readSettingsList(effectiveSettings.monitorV2exQueries))
                    : '未提供'}
                </div>
              </div>
            ) : null}

            {displayState.status === 'idle' ? (
              <p style={{ margin: 0, color: '#475569' }}>页面挂载后会自动请求真实设置接口。</p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="调度与运行态" description="这里消费 scheduler/runtime contract；即使后端还没全部实现，也会把已返回字段显示出来。">
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={{ ...statusPillStyle, background: '#eff6ff', color: '#1d4ed8' }}>{schedulerStatus}</div>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>调度间隔</span>
              <input
                data-settings-field="schedulerIntervalMinutes"
                value={schedulerIntervalMinutes}
                onChange={(event) => {
                  setValidationMessage(null);
                  setSchedulerIntervalMinutesDraft(event.target.value);
                }}
                style={fieldStyle}
              />
            </label>
            {renderInfoRows([
              { label: 'Scheduler 开关', value: formatBooleanLabel(schedulerEnabled) },
              { label: 'Scheduler Started', value: formatContractValue(runtimeContract?.started) },
              { label: '上次运行', value: formatContractValue(schedulerContract?.lastRunAt) },
              { label: '最近 Tick', value: formatContractValue(runtimeContract?.lastTickAt) },
              { label: '下次运行', value: formatContractValue(schedulerContract?.nextRunAt) },
              { label: '运行模式', value: formatContractValue(runtimeMode) },
              { label: '运行环境', value: formatContractValue(runtimeEnvironment) },
              { label: '队列深度', value: formatContractValue(runtimeQueueDepth) },
            ])}
          </div>
        </SectionCard>

        <SectionCard title="运行控制台" description="把 runtime queue、最近作业和手动触发入口放在一个地方，便于运营时直接点控。">
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton
                label={activeControl === 'reload' ? '正在重载 Scheduler...' : '重载 Scheduler'}
                onClick={() => {
                  void runControlAction('reload', reloadSchedulerAction, () => 'Scheduler 已重载');
                }}
              />
              <ActionButton
                label={activeControl === 'tick' ? '正在执行 Tick...' : '立即 Tick'}
                onClick={() => {
                  void runControlAction('tick', tickSchedulerAction, (result) => {
                    const tickResult = result as RuntimeControlResponse;
                    const count = Array.isArray(tickResult.results) ? tickResult.results.length : 0;
                    return `Tick 已执行，本轮处理结果 ${count} 条`;
                  });
                }}
              />
              <ActionButton
                label={activeControl === 'monitor_fetch' ? '正在抓取 Monitor...' : '抓取 Monitor'}
                onClick={() => {
                  void runControlAction('monitor_fetch', fetchMonitorAction, (result) => {
                    const fetchResult = result as FetchControlResponse;
                    return `Monitor 已抓取，新增 ${fetchResult.inserted} 条`;
                  });
                }}
              />
              <ActionButton
                label={activeControl === 'inbox_fetch' ? '正在抓取 Inbox...' : '抓取 Inbox'}
                onClick={() => {
                  void runControlAction('inbox_fetch', fetchInboxAction, (result) => {
                    const fetchResult = result as FetchControlResponse;
                    return `Inbox 已抓取，新增 ${fetchResult.inserted} 条`;
                  });
                }}
              />
              <ActionButton
                label={activeControl === 'reputation_fetch' ? '正在抓取 Reputation...' : '抓取 Reputation'}
                onClick={() => {
                  void runControlAction('reputation_fetch', fetchReputationAction, (result) => {
                    const fetchResult = result as FetchControlResponse;
                    return `Reputation 已抓取，新增 ${fetchResult.inserted} 条`;
                  });
                }}
              />
            </div>

            {controlMessage ? <div style={{ color: '#166534', fontWeight: 700 }}>{controlMessage}</div> : null}
            {controlError ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>控制台动作失败：{controlError}</div> : null}

            {renderInfoRows([
              { label: 'Pending Jobs', value: formatContractValue(runtimeQueue?.pending) },
              { label: 'Running Jobs', value: formatContractValue(runtimeQueue?.running) },
              { label: 'Failed Jobs', value: formatContractValue(runtimeQueue?.failed) },
              { label: 'Due Pending', value: formatContractValue(runtimeQueue?.duePending) },
            ])}

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>排程新作业</div>
              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>runAt</span>
                <input
                  data-settings-field="enqueueRunAt"
                  value={enqueueRunAtDraft}
                  onChange={(event) => setEnqueueRunAtDraft(event.target.value)}
                  style={fieldStyle}
                />
              </label>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <ActionButton
                  label={activeControl === 'enqueue:monitor_fetch' ? '正在入队 Monitor...' : '排程 Monitor Fetch'}
                  onClick={() => {
                    handleEnqueueJob('monitor_fetch');
                  }}
                />
                <ActionButton
                  label={activeControl === 'enqueue:inbox_fetch' ? '正在入队 Inbox...' : '排程 Inbox Fetch'}
                  onClick={() => {
                    handleEnqueueJob('inbox_fetch');
                  }}
                />
                <ActionButton
                  label={
                    activeControl === 'enqueue:reputation_fetch'
                      ? '正在入队 Reputation...'
                      : '排程 Reputation Fetch'
                  }
                  onClick={() => {
                    handleEnqueueJob('reputation_fetch');
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>作业控制</div>
              {displayJobsState.status === 'loading' ? (
                <div style={{ color: '#475569' }}>正在加载 system jobs...</div>
              ) : null}
              {displayJobsState.status === 'error' ? (
                <div style={{ color: '#b91c1c' }}>system jobs 加载失败：{displayJobsState.error}</div>
              ) : null}
              {displayJobsState.status === 'success' && displayJobsState.data.jobs.length > 0 ? (
                displayJobsState.data.jobs.map((job) => (
                  <div
                    key={`job-control-${job.id}`}
                    style={{
                      borderRadius: '14px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      padding: '12px 14px',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      #{job.id} · {job.type} · {job.status}
                    </div>
                    <div style={{ color: '#475569' }}>runAt: {job.runAt}</div>
                    <div style={{ color: '#475569' }}>attempts: {job.attempts}</div>
                    {job.lastError ? <div style={{ color: '#b91c1c' }}>lastError: {job.lastError}</div> : null}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {job.canRetry ? (
                        <ActionButton
                          label={activeControl === `retry:${job.id}` ? '正在重试...' : '重试'}
                          onClick={() => {
                            handleJobAction(job.id, 'retry');
                          }}
                        />
                      ) : null}
                      {job.canCancel ? (
                        <ActionButton
                          label={activeControl === `cancel:${job.id}` ? '正在取消...' : '取消'}
                          onClick={() => {
                            handleJobAction(job.id, 'cancel');
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ))
              ) : displayJobsState.status === 'success' ? (
                <div style={{ color: '#475569' }}>当前没有可操作的 system jobs。</div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>最近作业</div>
              {recentJobs.length > 0 ? (
                recentJobs.map((job) => (
                  <div
                    key={`${formatContractValue(job.id)}-${formatContractValue(job.updatedAt)}`}
                    style={{
                      borderRadius: '14px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      padding: '12px 14px',
                      display: 'grid',
                      gap: '4px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      #{formatContractValue(job.id)} · {formatContractValue(job.type)} · {formatContractValue(job.status)}
                    </div>
                    <div style={{ color: '#475569' }}>runAt: {formatContractValue(job.runAt)}</div>
                    <div style={{ color: '#475569' }}>attempts: {formatContractValue(job.attempts)}</div>
                  </div>
                ))
              ) : (
                <div style={{ color: '#475569' }}>runtime 尚未返回 recentJobs。</div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="AI 配置" description="当前页先展示 AI contract 消费位，不依赖后端已经支持写回。">
          {renderInfoRows([
            { label: 'Provider', value: formatContractValue(aiContract?.provider) },
            { label: 'Model', value: formatContractValue(aiContract?.model) },
            { label: 'Moderation', value: formatBooleanLabel(readBoolean(aiContract?.moderationEnabled)) },
            { label: 'Fallback', value: formatBooleanLabel(readBoolean(aiContract?.allowModelFallback)) },
          ])}
        </SectionCard>

        <SectionCard title="平台就绪度" description="这里直接消费后端返回的 readiness contract，集中判断哪些平台已经具备真实执行或人工接管条件。">
          <div style={{ display: 'grid', gap: '12px' }}>
            {platformReadiness.length > 0 ? (
              platformReadiness.map((platform) => (
                <div
                  key={`${formatContractValue(platform.platform)}-${formatContractValue(platform.status)}`}
                  style={{
                    borderRadius: '14px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    padding: '12px 14px',
                    display: 'grid',
                    gap: '6px',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{formatPlatformName(platform.platform)}</div>
                  <div style={{ color: '#334155' }}>发布就绪：{formatPlatformStatus(platform.status)}</div>
                  <div style={{ color: '#475569' }}>发布方式：{formatPlatformMode(platform.mode)}</div>
                  <div style={{ color: '#334155' }}>就绪说明：{formatContractValue(platform.message)}</div>
                  {platform.action ? (
                    <div style={{ color: '#475569' }}>建议动作：{formatPlatformAction(platform.action)}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div style={{ color: '#475569' }}>后端尚未返回平台就绪信息。</div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="LAN allowlist" description="当前设置载入后会直接回填到表单，便于基于真实值继续编辑。">
          <div style={{ display: 'grid', gap: '14px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>allowlist</span>
              <input
                data-settings-field="allowlist"
                value={allowlist}
                onChange={(event) => {
                  setValidationMessage(null);
                  setAllowlistDraft(event.target.value);
                }}
                style={fieldStyle}
              />
            </label>
            {renderInfoRows([
              { label: '当前 allowlist', value: effectiveSettings?.allowlist.length ? formatList(effectiveSettings.allowlist) : '未提供' },
              { label: '最近保存返回', value: savedData?.settings?.allowlist?.length ? formatList(savedData.settings.allowlist) : '未提供' },
            ])}
          </div>
        </SectionCard>

        <SectionCard title="RSS 默认源" description="RSS 默认值继续走 `/api/settings` 写回，扩展 RSS contract 则只做展示。">
          <div style={{ display: 'grid', gap: '14px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>rssDefaults</span>
              <input
                data-settings-field="rssDefaults"
                value={rssDefaults}
                onChange={(event) => {
                  setValidationMessage(null);
                  setRssDefaultsDraft(event.target.value);
                }}
                style={fieldStyle}
              />
            </label>
            {renderInfoRows([
              { label: '默认源', value: effectiveSettings?.rssDefaults.length ? formatList(effectiveSettings.rssDefaults) : '未提供' },
              { label: '抓取窗口', value: formatContractValue(rssContract?.fetchWindowMinutes) },
              { label: '去重策略', value: formatContractValue(rssContract?.dedupeMode) },
              { label: 'RSS Poller', value: formatBooleanLabel(readBoolean(rssContract?.pollerEnabled)) },
            ])}
          </div>
        </SectionCard>

        <SectionCard
          title="监控来源配置"
          description="这里配置 Monitor 抓取优先使用的 RSS 源、X 查询词、Reddit 查询词和 V2EX 关键词。支持逗号或换行分隔，继续兼容现有 `/api/settings` 保存。"
        >
          <div style={{ display: 'grid', gap: '14px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Monitor RSS 源</span>
              <textarea
                data-settings-field="monitorRssFeeds"
                value={monitorRssFeeds}
                onChange={(event) => {
                  setValidationMessage(null);
                  setMonitorRssFeedsDraft(event.target.value);
                }}
                rows={4}
                style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>X 查询词</span>
              <textarea
                data-settings-field="monitorXQueries"
                value={monitorXQueries}
                onChange={(event) => {
                  setValidationMessage(null);
                  setMonitorXQueriesDraft(event.target.value);
                }}
                rows={4}
                style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Reddit 查询词</span>
              <textarea
                data-settings-field="monitorRedditQueries"
                value={monitorRedditQueries}
                onChange={(event) => {
                  setValidationMessage(null);
                  setMonitorRedditQueriesDraft(event.target.value);
                }}
                rows={4}
                style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>V2EX 关键词</span>
              <textarea
                data-settings-field="monitorV2exQueries"
                value={monitorV2exQueries}
                onChange={(event) => {
                  setValidationMessage(null);
                  setMonitorV2exQueriesDraft(event.target.value);
                }}
                rows={4}
                style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }}
              />
            </label>

            {renderInfoRows([
              {
                label: '当前 Monitor RSS 源',
                value: readSettingsList(effectiveSettings?.monitorRssFeeds).length
                  ? formatList(readSettingsList(effectiveSettings?.monitorRssFeeds))
                  : '未提供',
              },
              {
                label: '最近保存 Monitor RSS 源',
                value: readSettingsList(savedData?.settings?.monitorRssFeeds).length
                  ? formatList(readSettingsList(savedData?.settings?.monitorRssFeeds))
                  : '未提供',
              },
              {
                label: '当前 X 查询词',
                value: readSettingsList(effectiveSettings?.monitorXQueries).length
                  ? formatList(readSettingsList(effectiveSettings?.monitorXQueries))
                  : '未提供',
              },
              {
                label: '最近保存 X 查询词',
                value: readSettingsList(savedData?.settings?.monitorXQueries).length
                  ? formatList(readSettingsList(savedData?.settings?.monitorXQueries))
                  : '未提供',
              },
              {
                label: '当前 V2EX 关键词',
                value: readSettingsList(effectiveSettings?.monitorV2exQueries).length
                  ? formatList(readSettingsList(effectiveSettings?.monitorV2exQueries))
                  : '未提供',
              },
              {
                label: '当前 Reddit 查询词',
                value: readSettingsList(effectiveSettings?.monitorRedditQueries).length
                  ? formatList(readSettingsList(effectiveSettings?.monitorRedditQueries))
                  : '未提供',
              },
              {
                label: '最近保存 Reddit 查询词',
                value: readSettingsList(savedData?.settings?.monitorRedditQueries).length
                  ? formatList(readSettingsList(savedData?.settings?.monitorRedditQueries))
                  : '未提供',
              },
              {
                label: '最近保存 V2EX 关键词',
                value: readSettingsList(savedData?.settings?.monitorV2exQueries).length
                  ? formatList(readSettingsList(savedData?.settings?.monitorV2exQueries))
                  : '未提供',
              },
            ])}
          </div>
        </SectionCard>

        <SectionCard title="原始接口 Contract" description="保留原始 JSON 视图，方便前后端联调和观察新增字段落位。">
          {displayState.status === 'success' && displayState.data ? (
            <JsonPreview value={displayState.data} />
          ) : (
            <p style={{ margin: 0, color: '#475569' }}>接口成功返回后，会在这里展示完整响应。</p>
          )}
        </SectionCard>

        {(displayValidationMessage || displayUpdateState.status !== 'idle') && (
          <SectionCard title="最近保存结果" description="保存前校验和最近一次 PATCH 结果会显示在这里。">
            {displayValidationMessage ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>保存前校验失败：{displayValidationMessage}</p>
            ) : null}
            {displayUpdateState.status === 'success' ? (
              <div style={{ color: '#166534', display: 'grid', gap: '8px' }}>
                <div style={{ fontWeight: 700 }}>设置已保存</div>
                {displayUpdateState.data?.settings ? (
                  <>
                    <div>allowlist：{displayUpdateState.data.settings.allowlist.join(', ')}</div>
                    <div>schedulerIntervalMinutes：{displayUpdateState.data.settings.schedulerIntervalMinutes}</div>
                    <div>rssDefaults：{displayUpdateState.data.settings.rssDefaults.join(', ') || '未提供'}</div>
                    <div>
                      monitorRssFeeds：
                      {readSettingsList(displayUpdateState.data.settings.monitorRssFeeds).join(', ') || '未提供'}
                    </div>
                    <div>
                      monitorXQueries：
                      {readSettingsList(displayUpdateState.data.settings.monitorXQueries).join(', ') || '未提供'}
                    </div>
                    <div>
                      monitorRedditQueries：
                      {readSettingsList(displayUpdateState.data.settings.monitorRedditQueries).join(', ') || '未提供'}
                    </div>
                    <div>
                      monitorV2exQueries：
                      {readSettingsList(displayUpdateState.data.settings.monitorV2exQueries).join(', ') || '未提供'}
                    </div>
                  </>
                ) : (
                  <div>接口未返回 settings 节点，但请求已成功。</div>
                )}
              </div>
            ) : null}
            {displayUpdateState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>保存失败：{displayUpdateState.error}</p>
            ) : null}
          </SectionCard>
        )}
      </div>
    </section>
  );
}
