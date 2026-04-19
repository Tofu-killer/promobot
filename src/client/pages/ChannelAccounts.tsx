import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { JsonPreview } from '../components/JsonPreview';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface ChannelAccountsResponse {
  channelAccounts?: Array<{
    id: number;
    platform: string;
    accountKey: string;
    displayName: string;
    authType: string;
    status: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  [key: string]: unknown;
}

export async function loadChannelAccountsRequest(): Promise<ChannelAccountsResponse> {
  return apiRequest<ChannelAccountsResponse>('/api/channel-accounts');
}

interface ChannelAccountsPageProps {
  loadChannelAccountsAction?: () => Promise<ChannelAccountsResponse>;
  stateOverride?: AsyncState<ChannelAccountsResponse>;
}

export function ChannelAccountsPage({
  loadChannelAccountsAction = loadChannelAccountsRequest,
  stateOverride,
}: ChannelAccountsPageProps) {
  const { state, reload } = useAsyncQuery(loadChannelAccountsAction, [loadChannelAccountsAction]);
  const displayState = stateOverride ?? state;

  return (
    <section>
      <PageHeader
        eyebrow="Session Center"
        title="Channel Accounts"
        description="集中查看各渠道的凭证与登录态健康度。当前页面会直接请求 `/api/channel-accounts` 并展示返回结果或错误。"
        actions={
          <>
            <ActionButton label="重新登录" />
            <ActionButton label="测试连接" tone="primary" onClick={reload} />
          </>
        }
      />

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(340px, 1.2fr) minmax(280px, 0.8fr)' }}>
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
            <div>点击“测试连接”会重新请求当前接口。</div>
            <div>如果服务端返回 404 或 500，这里不会吞掉错误，而是直接在页面中显示。</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton label="重新登录" />
              <ActionButton label="测试连接" tone="primary" onClick={reload} />
            </div>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
