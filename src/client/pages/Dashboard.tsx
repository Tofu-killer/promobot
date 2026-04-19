import { StatCard } from '../components/StatCard';

export function DashboardPage() {
  return (
    <section>
      <header style={{ marginBottom: '24px' }}>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>Overview</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>Dashboard</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px' }}>
          先看今天的内容运营节奏，再决定是去生成新内容，还是处理待审核与待发布任务。
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <StatCard label="今日生成" value="18" detail="跨 4 个项目的候选内容草稿" />
        <StatCard label="待审核" value="7" detail="2 条高风险内容等待人工确认" />
        <StatCard label="已发布" value="11" detail="X / Reddit / Facebook Group 混合发布" />
        <StatCard label="新线索" value="24" detail="Social Inbox 与竞品监控合并命中" />
      </div>
    </section>
  );
}
