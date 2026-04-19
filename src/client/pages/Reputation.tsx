import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { SentimentChart } from '../components/SentimentChart';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

const sentimentBars = [
  { label: '正向', value: 58, color: '#16a34a' },
  { label: '中性', value: 27, color: '#64748b' },
  { label: '负向', value: 15, color: '#dc2626' }
];

export function ReputationPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Brand Signals"
        title="Reputation"
        description="追踪品牌口碑与情绪变化，优先暴露负面提及，并把已处理状态回写到运营视图。"
        actions={
          <>
            <ActionButton label="导出日报" />
            <ActionButton label="标记已处理" tone="primary" />
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <StatCard label="正向提及" value="34" detail="性能、价格和 AU 延迟优势是主要加分点" />
        <StatCard label="负面提及" value="9" detail="主要集中在试用额度和渠道登录体验" />
        <StatCard label="已处理" value="21" detail="人工确认后已回写 handled 状态" />
      </div>

      <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
        <SectionCard title="情绪分布" description="按最近 7 天的提及情绪做一个最小可视化，帮助判断是不是需要人工介入。">
          <SentimentChart bars={sentimentBars} />
        </SectionCard>

        <SectionCard title="重点负面提及" description="高风险条目需要优先回应，避免在多个渠道重复扩散。">
          <article
            style={{
              borderRadius: '16px',
              border: '1px solid #fecaca',
              background: '#fef2f2',
              padding: '18px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700 }}>Facebook Group · Session expired complaint</div>
              <StatusBadge tone="review" label="Escalate" />
            </div>
            <p style={{ margin: '12px 0 0', color: '#7f1d1d', lineHeight: 1.5 }}>
              用户反馈发布登录态过期后没有第一时间收到告警，需要在账号中心和调度页同步暴露风险。
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton label="标记已处理" tone="primary" />
              <ActionButton label="转入 Social Inbox" />
            </div>
          </article>
        </SectionCard>
      </div>
    </section>
  );
}
