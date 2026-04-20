import { useState } from 'react';

interface LoginPageProps {
  error?: string | null;
  onSubmit?: (password: string) => void;
}

export function LoginPage({ error, onSubmit }: LoginPageProps) {
  const [password, setPassword] = useState('');

  return (
    <section
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f5f7fb',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#ffffff',
          border: '1px solid #dbe4f0',
          borderRadius: '20px',
          padding: '28px',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          display: 'grid',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '32px' }}>Admin Login</h2>
          <p style={{ marginTop: '12px', color: '#475569', lineHeight: 1.5 }}>
            输入管理员密码后进入 PromoBot 控制台。局域网 IP 白名单仍会继续生效。
          </p>
        </div>

        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: '#122033' }}>Admin Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{
              width: '100%',
              borderRadius: '14px',
              border: '1px solid #cbd5e1',
              padding: '12px 14px',
              font: 'inherit',
              background: '#ffffff',
            }}
          />
        </label>

        {error ? <div style={{ color: '#b91c1c', fontWeight: 700 }}>登录失败：{error}</div> : null}

        <button
          type="button"
          onClick={() => onSubmit?.(password)}
          style={{
            borderRadius: '12px',
            border: 'none',
            background: '#2563eb',
            color: '#ffffff',
            padding: '12px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          进入控制台
        </button>
      </div>
    </section>
  );
}
