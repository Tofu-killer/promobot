import { ActionButton } from '../components/ActionButton';
import { MonitorFeed } from '../components/MonitorFeed';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';

const sourceFilters = ['全部来源', 'X / Twitter', 'RSS', 'Reddit', 'Product Hunt'];

const monitorItems = [
  {
    source: 'X / Twitter',
    title: 'Competitor launched a lower entry-tier plan',
    detail: '价格点下探到团队试用区间，值得准备一个对标说明稿。'
  },
  {
    source: 'RSS',
    title: 'New API feature announcement with usage caps',
    detail: '功能有亮点，但配额限制明显，适合转成 FAQ 型跟进草稿。'
  }
];

export function MonitorPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Tracking"
        title="Competitor Monitor"
        description="把竞品动态、关键词搜索结果和 RSS 更新放到一个时间线里，支持快速生成跟进草稿。"
        actions={
          <>
            <ActionButton label="刷新监控" />
            <ActionButton label="生成跟进草稿" tone="primary" />
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <StatCard label="监控源" value="8" detail="含关键词搜索、竞品官网 RSS 与社区订阅" />
        <StatCard label="新动态" value="14" detail="最近 24 小时内新增命中，6 条尚未读过" />
        <StatCard label="待跟进" value="5" detail="适合进入 Generate Center 的竞品动态" />
      </div>

      <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(260px, 0.7fr) minmax(340px, 1.3fr)' }}>
        <SectionCard title="来源筛选" description="先缩小到一个来源簇，再决定要不要把动态推到内容生成流程。">
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {sourceFilters.map((filter, index) => (
              <button
                key={filter}
                type="button"
                style={{
                  borderRadius: '999px',
                  border: '1px solid #cbd5e1',
                  background: index === 0 ? '#dbeafe' : '#ffffff',
                  color: index === 0 ? '#1d4ed8' : '#334155',
                  padding: '8px 12px',
                  fontWeight: 700
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="最新动态" description="每条监控结果都保留来源和简短解读，方便直接转成跟进素材。">
          <MonitorFeed items={monitorItems} />
        </SectionCard>
      </div>
    </section>
  );
}
