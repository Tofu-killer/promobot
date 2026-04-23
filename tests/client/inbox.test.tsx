import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InboxDetail } from '../../src/client/components/InboxDetail';

describe('InboxDetail', () => {
  it('renders the selected inbox item context and suggested reply', () => {
    const html = renderToStaticMarkup(
      createElement(InboxDetail, {
        isPreview: false,
        selectedItem: {
          id: 7,
          source: 'reddit',
          author: 'user123',
        },
        suggestedReply: 'Reply for item A only.',
        replyDraft: 'Reply for item A only.',
        isGeneratingReply: false,
        canGenerateReply: true,
        onGenerateReply: vi.fn(),
        onReplyDraftChange: vi.fn(),
        onApplySuggestion: vi.fn(),
      }),
    );

    expect(html).toContain('当前会话：reddit · user123');
    expect(html).toContain('Reply for item A only.');
    expect(html).toContain('应用建议（人工复制）');
    expect(html).toContain('回复草稿');
    expect(html).toContain('<textarea');
  });

  it('renders the preview placeholder and disables reply generation when no item is selected', () => {
    const html = renderToStaticMarkup(
      createElement(InboxDetail, {
        isPreview: true,
        selectedItem: null,
        suggestedReply: null,
        replyDraft: '',
        isGeneratingReply: false,
        canGenerateReply: false,
        onGenerateReply: vi.fn(),
        onReplyDraftChange: vi.fn(),
        onApplySuggestion: vi.fn(),
      }),
    );

    expect(html).toContain('暂无可生成回复的会话');
    expect(html).toContain('预览数据不可生成回复。');
    expect(html).toContain('AI 生成回复');
    expect(html).toContain('disabled');
  });
});
