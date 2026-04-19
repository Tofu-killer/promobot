import { DraftCard } from '../components/DraftCard';

export function DraftsPage() {
  return (
    <section>
      <header style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '32px' }}>Drafts</h2>
        <p style={{ marginTop: '12px', color: '#475569', maxWidth: '760px' }}>
          草稿列表会集中展示不同项目和渠道的候选内容，支持审核、定时和快速发布。
        </p>
      </header>

      <div style={{ display: 'grid', gap: '16px' }}>
        <DraftCard
          platform="X / Twitter"
          status="review"
          title="Claude-compatible pricing update"
          summary="用更低价格切入 OpenRouter 替代方案，强调澳洲低延迟。"
        />
        <DraftCard
          platform="Reddit"
          status="draft"
          title="API gateway comparison"
          summary="更长的技术向草稿，准备发布到 LocalLLaMA 和相关 subreddit。"
        />
      </div>
    </section>
  );
}
