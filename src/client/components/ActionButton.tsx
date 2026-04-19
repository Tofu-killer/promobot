interface ActionButtonProps {
  label: string;
  tone?: 'primary' | 'secondary';
  onClick?: () => void;
}

export function ActionButton({ label, tone = 'secondary', onClick }: ActionButtonProps) {
  const isPrimary = tone === 'primary';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: '12px',
        border: isPrimary ? 'none' : '1px solid #cbd5e1',
        background: isPrimary ? '#2563eb' : '#ffffff',
        color: isPrimary ? '#ffffff' : '#122033',
        padding: '12px 16px',
        fontWeight: 700,
        boxShadow: isPrimary ? '0 12px 24px rgba(37, 99, 235, 0.18)' : 'none'
      }}
    >
      {label}
    </button>
  );
}
