import { useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { JsonPreview } from '../components/JsonPreview';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface ChannelAccountRecord {
  id: number;
  platform: string;
  accountKey: string;
  displayName: string;
  authType: string;
  status: string;
  metadata: Record<string, unknown>;
  session?: ChannelAccountSessionSummary;
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
  storageStatePath: string;
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
    nextStep?: string;
    readiness?: Record<string, unknown>;
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
  displayName: string;
  status: string;
  metadata: string;
  sessionStorageStatePath: string;
  sessionStatus: string;
  sessionValidatedAt: string;
  sessionNotes: string;
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
  const [platform, setPlatform] = useState('x');
  const [accountKey, setAccountKey] = useState('acct-x-2');
  const [displayName, setDisplayName] = useState('X Secondary');
  const [authType, setAuthType] = useState('api-key');
  const [status, setStatus] = useState('healthy');
  const [metadata, setMetadata] = useState('team=growth');
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editFormById, setEditFormById] = useState<Record<number, EditFormValue>>({});
  const { state: createState, run: createChannelAccount } = useAsyncAction(createChannelAccountAction);
  const { state: updateState, run: updateAccount } = useAsyncAction(
    ({ accountId, input }: { accountId: number; input: UpdateChannelAccountPayload }) =>
      updateChannelAccountAction(accountId, input),
  );
  const { state: testConnectionState, run: requestConnectionTest } = useAsyncAction(
    ({ accountId }: { accountId: number }) =>
      runChannelAccountConnectionTest(accountId, testChannelAccountAction, reload),
  );
  const { state: saveSessionState, run: saveSession } = useAsyncAction(
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
  const displaySaveSessionState = saveSessionStateOverride ?? saveSessionState;
  const displaySessionActionState = sessionActionStateOverride ?? sessionActionState;

  const loadedAccounts =
    displayState.status === 'success' && Array.isArray(displayState.data?.channelAccounts)
      ? displayState.data.channelAccounts.map(normalizeChannelAccountRecord)
      : [];
  const createdAccount = displayCreateState.data?.channelAccount
    ? normalizeChannelAccountRecord(displayCreateState.data.channelAccount)
    : null;
  const updatedAccount = displayUpdateState.data?.channelAccount
    ? normalizeChannelAccountRecord(displayUpdateState.data.channelAccount)
    : null;
  const sessionSavedAccount = displaySaveSessionState.data?.channelAccount
    ? normalizeChannelAccountRecord(displaySaveSessionState.data.channelAccount)
    : null;
  const sessionActionAccount = displaySessionActionState.data?.channelAccount
    ? normalizeChannelAccountRecord(displaySessionActionState.data.channelAccount)
    : null;

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

    if (sessionSavedAccount) {
      accounts = accounts.map((account) =>
        account.id === sessionSavedAccount.id
          ? mergeChannelAccountRecord(account, sessionSavedAccount)
          : account,
      );
    }

    if (sessionActionAccount) {
      accounts = accounts.map((account) =>
        account.id === sessionActionAccount.id
          ? mergeChannelAccountRecord(account, sessionActionAccount)
          : account,
      );
    }

    return accounts;
  }, [loadedAccounts, createdAccount, updatedAccount, sessionSavedAccount, sessionActionAccount]);

  const latestCreatedAccount = createdAccount;
  const fallbackTestTarget = visibleAccounts[0] ?? null;
  const testTarget = latestCreatedAccount ?? fallbackTestTarget;
  const testedAccount = displayTestConnectionState.data?.channelAccount
    ? normalizeChannelAccountRecord(displayTestConnectionState.data.channelAccount)
    : testTarget;
  const connectionTestFeedback =
    displayTestConnectionState.status === 'success' && displayTestConnectionState.data
      ? describeConnectionTestFeedback(displayTestConnectionState.data, testedAccount)
      : null;

  function handleCreateChannelAccount() {
    const parsedMetadata = parseMetadataInput(metadata);

    void createChannelAccount({
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

  function getEditFormValue(account: ChannelAccountRecord): EditFormValue {
    const session = getSessionSummary(account);
    return editFormById[account.id] ?? {
      displayName: account.displayName,
      status: account.status,
      metadata: serializeMetadata(account.metadata),
      sessionStorageStatePath: session.storageStatePath ?? '',
      sessionStatus: session.status === 'missing' ? 'active' : session.status,
      sessionValidatedAt: session.validatedAt ?? '',
      sessionNotes: session.notes ?? '',
    };
  }

  function updateEditFormValue(accountId: number, patch: Partial<EditFormValue>) {
    const account = visibleAccounts.find((entry) => entry.id === accountId);
    if (!account) {
      return;
    }

    setEditFormById((current) => ({
      ...current,
      [accountId]: {
        ...(current[accountId] ?? {
          displayName: account.displayName,
          status: account.status,
          metadata: serializeMetadata(account.metadata),
        }),
        ...patch,
      },
    }));
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
    const parsedMetadata = parseMetadataInput(formValue.metadata);

    void updateAccount({
      accountId,
      input: {
        platform: account.platform,
        accountKey: account.accountKey,
        displayName: formValue.displayName,
        authType: account.authType,
        status: formValue.status,
        metadata: mergeMetadataWithSession(parsedMetadata, account),
      },
    }).catch(() => undefined);
  }

  function handleSaveSession(accountId: number) {
    const account = visibleAccounts.find((entry) => entry.id === accountId);
    if (!account) {
      return;
    }

    const formValue = getEditFormValue(account);

    void saveSession({
      accountId,
      input: {
        storageStatePath: formValue.sessionStorageStatePath,
        status: normalizeSessionStatus(formValue.sessionStatus),
        validatedAt: formValue.sessionValidatedAt.trim() ? formValue.sessionValidatedAt.trim() : null,
        notes: formValue.sessionNotes.trim() ? formValue.sessionNotes.trim() : undefined,
      },
    }).catch(() => undefined);
  }

  function handleRequestSessionAction(account: ChannelAccountRecord, forcedAction?: 'request_session' | 'relogin') {
    void requestSessionAction({
      accountId: account.id,
      input: {
        action: forcedAction ?? getDefaultSessionAction(account),
      },
    }).catch(() => undefined);
  }

  function handleTestConnection() {
    if (!testTarget) {
      reload();
      return;
    }

    void requestConnectionTest({ accountId: testTarget.id }).catch(() => undefined);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Session Center"
        title="Channel Accounts"
        description="集中查看各渠道的凭证与登录态健康度。当前页面会直接请求 `/api/channel-accounts` 并展示返回结果或错误。"
        actions={
          <>
            <ActionButton
              label="重新登录"
              onClick={() => {
                if (!testTarget) {
                  reload();
                  return;
                }

                handleRequestSessionAction(testTarget, 'relogin');
              }}
            />
            <ActionButton
              label={displayTestConnectionState.status === 'loading' ? '正在测试连接...' : '测试连接'}
              tone="primary"
              onClick={handleTestConnection}
            />
          </>
        }
      />

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(340px, 1.1fr) minmax(320px, 0.9fr)' }}>
        <SectionCard title="创建账号" description="填写最小必需信息后提交到 `/api/channel-accounts`。">
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>平台</span>
              <input value={platform} onChange={(event) => setPlatform(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>账号 Key</span>
              <input value={accountKey} onChange={(event) => setAccountKey(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>显示名</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} style={fieldStyle} />
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
          </div>
        </SectionCard>

        <SectionCard title="最近创建结果" description="创建反馈和下一步动作都会在这里落地。">
          {displayCreateState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在创建账号...</p> : null}

          {displayCreateState.status === 'error' ? (
            <p style={{ margin: 0, color: '#b91c1c' }}>创建失败：{displayCreateState.error}</p>
          ) : null}

          {displayCreateState.status === 'success' && latestCreatedAccount ? (
            <div style={{ display: 'grid', gap: '12px', color: '#334155' }}>
              <div style={{ fontWeight: 700 }}>账号已创建，可继续测试连接</div>
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
                  label={displayTestConnectionState.status === 'loading' ? '正在测试连接...' : '测试连接'}
                  tone="primary"
                  onClick={handleTestConnection}
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

          {displayState.status === 'success' && displayState.data ? (
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
                          <ActionButton label="编辑账号" onClick={() => handleStartEditing(account.id)} />
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
                            保存 Session 元数据
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
                              {displayUpdateState.status === 'loading' ? '正在保存账号...' : '保存账号'}
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
                              {displaySaveSessionState.status === 'loading'
                                ? '正在保存 Session...'
                                : '保存 Session 元数据'}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            data-edit-account-id={String(account.id)}
                            onClick={() => handleStartEditing(account.id)}
                            style={{ display: 'none' }}
                          />
                        )}
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

          {displayUpdateState.status === 'success' ? (
            <p style={{ marginTop: '12px', color: '#166534' }}>账号已更新</p>
          ) : null}
          {displayUpdateState.status === 'error' ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>更新失败：{displayUpdateState.error}</p>
          ) : null}
          {displaySaveSessionState.status === 'loading' ? (
            <p style={{ marginTop: '12px', color: '#334155' }}>正在保存 Session...</p>
          ) : null}
          {displaySaveSessionState.status === 'success' ? (
            <p style={{ marginTop: '12px', color: '#166534' }}>Session 元数据已保存</p>
          ) : null}
          {displaySaveSessionState.status === 'error' ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>
              Session 保存失败：{displaySaveSessionState.error}
            </p>
          ) : null}
          {displaySessionActionState.status === 'success' && displaySessionActionState.data ? (
            <div style={{ marginTop: '12px', display: 'grid', gap: '6px', color: '#166534' }}>
              <div>{getSessionActionLabelFromAction(displaySessionActionState.data.sessionAction.action)}请求已发送</div>
              <div>{displaySessionActionState.data.sessionAction.message}</div>
            </div>
          ) : null}
          {displaySessionActionState.status === 'error' ? (
            <p style={{ marginTop: '12px', color: '#b91c1c' }}>
              登录动作失败：{displaySessionActionState.error}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="恢复动作" description="当后端未实现或返回错误时，页面会在左侧直接展示错误状态。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>点击“测试连接”会优先对最近创建账号发起真实连接测试；如果当前没有目标账号，则会先刷新列表。</div>
            <div>每个账号卡片都会显式显示 Session 是否存在、当前状态、最近验证时间和 Storage Path。</div>
            <div>“请求登录 / 重新登录”会调用新的占位接口，“保存 Session 元数据”会把 storage path、状态、验证时间和备注直接提交到后端。</div>
            <div>如果服务端返回 404 或 500，这里不会吞掉错误，而是直接在页面中显示。</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton
                label={displayTestConnectionState.status === 'loading' ? '正在测试连接...' : '测试连接'}
                tone="primary"
                onClick={handleTestConnection}
              />
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
  const readiness =
    normalizeReadinessRecord(response.test.readiness) ??
    (account ? normalizeReadinessRecord(account.publishReadiness) : undefined);
  const result =
    readTextValue(response.test.summary) ??
    (readiness ? formatReadinessStatus(readiness.status) : undefined) ??
    formatConnectionTestStatus(response.test.status);
  const message =
    readTextValue(response.test.message) ??
    (readiness ? readTextValue(readiness.message) : undefined) ??
    buildDefaultConnectionTestMessage(account, result);
  const action =
    readTextValue(response.test.action) ??
    (readiness ? readTextValue(readiness.action) : undefined);

  return {
    accountLabel: account?.displayName,
    result,
    message: message === result ? undefined : message,
    action,
    nextStep: readTextValue(response.test.nextStep),
    checkedAt: response.test.checkedAt,
  };
}

function formatConnectionTestStatus(value: unknown) {
  if (value === 'healthy') return '连接正常';
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

function readTextValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
