import type { ReactNode } from 'react';

interface SectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section
      style={{
        borderRadius: '20px',
        background: '#ffffff',
        padding: '24px',
        border: '1px solid #dbe4f0',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)'
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '20px' }}>{title}</h3>
        {description ? <p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.5 }}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
