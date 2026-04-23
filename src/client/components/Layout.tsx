import type { ReactNode } from 'react';
import type { AppRoute, NavItem } from '../lib/types';

interface LayoutProps {
  activeRoute: AppRoute;
  navItems: NavItem[];
  onNavigate: (route: AppRoute) => void;
  onLogout?: () => void;
  children: ReactNode;
}

export function Layout({ activeRoute, navItems, onNavigate, onLogout, children }: LayoutProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        background: '#f5f7fb',
        color: '#122033',
        fontFamily: 'Segoe UI, sans-serif'
      }}
      >
        <aside
          aria-label="Primary navigation"
          style={{
            padding: '24px 20px',
            background: '#0f172a',
            color: '#e2e8f0',
          borderRight: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8' }}>
            AI Operations Console
          </div>
          <h1 style={{ margin: '8px 0 0', fontSize: '28px' }}>PromoBot</h1>
          <p style={{ margin: '8px 0 0', fontSize: '14px', lineHeight: 1.5, color: '#cbd5e1' }}>
            局域网内统一管理内容发现、生成、审核与发布。
          </p>
        </div>

        <nav style={{ display: 'grid', gap: '8px', flex: '1 1 auto' }}>
          {navItems.map((item) => {
            const isActive = item.id === activeRoute;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  textAlign: 'left',
                  borderRadius: '12px',
                  border: `1px solid ${isActive ? '#38bdf8' : '#1e293b'}`,
                  background: isActive ? '#082f49' : '#111827',
                  color: '#f8fafc',
                  padding: '12px 14px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 700 }}>{item.label}</div>
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}>{item.description}</div>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => onLogout?.()}
          style={{
            marginTop: '16px',
            borderRadius: '12px',
            border: '1px solid #334155',
            background: '#111827',
            color: '#f8fafc',
            padding: '12px 14px',
            cursor: 'pointer',
            textAlign: 'left',
            fontWeight: 700,
          }}
        >
          退出登录
        </button>
      </aside>

      <main style={{ padding: '32px' }}>{children}</main>
    </div>
  );
}
