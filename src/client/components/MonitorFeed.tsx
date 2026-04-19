interface MonitorItem {
  source: string;
  title: string;
  detail: string;
}

interface MonitorFeedProps {
  items: MonitorItem[];
}

export function MonitorFeed({ items }: MonitorFeedProps) {
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {items.map((item) => (
        <article
          key={`${item.source}-${item.title}`}
          style={{
            borderRadius: '16px',
            border: '1px solid #dbe4f0',
            background: '#f8fafc',
            padding: '16px'
          }}
        >
          <div style={{ fontSize: '13px', color: '#2563eb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {item.source}
          </div>
          <div style={{ marginTop: '10px', fontWeight: 700 }}>{item.title}</div>
          <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.5 }}>{item.detail}</p>
        </article>
      ))}
    </div>
  );
}
