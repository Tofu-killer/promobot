import { ActionButton } from './ActionButton';
import { SectionCard } from './SectionCard';

export interface InboxDetailItem {
  id: number;
  source: string;
  author?: string;
}

interface InboxDetailProps {
  isPreview: boolean;
  selectedItem: InboxDetailItem | null;
  suggestedReply: string | null;
  replyDraft: string;
  isGeneratingReply: boolean;
  isSendingReply: boolean;
  canGenerateReply: boolean;
  canSendReply: boolean;
  onGenerateReply: () => void;
  onSendReply: () => void;
  onReplyDraftChange: (value: string) => void;
  onApplySuggestion: () => void;
}

interface PlaceholderActionButtonProps {
  label: string;
  hint: string;
  tone?: 'primary' | 'secondary';
}

const placeholderActionNoteStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: '13px',
  lineHeight: 1.5,
} as const;

function PlaceholderActionButton({ label, hint, tone = 'secondary' }: PlaceholderActionButtonProps) {
  const isPrimary = tone === 'primary';

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={hint}
      style={{
        borderRadius: '12px',
        border: isPrimary ? 'none' : '1px solid #cbd5e1',
        background: isPrimary ? '#bfdbfe' : '#e2e8f0',
        color: '#475569',
        padding: '12px 16px',
        fontWeight: 700,
        boxShadow: 'none',
        cursor: 'not-allowed',
        opacity: 0.8,
      }}
    >
      {label}
    </button>
  );
}

export function InboxDetail({
  isPreview,
  selectedItem,
  suggestedReply,
  replyDraft,
  isGeneratingReply,
  isSendingReply,
  canGenerateReply,
  canSendReply,
  onGenerateReply,
  onSendReply,
  onReplyDraftChange,
  onApplySuggestion,
}: InboxDetailProps) {
  const canApplySuggestion = suggestedReply !== null && suggestedReply.trim().length > 0 && selectedItem !== null;

  return (
    <SectionCard title="回复工作台" description="AI 会生成首版草稿，人工可以在发送前再补充事实和语气。">
      <div style={{ display: 'grid', gap: '12px' }}>
        <div style={{ color: '#475569', lineHeight: 1.5 }}>
          {selectedItem ? `当前会话：${selectedItem.source} · ${selectedItem.author ?? 'unknown'}` : '暂无可生成回复的会话'}
        </div>
        <div style={{ fontWeight: 700, color: '#0f172a' }}>建议回复</div>
        <div
          style={{
            borderRadius: '16px',
            border: '1px solid #dbe4f0',
            background: '#f8fafc',
            padding: '16px',
            color: '#334155',
            lineHeight: 1.6,
          }}
        >
          {isGeneratingReply
            ? '正在生成回复建议...'
            : suggestedReply ??
              (isPreview
                ? '预览数据不可生成回复。'
                : selectedItem
                  ? '点击“AI 生成回复”后，这里会展示最新的 AI 草稿。'
                  : '收件箱为空，暂无可生成回复的会话。')}
        </div>
        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>回复草稿</span>
          <textarea
            data-reply-draft={replyDraft}
            value={replyDraft}
            onChange={(event) => onReplyDraftChange(event.target.value)}
            placeholder={
              selectedItem ? '在这里整理人工回复草稿，再复制到目标平台。' : '选择一条会话后，这里会保留你的人工回复草稿。'
            }
            style={{
              minHeight: '140px',
              borderRadius: '16px',
              border: '1px solid #dbe4f0',
              background: '#ffffff',
              padding: '16px',
              color: '#0f172a',
              lineHeight: 1.6,
              resize: 'vertical',
              font: 'inherit',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <ActionButton
            label={isGeneratingReply ? '正在生成回复...' : 'AI 生成回复'}
            tone="primary"
            disabled={!canGenerateReply}
            onClick={onGenerateReply}
          />
          <ActionButton
            label="应用建议（人工复制）"
            tone="primary"
            disabled={!canApplySuggestion}
            onClick={onApplySuggestion}
          />
          <ActionButton
            label={isSendingReply ? '正在发送回复...' : '发送回复'}
            disabled={!canSendReply}
            onClick={onSendReply}
          />
        </div>
        <p style={placeholderActionNoteStyle}>发送回复会把当前草稿记录为人工投递并结单，实际发送仍需在目标平台完成。</p>
      </div>
    </SectionCard>
  );
}
