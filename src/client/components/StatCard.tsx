interface StatCardProps {
  label: string;
  value: string;
  detail: string;
}

export function StatCard({ label, value, detail }: StatCardProps) {
  return (
    <section
      style={{
        borderRadius: '18px',
        background: '#ffffff',
        padding: '20px',
        border: '1px solid #dbe4f0',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)'
      }}
    >
      <div style={{ fontSize: '13px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: '12px', fontSize: '32px', fontWeight: 700 }}>{value}</div>
      <div style={{ marginTop: '8px', color: '#64748b', fontSize: '14px' }}>{detail}</div>
    </section>
  );
}
