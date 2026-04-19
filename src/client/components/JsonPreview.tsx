interface JsonPreviewProps {
  value: unknown;
}

export function JsonPreview({ value }: JsonPreviewProps) {
  return (
    <pre
      style={{
        margin: 0,
        borderRadius: '16px',
        background: '#0f172a',
        color: '#e2e8f0',
        padding: '16px',
        overflowX: 'auto',
        fontSize: '13px',
        lineHeight: 1.5,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
