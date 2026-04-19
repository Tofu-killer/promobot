import { ActionButton } from '../components/ActionButton';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

const accountRows = [
  { channel: 'X / Twitter', mode: 'API Key 已脱敏', badgeTone: 'approved' as const, badgeLabel: 'Healthy' },
  { channel: 'Reddit', mode: 'Refresh token 已配置', badgeTone: 'approved' as const, badgeLabel: 'Healthy' },
  { channel: 'Facebook Group', mode: 'Playwright session 还剩 2 小时', badgeTone: 'review' as const, badgeLabel: 'Re-login Soon' }
];

export function ChannelAccountsPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Session Center"
        title="Channel Accounts"
        description="集中查看各渠道的凭证与登录态健康度，避免调度任务在后台静默失败。"
        actions={
          <>
            <ActionButton label="重新登录" />
            <ActionButton label="测试连接" tone="primary" />
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <StatCard label="在线渠道" value="5 / 6" detail="浏览器型渠道和 API 型渠道统一汇总" />
        <StatCard label="即将过期 Session" value="1" detail="Facebook Group 登录态需要尽快刷新" />
        <StatCard label="失败重试" value="2" detail="最近一次发帖失败后已自动进入重试队列" />
      </div>

      <div style={{ marginTop: '20px', display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(340px, 1.2fr) minmax(280px, 0.8fr)' }}>
        <SectionCard title="连接状态" description="只展示脱敏后的凭证和 session 状态，不在前端回显原始密钥。">
          <div style={{ display: 'grid', gap: '12px' }}>
            {accountRows.map((account) => (
              <article
                key={account.channel}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  borderRadius: '16px',
                  border: '1px solid #dbe4f0',
                  background: '#f8fafc',
                  padding: '16px',
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{account.channel}</div>
                  <div style={{ marginTop: '8px', color: '#475569' }}>{account.mode}</div>
                </div>
                <StatusBadge tone={account.badgeTone} label={account.badgeLabel} />
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="恢复动作" description="一旦 session 失效，这里会给出重新登录和连接测试入口。">
          <div style={{ display: 'grid', gap: '12px', color: '#334155', lineHeight: 1.6 }}>
            <div>浏览器型渠道会在 session 失效时直接亮红，并阻止新的发布作业继续排队。</div>
            <div>API 型渠道只显示掩码后的凭证摘要，避免误暴露密钥。</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton label="重新登录" />
              <ActionButton label="测试连接" tone="primary" />
            </div>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
