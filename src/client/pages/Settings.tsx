import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncQuery } from '../hooks/useAsyncRequest';
import { ActionButton } from '../components/ActionButton';
import { JsonPreview } from '../components/JsonPreview';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface SettingsResponse {
  settings?: {
    allowlist: string[];
    schedulerIntervalMinutes: number;
    rssDefaults: string[];
  };
  [key: string]: unknown;
}

export async function loadSettingsRequest(): Promise<SettingsResponse> {
  return apiRequest<SettingsResponse>('/api/settings');
}

interface SettingsPageProps {
  loadSettingsAction?: () => Promise<SettingsResponse>;
  stateOverride?: AsyncState<SettingsResponse>;
}

export function SettingsPage({ loadSettingsAction = loadSettingsRequest, stateOverride }: SettingsPageProps) {
  const { state, reload } = useAsyncQuery(loadSettingsAction, [loadSettingsAction]);
  const displayState = stateOverride ?? state;

  return (
    <section>
      <PageHeader
        eyebrow="Control Plane"
        title="Settings"
        description="集中管理局域网访问控制和调度配置。当前页面直接请求 `/api/settings`，把返回内容或错误显示出来。"
        actions={
          <>
            <ActionButton label="重新加载默认源" onClick={reload} />
            <ActionButton label="保存设置" tone="primary" />
          </>
        }
      />

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
        <SectionCard title="LAN allowlist" description="真实接口响应首先显示在这里。">
          {displayState.status === 'loading' ? <p style={{ margin: 0, color: '#334155' }}>正在加载设置...</p> : null}

          {displayState.status === 'error' ? (
            <p style={{ margin: 0, color: '#b91c1c' }}>设置加载失败：{displayState.error}</p>
          ) : null}

          {displayState.status === 'success' && displayState.data ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ fontWeight: 700 }}>已加载当前设置</div>
              {displayState.data.settings ? (
                <div style={{ display: 'grid', gap: '8px', color: '#334155' }}>
                  <div>schedulerIntervalMinutes: {displayState.data.settings.schedulerIntervalMinutes}</div>
                  <div>allowlist: {displayState.data.settings.allowlist.join(', ')}</div>
                  <div>rssDefaults: {displayState.data.settings.rssDefaults.join(', ')}</div>
                </div>
              ) : null}
              <JsonPreview value={displayState.data} />
            </div>
          ) : null}

          {displayState.status === 'idle' ? (
            <p style={{ margin: 0, color: '#475569' }}>页面挂载后会自动请求真实设置接口。</p>
          ) : null}
        </SectionCard>

        <SectionCard title="调度间隔" description="即使当前接口未实现，错误也会直接显示，方便前后端联调。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>如果接口成功返回，这一页会把设置 JSON 原样显示。</div>
            <div>如果接口缺失或失败，这里配合左侧卡片一起保留错误上下文。</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton label="重新加载默认源" onClick={reload} />
              <ActionButton label="保存设置" tone="primary" />
            </div>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
