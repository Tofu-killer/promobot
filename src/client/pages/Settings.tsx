import { useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AsyncState } from '../hooks/useAsyncRequest';
import { useAsyncAction, useAsyncQuery } from '../hooks/useAsyncRequest';
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

export interface UpdateSettingsPayload {
  allowlist: string[];
  schedulerIntervalMinutes: number;
  rssDefaults: string[];
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

export async function submitSettingsForm(
  formValues: {
    allowlist: string;
    schedulerIntervalMinutes: string;
    rssDefaults: string;
  },
  action: (payload: UpdateSettingsPayload) => Promise<unknown>,
): Promise<{ ok: boolean; error?: string; payload?: UpdateSettingsPayload }> {
  const allowlist = formValues.allowlist
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const schedulerIntervalMinutes = Number(formValues.schedulerIntervalMinutes);
  const rssDefaults = formValues.rssDefaults
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (allowlist.length === 0) {
    return { ok: false, error: 'allowlist 不能为空' };
  }

  if (!Number.isInteger(schedulerIntervalMinutes) || schedulerIntervalMinutes <= 0) {
    return { ok: false, error: 'schedulerIntervalMinutes 必须是大于 0 的整数' };
  }

  const payload = {
    allowlist,
    schedulerIntervalMinutes,
    rssDefaults,
  };

  await action(payload);

  return {
    ok: true,
    payload,
  };
}

interface SettingsPageProps {
  loadSettingsAction?: () => Promise<SettingsResponse>;
  stateOverride?: AsyncState<SettingsResponse>;
  updateStateOverride?: AsyncState<SettingsResponse>;
  validationMessageOverride?: string;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  font: 'inherit',
  background: '#ffffff',
} as const;

export function SettingsPage({
  loadSettingsAction = loadSettingsRequest,
  stateOverride,
  updateStateOverride,
  validationMessageOverride,
}: SettingsPageProps) {
  const { state, reload } = useAsyncQuery(loadSettingsAction, [loadSettingsAction]);
  const [allowlist, setAllowlist] = useState('127.0.0.1, ::1');
  const [schedulerIntervalMinutes, setSchedulerIntervalMinutes] = useState('15');
  const [rssDefaults, setRssDefaults] = useState('OpenAI blog, Anthropic news');
  const { state: updateState, run: saveSettings } = useAsyncAction(updateSettingsRequest);
  const displayState = stateOverride ?? state;
  const displayUpdateState = updateStateOverride ?? updateState;
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const displayValidationMessage = validationMessageOverride ?? validationMessage;

  function handleSaveSettings() {
    void submitSettingsForm(
      {
        allowlist,
        schedulerIntervalMinutes,
        rssDefaults,
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

  return (
    <section>
      <PageHeader
        eyebrow="Control Plane"
        title="Settings"
        description="集中管理局域网访问控制和调度配置。当前页面直接请求 `/api/settings`，把返回内容或错误显示出来。"
        actions={
          <>
            <ActionButton label="重新加载默认源" onClick={reload} />
            <ActionButton label={displayUpdateState.status === 'loading' ? '正在保存设置...' : '保存设置'} tone="primary" onClick={handleSaveSettings} />
          </>
        }
      />

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
        <SectionCard title="编辑设置" description="提交 allowlist、scheduler 和 RSS 默认值到 `/api/settings`。">
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>allowlist</span>
              <input value={allowlist} onChange={(event) => setAllowlist(event.target.value)} style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>schedulerIntervalMinutes</span>
              <input
                value={schedulerIntervalMinutes}
                onChange={(event) => setSchedulerIntervalMinutes(event.target.value)}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>rssDefaults</span>
              <input value={rssDefaults} onChange={(event) => setRssDefaults(event.target.value)} style={fieldStyle} />
            </label>

            <button
              type="button"
              onClick={handleSaveSettings}
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
              {displayUpdateState.status === 'loading' ? '正在保存设置...' : '保存设置'}
            </button>
          </div>
        </SectionCard>

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
              <ActionButton label={displayUpdateState.status === 'loading' ? '正在保存设置...' : '保存设置'} tone="primary" onClick={handleSaveSettings} />
            </div>
          </div>
        </SectionCard>

        {(displayValidationMessage || displayUpdateState.status !== 'idle') && (
          <SectionCard title="最近保存结果" description="保存前校验和最近一次提交结果会显示在这里。">
            {displayValidationMessage ? (
              <p style={{ margin: 0, color: '#b91c1c' }}>
                保存前校验失败：{displayValidationMessage}
              </p>
            ) : null}
            {displayUpdateState.status === 'success' ? (
              <div style={{ color: '#166534' }}>
                <div style={{ fontWeight: 700 }}>设置已保存</div>
                {displayUpdateState.data?.settings ? (
                  <div style={{ marginTop: '8px' }}>
                    {displayUpdateState.data.settings.allowlist.join(', ')}
                  </div>
                ) : null}
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
