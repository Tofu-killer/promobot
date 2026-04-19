interface SentimentBar {
  label: string;
  value: number;
  color: string;
}

interface SentimentChartProps {
  bars: SentimentBar[];
}

export function SentimentChart({ bars }: SentimentChartProps) {
  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      {bars.map((bar) => (
        <div key={bar.label} style={{ display: 'grid', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px', color: '#334155' }}>
            <span>{bar.label}</span>
            <strong>{bar.value}%</strong>
          </div>
          <div style={{ height: '12px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{ width: `${bar.value}%`, height: '100%', borderRadius: '999px', background: bar.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
