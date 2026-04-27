import { useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { JsonPreview } from '../components/JsonPreview';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface ChannelAccountRecord {
  id: number;
  projectId?: number | null;
  platform: string;
  accountKey: string;
  displayName: string;
  authType: string;
  status: string;
  metadata: Record<string, unknown>;
  session?: ChannelAccountSessionSummary;
  latestBrowserLaneArtifact?: {
    action: 'request_session' | 'relogin';
    jobStatus: string;
    requestedAt: string;
    artifactPath: string;
    resolvedAt: string | null;
    resolution?: unknown;
  };
  latestBrowserHandoffArtifact?: {
    channelAccountId?: number;
    accountDisplayName?: string | null;
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
  };
  latestInboxReplyHandoffArtifact?: {
    channelAccountId?: number;
    ownership?: string;
    projectId?: number | null;
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
  };
  readiness?: Record<string, unknown>;
  publishReadiness?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelAccountSessionSummary {
  hasSession: boolean;
  status: 'active' | 'expired' | 'missing' | string;
  validatedAt: string | null;
  storageStatePath: string | null;
  id?: string;
  notes?: string;
}

export interface ChannelAccountsResponse {
  channelAccounts?: ChannelAccountRecord[];
  [key: string]: unknown;
}

export async function loadChannelAccountsRequest(): Promise<ChannelAccountsResponse> {
  return apiRequest<ChannelAccountsResponse>('/api/channel-accounts');
}

export interface CreateChannelAccountPayload {
  projectId?: number | null;
  platform: string;
  accountKey: string;
  displayName: string;
  authType: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface CreateChannelAccountResponse {
  channelAccount: ChannelAccountRecord;
}

export interface UpdateChannelAccountPayload {
  projectId?: number | null;
  platform?: string;
  accountKey?: string;
  displayName?: string;
  authType?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateChannelAccountResponse {
  channelAccount: ChannelAccountRecord;
}

export interface SaveChannelAccountSessionPayload {
  storageStatePath?: string;
  storageState?: Record<string, unknown>;
  status?: 'active' | 'expired' | 'missing';
  validatedAt?: string | null;
  notes?: string;
}

export interface SaveChannelAccountSessionResponse {
  ok: boolean;
  session: ChannelAccountSessionSummary;
  channelAccount: ChannelAccountRecord;
}

export interface RequestChannelAccountSessionActionPayload {
  action?: 'request_session' | 'relogin';
}

export interface RequestChannelAccountSessionActionResponse {
  ok: boolean;
  sessionAction: {
    action: 'request_session' | 'relogin';
    accountId: number;
    status: string;
    requestedAt: string;
    message: string;
    nextStep: string;
    jobId?: number;
    jobStatus?: string;
    artifactPath?: string | null;
    reused?: boolean;
  };
  channelAccount: ChannelAccountRecord;
}

export interface TestChannelAccountConnectionResponse {
  ok: boolean;
  test: {
    checkedAt: string;
    status: string;
    summary?: string;
    message?: string;
    action?: string;
    nextStep?: string | Record<string, unknown>;
    readiness?: Record<string, unknown>;
    details?: Record<string, unknown>;
    result?: string | Record<string, unknown>;
    feedback?: string | Record<string, unknown>;
    recommendedAction?: string | Record<string, unknown>;
    recommendation?: Record<string, unknown>;
  };
  channelAccount: ChannelAccountRecord;
}

export async function createChannelAccountRequest(
  input: CreateChannelAccountPayload,
): Promise<CreateChannelAccountResponse> {
  return apiRequest<CreateChannelAccountResponse>('/api/channel-accounts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function updateChannelAccountRequest(
  accountId: number,
  input: UpdateChannelAccountPayload,
): Promise<UpdateChannelAccountResponse> {
  return apiRequest<UpdateChannelAccountResponse>(`/api/channel-accounts/${accountId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function testChannelAccountConnectionRequest(
  accountId: number,
): Promise<TestChannelAccountConnectionResponse> {
  return apiRequest<TestChannelAccountConnectionResponse>(`/api/channel-accounts/${accountId}/test`, {
    method: 'POST',
  });
}

export async function saveChannelAccountSessionRequest(
  accountId: number,
  input: SaveChannelAccountSessionPayload,
): Promise<SaveChannelAccountSessionResponse> {
  return apiRequest<SaveChannelAccountSessionResponse>(`/api/channel-accounts/${accountId}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export async function requestChannelAccountSessionActionRequest(
  accountId: number,
  input: RequestChannelAccountSessionActionPayload = {},
): Promise<RequestChannelAccountSessionActionResponse> {
  return apiRequest<RequestChannelAccountSessionActionResponse>(
    `/api/channel-accounts/${accountId}/session/request`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );
}

export async function runChannelAccountConnectionTest(
  accountId: number,
  action: (targetAccountId: number) => Promise<TestChannelAccountConnectionResponse>,
  onSuccess: () => void,
): Promise<TestChannelAccountConnectionResponse> {
  const result = await action(accountId);
  onSuccess();
  return result;
}

interface EditFormValue {
  projectId: string;
  displayName: string;
  status: string;
  metadata: string;
  sessionStorageStatePath: string;
  sessionStorageStateJson: string;
  sessionStatus: string;
  sessionValidatedAt: string;
  sessionNotes: string;
}

type LatestSessionMutation =
  | {
      kind: 'save_session';
      accountId: number;
    }
  | {
      kind: 'session_action';
      accountId: number;
    }
  | null;

interface SessionSaveFeedback {
  tone: 'success' | 'error';
  message: string;
}

interface ChannelAccountsPageProps {
  loadChannelAccountsAction?: () => Promise<ChannelAccountsResponse>;
  createChannelAccountAction?: (input: CreateChannelAccountPayload) => Promise<CreateChannelAccountResponse>;
  updateChannelAccountAction?: (
    accountId: number,
    input: UpdateChannelAccountPayload,
  ) => Promise<UpdateChannelAccountResponse>;
  testChannelAccountAction?: (accountId: number) => Promise<TestChannelAccountConnectionResponse>;
  saveChannelAccountSessionAction?: (
    accountId: number,
    input: SaveChannelAccountSessionPayload,
  ) => Promise<SaveChannelAccountSessionResponse>;
  requestChannelAccountSessionAction?: (
    accountId: number,
    input?: RequestChannelAccountSessionActionPayload,
  ) => Promise<RequestChannelAccountSessionActionResponse>;
  stateOverride?: AsyncState<ChannelAccountsResponse>;
  createStateOverride?: AsyncState<CreateChannelAccountResponse>;
  updateStateOverride?: AsyncState<UpdateChannelAccountResponse>;
  testConnectionStateOverride?: AsyncState<TestChannelAccountConnectionResponse>;
  saveSessionStateOverride?: AsyncState<SaveChannelAccountSessionResponse>;
  sessionActionStateOverride?: AsyncState<RequestChannelAccountSessionActionResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

const headerSecondaryButtonStyle = {
  borderRadius: '12px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#122033',
  padding: '12px 16px',
  fontWeight: 700,
  boxShadow: 'none',
} as const;

const disabledHeaderSecondaryButtonStyle = {
  ...headerSecondaryButtonStyle,
  background: '#f8fafc',
  color: '#94a3b8',
  cursor: 'not-allowed',
} as const;

const headerPrimaryButtonStyle = {
  borderRadius: '12px',
  border: 'none',
  background: '#2563eb',
  color: '#ffffff',
  padding: '12px 16px',
  fontWeight: 700,
  boxShadow: '0 12px 24px rgba(37, 99, 235, 0.18)',
} as const;

const disabledHeaderPrimaryButtonStyle = {
  ...headerPrimaryButtonStyle,
  background: '#bfdbfe',
  color: '#475569',
  boxShadow: 'none',
  cursor: 'not-allowed',
} as const;

const createPlatformOptions = [
  { value: 'x', label: 'X / Twitter（首发可用）' },
  { value: 'reddit', label: 'Reddit（首发可用）' },
  { value: 'facebookGroup', label: 'Facebook Group（人工接管）' },
  { value: 'instagram', label: 'Instagram（人工接管）' },
  { value: 'tiktok', label: 'TikTok（人工接管）' },
  { value: 'xiaohongshu', label: '小红书（人工接管）' },
  { value: 'weibo', label: '微博（人工接管）' },
  { value: 'blog', label: 'Blog（本地文件发布）' },
] as const;

const createPlatformDefaults: Record<
  string,
  { accountKey: string; displayName: string; authType: string; status: string; metadata: string }
> = {
  x: {
    accountKey: 'x-main',
    displayName: 'X Primary',
    authType: 'api',
    status: 'unknown',
    metadata: '',
  },
  reddit: {
    accountKey: 'reddit-main',
    displayName: 'Reddit Primary',
    authType: 'oauth',
    status: 'unknown',
    metadata: '',
  },
  facebookGroup: {
    accountKey: 'facebook-group-main',
    displayName: 'Facebook Group Manual',
    authType: 'browser',
    status: 'unknown',
    metadata: '',
  },
  instagram: {
    accountKey: 'instagram-main',
    displayName: 'Instagram Primary',
    authType: 'browser',
    status: 'unknown',
    metadata: '',
  },
  tiktok: {
    accountKey: 'tiktok-main',
    displayName: 'TikTok Primary',
    authType: 'browser',
    status: 'unknown',
    metadata: '',
  },
  xiaohongshu: {
    accountKey: 'xiaohongshu-main',
    displayName: 'Xiaohongshu Manual',
    authType: 'browser',
    status: 'unknown',
    metadata: '',
  },
  weibo: {
    accountKey: 'weibo-main',
    displayName: 'Weibo Manual',
    authType: 'browser',
    status: 'unknown',
    metadata: '',
  },
  blog: {
    accountKey: 'blog-main',
    displayName: 'Blog Manual',
    authType: 'manual',
    status: 'unknown',
    metadata: '',
  },
};

function serializeMetadata(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .filter(
      ([key, value]) =>
        key !== 'session' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    )
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',');
}

function parseMetadataInput(value: string): Record<string, unknown> {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .reduce<Record<string, unknown>>((accumulator, entry) => {
      const [key, ...rest] = entry.split('=');
      if (key && rest.length > 0) {
        accumulator[key.trim()] = rest.join('=').trim();
      }
      return accumulator;
    }, {});
}

function parseOptionalProjectIdInput(value: string, mode: 'create' | 'edit') {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return mode === 'create' ? undefined : null;
  }

  const projectId = Number(normalizedValue);
  return Number.isInteger(projectId) && projectId > 0
    ? projectId
    : mode === 'create'
      ? undefined
      : null;
}

function getProjectIdValidationError(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return null;
  }

  return Number.isInteger(Number(normalizedValue)) && Number(normalizedValue) > 0
    ? null
    : '项目 ID 必须是大于 0 的整数';
}

function parseStorageStateJsonInput(value: string): Record<string, unknown> | undefined {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(trimmedValue);
  } catch {
    throw new Error('storage state JSON 必须是合法 JSON');
  }

  if (!isPlainObject(parsedValue)) {
    throw new Error('storage state JSON 必须是 JSON 对象');
  }

  return parsedValue;
}

function buildEditFormValue(account: ChannelAccountRecord): EditFormValue {
  const session = getSessionSummary(account);

  return {
    projectId: typeof account.projectId === 'number' ? String(account.projectId) : '',
    displayName: account.displayName,
    status: account.status,
    metadata: serializeMetadata(account.metadata),
    sessionStorageStatePath: session.storageStatePath ?? '',
    sessionStorageStateJson: '',
    sessionStatus: session.status === 'missing' ? 'active' : session.status,
    sessionValidatedAt: session.validatedAt ?? '',
    sessionNotes: session.notes ?? '',
  };
}

function formatReadinessValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? '已就绪' : '未就绪';
  }

  return '未提供';
}

function formatReadinessStatus(value: unknown) {
  if (value === 'ready') return '已就绪';
  if (value === 'needs_config') return '待配置';
  if (value === 'needs_session') return '需要登录会话';
  if (value === 'needs_relogin') return '需要重新登录';
  return formatReadinessValue(value);
}

function formatReadinessMode(value: unknown) {
  if (value === 'api') return 'API';
  if (value === 'browser') return '浏览器接管';
  if (value === 'manual') return '人工处理';
  return formatReadinessValue(value);
}

function formatReadinessAction(value: unknown) {
  if (value === 'configure_credentials') return '配置凭证';
  if (value === 'request_session') return '请求登录';
  if (value === 'relogin') return '重新登录';
  return formatReadinessValue(value);
}

function normalizeReadinessRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function resolvePublishReadiness(account: ChannelAccountRecord): Record<string, unknown> | undefined {
  const metadata = isPlainObject(account.metadata) ? account.metadata : {};

  return (
    normalizeReadinessRecord(account.publishReadiness) ??
    normalizeReadinessRecord(account.readiness) ??
    normalizeReadinessRecord(metadata.publishReadiness) ??
    normalizeReadinessRecord(metadata.readiness)
  );
}

interface ConnectionTestFeedback {
  accountLabel?: string;
  result: string;
  message?: string;
  action?: string;
  nextStep?: string;
  checkedAt: string;
}

export function ChannelAccountsPage({
  loadChannelAccountsAction = loadChannelAccountsRequest,
  createChannelAccountAction = createChannelAccountRequest,
  updateChannelAccountAction = updateChannelAccountRequest,
  testChannelAccountAction = testChannelAccountConnectionRequest,
  saveChannelAccountSessionAction = saveChannelAccountSessionRequest,
  requestChannelAccountSessionAction = requestChannelAccountSessionActionRequest,
  stateOverride,
  createStateOverride,
  updateStateOverride,
  testConnectionStateOverride,
  saveSessionStateOverride,
  sessionActionStateOverride,
}: ChannelAccountsPageProps) {
  const { state, reload } = useAsyncQuery(loadChannelAccountsAction, [loadChannelAccountsAction]);
  const [projectId, setProjectId] = useState('');
  const [platform, setPlatform] = useState('x');
  const [accountKey, setAccountKey] = useState('x-main');
  const [displayName, setDisplayName] = useState('X Primary');
  const [authType, setAuthType] = useState('api');
  const [status, setStatus] = useState('unknown');
  const [metadata, setMetadata] = useState('');
  const [actionTargetAccountId, setActionTargetAccountId] = useState<string>('');
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editFormById, setEditFormById] = useState<Record<number, EditFormValue>>({});
  const [accountFormErrorById, setAccountFormErrorById] = useState<Record<number, string>>({});
  const [sessionFormErrorById, setSessionFormErrorById] = useState<Record<number, string>>({});
  const [sessionSavePendingById, setSessionSavePendingById] = useState<Record<number, boolean>>({});
  const [sessionSaveFeedbackById, setSessionSaveFeedbackById] = useState<Record<number, SessionSaveFeedback>>({});
  const [sessionSavedAccountById, setSessionSavedAccountById] = useState<Record<number, ChannelAccountRecord>>({});
  const [latestSessionMutation, setLatestSessionMutation] = useState<LatestSessionMutation>(null);
  const [latestAccountMutationId, setLatestAccountMutationId] = useState<number | null>(null);
  const [latestBlockedAccountSaveId, setLatestBlockedAccountSaveId] = useState<number | null>(null);
  const [latestBlockedSessionSaveId, setLatestBlockedSessionSaveId] = useState<number | null>(null);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const sessionSaveRequestTokenByIdRef = useRef<Record<number, number>>({});
  const { state: createState, run: createChannelAccount } = useAsyncAction(createChannelAccountAction);
  const { state: updateState, run: updateAccount } = useAsyncAction(
    ({ accountId, input }: { accountId: number; input: UpdateChannelAccountPayload }) =>
      updateChannelAccountAction(accountId, input),
  );
  const { state: testConnectionState, run: requestConnectionTest } = useAsyncAction(
    ({ accountId }: { accountId: number }) =>
      runChannelAccountConnectionTest(accountId, testChannelAccountAction, reload),
  );
  const { run: saveSession } = useAsyncAction(
    ({ accountId, input }: { accountId: number; input: SaveChannelAccountSessionPayload }) =>
      saveChannelAccountSessionAction(accountId, input),
  );
  const { state: sessionActionState, run: requestSessionAction } = useAsyncAction(
    ({
      accountId,
      input,
    }: {
      accountId: number;
      input?: RequestChannelAccountSessionActionPayload;
    }) => requestChannelAccountSessionAction(accountId, input),
  );
  const displayState = stateOverride ?? state;
  const displayCreateState = createStateOverride ?? createState;
  const displayUpdateState = updateStateOverride ?? updateState;
  const displayTestConnectionState = testConnectionStateOverride ?? testConnectionState;
  const displaySessionActionState = sessionActionStateOverride ?? sessionActionState;
  const hasLiveAccounts =
    typeof displayState.data === 'object' &&
    displayState.data !== null &&
    Array.isArray((displayState.data as ChannelAccountsResponse).channelAccounts);

  const loadedAccounts = hasLiveAccounts
    ? ((displayState.data as ChannelAccountsResponse).channelAccounts ?? []).map(normalizeChannelAccountRecord)
    : [];
  const createdAccount = displayCreateState.data?.channelAccount
    ? normalizeChannelAccountRecord(displayCreateState.data.channelAccount)
    : null;
  const updatedAccount = displayUpdateState.data?.channelAccount
    ? normalizeChannelAccountRecord(displayUpdateState.data.channelAccount)
    : null;
  const sessionActionAccount = displaySessionActionState.data?.channelAccount
    ? normalizeChannelAccountRecord(displaySessionActionState.data.channelAccount)
    : null;
  const showSessionActionFeedback =
    latestSessionMutation === null || latestSessionMutation.kind === 'session_action';
  const showAccountUpdateSuccess =
    displayUpdateState.status === 'success' &&
    updatedAccount !== null &&
    editingAccountId === updatedAccount.id &&
    updatedAccount.id !== latestBlockedAccountSaveId;
  const showAccountUpdateError =
    displayUpdateState.status === 'error' &&
    editingAccountId !== null &&
    latestAccountMutationId === editingAccountId;
  const sessionSavedAccounts = Object.values(sessionSavedAccountById);
  const showSessionActionOverlay =
    sessionActionAccount !== null &&
    !(
      latestSessionMutation?.kind === 'save_session' &&
      latestSessionMutation.accountId === sessionActionAccount.id &&
      sessionActionAccount.id in sessionSavedAccountById
    ) &&
    !(
      latestSessionMutation?.kind === 'save_session' &&
      latestSessionMutation.accountId === sessionActionAccount.id &&
      latestBlockedSessionSaveId === sessionActionAccount.id
    );
  const editingSessionSaveFeedback =
    editingAccountId !== null ? sessionSaveFeedbackById[editingAccountId] ?? null : null;
  const showSessionSaveLoading =
    editingAccountId !== null &&
    Boolean(sessionSavePendingById[editingAccountId]);
  const showSessionSaveSuccess = editingSessionSaveFeedback?.tone === 'success';
  const showSessionSaveError = editingSessionSaveFeedback?.tone === 'error';

  const visibleAccounts = useMemo(() => {
    let accounts = [...loadedAccounts];

    if (createdAccount && !accounts.some((account) => account.id === createdAccount.id)) {
      accounts = [...accounts, createdAccount];
    }

    if (updatedAccount) {
      accounts = accounts.map((account) =>
        account.id === updatedAccount.id ? mergeChannelAccountRecord(account, updatedAccount) : account,
      );
    }

    for (const sessionSavedAccount of sessionSavedAccounts) {
      accounts = accounts.map((account) =>
        account.id === sessionSavedAccount.id
          ? mergeChannelAccountRecord(account, sessionSavedAccount)
          : account,
      );
    }

    if (showSessionActionOverlay && sessionActionAccount) {
      accounts = accounts.map((account) =>
        account.id === sessionActionAccount.id
          ? mergeChannelAccountRecord(account, sessionActionAccount)
          : account,
      );
    }

    return accounts;
  }, [
    loadedAccounts,
    createdAccount,
    updatedAccount,
    sessionSavedAccounts,
    sessionActionAccount,
    showSessionActionOverlay,
  ]);

  const latestCreatedAccount = createdAccount;
  const actionTargetAccount = resolveActionTargetAccount(
    visibleAccounts,
    actionTargetAccountId,
    latestCreatedAccount,
  );
  const headerSessionActionDisabled = !actionTargetAccount;
  const headerSessionActionLabel = actionTargetAccount ? getSessionActionLabel(actionTargetAccount) : '暂无登录目标';
  const testConnectionActionDisabled = !actionTargetAccount;
  const testConnectionActionLabel = testConnectionActionDisabled
    ? '暂无测试目标'
    : displayTestConnectionState.status === 'loading'
      ? '正在测试连接...'
      : '测试连接';
  const testedAccount = displayTestConnectionState.data?.channelAccount
    ? normalizeChannelAccountRecord(displayTestConnectionState.data.channelAccount)
    : actionTargetAccount;
  const connectionTestFeedback =
    displayTestConnectionState.status === 'success' && displayTestConnectionState.data
      ? describeConnectionTestFeedback(displayTestConnectionState.data, testedAccount)
      : null;
  const editingSessionFormError =
    editingAccountId !== null ? sessionFormErrorById[editingAccountId] ?? null : null;
  const editingAccountFormError =
    editingAccountId !== null ? accountFormErrorById[editingAccountId] ?? null : null;

  function handleCreateChannelAccount() {
    const projectIdValidationError = getProjectIdValidationError(projectId);
    if (projectIdValidationError) {
      setCreateFormError(projectIdValidationError);
      return;
    }

    setCreateFormError(null);
    const parsedMetadata = parseMetadataInput(metadata);
    const parsedProjectId = parseOptionalProjectIdInput(projectId, 'create');

    void createChannelAccount({
      ...(parsedProjectId === undefined ? {} : { projectId: parsedProjectId }),
      platform,
      accountKey,
      displayName,
      authType,
      status,
      metadata: Object.keys(parsedMetadata).length > 0 ? parsedMetadata : undefined,
    })
      .then(() => {
        reload();
      })
      .catch(() => undefined);
  }

  function applyCreatePreset(nextPlatform: string) {
    const defaults = createPlatformDefaults[nextPlatform];
    setPlatform(nextPlatform);
    if (!defaults) {
      return;
    }

    setAccountKey(defaults.accountKey);
    setDisplayName(defaults.displayName);
    setAuthType(defaults.authType);
    setStatus(defaults.status);
    setMetadata(defaults.metadata);
  }

  function getEditFormValue(account: ChannelAccountRecord): EditFormValue {
    return editFormById[account.id] ?? buildEditFormValue(account);
  }

  function updateEditFormValue(accountId: number, patch: Partial<EditFormValue>) {
    const account = visibleAccounts.find((entry) => entry.id === accountId);
    if (!account) {
      return;
    }

    setEditFormById((current) => ({
      ...current,
      [accountId]: {
        ...(current[accountId] ?? buildEditFormValue(account)),
        ...patch,
      },
    }));
    setAccountFormErrorById((current) => {
      if (!(accountId in current)) {
        return current;
      }

      const { [accountId]: _removed, ...rest } = current;
      return rest;
    });
    setSessionFormErrorById((current) => {
      if (!(accountId in current)) {
        return current;
      }

      const { [accountId]: _removed, ...rest } = current;
      return rest;
    });
    setSessionSaveFeedbackById((current) => {
      if (!(accountId in current)) {
        return current;
      }

      const { [accountId]: _removed, ...rest } = current;
      return rest;
    });
  }

  function setSessionSavePending(accountId: number, pending: boolean) {
    setSessionSavePendingById((current) => {
      if (pending) {
        if (current[accountId]) {
          return current;
        }

        return {
          ...current,
          [accountId]: true,
        };
      }

      if (!(accountId in current)) {
        return current;
      }

      const { [accountId]: _removed, ...rest } = current;
      return rest;
    });
  }

  function setSessionSaveFeedback(accountId: number, feedback: SessionSaveFeedback | null) {
    setSessionSaveFeedbackById((current) => {
      if (feedback === null) {
        if (!(accountId in current)) {
          return current;
        }

        const { [accountId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [accountId]: feedback,
      };
    });
  }

  function setSessionSavedAccount(accountId: number, account: ChannelAccountRecord | null) {
    setSessionSavedAccountById((current) => {
      if (account === null) {
        if (!(accountId in current)) {
          return current;
        }

        const { [accountId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [accountId]: account,
      };
    });
  }

  function createSessionSaveRequestToken(accountId: number) {
    const nextToken = (sessionSaveRequestTokenByIdRef.current[accountId] ?? 0) + 1;
    sessionSaveRequestTokenByIdRef.current[accountId] = nextToken;
    return nextToken;
  }

  function isLatestSessionSaveRequest(accountId: number, requestToken: number) {
    return sessionSaveRequestTokenByIdRef.current[accountId] === requestToken;
  }

  function handleStartEditing(accountId: number) {
    setEditingAccountId(accountId);
  }

  function handleSaveAccount(accountId: number) {
    const account = visibleAccounts.find((entry) => entry.id === accountId);
    if (!account) {
      return;
    }

    const formValue = getEditFormValue(account);
    const projectIdValidationError = getProjectIdValidationError(formValue.projectId);
    if (projectIdValidationError) {
      setLatestBlockedAccountSaveId(accountId);
      setAccountFormErrorById((current) => ({
        ...current,
        [accountId]: projectIdValidationError,
      }));
      return;
    }

    setLatestBlockedAccountSaveId(null);
    setLatestAccountMutationId(accountId);
    const parsedMetadata = parseMetadataInput(formValue.metadata);
    const parsedProjectId = parseOptionalProjectIdInput(formValue.projectId, 'edit');

    void updateAccount({
      accountId,
      input: {
        projectId: parsedProjectId,
        platform: account.platform,
        accountKey: account.accountKey,
        displayName: formValue.displayName,
        authType: account.authType,
        status: formValue.status,
        metadata: mergeMetadataWithSession(parsedMetadata, account),
      },
    })
      .then((result) => {
        const normalizedAccount = normalizeChannelAccountRecord(result.channelAccount);
        setEditFormById((current) => ({
          ...current,
          [accountId]: buildEditFormValue(normalizedAccount),
        }));
      })
      .catch(() => undefined);
  }

  function handleSaveSession(accountId: number) {
    const account = visibleAccounts.find((entry) => entry.id === accountId);
    if (!account) {
      return;
    }

    setLatestSessionMutation({
      kind: 'save_session',
      accountId,
    });
    const requestToken = createSessionSaveRequestToken(accountId);
    const formValue = getEditFormValue(account);
    let parsedStorageState: Record<string, unknown> | undefined;
    setSessionSaveFeedback(accountId, null);
    setSessionSavePending(accountId, true);

    try {
      parsedStorageState = parseStorageStateJsonInput(formValue.sessionStorageStateJson);
      setLatestBlockedSessionSaveId(null);
      setSessionFormErrorById((current) => {
        if (!(accountId in current)) {
          return current;
        }

        const { [accountId]: _removed, ...rest } = current;
        return rest;
      });
    } catch (error) {
      setLatestBlockedSessionSaveId(accountId);
      setSessionSavePending(accountId, false);
      setSessionFormErrorById((current) => ({
        ...current,
        [accountId]: error instanceof Error ? error.message : 'storage state JSON 解析失败',
      }));
      return;
    }

    void saveSession({
      accountId,
      input: {
        ...(parsedStorageState
          ? {}
          : formValue.sessionStorageStatePath.trim()
            ? { storageStatePath: formValue.sessionStorageStatePath.trim() }
            : {}),
        storageState: parsedStorageState,
        status: normalizeSessionStatus(formValue.sessionStatus),
        validatedAt: formValue.sessionValidatedAt.trim() ? formValue.sessionValidatedAt.trim() : null,
        notes: formValue.sessionNotes.trim() ? formValue.sessionNotes.trim() : undefined,
      },
    })
      .then((result) => {
        if (!isLatestSessionSaveRequest(accountId, requestToken)) {
          return;
        }

        const normalizedAccount = normalizeChannelAccountRecord(result.channelAccount);
        setEditFormById((current) => ({
          ...current,
          [accountId]: buildEditFormValue(normalizedAccount),
        }));
        setSessionSavedAccount(accountId, normalizedAccount);
        setSessionSaveFeedback(accountId, {
          tone: 'success',
          message: 'Session 元数据已保存',
        });
      })
      .catch((error) => {
        if (!isLatestSessionSaveRequest(accountId, requestToken)) {
          return;
        }

        setSessionSaveFeedback(accountId, {
          tone: 'error',
          message: error instanceof Error ? error.message : 'Session 保存失败',
        });
      })
      .finally(() => {
        if (!isLatestSessionSaveRequest(accountId, requestToken)) {
          return;
        }

        setSessionSavePending(accountId, false);
      });
  }

  function handleRequestSessionAction(account: ChannelAccountRecord, forcedAction?: 'request_session' | 'relogin') {
    setLatestSessionMutation({
      kind: 'session_action',
      accountId: account.id,
    });
    void requestSessionAction({
      accountId: account.id,
      input: {
        action: forcedAction ?? getDefaultSessionAction(account),
      },
    }).catch(() => undefined);
  }

  function handleTestConnection(targetAccount: ChannelAccountRecord | null = actionTargetAccount) {
    if (!targetAccount) {
      return;
    }

    void requestConnectionTest({ accountId: targetAccount.id }).catch(() => undefined);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Session Center"
        title="Channel Accounts"
        description="集中查看各渠道的凭证与登录态健康度。当前页面会直接请求 `/api/channel-accounts` 并展示返回结果或错误。"
        actions={
          <>
            <span data-header-session-action="true">
              <button
                type="button"
                disabled={headerSessionActionDisabled}
                onClick={
                  actionTargetAccount ? () => handleRequestSessionAction(actionTargetAccount) : undefined
                }
                style={
                  headerSessionActionDisabled
                    ? disabledHeaderSecondaryButtonStyle
                    : headerSecondaryButtonStyle
                }
              >
                {headerSessionActionLabel}
              </button>
            </span>
            <button
              type="button"
              data-header-test-connection-action="true"
              disabled={testConnectionActionDisabled}
              onClick={testConnectionActionDisabled ? undefined : () => handleTestConnection()}
              style={
                testConnectionActionDisabled
                  ? disabledHeaderPrimaryButtonStyle
                  : headerPrimaryButtonStyle
              }
            >
              {testConnectionActionLabel}
            </button>
          </>
        }
      />

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(340px, 1.1fr) minmax(320px, 0.9fr)' }}>
        <SectionCard title="创建账号" description="填写最小必需信息后提交到 `/api/channel-accounts`。默认值按首发路径保守预置，创建后再测试连接。">
          <div style={{ display: 'grid', gap: '12px' }}>
            <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
              首发可用：X、Reddit、Blog（本地文件）。人工接管：Facebook Group、Instagram、TikTok、小红书、微博。
            </p>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>项目 ID</span>
              <input
                data-create-project-id="true"
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setCreateFormError(null);
                }}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>平台</span>
              <input value={platform} onChange={(event) => setPlatform(event.target.value)} style={fieldStyle} />
            </label>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {createPlatformOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-create-platform-preset={option.value}
                  onClick={() => applyCreatePreset(option.value)}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid #dbe4f0',
                    background: option.value === platform ? '#dbeafe' : '#f8fafc',
                    color: option.value === platform ? '#1d4ed8' : '#475569',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>账号 Key</span>
              <input
                data-create-account-key="true"
                value={accountKey}
                onChange={(event) => setAccountKey(event.target.value)}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>显示名</span>
              <input
                data-create-display-name="true"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>认证方式</span>
              <input value={authType} onChange={(event) => setAuthType(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>状态</span>
              <input value={status} onChange={(event) => setStatus(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>metadata</span>
              <input value={metadata} onChange={(event) => setMetadata(event.target.value)} style={fieldStyle} />
            </label>

            <button
              type="button"
              onClick={handleCreateChannelAccount}
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
              {displayCreateState.status === 'loading' ? '正在创建账号...' : '创建账号'}
            </button>
            {createFormError ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>创建失败：{createFormError}</p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="最近创建结果" description="创建反馈和下一步动作都会在这里落地。">
          {displayCreateState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在创建账号...</p> : null}

          {displayCreateState.status === 'error' ? (
            <p style={{ margin: 0, color: '#b91c1c' }}>创建失败：{displayCreateState.error}</p>
          ) : null}

          {displayCreateState.status === 'success' && latestCreatedAccount ? (
            <div style={{ display: 'grid', gap: '12px', color: '#334155' }}>
              <div style={{ fontWeight: 700 }}>
                {latestCreatedAccount.authType === 'browser'
                  ? '账号已创建，下一步请准备人工接管'
                  : '账号已创建，可继续测试连接'}
              </div>
              <div>
                <strong>账号：</strong>
                {latestCreatedAccount.displayName}
              </div>
              <div>
                <strong>平台：</strong>
                {latestCreatedAccount.platform}
              </div>
              <div>
                <strong>认证方式：</strong>
                {latestCreatedAccount.authType}
              </div>
              <div>
                <strong>状态：</strong>
                {latestCreatedAccount.status}
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <ActionButton
                  label={
                    displayTestConnectionState.status === 'loading'
                      ? '正在测试连接...'
                      : latestCreatedAccount.authType === 'browser'
                        ? '继续准备人工接管'
                        : '测试连接'
                  }
                  tone="primary"
                  onClick={() => handleTestConnection(latestCreatedAccount)}
                />
              </div>
            </div>
          ) : null}

          {displayTestConnectionState.status === 'loading' ? (
            <p style={{ margin: 0, color: '#334155' }}>正在测试连接...</p>
          ) : null}

          {displayTestConnectionState.status === 'error' ? (
            <p style={{ margin: 0, color: '#b91c1c' }}>连接测试失败：{displayTestConnectionState.error}</p>
          ) : null}

          {connectionTestFeedback ? (
            <div style={{ display: 'grid', gap: '8px', color: '#334155' }}>
              <div style={{ fontWeight: 700 }}>最近一次连接测试</div>
              {connectionTestFeedback.accountLabel ? (
                <div>
                  <strong>账号：</strong>
                  {connectionTestFeedback.accountLabel}
                </div>
              ) : null}
              <div>
                <strong>连接结果：</strong>
                {connectionTestFeedback.result}
              </div>
              {connectionTestFeedback.message ? (
                <div>
                  <strong>反馈：</strong>
                  {connectionTestFeedback.message}
                </div>
              ) : null}
              {connectionTestFeedback.action ? (
                <div>
                  <strong>建议动作：</strong>
                  {formatReadinessAction(connectionTestFeedback.action)}
                </div>
              ) : null}
              {connectionTestFeedback.nextStep ? (
                <div>
                  <strong>下一步：</strong>
                  {connectionTestFeedback.nextStep}
                </div>
              ) : null}
              <div>
                <strong>检查时间：</strong>
                {connectionTestFeedback.checkedAt}
              </div>
            </div>
          ) : null}

          {displayCreateState.status === 'idle' && displayTestConnectionState.status === 'idle' ? (
            <p style={{ margin: 0, color: '#475569' }}>提交表单后，这里会显示新账号和下一步测试连接动作。</p>
          ) : null}
        </SectionCard>

        <SectionCard title="连接状态" description="这是该页面的真实接口返回区域。">
          {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载渠道账号...</p> : null}

          {displayState.status === 'error' ? (
            <p style={{ margin: 0, color: '#b91c1c' }}>渠道账号加载失败：{displayState.error}</p>
          ) : null}

          {hasLiveAccounts ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ fontWeight: 700 }}>
                接口返回 {visibleAccounts.length} 个账号
              </div>
              {visibleAccounts.length > 0 ? (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {visibleAccounts.map((account) => {
                    const editForm = getEditFormValue(account);
                    const session = getSessionSummary(account);
                    const sessionActionLabel = getSessionActionLabel(account);
                    return (
                      <article
                        key={account.id}
                        style={{
                          borderRadius: '14px',
                          border: '1px solid #dbe4f0',
                          background: '#f8fafc',
                          padding: '14px',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{account.displayName}</div>
                        <div style={{ marginTop: '6px', color: '#475569' }}>
                          {account.platform} · {account.authType} · {account.status}
                        </div>
                        <div style={{ marginTop: '10px', display: 'grid', gap: '6px', color: '#334155' }}>
                          <div>Session {session.hasSession ? '已关联' : '未关联'}</div>
                          <div>Session 状态：{session.status}</div>
                          <div>最近验证：{session.validatedAt ?? '未验证'}</div>
                          <div>Storage Path：{session.storageStatePath ?? '未提供'}</div>
                          {session.notes ? (
                            <div>Session 备注：{session.notes}</div>
                          ) : null}
                          {account.latestBrowserLaneArtifact ? (
                            <>
                              <div>
                                最近工单：{getSessionActionLabelFromAction(account.latestBrowserLaneArtifact.action)}
                              </div>
                              <div>工单状态：{account.latestBrowserLaneArtifact.jobStatus}</div>
                              <div>工单时间：{account.latestBrowserLaneArtifact.requestedAt}</div>
                              <div>工单结单：{account.latestBrowserLaneArtifact.resolvedAt ?? '未结单'}</div>
                              <div>工单路径：{account.latestBrowserLaneArtifact.artifactPath}</div>
                            </>
                          ) : null}
                          {account.latestBrowserHandoffArtifact ? (
                            <>
                              <div>
                                最近 Handoff：draft #{account.latestBrowserHandoffArtifact.draftId} ·{' '}
                                {account.latestBrowserHandoffArtifact.status}
                              </div>
                              <div>
                                Handoff 标题：{account.latestBrowserHandoffArtifact.title ?? '未提供'}
                              </div>
                              <div>Handoff 时间：{account.latestBrowserHandoffArtifact.updatedAt}</div>
                              <div>
                                Handoff 结单：
                                {account.latestBrowserHandoffArtifact.resolvedAt ?? '未结单'}
                              </div>
                              <div>
                                Handoff 账号：
                                {readTextValue(account.latestBrowserHandoffArtifact.accountDisplayName) ?? '未提供'}
                              </div>
                              {account.latestBrowserHandoffArtifact.ownership ? (
                                <div>Handoff 归属：{formatHandoffOwnership(account.latestBrowserHandoffArtifact.ownership)}</div>
                              ) : null}
                              {readStatusValue(account.latestBrowserHandoffArtifact.resolution) ? (
                                <div>
                                  Handoff 结果：
                                  {readStatusValue(account.latestBrowserHandoffArtifact.resolution)}
                                </div>
                              ) : null}
                              {readResolutionDetail(account.latestBrowserHandoffArtifact.resolution) ? (
                                <div>
                                  Handoff 详情：
                                  {readResolutionDetail(account.latestBrowserHandoffArtifact.resolution)}
                                </div>
                              ) : null}
                              <div>
                                Handoff 路径：{account.latestBrowserHandoffArtifact.artifactPath}
                              </div>
                            </>
                          ) : null}
                          {account.latestInboxReplyHandoffArtifact ? (
                            <>
                              <div>
                                最近 Inbox Reply Handoff：item #{account.latestInboxReplyHandoffArtifact.itemId} ·{' '}
                                {account.latestInboxReplyHandoffArtifact.status}
                              </div>
                              <div>
                                Inbox 来源：{account.latestInboxReplyHandoffArtifact.source}
                              </div>
                              <div>
                                Inbox 作者：{account.latestInboxReplyHandoffArtifact.author ?? '未提供'}
                              </div>
                              <div>
                                Inbox 标题：{account.latestInboxReplyHandoffArtifact.title ?? '未提供'}
                              </div>
                              <div>
                                Inbox Handoff 时间：{account.latestInboxReplyHandoffArtifact.updatedAt}
                              </div>
                              <div>
                                Inbox Handoff 结单：
                                {account.latestInboxReplyHandoffArtifact.resolvedAt ?? '未结单'}
                              </div>
                              {account.latestInboxReplyHandoffArtifact.ownership ? (
                                <div>
                                  Inbox Handoff 归属：
                                  {formatHandoffOwnership(account.latestInboxReplyHandoffArtifact.ownership)}
                                </div>
                              ) : null}
                              {typeof account.latestInboxReplyHandoffArtifact.projectId === 'number' ? (
                                <div>
                                  Inbox Handoff 项目：{account.latestInboxReplyHandoffArtifact.projectId}
                                </div>
                              ) : null}
                              {readStatusValue(account.latestInboxReplyHandoffArtifact.resolution) ? (
                                <div>
                                  Inbox Handoff 结果：
                                  {readStatusValue(account.latestInboxReplyHandoffArtifact.resolution)}
                                </div>
                              ) : null}
                              {readResolutionDetail(account.latestInboxReplyHandoffArtifact.resolution) ? (
                                <div>
                                  Inbox Handoff 详情：
                                  {readResolutionDetail(account.latestInboxReplyHandoffArtifact.resolution)}
                                </div>
                              ) : null}
                              {readTextValue(
                                readObjectValue(account.latestInboxReplyHandoffArtifact.resolution)?.deliveryUrl,
                              ) ? (
                                <div>
                                  Inbox Delivery URL：
                                  {
                                    readTextValue(
                                      readObjectValue(account.latestInboxReplyHandoffArtifact.resolution)?.deliveryUrl,
                                    )
                                  }
                                </div>
                              ) : null}
                              <div>
                                Inbox Handoff 路径：{account.latestInboxReplyHandoffArtifact.artifactPath}
                              </div>
                            </>
                          ) : null}
                          <div>
                            发布就绪：{formatReadinessStatus(account.publishReadiness?.status)}
                          </div>
                          <div>
                            发布方式：{formatReadinessMode(account.publishReadiness?.mode)}
                          </div>
                          <div>
                            就绪说明：{formatReadinessValue(account.publishReadiness?.message)}
                          </div>
                          {account.publishReadiness?.action ? (
                            <div>建议动作：{formatReadinessAction(account.publishReadiness.action)}</div>
                          ) : null}
                        </div>
                        <div style={{ marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <ActionButton
                            label="编辑账号"
                            onClick={() => handleStartEditing(account.id)}
                            buttonAttributes={{ 'data-edit-account-id': String(account.id) }}
                          />
                          <button
                            type="button"
                            onClick={() => handleStartEditing(account.id)}
                            style={{
                              borderRadius: '12px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#122033',
                              padding: '12px 16px',
                              fontWeight: 700,
                            }}
                          >
                            编辑 Session 元数据
                          </button>
                          <button
                            type="button"
                            data-session-action-id={String(account.id)}
                            onClick={() => handleRequestSessionAction(account)}
                            style={{
                              borderRadius: '12px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#122033',
                              padding: '12px 16px',
                              fontWeight: 700,
                            }}
                          >
                            {sessionActionLabel}
                          </button>
                        </div>

                        {editingAccountId === account.id ? (
                          <div style={{ marginTop: '12px', display: 'grid', gap: '10px' }}>
                            <input
                              data-edit-project-id={String(account.id)}
                              value={editForm.projectId ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { projectId: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <input
                              data-edit-display-name-id={String(account.id)}
                              value={editForm.displayName ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { displayName: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <input
                              data-edit-status-id={String(account.id)}
                              value={editForm.status ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { status: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <input
                              data-edit-metadata-id={String(account.id)}
                              value={editForm.metadata ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { metadata: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <input
                              data-edit-session-storage-path-id={String(account.id)}
                              value={editForm.sessionStorageStatePath ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, {
                                  sessionStorageStatePath: event.target.value,
                                })
                              }
                              style={fieldStyle}
                            />
                            <textarea
                              data-edit-session-storage-state-json-id={String(account.id)}
                              value={editForm.sessionStorageStateJson ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, {
                                  sessionStorageStateJson: event.target.value,
                                })
                              }
                              placeholder="直接粘贴 Playwright storageState JSON；旧的 Storage Path 字段仍可继续手填。"
                              style={{
                                ...fieldStyle,
                                minHeight: '140px',
                                resize: 'vertical',
                              }}
                            />
                            <input
                              data-edit-session-status-id={String(account.id)}
                              value={editForm.sessionStatus ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { sessionStatus: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <input
                              data-edit-session-validated-at-id={String(account.id)}
                              value={editForm.sessionValidatedAt ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { sessionValidatedAt: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <input
                              data-edit-session-notes-id={String(account.id)}
                              value={editForm.sessionNotes ?? ''}
                              onChange={(event) =>
                                updateEditFormValue(account.id, { sessionNotes: event.target.value })
                              }
                              style={fieldStyle}
                            />
                            <button
                              type="button"
                              data-save-account-id={String(account.id)}
                              onClick={() => handleSaveAccount(account.id)}
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
                              {displayUpdateState.status === 'loading' && latestAccountMutationId === account.id
                                ? '正在保存账号...'
                                : '保存账号'}
                            </button>
                            <button
                              type="button"
                              data-save-session-id={String(account.id)}
                              onClick={() => handleSaveSession(account.id)}
                              style={{
                                border: '1px solid #cbd5e1',
                                borderRadius: '12px',
                                background: '#ffffff',
                                color: '#122033',
                                padding: '10px 14px',
                                fontWeight: 700,
                                justifySelf: 'flex-start',
                              }}
                            >
                              {sessionSavePendingById[account.id]
                                ? '正在保存 Session...'
                                : '保存 Session 元数据'}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}
              <JsonPreview value={displayState.data} />
            </div>
          ) : null}

          {displayState.status === 'idle' ? (
            <p style={{ margin: 0, color: '#475569' }}>页面挂载后会自动请求真实渠道账号接口。</p>
          ) : null}

          {showAccountUpdateSuccess ? (
            <p style={{ marginTop: '12px', color: '#166534' }}>账号已更新</p>
          ) : null}
          {showAccountUpdateError ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>更新失败：{displayUpdateState.error}</p>
          ) : null}
          {editingAccountFormError ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>更新失败：{editingAccountFormError}</p>
          ) : null}
          {showSessionSaveLoading ? (
            <p style={{ marginTop: '12px', color: '#334155' }}>正在保存 Session...</p>
          ) : null}
          {editingSessionFormError ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>Session 保存失败：{editingSessionFormError}</p>
          ) : null}
          {showSessionSaveSuccess ? (
            <p style={{ marginTop: '12px', color: '#166534' }}>{editingSessionSaveFeedback?.message}</p>
          ) : null}
          {showSessionSaveError ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>
              Session 保存失败：{editingSessionSaveFeedback?.message}
            </p>
          ) : null}
          {showSessionActionFeedback &&
          displaySessionActionState.status === 'success' &&
          displaySessionActionState.data ? (
            <div style={{ marginTop: '12px', display: 'grid', gap: '6px', color: '#334155' }}>
              <div>
                {getSessionActionLabelFromAction(displaySessionActionState.data.sessionAction.action)}
                {displaySessionActionState.data.sessionAction.reused ? '工单已存在，继续沿用' : '工单已记录'}
              </div>
              <div>{displaySessionActionState.data.sessionAction.message}</div>
              <div>请求时间：{displaySessionActionState.data.sessionAction.requestedAt}</div>
              <div>
                工单状态：
                {displaySessionActionState.data.sessionAction.jobStatus ??
                  displaySessionActionState.data.sessionAction.status}
              </div>
              <div>下一步：{displaySessionActionState.data.sessionAction.nextStep}</div>
              {displaySessionActionState.data.sessionAction.artifactPath ? (
                <div>Artifact Path：{displaySessionActionState.data.sessionAction.artifactPath}</div>
              ) : null}
            </div>
          ) : null}
          {showSessionActionFeedback && displaySessionActionState.status === 'error' ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>
              登录动作失败：{displaySessionActionState.error}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="恢复动作" description="当后端未实现或返回错误时，页面会在左侧直接展示错误状态。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>
              当前目标账号：{actionTargetAccount?.displayName ?? '未选定'}
            </div>
            {visibleAccounts.length > 0 ? (
              <div style={{ display: 'grid', gap: '8px', maxWidth: '420px' }}>
                <span style={{ fontWeight: 700 }}>动作目标账号</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-action-target-account=""
                    onClick={() => setActionTargetAccountId('')}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid #dbe4f0',
                      background: actionTargetAccountId === '' ? '#dbeafe' : '#f8fafc',
                      color: actionTargetAccountId === '' ? '#1d4ed8' : '#475569',
                      padding: '6px 10px',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    自动选择最近目标
                  </button>
                  {visibleAccounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      data-action-target-account={String(account.id)}
                      onClick={() => setActionTargetAccountId(String(account.id))}
                      style={{
                        borderRadius: '999px',
                        border: '1px solid #dbe4f0',
                        background: actionTargetAccountId === String(account.id) ? '#dbeafe' : '#f8fafc',
                        color: actionTargetAccountId === String(account.id) ? '#1d4ed8' : '#475569',
                        padding: '6px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {account.displayName}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div>点击“测试连接”会优先对最近创建账号发起真实连接测试；没有目标账号时，“测试连接”会禁用；先创建账号或选择动作目标账号。</div>
            <div>每个账号卡片都会显式显示 Session 是否存在、当前状态、最近验证时间和 Storage Path。</div>
            <div>
              “请求登录 / 重新登录”会创建 browser lane 工单；同账号同动作存在未结单工单时，页面会直接复用现有工单，不会重复排队。
              “编辑 Session 元数据”用于展开表单，“保存 Session 元数据”才会真正提交 storage path 或 storage
              state JSON、状态、验证时间和备注，并把对应工单结单。
            </div>
            <div>如果服务端返回 404 或 500，这里不会吞掉错误，而是直接在页面中显示。</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                data-recovery-test-connection-action="true"
                disabled={testConnectionActionDisabled}
                onClick={testConnectionActionDisabled ? undefined : () => handleTestConnection()}
                style={
                  testConnectionActionDisabled
                    ? disabledHeaderPrimaryButtonStyle
                    : headerPrimaryButtonStyle
                }
              >
                {testConnectionActionLabel}
              </button>
            </div>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}

function normalizeChannelAccountRecord(account: ChannelAccountRecord): ChannelAccountRecord {
  return {
    ...account,
    metadata: isPlainObject(account.metadata) ? account.metadata : {},
    session: normalizeSessionSummary(account.session),
    publishReadiness: resolvePublishReadiness(account),
  };
}

function normalizeSessionSummary(session: ChannelAccountRecord['session']): ChannelAccountSessionSummary {
  if (!session) {
    return {
      hasSession: false,
      status: 'missing',
      validatedAt: null,
      storageStatePath: null,
    };
  }

  return {
    hasSession: session.hasSession === true,
    status: session.status ?? 'missing',
    validatedAt: session.validatedAt ?? null,
    storageStatePath: session.storageStatePath ?? null,
    id: session.id,
    notes: session.notes,
  };
}

function mergeChannelAccountRecord(
  current: ChannelAccountRecord,
  next: ChannelAccountRecord,
): ChannelAccountRecord {
  return normalizeChannelAccountRecord({
    ...current,
    ...next,
    metadata: isPlainObject(next.metadata) ? next.metadata : current.metadata,
    session: next.session ?? current.session,
  });
}

function getSessionSummary(account: ChannelAccountRecord): ChannelAccountSessionSummary {
  return normalizeSessionSummary(account.session);
}

function normalizeSessionStatus(value: string): 'active' | 'expired' | 'missing' {
  return value === 'expired' || value === 'missing' ? value : 'active';
}

function resolveActionTargetAccount(
  visibleAccounts: ChannelAccountRecord[],
  actionTargetAccountId: string,
  latestCreatedAccount: ChannelAccountRecord | null,
) {
  return (
    visibleAccounts.find((account) => String(account.id) === actionTargetAccountId) ??
    latestCreatedAccount ??
    visibleAccounts[0] ??
    null
  );
}

function getDefaultSessionAction(account: ChannelAccountRecord): 'request_session' | 'relogin' {
  return getSessionSummary(account).hasSession ? 'relogin' : 'request_session';
}

function getSessionActionLabel(account: ChannelAccountRecord): '请求登录' | '重新登录' {
  return getDefaultSessionAction(account) === 'relogin' ? '重新登录' : '请求登录';
}

function getSessionActionLabelFromAction(action: 'request_session' | 'relogin') {
  return action === 'relogin' ? '重新登录' : '请求登录';
}

function mergeMetadataWithSession(
  metadata: Record<string, unknown>,
  account: ChannelAccountRecord,
): Record<string, unknown> {
  if (isPlainObject(account.metadata.session)) {
    return {
      ...metadata,
      session: account.metadata.session,
    };
  }

  return metadata;
}

function describeConnectionTestFeedback(
  response: TestChannelAccountConnectionResponse,
  fallbackAccount: ChannelAccountRecord | null,
): ConnectionTestFeedback {
  const account = response.channelAccount
    ? normalizeChannelAccountRecord(response.channelAccount)
    : fallbackAccount;
  const detailRecord = normalizeReadinessRecord(response.test.details);
  const readiness =
    normalizeReadinessRecord(response.test.readiness) ??
    normalizeReadinessRecord(readObjectValue(response.test.result)?.readiness) ??
    normalizeReadinessRecord(readObjectValue(response.test.feedback)?.readiness) ??
    normalizeReadinessRecord(readObjectValue(response.test.recommendedAction)?.readiness) ??
    (account ? normalizeReadinessRecord(account.publishReadiness) : undefined);
  const result =
    readConnectionTestResult(response.test) ??
    resolveConnectionTestStatusResult(response.test.status, readiness);
  const message =
    readConnectionTestMessage(response.test) ??
    buildConnectionTestMessageFromDetails(account, response.test.status, detailRecord) ??
    (readiness ? readTextValue(readiness.message) : undefined) ??
    buildDefaultConnectionTestMessage(account, result);
  const action =
    readConnectionTestAction(response.test) ??
    (readiness ? readTextValue(readiness.action) : undefined) ??
    inferConnectionTestAction(response.test.status);
  const nextStep =
    readConnectionTestNextStep(response.test) ??
    inferConnectionTestNextStep(account?.id, action, response.test.status);

  return {
    accountLabel: account?.displayName,
    result,
    message: message === result ? undefined : message,
    action,
    nextStep,
    checkedAt: response.test.checkedAt,
  };
}

function readConnectionTestResult(test: TestChannelAccountConnectionResponse['test']) {
  return (
    readTextValue(test.summary) ??
    readTextCandidate(test.result) ??
    readTextCandidate(readObjectValue(test.feedback)?.result) ??
    readTextCandidate(readObjectValue(test.recommendedAction)?.result)
  );
}

function readConnectionTestMessage(test: TestChannelAccountConnectionResponse['test']) {
  return (
    readTextValue(test.message) ??
    readTextCandidate(test.feedback) ??
    readTextCandidate(readObjectValue(test.result)?.message) ??
    readTextCandidate(readObjectValue(test.recommendation)?.message) ??
    readTextCandidate(readObjectValue(test.recommendedAction)?.message)
  );
}

function readConnectionTestAction(test: TestChannelAccountConnectionResponse['test']) {
  return (
    readActionCandidate(test.recommendedAction) ??
    readTextValue(test.action) ??
    readActionCandidate(readObjectValue(test.recommendation)?.action) ??
    readActionCandidate(readObjectValue(test.feedback)?.action)
  );
}

function readConnectionTestNextStep(test: TestChannelAccountConnectionResponse['test']) {
  return (
    readNextStepCandidate(test.nextStep) ??
    readNextStepCandidate(readObjectValue(test.recommendation)?.nextStep) ??
    readNextStepCandidate(readObjectValue(test.recommendedAction)?.nextStep) ??
    readNextStepCandidate(readObjectValue(test.feedback)?.nextStep)
  );
}

function resolveConnectionTestStatusResult(
  status: unknown,
  readiness: Record<string, unknown> | undefined,
) {
  if (
    status === 'ready' ||
    status === 'needs_config' ||
    status === 'needs_session' ||
    status === 'needs_relogin'
  ) {
    return formatConnectionTestStatus(status);
  }

  if (readiness) {
    return formatReadinessStatus(readiness.status);
  }

  return formatConnectionTestStatus(status);
}

function formatConnectionTestStatus(value: unknown) {
  if (value === 'healthy') return '已就绪';
  if (value === 'failed') return '连接失败';
  if (value === 'unknown') return '状态未变化';
  if (value === 'ready') return '已就绪';
  if (value === 'needs_config') return '待配置';
  if (value === 'needs_session') return '需要登录会话';
  if (value === 'needs_relogin') return '需要重新登录';
  return formatReadinessValue(value);
}

function buildDefaultConnectionTestMessage(account: ChannelAccountRecord | null, result: string) {
  if (account?.displayName) {
    return `${account.displayName} 连接检查已完成，当前结果为${result}。`;
  }

  return `连接检查已完成，当前结果为${result}。`;
}

function buildConnectionTestMessageFromDetails(
  account: ChannelAccountRecord | null,
  status: string,
  details: Record<string, unknown> | undefined,
) {
  if (!details) {
    return undefined;
  }

  const mode = readTextValue(details.mode);
  const platformLabel = formatPlatformLabel(account?.platform);

  if (mode === 'api') {
    if (status === 'ready') {
      return `${platformLabel} API 账号已检测到可用凭证。`;
    }

    if (account?.platform === 'x') {
      return 'X API 账号缺少可用凭证，请配置 X_ACCESS_TOKEN 或 X_BEARER_TOKEN。';
    }

    if (account?.platform === 'reddit') {
      return 'Reddit API 账号缺少完整 OAuth 凭证，请配置 client id/secret 和 username/password。';
    }

    return `${platformLabel} API 账号需要补充可用凭证。`;
  }

  if (mode === 'browser') {
    if (status === 'ready') {
      return `${platformLabel} 浏览器 session 可用，可以继续发布流程。`;
    }

    if (status === 'needs_relogin') {
      return `${platformLabel} 浏览器 session 已过期，需要重新登录并重新保存 session 元数据。`;
    }

    if (status === 'needs_session') {
      return `${platformLabel} 浏览器账号缺少可用 session，请先登录并保存 session 元数据。`;
    }
  }

  return undefined;
}

function inferConnectionTestAction(status: unknown) {
  if (status === 'needs_config') return 'configure_credentials';
  if (status === 'needs_session') return 'request_session';
  if (status === 'needs_relogin') return 'relogin';
  return undefined;
}

function inferConnectionTestNextStep(accountId: number | undefined, action: string | undefined, status: unknown) {
  if (!accountId) {
    return undefined;
  }

  const resolvedAction = action ?? inferConnectionTestAction(status);

  if (resolvedAction === 'configure_credentials') {
    return `/api/channel-accounts/${accountId}`;
  }

  if (resolvedAction === 'request_session' || resolvedAction === 'relogin') {
    return `/api/channel-accounts/${accountId}/session`;
  }

  return undefined;
}

function readTextCandidate(value: unknown): string | undefined {
  const directValue = readTextValue(value);
  if (directValue) {
    return directValue;
  }

  const record = readObjectValue(value);
  if (!record) {
    return undefined;
  }

  return (
    readTextValue(record.label) ??
    readTextValue(record.summary) ??
    readTextValue(record.message) ??
    readTextValue(record.text) ??
    readTextValue(record.title) ??
    readTextValue(record.description) ??
    readTextValue(record.value)
  );
}

function readActionCandidate(value: unknown): string | undefined {
  const directValue = readTextValue(value);
  if (directValue) {
    return directValue;
  }

  const record = readObjectValue(value);
  if (!record) {
    return undefined;
  }

  return (
    readTextValue(record.action) ??
    readTextValue(record.key) ??
    readTextValue(record.type) ??
    readTextValue(record.id) ??
    readTextValue(record.value) ??
    readTextValue(record.label)
  );
}

function readNextStepCandidate(value: unknown): string | undefined {
  const directValue = readTextValue(value);
  if (directValue) {
    return directValue;
  }

  const record = readObjectValue(value);
  if (!record) {
    return undefined;
  }

  return (
    readTextValue(record.path) ??
    readTextValue(record.href) ??
    readTextValue(record.url) ??
    readTextValue(record.route) ??
    readTextValue(record.value) ??
    readTextValue(record.label) ??
    readTextValue(record.description)
  );
}

function readObjectValue(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function readTextValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStatusValue(value: unknown): string | undefined {
  return typeof readObjectValue(value)?.status === 'string'
    ? (readObjectValue(value)?.status as string)
    : undefined;
}

function readResolutionDetail(value: unknown): string | undefined {
  const record = readObjectValue(value);
  return (
    readTextValue(record?.reason) ??
    readTextValue(record?.publishStatus) ??
    readTextValue(record?.replyStatus) ??
    readTextValue(record?.draftStatus) ??
    readTextValue(record?.itemStatus) ??
    undefined
  );
}

function formatHandoffOwnership(value: string) {
  if (value === 'direct') {
    return '直接绑定';
  }

  if (value === 'draft_project') {
    return '按草稿项目推断';
  }

  if (value === 'item_project') {
    return '按 Inbox 项目推断';
  }

  if (value === 'unmatched') {
    return '未归属';
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPlatformLabel(platform: string | undefined) {
  if (platform === 'x') return 'X';
  if (platform === 'reddit') return 'Reddit';
  if (platform === 'facebookGroup' || platform === 'facebook-group') return 'Facebook Group';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'tiktok') return 'TikTok';
  return platform ?? '当前';
}
