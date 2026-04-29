interface DataSourceSetupHintProps {
  dataLabel: string;
}

const containerStyle = {
  borderRadius: '16px',
  border: '1px dashed #bfdbfe',
  background: '#f8fbff',
  padding: '18px',
} as const;

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  border: '1px solid #bfdbfe',
  background: '#ffffff',
  color: '#1d4ed8',
  padding: '10px 14px',
  fontWeight: 700,
  textDecoration: 'none',
} as const;

export function DataSourceSetupHint({ dataLabel }: DataSourceSetupHintProps) {
  return (
    <div data-empty-state-setup-hint={dataLabel} style={containerStyle}>
      <div style={{ fontWeight: 700, color: '#0f172a' }}>这里还没有真实{dataLabel}</div>
      <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.6 }}>
        先到 Settings 补全 RSS、X、Reddit、V2EX 等监控源，再到 Projects 为目标项目添加 Source Config。后续抓取到的真实数据会自动回流到当前工作台。
      </p>
      <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <a href="/settings" data-empty-state-link="settings" style={linkStyle}>
          前往 Settings 配置监控源
        </a>
        <a href="/projects" data-empty-state-link="projects" style={linkStyle}>
          前往 Projects 配置 Source Config
        </a>
      </div>
    </div>
  );
}
