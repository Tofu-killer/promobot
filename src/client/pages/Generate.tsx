const platformOptions = ['X / Twitter', 'Reddit', 'Facebook Group', '小红书', '微博', 'Blog'];

export function GeneratePage() {
  return (
    <section>
      <header style={{ marginBottom: '24px' }}>
        <div style={{ color: '#2563eb', fontWeight: 700 }}>Content Studio</div>
        <h2 style={{ margin: '8px 0 0', fontSize: '32px' }}>Generate Center</h2>
        <p style={{ margin: '10px 0 0', color: '#475569', maxWidth: '760px' }}>
          从一个话题同时生成多平台草稿，并为审核与定时发布留出空间。
        </p>
      </header>

      <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)' }}>
        <section
          style={{
            borderRadius: '20px',
            background: '#ffffff',
            padding: '24px',
            border: '1px solid #dbe4f0'
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>话题输入</h3>
          <label style={{ display: 'grid', gap: '10px' }}>
            <span style={{ fontWeight: 700 }}>输入原始话题、功能更新或竞品动态</span>
            <textarea
              rows={8}
              defaultValue="We added a cheaper Claude-compatible endpoint for Australian customers."
              style={{
                width: '100%',
                borderRadius: '14px',
                border: '1px solid #cbd5e1',
                padding: '14px',
                font: 'inherit',
                resize: 'vertical'
              }}
            />
          </label>

          <div style={{ marginTop: '18px', display: 'grid', gap: '10px' }}>
            <div style={{ fontWeight: 700 }}>语气</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {['专业', '轻松', '激动人心'].map((tone) => (
                <button
                  key={tone}
                  type="button"
                  style={{
                    borderRadius: '999px',
                    border: '1px solid #cbd5e1',
                    background: tone === '专业' ? '#dbeafe' : '#f8fafc',
                    color: '#1e3a8a',
                    padding: '8px 12px'
                  }}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section
          style={{
            borderRadius: '20px',
            background: '#ffffff',
            padding: '24px',
            border: '1px solid #dbe4f0'
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px' }}>选择渠道</h3>
          <div style={{ display: 'grid', gap: '10px' }}>
            {platformOptions.map((platform) => (
              <label
                key={platform}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderRadius: '12px',
                  border: '1px solid #dbe4f0',
                  padding: '10px 12px'
                }}
              >
                <input defaultChecked type="checkbox" />
                <span>{platform}</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              style={{
                border: 'none',
                borderRadius: '12px',
                background: '#2563eb',
                color: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700
              }}
            >
              一键生成
            </button>
            <button
              type="button"
              style={{
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                padding: '12px 16px',
                fontWeight: 700
              }}
            >
              保存为草稿
            </button>
          </div>
        </section>
      </div>

      <section
        style={{
          marginTop: '20px',
          borderRadius: '20px',
          background: '#ffffff',
          padding: '24px',
          border: '1px solid #dbe4f0'
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '20px' }}>生成结果</h3>
        <p style={{ margin: 0, color: '#475569' }}>生成结果将在这里出现，并按平台拆分为可编辑卡片。</p>
      </section>
    </section>
  );
}
