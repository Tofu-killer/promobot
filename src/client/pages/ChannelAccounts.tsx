import { useState } from 'react';
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
  createdAt: string;
  updatedAt: string;
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

export interface TestChannelAccountConnectionResponse {
  ok: boolean;
  test: {
    checkedAt: string;
    status: string;
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

export async function testChannelAccountConnectionRequest(
  accountId: number,
): Promise<TestChannelAccountConnectionResponse> {
  return apiRequest<TestChannelAccountConnectionResponse>(`/api/channel-accounts/${accountId}/test`, {
    method: 'POST',
  });
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

interface ChannelAccountsPageProps {
  loadChannelAccountsAction?: () => Promise<ChannelAccountsResponse>;
  createChannelAccountAction?: (input: CreateChannelAccountPayload) => Promise<CreateChannelAccountResponse>;
  testChannelAccountAction?: (accountId: number) => Promise<TestChannelAccountConnectionResponse>;
  stateOverride?: AsyncState<ChannelAccountsResponse>;
  createStateOverride?: AsyncState<CreateChannelAccountResponse>;
  testConnectionStateOverride?: AsyncState<TestChannelAccountConnectionResponse>;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export function ChannelAccountsPage({
  loadChannelAccountsAction = loadChannelAccountsRequest,
  createChannelAccountAction = createChannelAccountRequest,
  testChannelAccountAction = testChannelAccountConnectionRequest,
  stateOverride,
  createStateOverride,
  testConnectionStateOverride,
}: ChannelAccountsPageProps) {
  const { state, reload } = useAsyncQuery(loadChannelAccountsAction, [loadChannelAccountsAction]);
  const [platform, setPlatform] = useState('x');
  const [accountKey, setAccountKey] = useState('acct-x-2');
  const [displayName, setDisplayName] = useState('X Secondary');
  const [authType, setAuthType] = useState('api-key');
  const [status, setStatus] = useState('healthy');
  const [metadata, setMetadata] = useState('team=growth');
  const { state: createState, run: createChannelAccount } = useAsyncAction(createChannelAccountAction);
  const { state: testConnectionState, run: requestConnectionTest } = useAsyncAction(
    ({ accountId }: { accountId: number }) =>
      runChannelAccountConnectionTest(accountId, testChannelAccountAction, reload),
  );
  const displayState = stateOverride ?? state;
  const displayCreateState = createStateOverride ?? createState;
  const displayTestConnectionState = testConnectionStateOverride ?? testConnectionState;
  const latestCreatedAccount = displayCreateState.data?.channelAccount ?? null;
  const fallbackTestTarget =
    displayState.status === 'success' && Array.isArray(displayState.data?.channelAccounts)
      ? displayState.data.channelAccounts[0] ?? null
      : null;
  const testTarget = latestCreatedAccount ?? fallbackTestTarget;

  function handleCreateChannelAccount() {
    const parsedMetadata = metadata
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
            <ActionButton label="重新登录" />
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

              {displayTestConnectionState.status === 'error' ? (
                <p style={{ margin: 0, color: '#b91c1c' }}>连接测试失败：{displayTestConnectionState.error}</p>
              ) : null}

              {displayTestConnectionState.status === 'success' && displayTestConnectionState.data ? (
                <div style={{ display: 'grid', gap: '8px' }}>
                  <div style={{ fontWeight: 700 }}>最近一次连接测试</div>
                  <div>
                    <strong>结果：</strong>
                    {displayTestConnectionState.data.test.status}
                  </div>
                  <div>
                    <strong>检查时间：</strong>
                    {displayTestConnectionState.data.test.checkedAt}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {displayCreateState.status === 'idle' ? (
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
                接口返回 {Array.isArray(displayState.data.channelAccounts) ? displayState.data.channelAccounts.length : 0} 个账号
              </div>
              {Array.isArray(displayState.data.channelAccounts) ? (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {displayState.data.channelAccounts.map((account) => (
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
                    </article>
                  ))}
                </div>
              ) : null}
              <JsonPreview value={displayState.data} />
            </div>
          ) : null}

          {displayState.status === 'idle' ? (
            <p style={{ margin: 0, color: '#475569' }}>页面挂载后会自动请求真实渠道账号接口。</p>
          ) : null}
        </SectionCard>

        <SectionCard title="恢复动作" description="当后端未实现或返回错误时，页面会在左侧直接展示错误状态。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>点击“测试连接”会优先对最近创建账号发起真实连接测试；如果当前没有目标账号，则会先刷新列表。</div>
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
