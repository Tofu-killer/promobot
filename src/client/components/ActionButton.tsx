interface ActionButtonProps {
  label: string;
  tone?: 'primary' | 'secondary';
  onClick?: () => void;
  disabled?: boolean;
}

export function ActionButton({ label, tone = 'secondary', onClick, disabled = false }: ActionButtonProps) {
  const isPrimary = tone === 'primary';

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      style={{
        borderRadius: '12px',
        border: isPrimary ? 'none' : '1px solid #cbd5e1',
        background: disabled ? (isPrimary ? '#bfdbfe' : '#e2e8f0') : isPrimary ? '#2563eb' : '#ffffff',
        color: disabled ? '#475569' : isPrimary ? '#ffffff' : '#122033',
        padding: '12px 16px',
        fontWeight: 700,
        boxShadow: disabled ? 'none' : isPrimary ? '0 12px 24px rgba(37, 99, 235, 0.18)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.8 : 1,
      }}
    >
      {label}
    </button>
  );
}
