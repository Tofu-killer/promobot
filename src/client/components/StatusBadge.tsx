interface StatusBadgeProps {
  tone: 'draft' | 'review' | 'approved';
  label: string;
}

const toneStyles: Record<StatusBadgeProps['tone'], { background: string; color: string }> = {
  draft: { background: '#e2e8f0', color: '#334155' },
  review: { background: '#fef3c7', color: '#92400e' },
  approved: { background: '#dcfce7', color: '#166534' }
};

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  const style = toneStyles[tone];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '999px',
        padding: '4px 10px',
        fontSize: '12px',
        fontWeight: 700,
        background: style.background,
        color: style.color
      }}
    >
      {label}
    </span>
  );
}
