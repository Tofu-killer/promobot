interface MonitorItem {
  id: number;
  source: string;
  title: string;
  detail: string;
  status?: string;
  createdAt?: string;
}

interface MonitorFeedProps {
  items: MonitorItem[];
  selectedItemId?: number | null;
  onSelectItem?: (item: MonitorItem) => void;
}

export function MonitorFeed({ items, selectedItemId = null, onSelectItem }: MonitorFeedProps) {
  if (items.length === 0) {
    return <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>当前筛选下暂无监控动态。</p>;
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {items.map((item) => {
        const isSelected = item.id === selectedItemId;

        return (
        <button
          key={item.id}
          type="button"
          data-monitor-item-id={String(item.id)}
          data-monitor-item-selected={isSelected ? 'true' : 'false'}
          aria-pressed={isSelected}
          onClick={() => onSelectItem?.(item)}
          style={{
            borderRadius: '16px',
            border: isSelected ? '1px solid #2563eb' : '1px solid #dbe4f0',
            background: isSelected ? '#eff6ff' : '#f8fafc',
            padding: '16px',
            textAlign: 'left',
            cursor: 'pointer',
            boxShadow: isSelected ? '0 0 0 1px rgba(37, 99, 235, 0.15)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px', color: '#2563eb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {item.source}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {isSelected ? (
                <div
                  style={{
                    fontSize: '12px',
                    color: '#1d4ed8',
                    fontWeight: 700,
                    background: '#dbeafe',
                    borderRadius: '999px',
                    padding: '4px 8px',
                  }}
                >
                  已选中
                </div>
              ) : null}
              {item.status ? (
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {item.status}
                </div>
              ) : null}
            </div>
          </div>
          <div style={{ marginTop: '10px', fontWeight: 700 }}>{item.title}</div>
          <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.5 }}>{item.detail}</p>
          {item.createdAt ? <div style={{ marginTop: '10px', color: '#64748b', fontSize: '13px' }}>{item.createdAt}</div> : null}
        </button>
        );
      })}
    </div>
  );
}
