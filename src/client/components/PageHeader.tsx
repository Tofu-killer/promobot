import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header
      style={{
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '16px',
        flexWrap: 'wrap'
      }}
    >
      <div>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>{eyebrow}</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>{title}</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px', lineHeight: 1.5 }}>{description}</p>
      </div>
      {actions ? <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>{actions}</div> : null}
    </header>
  );
}
