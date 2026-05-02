import React, { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

const sampleDiscoveryApiResponse = {
  items: [
    {
      id: 'monitor-101',
      title: 'AI 短视频脚本切题',
      detail: '近 24 小时讨论增长明显，适合做教程向内容。',
      source: 'Reddit',
      type: 'monitor',
      status: 'new',
      score: 92,
      createdAt: '2026-04-19T00:00:00.000Z',
    },
    {
      id: 'inbox-102',
      title: '竞品推出周报模板',
      detail: '竞品把周报模板打包成独立资源，适合做拆解复盘。',
      source: 'Product Hunt',
      type: 'inbox',
      status: 'triaged',
      score: 78,
      createdAt: '2026-04-19T02:30:00.000Z',
    },
  ],
  total: 2,
  stats: {
    sources: 2,
    averageScore: 85,
  },
};

const sampleLegacyDiscoveryApiResponse = {
  items: [
    {
      id: 301,
      title: 'Legacy monitor discovery item',
      detail: '旧 contract 里的 monitor 条目仍应归一到可操作 id。',
      source: 'Reddit',
      type: 'monitor',
      status: 'new',
      score: 88,
      createdAt: '2026-04-19T04:00:00.000Z',
    },
    {
      id: '302',
      title: 'Legacy inbox discovery item',
      detail: '字符串数字 inbox id 也应补齐 inbox 前缀。',
      source: 'Product Hunt',
      type: 'inbox',
      status: 'triaged',
      score: 79,
      createdAt: '2026-04-19T05:30:00.000Z',
    },
  ],
  total: 2,
  stats: {
    sources: 2,
    averageScore: 84,
  },
};

const sampleConflictingDiscoveryApiResponse = {
  items: [
    {
      id: 'inbox-401',
      title: 'Conflicting discovery item',
      detail: '当前端同时收到 inbox 前缀 id 和 monitor type 时，应以前缀为准。',
      source: 'Reddit',
      type: 'monitor',
      status: 'needs_review',
      score: 71,
      createdAt: '2026-04-19T06:30:00.000Z',
    },
  ],
  total: 1,
  stats: {
    sources: 1,
    averageScore: 71,
  },
};

const sampleNonCanonicalDiscoveryApiResponse = {
  items: [
    {
      id: 701,
      title: 'Legacy discovery item without explicit type',
      detail: '旧 contract 里的裸数字 id 不应该被默认归一成 monitor-*。',
      source: 'Product Hunt',
      status: 'triaged',
      score: 79,
      createdAt: '2026-04-19T07:00:00.000Z',
    },
    {
      title: 'Monitor item without id',
      detail: '缺失 id 的 monitor 条目需要保留为不可操作 fallback id。',
      source: 'Reddit',
      type: 'monitor',
      status: 'new',
      score: 68,
      createdAt: '2026-04-19T07:15:00.000Z',
    },
  ],
  total: 2,
  stats: {
    sources: 2,
    averageScore: 74,
  },
};

const sampleDiscoveryPageResponse = {
  items: [
    {
      id: 'monitor-101',
      title: 'AI 短视频脚本切题',
      summary: '近 24 小时讨论增长明显，适合做教程向内容。',
      source: 'Reddit',
      type: 'monitor',
      status: 'new',
      score: 92,
      createdAt: '2026-04-19T00:00:00.000Z',
    },
    {
      id: 'inbox-102',
      title: '竞品推出周报模板',
      summary: '竞品把周报模板打包成独立资源，适合做拆解复盘。',
      source: 'Product Hunt',
      type: 'inbox',
      status: 'triaged',
      score: 78,
      createdAt: '2026-04-19T02:30:00.000Z',
    },
  ],
  total: 2,
  stats: {
    sources: 2,
    averageScore: 85,
  },
};

function renderPage(
  Component: unknown,
  props: {
    stateOverride?: {
      status: 'idle' | 'loading' | 'success' | 'error';
      data?: unknown;
      error?: string | null;
    };
  },
) {
  return renderToStaticMarkup(
    createElement(Component as (properties: typeof props) => React.JSX.Element, props),
  );
}

class FakeNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: FakeDocument | null;
  parentNode: FakeNode | null;
  childNodes: FakeNode[];

  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument | null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  appendChild(child: FakeNode) {
    return this.insertBefore(child, null);
  }

  insertBefore(child: FakeNode, referenceNode: FakeNode | null) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }

    child.parentNode = this;
    child.ownerDocument = this.nodeType === 9 ? (this as FakeDocument) : this.ownerDocument;

    if (referenceNode === null) {
      this.childNodes.push(child);
      return child;
    }

    const index = this.childNodes.indexOf(referenceNode);
    if (index === -1) {
      this.childNodes.push(child);
      return child;
    }

    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: FakeNode) {
    const index = this.childNodes.indexOf(child);
    if (index === -1) {
      throw new Error('child not found');
    }

    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  contains(node: FakeNode | null): boolean {
    if (!node) {
      return false;
    }

    let current: FakeNode | null = node;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }

    return false;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling() {
    if (!this.parentNode) {
      return null;
    }

    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get previousSibling() {
    if (!this.parentNode) {
      return null;
    }

    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index - 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes = [];

    if (value.length > 0) {
      this.appendChild(new FakeText(value, this.ownerDocument));
    }
  }
}

class FakeText extends FakeNode {
  data: string;

  constructor(data: string, ownerDocument: FakeDocument | null) {
    super(3, '#text', ownerDocument);
    this.data = data;
  }

  get nodeValue() {
    return this.data;
  }

  set nodeValue(value: string | null) {
    this.data = value ?? '';
  }

  get textContent() {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }
}

class FakeComment extends FakeNode {
  data: string;

  constructor(data: string, ownerDocument: FakeDocument | null) {
    super(8, '#comment', ownerDocument);
    this.data = data;
  }

  get nodeValue() {
    return this.data;
  }

  set nodeValue(value: string | null) {
    this.data = value ?? '';
  }

  get textContent() {
    return '';
  }

  set textContent(_value: string) {}
}

class FakeElement extends FakeNode {
  tagName: string;
  namespaceURI: string;
  style: Record<string, string>;
  attributes: Map<string, string>;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = new Map();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  setAttributeNS(_namespace: string | null, name: string, value: string) {
    this.setAttribute(name, value);
  }

  removeAttributeNS(_namespace: string | null, name: string) {
    this.removeAttribute(name);
  }

  addEventListener() {}

  removeEventListener() {}

  dispatchEvent() {
    return true;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
}

class FakeWindow {
  document: FakeDocument;
  navigator: { userAgent: string };
  location: { href: string };
  HTMLElement: typeof FakeElement;
  HTMLIFrameElement: typeof FakeElement;
  Element: typeof FakeElement;
  Node: typeof FakeNode;
  Text: typeof FakeText;
  Comment: typeof FakeComment;
  requestAnimationFrame: (callback: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;

  constructor(document: FakeDocument) {
    this.document = document;
    this.navigator = { userAgent: 'node.js' };
    this.location = { href: 'http://localhost/' };
    this.HTMLElement = FakeElement;
    this.HTMLIFrameElement = FakeElement;
    this.Element = FakeElement;
    this.Node = FakeNode;
    this.Text = FakeText;
    this.Comment = FakeComment;
    this.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    this.cancelAnimationFrame = (id) => clearTimeout(id);
  }

  addEventListener() {}

  removeEventListener() {}

  dispatchEvent() {
    return true;
  }
}

class FakeDocument extends FakeNode {
  defaultView!: FakeWindow;
  documentElement: FakeElement;
  body: FakeElement;
  activeElement: FakeElement | null;

  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string) {
    return new FakeElement(tagName, this);
  }

  createTextNode(value: string) {
    return new FakeText(value, this);
  }

  createComment(value: string) {
    return new FakeComment(value, this);
  }

  addEventListener() {}

  removeEventListener() {}

  dispatchEvent() {
    return true;
  }
}

function installMinimalDom() {
  const document = new FakeDocument();
  const window = new FakeWindow(document);
  document.defaultView = window;

  const container = document.createElement('div');
  document.body.appendChild(container);

  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', window.navigator);
  vi.stubGlobal('location', window.location);
  vi.stubGlobal('Node', FakeNode);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLIFrameElement', FakeElement);
  vi.stubGlobal('Text', FakeText);
  vi.stubGlobal('Comment', FakeComment);
  vi.stubGlobal('requestAnimationFrame', window.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', window.cancelAnimationFrame);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  return { container };
}

function collectText(node: FakeNode): string {
  if (node instanceof FakeText) {
    return node.data;
  }

  return node.childNodes.map((child) => collectText(child)).join('');
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Discovery page wiring', () => {
  it('loads discovery feed through /api/discovery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleDiscoveryApiResponse));
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/lib/discovery')) as Record<string, unknown>;

    expect(typeof discoveryModule.loadDiscoveryRequest).toBe('function');

    const loadDiscoveryRequest = discoveryModule.loadDiscoveryRequest as () => Promise<{
      total: number;
      stats: { sources: number; averageScore: number | null };
      items: Array<{
        id: string;
        title: string;
        summary: string;
        source: string;
        type: 'monitor' | 'inbox';
        score: number | null;
      }>;
    }>;

    const result = await loadDiscoveryRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/discovery', undefined);
    expect(result.total).toBe(2);
    expect(result.stats.sources).toBe(2);
    expect(result.stats.averageScore).toBe(85);
    expect(result.items[0]?.title).toBe('AI 短视频脚本切题');
    expect(result.items[0]?.type).toBe('monitor');
    expect(result.items[0]?.summary).toBe('近 24 小时讨论增长明显，适合做教程向内容。');
  });

  it('loads discovery feed with projectId through the page API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleDiscoveryApiResponse));
    vi.stubGlobal('fetch', fetchMock);

    const discoveryPageModule = (await import('../../src/client/pages/Discovery')) as Record<string, unknown>;

    expect(typeof discoveryPageModule.loadDiscoveryPageRequest).toBe('function');

    const loadDiscoveryPageRequest = discoveryPageModule.loadDiscoveryPageRequest as (projectId?: number) => Promise<{
      total: number;
      stats: { sources: number; averageScore: number | null };
      items: Array<{
        id: string;
        title: string;
        summary: string;
        source: string;
        type: 'monitor' | 'inbox';
        score: number | null;
      }>;
    }>;

    const result = await loadDiscoveryPageRequest(12);

    expect(fetchMock).toHaveBeenCalledWith('/api/discovery?projectId=12', undefined);
    expect(result.total).toBe(2);
    expect(result.items[1]?.source).toBe('Product Hunt');
    expect(result.items[1]?.type).toBe('inbox');
    expect(result.items[1]?.summary).toBe('竞品把周报模板打包成独立资源，适合做拆解复盘。');
  });

  it('normalizes typed numeric discovery ids into prefixed ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleLegacyDiscoveryApiResponse));
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/lib/discovery')) as Record<string, unknown>;

    expect(typeof discoveryModule.loadDiscoveryRequest).toBe('function');

    const loadDiscoveryRequest = discoveryModule.loadDiscoveryRequest as () => Promise<{
      items: Array<{ id: string; type: 'monitor' | 'inbox' }>;
    }>;

    const result = await loadDiscoveryRequest();

    expect(result.items[0]?.id).toBe('monitor-301');
    expect(result.items[0]?.type).toBe('monitor');
    expect(result.items[1]?.id).toBe('inbox-302');
    expect(result.items[1]?.type).toBe('inbox');
  });

  it('treats prefixed discovery ids as the canonical item type when type conflicts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleConflictingDiscoveryApiResponse));
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/lib/discovery')) as Record<string, unknown>;

    expect(typeof discoveryModule.loadDiscoveryRequest).toBe('function');

    const loadDiscoveryRequest = discoveryModule.loadDiscoveryRequest as () => Promise<{
      items: Array<{ id: string; type: 'monitor' | 'inbox' }>;
    }>;

    const result = await loadDiscoveryRequest();

    expect(result.items[0]?.id).toBe('inbox-401');
    expect(result.items[0]?.type).toBe('inbox');
  });

  it('keeps non-canonical legacy discovery ids non-actionable during normalization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sampleNonCanonicalDiscoveryApiResponse));
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/lib/discovery')) as Record<string, unknown>;

    expect(typeof discoveryModule.loadDiscoveryRequest).toBe('function');

    const loadDiscoveryRequest = discoveryModule.loadDiscoveryRequest as () => Promise<{
      items: Array<{ id: string; type: 'monitor' | 'inbox' | 'unknown' }>;
    }>;

    const result = await loadDiscoveryRequest();

    expect(result.items[0]?.id).toBe('701');
    expect(result.items[0]?.type).toBe('unknown');
    expect(result.items[1]?.id).toBe('discovery-2');
    expect(result.items[1]?.type).toBe('monitor');
  });

  it('shows loading, error, and success states for discovery data', async () => {
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    expect(renderPage(DiscoveryPage, { stateOverride: { status: 'loading' } })).toContain('正在加载发现池');
    expect(renderPage(DiscoveryPage, { stateOverride: { status: 'idle' } })).toContain('当前展示的是预览数据');
    expect(
      renderPage(DiscoveryPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('发现池加载失败');

    const html = renderPage(DiscoveryPage, {
      stateOverride: {
        status: 'success',
        data: sampleDiscoveryPageResponse,
      },
    });

    expect(html).toContain('候选条目');
    expect(html).toContain('数据源');
    expect(html).toContain('平均评分');
    expect(html).toContain('AI 短视频脚本切题');
    expect(html).toContain('竞品推出周报模板');
    expect(html).toContain('Reddit');
    expect(html).toContain('Product Hunt');
    expect(html).toContain('项目 ID（可选）');
  });

  it('requests discovery data on mount and renders the fetched items', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    let resolveLoad: ((value: typeof sampleDiscoveryPageResponse) => void) | null = null;
    const loadDiscoveryAction = vi.fn(
      () =>
        new Promise<typeof sampleDiscoveryPageResponse>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const root = createRoot(container as never);

    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction,
        }),
      );
      await flush();
    });

    expect(loadDiscoveryAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('正在加载发现池');

    await act(async () => {
      resolveLoad?.(sampleDiscoveryPageResponse);
      await flush();
    });

    const renderedText = collectText(container);
    expect(renderedText).toContain('AI 短视频脚本切题');
    expect(renderedText).toContain('竞品推出周报模板');
    expect(renderedText).toContain('平均评分');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
