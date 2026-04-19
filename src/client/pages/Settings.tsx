import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';

export function SettingsPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Control Plane"
        title="Settings"
        description="集中管理局域网访问控制、任务调度节奏和默认监控源，方便在一个页面里完成全局配置。"
        actions={
          <>
            <ActionButton label="重新加载默认源" />
            <ActionButton label="保存设置" tone="primary" />
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <StatCard label="LAN allowlist" value="3" detail="仅允许指定局域网 IP 和网段访问管理台" />
        <StatCard label="调度间隔" value="15 min" detail="监控抓取与发布轮询共用一套最小调度节奏" />
        <StatCard label="RSS 默认源" value="6" detail="发现池与竞品监控共享的默认输入源" />
      </div>

      <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
        <SectionCard title="访问控制" description="所有敏感配置都只回显掩码摘要，LAN allowlist 可以直接在这里维护。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>LAN allowlist: `192.168.31.0/24`, `10.0.0.0/24`, `127.0.0.1`</div>
            <div>Admin password: 已启用，前端只显示状态，不暴露真实值。</div>
            <div>API secrets: 统一脱敏显示，修改时走单独更新流程。</div>
          </div>
        </SectionCard>

        <SectionCard title="调度与默认源" description="任务间隔和 RSS/source defaults 会同时影响 Discovery、Monitor 和后台抓取任务。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>调度间隔: 15 分钟</div>
            <div>RSS/source defaults: OpenAI blog, Anthropic news, Product Hunt, Reddit watchlist</div>
            <div>抓取失败重试: 2 次，失败后进入任务日志。</div>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
