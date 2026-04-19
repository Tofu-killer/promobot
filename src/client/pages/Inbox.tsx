import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

export function InboxPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Response Desk"
        title="Social Inbox"
        description="统一查看命中关键词的帖子、AI 回复建议和人工接管入口，优先处理高价值会话。"
        actions={
          <>
            <ActionButton label="刷新收件箱" />
            <ActionButton label="AI 生成回复" tone="primary" />
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <StatCard label="待处理会话" value="12" detail="跨 X / Reddit / Facebook Group 的统一排队视图" />
        <StatCard label="未读命中" value="7" detail="最近 2 小时内新增的品牌相关提及" />
        <StatCard label="需人工接管" value="3" detail="AI 置信度不足，已等待人工确认" />
      </div>

      <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
        <SectionCard title="待回复队列" description="先处理意图明确、热度高的帖子，再回头看低优先级会话。">
          <article
            style={{
              borderRadius: '16px',
              border: '1px solid #dbe4f0',
              background: '#f8fafc',
              padding: '18px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>Reddit · /r/LocalLLaMA</div>
                <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.5 }}>
                  “Anyone shipping a Claude-compatible endpoint with lower APAC latency?”
                </p>
              </div>
              <StatusBadge tone="review" label="Needs Reply" />
            </div>

            <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton label="打开原帖" />
              <ActionButton label="标记已处理" />
              <ActionButton label="稍后处理" />
            </div>
          </article>
        </SectionCard>

        <SectionCard title="回复工作台" description="AI 会生成首版草稿，人工可以在发送前再补充事实和语气。">
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>建议回复</div>
            <div
              style={{
                borderRadius: '16px',
                border: '1px solid #dbe4f0',
                background: '#f8fafc',
                padding: '16px',
                color: '#334155',
                lineHeight: 1.6
              }}
            >
              We run an AU-hosted Claude-compatible endpoint, so latency stays lower for APAC traffic and the pricing is easier to predict.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton label="应用建议" tone="primary" />
              <ActionButton label="发送回复" />
            </div>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
