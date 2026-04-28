import { useEffect, useRef, useState } from 'react';
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

export interface BrowserLaneRequestRecord {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: string;
  jobStatus: string;
  requestedAt: string;
  artifactPath: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserLaneRequestsResponse {
  requests: BrowserLaneRequestRecord[];
  total: number;
}

export interface BrowserHandoffRecord {
  channelAccountId?: number;
  accountDisplayName?: string;
  ownership?: string;
  platform: string;
  draftId: string;
  title: string | null;
  accountKey: string;
  status: string;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface BrowserHandoffsResponse {
  handoffs: BrowserHandoffRecord[];
  total: number;
}

export interface InboxReplyHandoffRecord {
  channelAccountId?: number;
  platform: string;
  itemId: string;
  source: string;
  title: string | null;
  author: string | null;
  accountKey: string;
  status: string;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution?: unknown;
}

export interface InboxReplyHandoffsResponse {
  handoffs: InboxReplyHandoffRecord[];
  total: number;
}

export interface BrowserLaneSessionSummary {
  hasSession: boolean;
  status: 'active' | 'expired' | 'missing' | string;
  validatedAt: string | null;
  storageStatePath: string | null;
  id?: string;
  notes?: string;
}

export interface BrowserLaneRequestImportResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  session: BrowserLaneSessionSummary | null;
  channelAccount: {
    id: number;
    metadata?: Record<string, unknown>;
    session?: BrowserLaneSessionSummary;
    [key: string]: unknown;
  };
}

export interface BrowserHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  draftId: number;
  draftStatus: string;
  platform: string;
  mode: string;
  status: string;
  publishStatus?: string;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
}

export interface InboxReplyHandoffCompletionResponse {
  ok: boolean;
  imported: boolean;
  artifactPath: string;
  itemId: number;
  itemStatus: string;
  platform: string;
  mode: string;
  status: string;
  replyStatus?: string;
  success: boolean;
  deliveryUrl: string | null;
  externalId: string | null;
  message: string;
  deliveredAt: string | null;
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

export async function loadBrowserLaneRequestsRequest(limit = 20): Promise<BrowserLaneRequestsResponse> {
  return apiRequest<BrowserLaneRequestsResponse>(`/api/system/browser-lane-requests?limit=${limit}`);
}

export async function loadBrowserHandoffsRequest(limit = 20): Promise<BrowserHandoffsResponse> {
  return apiRequest<BrowserHandoffsResponse>(`/api/system/browser-handoffs?limit=${limit}`);
}

export async function loadInboxReplyHandoffsRequest(limit = 20): Promise<InboxReplyHandoffsResponse> {
  return apiRequest<InboxReplyHandoffsResponse>(`/api/system/inbox-reply-handoffs?limit=${limit}`);
}

export async function importBrowserLaneRequestResultRequest(input: {
  requestArtifactPath: string;
  storageState: Record<string, unknown>;
  notes?: string;
}): Promise<BrowserLaneRequestImportResponse> {
  return apiRequest<BrowserLaneRequestImportResponse>('/api/system/browser-lane-requests/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestArtifactPath: input.requestArtifactPath,
      storageState: input.storageState,
      ...(input.notes !== undefined && input.notes.trim().length > 0 ? { notes: input.notes.trim() } : {}),
    }),
  });
}

export async function completeBrowserHandoffRequest(input: {
  artifactPath: string;
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
}): Promise<BrowserHandoffCompletionResponse> {
  return apiRequest<BrowserHandoffCompletionResponse>('/api/system/browser-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      publishStatus: input.publishStatus,
      message:
        input.message ??
        (input.publishStatus === 'published'
          ? 'browser handoff marked published'
          : 'browser handoff marked failed'),
      ...(input.publishUrl !== undefined && input.publishUrl.trim().length > 0
        ? { publishUrl: input.publishUrl.trim() }
        : {}),
    }),
  });
}

export async function completeInboxReplyHandoffRequest(input: {
  artifactPath: string;
  replyStatus: 'sent' | 'failed';
  message?: string;
  deliveryUrl?: string;
}): Promise<InboxReplyHandoffCompletionResponse> {
  return apiRequest<InboxReplyHandoffCompletionResponse>('/api/system/inbox-reply-handoffs/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      artifactPath: input.artifactPath,
      replyStatus: input.replyStatus,
      message:
        input.message ??
        (input.replyStatus === 'sent'
          ? 'inbox reply handoff marked sent'
          : 'inbox reply handoff marked failed'),
      ...(input.deliveryUrl !== undefined && input.deliveryUrl.trim().length > 0
        ? { deliveryUrl: input.deliveryUrl.trim() }
        : {}),
    }),
  });
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

  if (allowlist.some((entry) => !isSupportedAllowlistEntry(entry))) {
    return { ok: false, error: 'allowlist 只支持精确 IP、CIDR 子网或 *' };
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
  loadBrowserLaneRequestsAction?: () => Promise<BrowserLaneRequestsResponse>;
  loadBrowserHandoffsAction?: () => Promise<BrowserHandoffsResponse>;
  loadInboxReplyHandoffsAction?: () => Promise<InboxReplyHandoffsResponse>;
  importBrowserLaneRequestResultAction?: (input: {
    requestArtifactPath: string;
    storageState: Record<string, unknown>;
    notes?: string;
  }) => Promise<BrowserLaneRequestImportResponse>;
  completeBrowserHandoffAction?: (input: {
    artifactPath: string;
    publishStatus: 'published' | 'failed';
    message?: string;
    publishUrl?: string;
  }) => Promise<BrowserHandoffCompletionResponse>;
  completeInboxReplyHandoffAction?: (input: {
    artifactPath: string;
    replyStatus: 'sent' | 'failed';
    message?: string;
    deliveryUrl?: string;
  }) => Promise<InboxReplyHandoffCompletionResponse>;
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
  browserLaneStateOverride?: AsyncState<BrowserLaneRequestsResponse>;
  browserHandoffStateOverride?: AsyncState<BrowserHandoffsResponse>;
  inboxReplyHandoffStateOverride?: AsyncState<InboxReplyHandoffsResponse>;
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

function defaultLoadSystemJobsAction() {
  return loadSystemJobsRequest(20);
}

function defaultLoadBrowserLaneRequestsAction() {
  return loadBrowserLaneRequestsRequest(20);
}

function defaultLoadBrowserHandoffsAction() {
  return loadBrowserHandoffsRequest(20);
}

function defaultLoadInboxReplyHandoffsAction() {
  return loadInboxReplyHandoffsRequest(20);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStatusValue(value: unknown) {
  return typeof (value as { status?: unknown } | null)?.status === 'string'
    ? ((value as { status: string }).status)
    : null;
}

function readResolutionDetail(value: unknown) {
  const record = asRecord(value);
  return (
    readString(record?.reason) ??
    readString(record?.publishStatus) ??
    readString(record?.replyStatus) ??
    readString(record?.draftStatus) ??
    readString(record?.itemStatus)
  );
}

function readResolutionDeliveryUrl(value: unknown) {
  const record = asRecord(value);
  return readString(record?.deliveryUrl);
}

function readResolutionPublishUrl(value: unknown) {
  const record = asRecord(value);
  return readString(record?.publishUrl);
}

function readResolutionMessage(value: unknown) {
  const record = asRecord(value);
  return readString(record?.message);
}

function readResolutionPublishedAt(value: unknown) {
  const record = asRecord(value);
  return readString(record?.publishedAt);
}

function readResolutionDeliveredAt(value: unknown) {
  const record = asRecord(value);
  return readString(record?.deliveredAt);
}

function readBrowserLaneSession(value: unknown) {
  const record = asRecord(value);
  return asRecord(record?.session);
}

function readBrowserLaneSessionStatus(value: unknown) {
  const session = readBrowserLaneSession(value);
  return readString(session?.status);
}

function readBrowserLaneSessionValidatedAt(value: unknown) {
  const session = readBrowserLaneSession(value);
  return readString(session?.validatedAt);
}

function readBrowserLaneSessionStorageStatePath(value: unknown) {
  const session = readBrowserLaneSession(value);
  return readString(session?.storageStatePath);
}

function readBrowserLaneSessionNotes(value: unknown) {
  const session = readBrowserLaneSession(value);
  return readString(session?.notes);
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
  if (value === 'instagram') return 'Instagram';
  if (value === 'tiktok') return 'TikTok';
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

function readChannelAccountMetadataSession(value: unknown) {
  const record = asRecord(value);
  return asRecord(record?.session) as BrowserLaneSessionSummary | null;
}

function readBrowserLaneImportSession(response: BrowserLaneRequestImportResponse) {
  return response.session ?? response.channelAccount.session ?? readChannelAccountMetadataSession(response.channelAccount.metadata);
}

function parseStorageStateJson(value: string | undefined) {
  const normalizedValue = value?.trim() ?? '';
  if (normalizedValue.length === 0) {
    throw new Error('storageState JSON 不能为空');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedValue);
  } catch {
    throw new Error('storageState JSON 必须是合法的 JSON 对象');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('storageState JSON 必须是 JSON 对象');
  }

  if (
    !Array.isArray((parsed as { cookies?: unknown }).cookies) ||
    !Array.isArray((parsed as { origins?: unknown }).origins)
  ) {
    throw new Error('storageState JSON 必须包含 cookies 和 origins 数组');
  }

  return parsed as Record<string, unknown>;
}

function buildOptimisticBrowserLaneRequestResolution(response: BrowserLaneRequestImportResponse) {
  const session = readBrowserLaneImportSession(response);
  return {
    resolvedAt: session?.validatedAt ?? new Date().toISOString(),
    jobStatus: 'resolved',
    resolution: {
      status: 'resolved',
      session,
    },
  };
}

function buildOptimisticBrowserHandoffResolution(response: BrowserHandoffCompletionResponse) {
  return {
    resolvedAt: response.publishedAt ?? new Date().toISOString(),
    status: response.status,
    resolution: {
      status: response.status,
      draftStatus: response.draftStatus,
      publishStatus: response.publishStatus ?? response.status,
      ...(response.publishUrl ? { publishUrl: response.publishUrl } : {}),
      ...(response.message ? { message: response.message } : {}),
      ...(response.publishedAt ? { publishedAt: response.publishedAt } : {}),
    },
  };
}

function buildOptimisticInboxReplyHandoffResolution(response: InboxReplyHandoffCompletionResponse) {
  return {
    resolvedAt: response.deliveredAt ?? new Date().toISOString(),
    status: response.status,
    resolution: {
      status: response.status,
      itemStatus: response.itemStatus,
      ...(response.replyStatus ? { replyStatus: response.replyStatus } : {}),
      ...(response.deliveryUrl ? { deliveryUrl: response.deliveryUrl } : {}),
      ...(response.message ? { message: response.message } : {}),
      ...(response.deliveredAt ? { deliveredAt: response.deliveredAt } : {}),
    },
  };
}

export function SettingsPage({
  loadSettingsAction = loadSettingsRequest,
  loadSystemJobsAction = defaultLoadSystemJobsAction,
  loadBrowserLaneRequestsAction = defaultLoadBrowserLaneRequestsAction,
  loadBrowserHandoffsAction = defaultLoadBrowserHandoffsAction,
  loadInboxReplyHandoffsAction = defaultLoadInboxReplyHandoffsAction,
  importBrowserLaneRequestResultAction = importBrowserLaneRequestResultRequest,
  completeBrowserHandoffAction = completeBrowserHandoffRequest,
  completeInboxReplyHandoffAction = completeInboxReplyHandoffRequest,
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
  browserLaneStateOverride,
  browserHandoffStateOverride,
  inboxReplyHandoffStateOverride,
  updateStateOverride,
  validationMessageOverride,
}: SettingsPageProps) {
  const { state, reload } = useAsyncQuery(loadSettingsAction, [loadSettingsAction]);
  const { state: jobsState, reload: reloadJobs } = useAsyncQuery(loadSystemJobsAction, [loadSystemJobsAction]);
  const { state: browserLaneState, reload: reloadBrowserLane } = useAsyncQuery(
    loadBrowserLaneRequestsAction,
    [loadBrowserLaneRequestsAction],
  );
  const { state: browserHandoffState, reload: reloadBrowserHandoffs } = useAsyncQuery(
    loadBrowserHandoffsAction,
    [loadBrowserHandoffsAction],
  );
  const { state: inboxReplyHandoffState, reload: reloadInboxReplyHandoffs } = useAsyncQuery(
    loadInboxReplyHandoffsAction,
    [loadInboxReplyHandoffsAction],
  );
  const { state: updateState, run: saveSettings } = useAsyncAction(updateSettingsRequest);
  const { run: enqueueJob } = useAsyncAction(enqueueSystemJobAction);
  const { run: mutateJob } = useAsyncAction(
    ({ action, jobId }: { action: 'retry' | 'cancel'; jobId: number }) =>
      action === 'retry' ? retrySystemJobAction(jobId) : cancelSystemJobAction(jobId),
  );
  const { state: browserLaneRequestMutationState, run: runBrowserLaneRequestImport } = useAsyncAction(
    (input: {
      requestArtifactPath: string;
      storageStateJson: string;
      notes?: string;
    }) =>
      importBrowserLaneRequestResultAction({
        requestArtifactPath: input.requestArtifactPath,
        storageState: parseStorageStateJson(input.storageStateJson),
        ...(input.notes ? { notes: input.notes } : {}),
      }),
  );
  const { state: browserHandoffMutationState, run: runBrowserHandoffCompletion } = useAsyncAction(
    (input: {
      artifactPath: string;
      publishStatus: 'published' | 'failed';
      message?: string;
      publishUrl?: string;
    }) => completeBrowserHandoffAction(input),
  );
  const { state: inboxReplyHandoffMutationState, run: runInboxReplyHandoffCompletion } = useAsyncAction(
    (input: {
      artifactPath: string;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => completeInboxReplyHandoffAction(input),
  );
  const displayState = stateOverride ?? state;
  const displayJobsState = jobsStateOverride ?? jobsState;
  const displayBrowserLaneState = browserLaneStateOverride ?? browserLaneState;
  const displayBrowserHandoffState = browserHandoffStateOverride ?? browserHandoffState;
  const displayInboxReplyHandoffState = inboxReplyHandoffStateOverride ?? inboxReplyHandoffState;
  const displayUpdateState = updateStateOverride ?? updateState;
  const hasLiveSettingsData =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    typeof (displayState.data as SettingsResponse).settings === 'object' &&
    (displayState.data as SettingsResponse).settings !== null;
  const loadedData = hasLiveSettingsData ? (displayState.data as SettingsResponse) : undefined;
  const savedData = displayUpdateState.status === 'success' ? displayUpdateState.data : undefined;
  const effectiveSettings = mergeSettingsRecords(loadedData?.settings, savedData?.settings);
  const loadedFormValues = getLoadedFormValues(effectiveSettings);
  const canEditSettings =
    displayState.status === 'success' &&
    !!loadedData?.settings &&
    displayUpdateState.status !== 'loading';

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
  const [controlPending, setControlPending] = useState(false);
  const [activeBrowserLaneArtifactPath, setActiveBrowserLaneArtifactPath] = useState<string | null>(null);
  const [activeBrowserHandoffArtifactPath, setActiveBrowserHandoffArtifactPath] = useState<string | null>(null);
  const [activeInboxReplyHandoffArtifactPath, setActiveInboxReplyHandoffArtifactPath] = useState<string | null>(null);
  const [resolvedBrowserLaneRequestsByArtifactPath, setResolvedBrowserLaneRequestsByArtifactPath] = useState<
    Record<string, { resolvedAt: string; jobStatus: string; resolution?: unknown }>
  >({});
  const [resolvedBrowserHandoffsByArtifactPath, setResolvedBrowserHandoffsByArtifactPath] = useState<
    Record<string, { resolvedAt: string; status: string; resolution?: unknown }>
  >({});
  const [resolvedInboxReplyHandoffsByArtifactPath, setResolvedInboxReplyHandoffsByArtifactPath] = useState<
    Record<string, { resolvedAt: string; status: string; resolution?: unknown }>
  >({});
  const [browserLaneDraftByArtifactPath, setBrowserLaneDraftByArtifactPath] = useState<
    Record<string, { storageState: string; notes: string }>
  >({});
  const [browserHandoffDraftByArtifactPath, setBrowserHandoffDraftByArtifactPath] = useState<
    Record<string, { publishUrl: string; message: string }>
  >({});
  const [inboxReplyHandoffDraftByArtifactPath, setInboxReplyHandoffDraftByArtifactPath] = useState<
    Record<string, { deliveryUrl: string; message: string }>
  >({});
  const controlPendingRef = useRef(false);
  const displayValidationMessage = validationMessageOverride ?? validationMessage;
  const showPersistedSaveFeedback = !displayValidationMessage;
  const visibleSavedSettings = showPersistedSaveFeedback ? savedData?.settings : undefined;

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
  const hasLiveJobsData =
    typeof displayJobsState.data === 'object' &&
    displayJobsState.data !== null &&
    Array.isArray(displayJobsState.data.jobs);
  const visibleJobs = hasLiveJobsData ? displayJobsState.data.jobs : [];
  const jobsQueueContract = hasLiveJobsData ? asRecord(displayJobsState.data?.queue) : null;
  const liveQueue = {
    ...(runtimeQueue ?? {}),
    ...(jobsQueueContract ?? {}),
  };
  const hasLiveBrowserLaneData =
    typeof displayBrowserLaneState.data === 'object' &&
    displayBrowserLaneState.data !== null &&
    Array.isArray(displayBrowserLaneState.data.requests);
  const visibleBrowserLaneRequests = hasLiveBrowserLaneData
    ? displayBrowserLaneState.data.requests.map((request) => {
        const resolvedRequest = resolvedBrowserLaneRequestsByArtifactPath[request.artifactPath];
        const hasLiveResolution =
          request.resolvedAt !== null ||
          readStatusValue(request.resolution) !== null ||
          request.jobStatus === 'resolved';
        if (!resolvedRequest || hasLiveResolution) {
          return request;
        }

        return {
          ...request,
          resolvedAt: resolvedRequest.resolvedAt,
          jobStatus: resolvedRequest.jobStatus,
          ...(resolvedRequest.resolution !== undefined
            ? { resolution: resolvedRequest.resolution }
            : request.resolution !== undefined
              ? { resolution: request.resolution }
              : {}),
        };
      })
    : [];
  const hasLiveBrowserHandoffData =
    typeof displayBrowserHandoffState.data === 'object' &&
    displayBrowserHandoffState.data !== null &&
    Array.isArray(displayBrowserHandoffState.data.handoffs);
  const visibleBrowserHandoffs = hasLiveBrowserHandoffData
    ? displayBrowserHandoffState.data.handoffs.map((handoff) => {
        const resolvedHandoff = resolvedBrowserHandoffsByArtifactPath[handoff.artifactPath];
        const hasLiveResolution =
          handoff.resolvedAt !== null ||
          readStatusValue(handoff.resolution) !== null ||
          handoff.status !== 'pending';
        if (!resolvedHandoff || hasLiveResolution) {
          return handoff;
        }

        return {
          ...handoff,
          resolvedAt: resolvedHandoff.resolvedAt,
          status: resolvedHandoff.status,
          ...(resolvedHandoff.resolution !== undefined
            ? { resolution: resolvedHandoff.resolution }
            : handoff.resolution !== undefined
              ? { resolution: handoff.resolution }
              : {}),
        };
      })
    : [];
  const hasLiveInboxReplyHandoffData =
    typeof displayInboxReplyHandoffState.data === 'object' &&
    displayInboxReplyHandoffState.data !== null &&
    Array.isArray(displayInboxReplyHandoffState.data.handoffs);
  const visibleInboxReplyHandoffs = hasLiveInboxReplyHandoffData
    ? displayInboxReplyHandoffState.data.handoffs.map((handoff) => {
        const resolvedHandoff = resolvedInboxReplyHandoffsByArtifactPath[handoff.artifactPath];
        const hasLiveResolution =
          handoff.resolvedAt !== null ||
          readStatusValue(handoff.resolution) !== null ||
          handoff.status !== 'pending';
        if (!resolvedHandoff || hasLiveResolution) {
          return handoff;
        }

        return {
          ...handoff,
          resolvedAt: resolvedHandoff.resolvedAt,
          status: resolvedHandoff.status,
          ...(resolvedHandoff.resolution !== undefined
            ? { resolution: resolvedHandoff.resolution }
            : handoff.resolution !== undefined
              ? { resolution: handoff.resolution }
              : {}),
        };
      })
    : [];
  const recentJobs =
    hasLiveJobsData && displayJobsState.data?.recentJobs.length > 0
      ? displayJobsState.data.recentJobs
      : readRecordArray(runtimeContract?.recentJobs);
  const isRuntimeControlPending = controlPending || activeControl !== null;
  const browserLaneRequestFeedback =
    browserLaneRequestMutationState.status === 'success' && browserLaneRequestMutationState.data
      ? `已导入 browser lane session #${browserLaneRequestMutationState.data.channelAccount.id} (${readBrowserLaneImportSession(browserLaneRequestMutationState.data)?.status ?? 'unknown'})`
      : browserLaneRequestMutationState.status === 'error'
        ? `browser lane session 导入失败：${browserLaneRequestMutationState.error}`
        : null;
  const browserHandoffFeedback =
    browserHandoffMutationState.status === 'success' && browserHandoffMutationState.data
      ? `已结单 handoff draft #${browserHandoffMutationState.data.draftId} (${browserHandoffMutationState.data.status})`
      : browserHandoffMutationState.status === 'error'
        ? `browser handoff 结单失败：${browserHandoffMutationState.error}`
        : null;
  const inboxReplyHandoffFeedback =
    inboxReplyHandoffMutationState.status === 'success' && inboxReplyHandoffMutationState.data
      ? `已结单 inbox reply item #${inboxReplyHandoffMutationState.data.itemId} (${inboxReplyHandoffMutationState.data.status})`
      : inboxReplyHandoffMutationState.status === 'error'
        ? `inbox reply handoff 结单失败：${inboxReplyHandoffMutationState.error}`
        : null;
  const isBrowserLaneRequestMutationPending = browserLaneRequestMutationState.status === 'loading';
  const isBrowserHandoffMutationPending = browserHandoffMutationState.status === 'loading';
  const isInboxReplyHandoffMutationPending = inboxReplyHandoffMutationState.status === 'loading';

  useEffect(() => {
    if (!hasLiveBrowserLaneData) {
      return;
    }

    setResolvedBrowserLaneRequestsByArtifactPath((current) => {
      let changed = false;
      const next = { ...current };

      for (const request of displayBrowserLaneState.data.requests) {
        if (!(request.artifactPath in next)) {
          continue;
        }

        if (
          request.resolvedAt !== null ||
          readStatusValue(request.resolution) !== null ||
          request.jobStatus === 'resolved'
        ) {
          delete next[request.artifactPath];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [displayBrowserLaneState.data, hasLiveBrowserLaneData]);

  useEffect(() => {
    if (!hasLiveBrowserHandoffData) {
      return;
    }

    setResolvedBrowserHandoffsByArtifactPath((current) => {
      let changed = false;
      const next = { ...current };

      for (const handoff of displayBrowserHandoffState.data.handoffs) {
        if (!(handoff.artifactPath in next)) {
          continue;
        }

        if (
          handoff.resolvedAt !== null ||
          readStatusValue(handoff.resolution) !== null ||
          handoff.status !== 'pending'
        ) {
          delete next[handoff.artifactPath];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [displayBrowserHandoffState.data, hasLiveBrowserHandoffData]);

  useEffect(() => {
    if (!hasLiveInboxReplyHandoffData) {
      return;
    }

    setResolvedInboxReplyHandoffsByArtifactPath((current) => {
      let changed = false;
      const next = { ...current };

      for (const handoff of displayInboxReplyHandoffState.data.handoffs) {
        if (!(handoff.artifactPath in next)) {
          continue;
        }

        if (
          handoff.resolvedAt !== null ||
          readStatusValue(handoff.resolution) !== null ||
          handoff.status !== 'pending'
        ) {
          delete next[handoff.artifactPath];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [displayInboxReplyHandoffState.data, hasLiveInboxReplyHandoffData]);

  function handleSaveSettings() {
    if (!canEditSettings) {
      return;
    }

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
    if (controlPendingRef.current) {
      return;
    }

    controlPendingRef.current = true;
    setControlPending(true);
    setControlError(null);
    setControlMessage(null);
    setActiveControl(actionLabel);

    try {
      const result = await action();
      setControlMessage(successBuilder(result));
      reload();
      reloadJobs();
      reloadBrowserLane();
      reloadBrowserHandoffs();
      reloadInboxReplyHandoffs();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    } finally {
      controlPendingRef.current = false;
      setControlPending(false);
      setActiveControl(null);
    }
  }

  function handleJobAction(jobId: number, action: 'retry' | 'cancel') {
    if (controlPendingRef.current) {
      return;
    }

    controlPendingRef.current = true;
    setControlPending(true);
    setControlError(null);
    setControlMessage(null);
    setActiveControl(`${action}:${jobId}`);

    void mutateJob({ action, jobId })
      .then((result) => {
        setControlMessage(action === 'retry' ? `作业 #${result.job.id} 已重试` : `作业 #${result.job.id} 已取消`);
        reload();
        reloadJobs();
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      })
      .catch((error) => {
        setControlError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        controlPendingRef.current = false;
        setControlPending(false);
        setActiveControl(null);
      });
  }

  function handleEnqueueJob(type: 'monitor_fetch' | 'inbox_fetch' | 'reputation_fetch') {
    if (controlPendingRef.current) {
      return;
    }

    controlPendingRef.current = true;
    setControlPending(true);
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
        reloadBrowserLane();
        reloadBrowserHandoffs();
        reloadInboxReplyHandoffs();
      })
      .catch((error) => {
        setControlError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        controlPendingRef.current = false;
        setControlPending(false);
        setActiveControl(null);
      });
  }

  function handleImportBrowserLaneRequest(request: BrowserLaneRequestRecord) {
    if (isBrowserLaneRequestMutationPending) {
      return;
    }

    const requestDraft = browserLaneDraftByArtifactPath[request.artifactPath];
    const notes = requestDraft?.notes.trim().length ? requestDraft.notes.trim() : undefined;

    setActiveBrowserLaneArtifactPath(request.artifactPath);
    void runBrowserLaneRequestImport({
      requestArtifactPath: request.artifactPath,
      storageStateJson: requestDraft?.storageState ?? '',
      ...(notes ? { notes } : {}),
    })
      .then((response) => {
        setResolvedBrowserLaneRequestsByArtifactPath((current) => ({
          ...current,
          [request.artifactPath]: buildOptimisticBrowserLaneRequestResolution(response),
        }));
        setBrowserLaneDraftByArtifactPath((current) => {
          const { [request.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadBrowserLane();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveBrowserLaneArtifactPath(null);
      });
  }

  function handleCompleteBrowserHandoff(
    handoff: BrowserHandoffRecord,
    publishStatus: 'published' | 'failed',
  ) {
    if (isBrowserHandoffMutationPending) {
      return;
    }

    const handoffDraft = browserHandoffDraftByArtifactPath[handoff.artifactPath];
    const message = handoffDraft?.message.trim().length ? handoffDraft.message.trim() : undefined;
    const publishUrl = handoffDraft?.publishUrl.trim().length ? handoffDraft.publishUrl.trim() : undefined;

    setActiveBrowserHandoffArtifactPath(handoff.artifactPath);
    void runBrowserHandoffCompletion({
      artifactPath: handoff.artifactPath,
      publishStatus,
      ...(message ? { message } : {}),
      ...(publishUrl ? { publishUrl } : {}),
    })
      .then((response) => {
        setResolvedBrowserHandoffsByArtifactPath((current) => ({
          ...current,
          [handoff.artifactPath]: buildOptimisticBrowserHandoffResolution(response),
        }));
        setBrowserHandoffDraftByArtifactPath((current) => {
          const { [handoff.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadBrowserHandoffs();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveBrowserHandoffArtifactPath(null);
      });
  }

  function handleCompleteInboxReplyHandoff(
    handoff: InboxReplyHandoffRecord,
    replyStatus: 'sent' | 'failed',
  ) {
    if (isInboxReplyHandoffMutationPending) {
      return;
    }

    const handoffDraft = inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath];
    const message = handoffDraft?.message.trim().length ? handoffDraft.message.trim() : undefined;
    const deliveryUrl = handoffDraft?.deliveryUrl.trim().length ? handoffDraft.deliveryUrl.trim() : undefined;

    setActiveInboxReplyHandoffArtifactPath(handoff.artifactPath);
    void runInboxReplyHandoffCompletion({
      artifactPath: handoff.artifactPath,
      replyStatus,
      ...(message ? { message } : {}),
      ...(deliveryUrl ? { deliveryUrl } : {}),
    })
      .then((response) => {
        setResolvedInboxReplyHandoffsByArtifactPath((current) => ({
          ...current,
          [handoff.artifactPath]: buildOptimisticInboxReplyHandoffResolution(response),
        }));
        setInboxReplyHandoffDraftByArtifactPath((current) => {
          const { [handoff.artifactPath]: _ignored, ...rest } = current;
          return rest;
        });
        reloadInboxReplyHandoffs();
      })
      .catch(() => undefined)
      .finally(() => {
        setActiveInboxReplyHandoffArtifactPath(null);
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
              disabled={!canEditSettings}
              onClick={handleSaveSettings}
            />
          </>
        }
      />

      <div style={cardGridStyle}>
        <SectionCard title="设置总览" description="这里区分当前加载值与最近保存回执，便于确认当前进程是否已经同步到最新设置。">
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ ...statusPillStyle, background: '#dbeafe', color: '#1d4ed8' }}>兼容接口 `/api/settings`</span>
              <span style={{ ...statusPillStyle, background: '#ecfdf5', color: '#047857' }}>
                当前加载：{hasLiveSettingsData ? '已同步' : displayState.status === 'error' ? '失败' : '等待同步'}
              </span>
              <span style={{ ...statusPillStyle, background: '#fef3c7', color: '#92400e' }}>
                保存状态：
                {displayValidationMessage
                  ? '校验失败'
                  : displayUpdateState.status === 'success'
                    ? '已写回并已触发 reload'
                    : displayUpdateState.status === 'error'
                      ? '失败'
                      : '未提交'}
              </span>
            </div>

            {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载设置...</p> : null}

            {displayState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>设置加载失败：{displayState.error}</p>
            ) : null}

            {loadedData?.settings ? (
              <div style={{ display: 'grid', gap: '8px', color: '#334155' }}>
                <div style={{ fontWeight: 700 }}>当前加载值</div>
                <div>schedulerIntervalMinutes: {loadedData.settings.schedulerIntervalMinutes}</div>
                <div>allowlist: {loadedData.settings.allowlist.length > 0 ? formatList(loadedData.settings.allowlist) : '未提供'}</div>
                <div>rssDefaults: {loadedData.settings.rssDefaults.length > 0 ? formatList(loadedData.settings.rssDefaults) : '未提供'}</div>
                <div>
                  monitorRssFeeds:{' '}
                  {readSettingsList(loadedData.settings.monitorRssFeeds).length > 0
                    ? formatList(readSettingsList(loadedData.settings.monitorRssFeeds))
                    : '未提供'}
                </div>
                <div>
                  monitorXQueries:{' '}
                  {readSettingsList(loadedData.settings.monitorXQueries).length > 0
                    ? formatList(readSettingsList(loadedData.settings.monitorXQueries))
                    : '未提供'}
                </div>
                <div>
                  monitorRedditQueries:{' '}
                  {readSettingsList(loadedData.settings.monitorRedditQueries).length > 0
                    ? formatList(readSettingsList(loadedData.settings.monitorRedditQueries))
                    : '未提供'}
                </div>
                <div>
                  monitorV2exQueries:{' '}
                  {readSettingsList(loadedData.settings.monitorV2exQueries).length > 0
                    ? formatList(readSettingsList(loadedData.settings.monitorV2exQueries))
                    : '未提供'}
                </div>
              </div>
            ) : null}

            {visibleSavedSettings ? (
              <div style={{ display: 'grid', gap: '8px', color: '#92400e' }}>
                <div style={{ fontWeight: 700 }}>最近保存返回</div>
                <div>allowlist 已立即同步到当前进程；其它运行参数请结合当前 runtime / reload 结果确认是否已生效。</div>
                <div>schedulerIntervalMinutes: {visibleSavedSettings.schedulerIntervalMinutes}</div>
                <div>allowlist: {visibleSavedSettings.allowlist.length > 0 ? formatList(visibleSavedSettings.allowlist) : '未提供'}</div>
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
                disabled={!canEditSettings}
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
                disabled={isRuntimeControlPending}
                onClick={() => {
                  void runControlAction('reload', reloadSchedulerAction, () => 'Scheduler 已重载');
                }}
              />
              <ActionButton
                label={activeControl === 'tick' ? '正在执行 Tick...' : '立即 Tick'}
                disabled={isRuntimeControlPending}
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
                disabled={isRuntimeControlPending}
                onClick={() => {
                  void runControlAction('monitor_fetch', fetchMonitorAction, (result) => {
                    const fetchResult = result as FetchControlResponse;
                    return `Monitor 已抓取，新增 ${fetchResult.inserted} 条`;
                  });
                }}
              />
              <ActionButton
                label={activeControl === 'inbox_fetch' ? '正在抓取 Inbox...' : '抓取 Inbox'}
                disabled={isRuntimeControlPending}
                onClick={() => {
                  void runControlAction('inbox_fetch', fetchInboxAction, (result) => {
                    const fetchResult = result as FetchControlResponse;
                    return `Inbox 已抓取，新增 ${fetchResult.inserted} 条`;
                  });
                }}
              />
              <ActionButton
                label={activeControl === 'reputation_fetch' ? '正在抓取 Reputation...' : '抓取 Reputation'}
                disabled={isRuntimeControlPending}
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
              { label: 'Pending Jobs', value: formatContractValue(liveQueue.pending) },
              { label: 'Running Jobs', value: formatContractValue(liveQueue.running) },
              { label: 'Done Jobs', value: formatContractValue(liveQueue.done) },
              { label: 'Failed Jobs', value: formatContractValue(liveQueue.failed) },
              { label: 'Canceled Jobs', value: formatContractValue(liveQueue.canceled) },
              { label: 'Due Pending', value: formatContractValue(liveQueue.duePending) },
            ])}

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>排程新作业</div>
              <label style={{ display: 'grid', gap: '8px' }}>
                <span style={{ fontWeight: 700 }}>runAt</span>
                <input
                  data-settings-field="enqueueRunAt"
                  value={enqueueRunAtDraft}
                  disabled={isRuntimeControlPending}
                  onChange={(event) => setEnqueueRunAtDraft(event.target.value)}
                  style={fieldStyle}
                />
              </label>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <ActionButton
                  label={activeControl === 'enqueue:monitor_fetch' ? '正在入队 Monitor...' : '排程 Monitor Fetch'}
                  disabled={isRuntimeControlPending}
                  onClick={() => {
                    handleEnqueueJob('monitor_fetch');
                  }}
                />
                <ActionButton
                  label={activeControl === 'enqueue:inbox_fetch' ? '正在入队 Inbox...' : '排程 Inbox Fetch'}
                  disabled={isRuntimeControlPending}
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
                  disabled={isRuntimeControlPending}
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
              {hasLiveJobsData && visibleJobs.length > 0 ? (
                visibleJobs.map((job) => (
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
                          disabled={isRuntimeControlPending}
                          onClick={() => {
                            handleJobAction(job.id, 'retry');
                          }}
                        />
                      ) : null}
                      {job.canCancel ? (
                        <ActionButton
                          label={activeControl === `cancel:${job.id}` ? '正在取消...' : '取消'}
                          disabled={isRuntimeControlPending}
                          onClick={() => {
                            handleJobAction(job.id, 'cancel');
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ))
              ) : hasLiveJobsData ? (
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

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>Browser Lane 工单</div>
              {browserLaneRequestFeedback ? (
                <div
                  style={{
                    color: browserLaneRequestMutationState.status === 'error' ? '#b91c1c' : '#166534',
                    fontWeight: 700,
                  }}
                >
                  {browserLaneRequestFeedback}
                </div>
              ) : null}
              {displayBrowserLaneState.status === 'loading' ? (
                <div style={{ color: '#475569' }}>正在加载 browser lane requests...</div>
              ) : null}
              {displayBrowserLaneState.status === 'error' ? (
                <div style={{ color: '#b91c1c' }}>
                  browser lane requests 加载失败：{displayBrowserLaneState.error}
                </div>
              ) : null}
              {hasLiveBrowserLaneData && visibleBrowserLaneRequests.length > 0 ? (
                visibleBrowserLaneRequests.map((request) => (
                  <div
                    key={`${request.channelAccountId}-${request.artifactPath}-${request.requestedAt}`}
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
                      #{request.channelAccountId} · {request.platform} · {request.action} · {request.jobStatus}
                    </div>
                    <div style={{ color: '#475569' }}>requestedAt: {request.requestedAt}</div>
                    <div style={{ color: '#475569' }}>artifactPath: {request.artifactPath}</div>
                    <div style={{ color: '#475569' }}>
                      resolvedAt: {request.resolvedAt ?? '未结单'}
                    </div>
                    <div style={{ color: '#475569' }}>
                      resolution: {formatContractValue(readStatusValue(request.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      session status: {formatContractValue(readBrowserLaneSessionStatus(request.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      validatedAt: {formatContractValue(readBrowserLaneSessionValidatedAt(request.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      storageStatePath: {formatContractValue(readBrowserLaneSessionStorageStatePath(request.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      notes: {formatContractValue(readBrowserLaneSessionNotes(request.resolution))}
                    </div>
                    {request.resolvedAt === null &&
                    readStatusValue(request.resolution) === null &&
                    request.jobStatus !== 'resolved' ? (
                      <div style={{ display: 'grid', gap: '10px', marginTop: '6px' }}>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>storageState JSON</span>
                          <textarea
                            data-settings-browser-lane-field="storageState"
                            value={browserLaneDraftByArtifactPath[request.artifactPath]?.storageState ?? ''}
                            onChange={(event) =>
                              setBrowserLaneDraftByArtifactPath((current) => ({
                                ...current,
                                [request.artifactPath]: {
                                  storageState: event.target.value,
                                  notes: current[request.artifactPath]?.notes ?? '',
                                },
                              }))
                            }
                            onInput={(event) =>
                              setBrowserLaneDraftByArtifactPath((current) => ({
                                ...current,
                                [request.artifactPath]: {
                                  storageState: event.target.value,
                                  notes: current[request.artifactPath]?.notes ?? '',
                                },
                              }))
                            }
                            rows={4}
                            placeholder='{"cookies":[],"origins":[]}'
                            style={{ ...fieldStyle, resize: 'vertical' }}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>导入备注</span>
                          <input
                            data-settings-browser-lane-field="notes"
                            value={browserLaneDraftByArtifactPath[request.artifactPath]?.notes ?? ''}
                            onChange={(event) =>
                              setBrowserLaneDraftByArtifactPath((current) => ({
                                ...current,
                                [request.artifactPath]: {
                                  storageState: current[request.artifactPath]?.storageState ?? '',
                                  notes: event.target.value,
                                },
                              }))
                            }
                            onInput={(event) =>
                              setBrowserLaneDraftByArtifactPath((current) => ({
                                ...current,
                                [request.artifactPath]: {
                                  storageState: current[request.artifactPath]?.storageState ?? '',
                                  notes: event.target.value,
                                },
                              }))
                            }
                            placeholder="可选：记录导入备注"
                            style={fieldStyle}
                          />
                        </label>
                        <ActionButton
                          label={
                            isBrowserLaneRequestMutationPending &&
                            activeBrowserLaneArtifactPath === request.artifactPath
                              ? '正在导入 Session...'
                              : '导入 Session'
                          }
                          tone="primary"
                          disabled={isBrowserLaneRequestMutationPending}
                          onClick={() => handleImportBrowserLaneRequest(request)}
                        />
                      </div>
                    ) : null}
                  </div>
                ))
              ) : hasLiveBrowserLaneData ? (
                <div style={{ color: '#475569' }}>当前没有 browser lane requests。</div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>Browser Handoff 工单</div>
              {browserHandoffFeedback ? (
                <div
                  style={{
                    color: browserHandoffMutationState.status === 'error' ? '#b91c1c' : '#166534',
                    fontWeight: 700,
                  }}
                >
                  {browserHandoffFeedback}
                </div>
              ) : null}
              {displayBrowserHandoffState.status === 'loading' ? (
                <div style={{ color: '#475569' }}>正在加载 browser handoffs...</div>
              ) : null}
              {displayBrowserHandoffState.status === 'error' ? (
                <div style={{ color: '#b91c1c' }}>
                  browser handoffs 加载失败：{displayBrowserHandoffState.error}
                </div>
              ) : null}
              {hasLiveBrowserHandoffData && visibleBrowserHandoffs.length > 0 ? (
                visibleBrowserHandoffs.map((handoff) => (
                  <div
                    key={`${handoff.artifactPath}-${handoff.updatedAt}`}
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
                      {handoff.platform} · draft #{handoff.draftId} · {handoff.status}
                    </div>
                    {typeof handoff.channelAccountId === 'number' ? (
                      <div style={{ color: '#475569' }}>account #{handoff.channelAccountId}</div>
                    ) : null}
                    {handoff.accountDisplayName ? (
                      <div style={{ color: '#475569' }}>account: {handoff.accountDisplayName}</div>
                    ) : null}
                    {handoff.ownership ? (
                      <div style={{ color: '#475569' }}>ownership: {handoff.ownership}</div>
                    ) : null}
                    <div style={{ color: '#475569' }}>title: {handoff.title ?? '未提供'}</div>
                    <div style={{ color: '#475569' }}>artifactPath: {handoff.artifactPath}</div>
                    <div style={{ color: '#475569' }}>updatedAt: {handoff.updatedAt}</div>
                    <div style={{ color: '#475569' }}>
                      resolvedAt: {handoff.resolvedAt ?? '未结单'}
                    </div>
                    <div style={{ color: '#475569' }}>
                      resolution: {formatContractValue(readStatusValue(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      resolution detail: {formatContractValue(readResolutionDetail(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      publishUrl: {formatContractValue(readResolutionPublishUrl(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      message: {formatContractValue(readResolutionMessage(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      publishedAt: {formatContractValue(readResolutionPublishedAt(handoff.resolution))}
                    </div>
                    {handoff.resolvedAt === null &&
                    readStatusValue(handoff.resolution) === null &&
                    handoff.status === 'pending' ? (
                      <div style={{ display: 'grid', gap: '10px', marginTop: '6px' }}>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>publishUrl</span>
                          <input
                            data-settings-browser-handoff-field="publishUrl"
                            value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.publishUrl ?? ''}
                            onChange={(event) =>
                              setBrowserHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  publishUrl: event.target.value,
                                  message: current[handoff.artifactPath]?.message ?? '',
                                },
                              }))
                            }
                            onInput={(event) =>
                              setBrowserHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  publishUrl: event.target.value,
                                  message: current[handoff.artifactPath]?.message ?? '',
                                },
                              }))
                            }
                            placeholder="可选：记录发布链接"
                            style={fieldStyle}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>处理备注</span>
                          <input
                            data-settings-browser-handoff-field="message"
                            value={browserHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
                            onChange={(event) =>
                              setBrowserHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  publishUrl: current[handoff.artifactPath]?.publishUrl ?? '',
                                  message: event.target.value,
                                },
                              }))
                            }
                            onInput={(event) =>
                              setBrowserHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  publishUrl: current[handoff.artifactPath]?.publishUrl ?? '',
                                  message: event.target.value,
                                },
                              }))
                            }
                            placeholder="可选：记录发布结果"
                            style={fieldStyle}
                          />
                        </label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <ActionButton
                            label={
                              isBrowserHandoffMutationPending &&
                              activeBrowserHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记已发布...'
                                : '标记已发布'
                            }
                            tone="primary"
                            disabled={isBrowserHandoffMutationPending}
                            onClick={() => handleCompleteBrowserHandoff(handoff, 'published')}
                          />
                          <ActionButton
                            label={
                              isBrowserHandoffMutationPending &&
                              activeBrowserHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记失败...'
                                : '标记失败'
                            }
                            tone="secondary"
                            disabled={isBrowserHandoffMutationPending}
                            onClick={() => handleCompleteBrowserHandoff(handoff, 'failed')}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : hasLiveBrowserHandoffData ? (
                <div style={{ color: '#475569' }}>当前没有 browser handoffs。</div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontWeight: 700 }}>Inbox Reply Handoff 工单</div>
              {inboxReplyHandoffFeedback ? (
                <div
                  style={{
                    color: inboxReplyHandoffMutationState.status === 'error' ? '#b91c1c' : '#166534',
                    fontWeight: 700,
                  }}
                >
                  {inboxReplyHandoffFeedback}
                </div>
              ) : null}
              {displayInboxReplyHandoffState.status === 'loading' ? (
                <div style={{ color: '#475569' }}>正在加载 inbox reply handoffs...</div>
              ) : null}
              {displayInboxReplyHandoffState.status === 'error' ? (
                <div style={{ color: '#b91c1c' }}>
                  inbox reply handoffs 加载失败：{displayInboxReplyHandoffState.error}
                </div>
              ) : null}
              {hasLiveInboxReplyHandoffData && visibleInboxReplyHandoffs.length > 0 ? (
                visibleInboxReplyHandoffs.map((handoff) => (
                  <div
                    key={`${handoff.artifactPath}-${handoff.updatedAt}`}
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
                      {handoff.platform} · item #{handoff.itemId} · {handoff.status}
                    </div>
                    {typeof handoff.channelAccountId === 'number' ? (
                      <div style={{ color: '#475569' }}>account #{handoff.channelAccountId}</div>
                    ) : null}
                    <div style={{ color: '#475569' }}>source: {handoff.source}</div>
                    <div style={{ color: '#475569' }}>author: {handoff.author ?? '未提供'}</div>
                    <div style={{ color: '#475569' }}>title: {handoff.title ?? '未提供'}</div>
                    <div style={{ color: '#475569' }}>artifactPath: {handoff.artifactPath}</div>
                    <div style={{ color: '#475569' }}>updatedAt: {handoff.updatedAt}</div>
                    <div style={{ color: '#475569' }}>
                      resolvedAt: {handoff.resolvedAt ?? '未结单'}
                    </div>
                    <div style={{ color: '#475569' }}>
                      resolution: {formatContractValue(readStatusValue(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      resolution detail: {formatContractValue(readResolutionDetail(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      deliveryUrl: {formatContractValue(readResolutionDeliveryUrl(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      message: {formatContractValue(readResolutionMessage(handoff.resolution))}
                    </div>
                    <div style={{ color: '#475569' }}>
                      deliveredAt: {formatContractValue(readResolutionDeliveredAt(handoff.resolution))}
                    </div>
                    {handoff.resolvedAt === null &&
                    readStatusValue(handoff.resolution) === null &&
                    handoff.status === 'pending' ? (
                      <div style={{ display: 'grid', gap: '10px', marginTop: '6px' }}>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>deliveryUrl</span>
                          <input
                            data-settings-inbox-reply-handoff-field="deliveryUrl"
                            value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.deliveryUrl ?? ''}
                            onChange={(event) =>
                              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  deliveryUrl: event.target.value,
                                  message: current[handoff.artifactPath]?.message ?? '',
                                },
                              }))
                            }
                            onInput={(event) =>
                              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  deliveryUrl: event.target.value,
                                  message: current[handoff.artifactPath]?.message ?? '',
                                },
                              }))
                            }
                            placeholder="可选：记录发送链接"
                            style={fieldStyle}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#334155' }}>处理备注</span>
                          <input
                            data-settings-inbox-reply-handoff-field="message"
                            value={inboxReplyHandoffDraftByArtifactPath[handoff.artifactPath]?.message ?? ''}
                            onChange={(event) =>
                              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  deliveryUrl: current[handoff.artifactPath]?.deliveryUrl ?? '',
                                  message: event.target.value,
                                },
                              }))
                            }
                            onInput={(event) =>
                              setInboxReplyHandoffDraftByArtifactPath((current) => ({
                                ...current,
                                [handoff.artifactPath]: {
                                  deliveryUrl: current[handoff.artifactPath]?.deliveryUrl ?? '',
                                  message: event.target.value,
                                },
                              }))
                            }
                            placeholder="可选：记录发送结果"
                            style={fieldStyle}
                          />
                        </label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <ActionButton
                            label={
                              isInboxReplyHandoffMutationPending &&
                              activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记已发送...'
                                : '标记已发送'
                            }
                            tone="primary"
                            disabled={isInboxReplyHandoffMutationPending}
                            onClick={() => handleCompleteInboxReplyHandoff(handoff, 'sent')}
                          />
                          <ActionButton
                            label={
                              isInboxReplyHandoffMutationPending &&
                              activeInboxReplyHandoffArtifactPath === handoff.artifactPath
                                ? '正在标记失败...'
                                : '标记失败'
                            }
                            tone="secondary"
                            disabled={isInboxReplyHandoffMutationPending}
                            onClick={() => handleCompleteInboxReplyHandoff(handoff, 'failed')}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : hasLiveInboxReplyHandoffData ? (
                <div style={{ color: '#475569' }}>当前没有 inbox reply handoffs。</div>
              ) : null}
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
            <div style={{ color: '#92400e', fontWeight: 700 }}>
              allowlist 保存后会立即影响当前进程的访问控制，可填写精确 IP、CIDR 子网或 *。
            </div>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>allowlist</span>
              <input
                data-settings-field="allowlist"
                value={allowlist}
                disabled={!canEditSettings}
                onChange={(event) => {
                  setValidationMessage(null);
                  setAllowlistDraft(event.target.value);
                }}
                style={fieldStyle}
              />
            </label>
            {renderInfoRows([
              { label: '当前 allowlist', value: effectiveSettings?.allowlist.length ? formatList(effectiveSettings.allowlist) : '未提供' },
              {
                label: '最近保存返回',
                value: visibleSavedSettings?.allowlist?.length ? formatList(visibleSavedSettings.allowlist) : '未提供',
              },
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
                disabled={!canEditSettings}
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
                disabled={!canEditSettings}
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
                disabled={!canEditSettings}
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
                disabled={!canEditSettings}
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
                disabled={!canEditSettings}
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
                value: readSettingsList(visibleSavedSettings?.monitorRssFeeds).length
                  ? formatList(readSettingsList(visibleSavedSettings?.monitorRssFeeds))
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
                value: readSettingsList(visibleSavedSettings?.monitorXQueries).length
                  ? formatList(readSettingsList(visibleSavedSettings?.monitorXQueries))
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
                value: readSettingsList(visibleSavedSettings?.monitorRedditQueries).length
                  ? formatList(readSettingsList(visibleSavedSettings?.monitorRedditQueries))
                  : '未提供',
              },
              {
                label: '最近保存 V2EX 关键词',
                value: readSettingsList(visibleSavedSettings?.monitorV2exQueries).length
                  ? formatList(readSettingsList(visibleSavedSettings?.monitorV2exQueries))
                  : '未提供',
              },
            ])}
          </div>
        </SectionCard>

        <SectionCard title="原始接口 Contract" description="保留原始 JSON 视图，方便前后端联调和观察新增字段落位。">
          {hasLiveSettingsData && loadedData ? (
            <JsonPreview value={loadedData} />
          ) : (
            <p style={{ margin: 0, color: '#475569' }}>接口成功返回后，会在这里展示完整响应。</p>
          )}
        </SectionCard>

        {(displayValidationMessage || displayUpdateState.status !== 'idle') && (
          <SectionCard title="最近保存结果" description="保存前校验和最近一次 PATCH 结果会显示在这里。">
            {displayValidationMessage ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>保存前校验失败：{displayValidationMessage}</p>
            ) : null}
            {showPersistedSaveFeedback && displayUpdateState.status === 'success' ? (
              <div style={{ color: '#166534', display: 'grid', gap: '8px' }}>
              <div style={{ fontWeight: 700 }}>设置已保存；allowlist 已生效，其它运行参数请结合 runtime 结果确认</div>
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
            {showPersistedSaveFeedback && displayUpdateState.status === 'error' ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>保存失败：{displayUpdateState.error}</p>
            ) : null}
          </SectionCard>
        )}
      </div>
    </section>
  );
}

function isSupportedAllowlistEntry(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === '*') {
    return true;
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return getIpVersion(trimmed) !== null;
  }

  const address = trimmed.slice(0, slashIndex).trim();
  const prefixText = trimmed.slice(slashIndex + 1).trim();
  if (!address || !/^\d+$/.test(prefixText) || prefixText.includes('/')) {
    return false;
  }

  const version = getIpVersion(address);
  if (!version) {
    return false;
  }

  const prefix = Number(prefixText);
  return prefix >= 0 && prefix <= (version === 4 ? 32 : 128);
}

function getIpVersion(value: string) {
  const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  if (isValidIpv4(normalized)) {
    return 4;
  }
  if (isValidIpv6(normalized)) {
    return 6;
  }
  return null;
}

function isValidIpv4(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isValidIpv6(value: string) {
  try {
    new URL(`http://[${value}]`);
    return true;
  } catch {
    return false;
  }
}
