import { StatusBadge } from './StatusBadge';

interface DraftCardProps {
  platform: string;
  status: 'draft' | 'review' | 'approved';
  title: string;
  summary: string;
}

export function DraftCard({ platform, status, title, summary }: DraftCardProps) {
  const badgeTone = status === 'approved' ? 'approved' : status === 'review' ? 'review' : 'draft';
  const badgeLabel = status === 'approved' ? 'Ready' : status === 'review' ? 'Needs Review' : 'Draft';

  return (
    <article
      style={{
        borderRadius: '18px',
        background: '#ffffff',
        padding: '20px',
        border: '1px solid #dbe4f0'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <StatusBadge tone={badgeTone} label={badgeLabel} />
      </div>
      <div style={{ marginTop: '10px', fontSize: '13px', color: '#2563eb', textTransform: 'uppercase' }}>{platform}</div>
      <p style={{ margin: '12px 0 0', color: '#475569', lineHeight: 1.5 }}>{summary}</p>
    </article>
  );
}
