import {
  type DraftFormValues,
  type DraftMutationState,
  type DraftRecord,
  type DraftStatus,
} from '../lib/drafts';

interface DraftEditorCardProps {
  draft: DraftRecord;
  formValues: DraftFormValues;
  saveState: DraftMutationState;
  publishState: DraftMutationState;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onStatusChange: (value: DraftStatus) => void;
  onSave: () => void;
  onPublish: () => void;
}

const fieldStyle = {
  width: '100%',
  borderRadius: '12px',
  border: '1px solid #cbd5e1',
  padding: '10px 12px',
  font: 'inherit',
  background: '#ffffff',
} as const;

const editableDraftStatusOptions: DraftStatus[] = ['draft', 'review', 'approved'];
const manualHandoffPlatforms = new Set(['facebook-group', 'facebookGroup', 'xiaohongshu', 'weibo', 'blog']);

function isEditableDraftStatus(status: DraftStatus) {
  return editableDraftStatusOptions.includes(status);
}

function renderFeedback(state: DraftMutationState, successPrefix: string) {
  if (state.status === 'loading') {
    return <p style={{ margin: 0, color: '#334155' }}>处理中...</p>;
  }

  if (state.status === 'success' && state.message) {
    return (
      <div style={{ display: 'grid', gap: '4px', color: '#166534' }}>
        <p style={{ margin: 0 }}>{state.message}</p>
        {state.publishUrl ? (
          <a href={state.publishUrl} style={{ color: '#166534' }}>
            {successPrefix}
          </a>
        ) : null}
      </div>
    );
  }

  if (state.status === 'error' && state.error) {
    return <p style={{ margin: 0, color: '#b91c1c' }}>{state.error}</p>;
  }

  return null;
}

export function DraftEditorCard({
  draft,
  formValues,
  saveState,
  publishState,
  onTitleChange,
  onContentChange,
  onStatusChange,
  onSave,
  onPublish,
}: DraftEditorCardProps) {
  const titleLabel = formValues.title.trim().length > 0 ? formValues.title : draft.title ?? `Draft #${draft.id}`;
  const publishLabel = manualHandoffPlatforms.has(draft.platform) ? '发起人工接管' : '触发发布';
  const editable = isEditableDraftStatus(draft.status);

  return (
    <article
      style={{
        borderRadius: '16px',
        border: '1px solid #dbe4f0',
        background: '#f8fafc',
        padding: '16px',
        display: 'grid',
        gap: '14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <strong>{titleLabel}</strong>
        <span style={{ color: '#475569' }}>{formValues.status}</span>
      </div>

      <div style={{ fontSize: '13px', color: '#2563eb', textTransform: 'uppercase' }}>{draft.platform}</div>

      {editable ? (
        <>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>标题</span>
            <input value={formValues.title} onChange={(event) => onTitleChange(event.target.value)} style={fieldStyle} />
          </label>

          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>内容</span>
            <textarea
              rows={6}
              value={formValues.content}
              onChange={(event) => onContentChange(event.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '8px', maxWidth: '220px' }}>
            <span style={{ fontWeight: 700 }}>状态</span>
            <select
              value={formValues.status}
              onChange={(event) => onStatusChange(event.target.value as DraftStatus)}
              style={fieldStyle}
            >
              {editableDraftStatusOptions.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {statusOption}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onSave}
              disabled={saveState.status === 'loading'}
              style={{
                border: 'none',
                borderRadius: '12px',
                background: '#2563eb',
                color: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
                opacity: saveState.status === 'loading' ? 0.72 : 1,
              }}
            >
              {saveState.status === 'loading' ? '正在保存...' : '保存修改'}
            </button>

            <button
              type="button"
              onClick={onPublish}
              disabled={publishState.status === 'loading'}
              style={{
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700,
                opacity: publishState.status === 'loading' ? 0.72 : 1,
              }}
            >
              {publishState.status === 'loading' ? '正在发布...' : publishLabel}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p style={{ margin: 0, color: '#475569' }}>
            当前状态已脱离 Draft 编辑流转，Drafts 页面仅展示服务器返回结果。
          </p>
          <div style={{ display: 'grid', gap: '8px' }}>
            <div style={{ display: 'grid', gap: '4px' }}>
              <span style={{ fontWeight: 700 }}>最新标题</span>
              <p style={{ margin: 0, color: '#0f172a' }}>{titleLabel}</p>
            </div>
            <div style={{ display: 'grid', gap: '4px' }}>
              <span style={{ fontWeight: 700 }}>最新内容</span>
              <p style={{ margin: 0, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{draft.content}</p>
            </div>
            {draft.scheduledAt ? (
              <div style={{ display: 'grid', gap: '4px' }}>
                <span style={{ fontWeight: 700 }}>计划发布时间</span>
                <p style={{ margin: 0, color: '#0f172a' }}>{draft.scheduledAt}</p>
              </div>
            ) : null}
            {draft.publishedAt ? (
              <div style={{ display: 'grid', gap: '4px' }}>
                <span style={{ fontWeight: 700 }}>发布时间</span>
                <p style={{ margin: 0, color: '#0f172a' }}>{draft.publishedAt}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: '8px' }}>
        {renderFeedback(saveState, '查看保存结果')}
        {renderFeedback(publishState, '查看发布结果')}
      </div>
    </article>
  );
}
