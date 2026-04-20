import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneratePage } from '../../src/client/pages/Generate';

describe('Generate page', () => {
  it('renders the core content generation controls', () => {
    const html = renderToStaticMarkup(<GeneratePage />);

    expect(html).toContain('Generate Center');
    expect(html).toContain('话题输入');
    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('例如 12');
    expect(html).toContain('语气');
    expect(html).toContain('选择渠道');
    expect(html).toContain('首发可用');
    expect(html).toContain('人工接管');
    expect(html).toContain('暂缓首发');
    expect(html).toContain('一键生成');
    expect(html).toContain('生成结果将在这里出现');
  });
});
