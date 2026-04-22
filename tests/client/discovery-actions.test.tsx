import React, { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean;
  target: FakeNode | null;
  currentTarget: FakeNode | FakeWindow | null;
  eventPhase: number;
  propagationStopped: boolean;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? true;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.propagationStopped = false;
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {
    this.propagationStopped = true;
  }
}

type EventListenerEntry = {
  capture: boolean;
  listener: (event: FakeEvent) => void;
};

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
  private listeners: Map<string, EventListenerEntry[]>;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
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

  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({
      capture: typeof options === 'boolean' ? options : options?.capture ?? false,
      listener,
    });
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    const entries = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event: FakeEvent) {
    dispatchEventAcrossTree(event, this);
    return !event.defaultPrevented;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  get children() {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
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
  Event: typeof FakeEvent;
  MouseEvent: typeof FakeEvent;
  requestAnimationFrame: (callback: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  private listeners: Map<string, EventListenerEntry[]>;

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
    this.Event = FakeEvent;
    this.MouseEvent = FakeEvent;
    this.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    this.cancelAnimationFrame = (id) => clearTimeout(id);
    this.listeners = new Map();
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({
      capture: typeof options === 'boolean' ? options : options?.capture ?? false,
      listener,
    });
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    const entries = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event: FakeEvent) {
    dispatchWindowListeners(this, event, true);
    if (!event.propagationStopped) {
      dispatchWindowListeners(this, event, false);
    }
    return !event.defaultPrevented;
  }

  getListeners(type: string) {
    return this.listeners.get(type) ?? [];
  }
}

class FakeDocument extends FakeNode {
  defaultView!: FakeWindow;
  documentElement: FakeElement;
  body: FakeElement;
  activeElement: FakeElement | null;
  private listeners: Map<string, EventListenerEntry[]>;

  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.listeners = new Map();
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

  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({
      capture: typeof options === 'boolean' ? options : options?.capture ?? false,
      listener,
    });
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    const entries = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event: FakeEvent) {
    dispatchDocumentListeners(this, event, true);
    if (!event.propagationStopped) {
      dispatchDocumentListeners(this, event, false);
    }
    return !event.defaultPrevented;
  }

  getListeners(type: string) {
    return this.listeners.get(type) ?? [];
  }
}

function dispatchEntries(target: FakeNode | FakeWindow, event: FakeEvent, capture: boolean) {
  const entries =
    target instanceof FakeWindow
      ? target.getListeners(event.type)
      : target instanceof FakeDocument
        ? target.getListeners(event.type)
        : target instanceof FakeElement
          ? (target as FakeElement)['listeners'].get(event.type) ?? []
          : [];

  for (const entry of entries) {
    if (entry.capture !== capture) {
      continue;
    }

    event.currentTarget = target;
    entry.listener(event);
    if (event.propagationStopped) {
      return;
    }
  }
}

function dispatchDocumentListeners(document: FakeDocument, event: FakeEvent, capture: boolean) {
  dispatchEntries(document, event, capture);
}

function dispatchWindowListeners(window: FakeWindow, event: FakeEvent, capture: boolean) {
  dispatchEntries(window, event, capture);
}

function dispatchEventAcrossTree(event: FakeEvent, target: FakeElement) {
  event.target = target;

  const window = target.ownerDocument?.defaultView ?? null;
  const path: Array<FakeNode | FakeWindow> = [];
  let current: FakeNode | null = target;

  while (current) {
    path.push(current);
    current = current.parentNode;
  }

  if (window && !path.includes(window.document)) {
    path.push(window.document);
  }

  if (window) {
    path.push(window);
  }

  for (let index = path.length - 1; index >= 0; index -= 1) {
    event.eventPhase = 1;
    dispatchEntries(path[index] as FakeNode | FakeWindow, event, true);
    if (event.propagationStopped) {
      return;
    }
  }

  for (let index = 0; index < path.length; index += 1) {
    event.eventPhase = index === 0 ? 2 : 3;
    dispatchEntries(path[index] as FakeNode | FakeWindow, event, false);
    if (event.propagationStopped) {
      return;
    }
    if (!event.bubbles && index === 0) {
      return;
    }
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
  vi.stubGlobal('Event', FakeEvent);
  vi.stubGlobal('MouseEvent', FakeEvent);
  vi.stubGlobal('requestAnimationFrame', window.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', window.cancelAnimationFrame);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  return { container, window };
}

function collectText(node: FakeNode): string {
  if (node instanceof FakeText) {
    return node.data;
  }

  return node.childNodes.map((child) => collectText(child)).join('');
}

function findElement(node: FakeNode, matcher: (element: FakeElement) => boolean): FakeElement | null {
  if (node instanceof FakeElement && matcher(node)) {
    return node;
  }

  for (const child of node.childNodes) {
    const match = findElement(child, matcher);
    if (match) {
      return match;
    }
  }

  return null;
}

function updateFieldValue(element: FakeElement | null, value: string, window: FakeWindow) {
  if (!element) {
    throw new Error('expected form field');
  }

  (element as unknown as { value?: string }).value = value;

  const reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'));
  const reactProps = reactPropsKey
    ? ((element as unknown as Record<string, unknown>)[reactPropsKey] as {
        onChange?: (event: { target: { value: string } }) => void;
      })
    : null;

  if (reactProps?.onChange) {
    reactProps.onChange({ target: { value } });
    return;
  }

  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Discovery draft actions', () => {
  it('disables draft generation for preview discovery data', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride: {
            status: 'idle',
            error: null,
          },
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成草稿'),
    );

    expect(button).not.toBeNull();
    expect(button?.getAttribute('disabled')).toBe('');
    expect(collectText(container)).toContain('当前展示的是预览数据');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('generates a saved draft for a discovery item and shows the returned identifiers', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 101,
            source: 'Reddit',
            title: 'AI 短视频脚本切题',
            summary: '近 24 小时讨论增长明显，适合做教程向内容。',
            status: 'new',
            score: 92,
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 92,
        },
      },
    };
    const generateAction = vi.fn().mockResolvedValue({
      results: [
        {
          platform: 'reddit',
          title: 'Reddit launch angle',
          content: 'Draft body',
          hashtags: ['#ai'],
          draftId: 88,
        },
      ],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction: async () => stateOverride.data,
          stateOverride,
          generateAction,
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成草稿'),
    );

    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).toHaveBeenCalledWith({
      topic: 'AI 短视频脚本切题\n\n近 24 小时讨论增长明显，适合做教程向内容。',
      tone: 'professional',
      platforms: ['reddit'],
      saveAsDraft: true,
    });
    expect(collectText(container)).toContain('草稿已生成');
    expect(collectText(container)).toContain('draftId: 88');
    expect(collectText(container)).toContain('platform: reddit');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks draft generation for non-launch discovery sources and shows a manual handoff message', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 102,
            source: 'Product Hunt',
            title: '竞品推出周报模板',
            summary: '竞品把周报模板打包成独立资源，适合做拆解复盘。',
            status: 'triaged',
            score: 78,
            createdAt: '2026-04-19T02:30:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 78,
        },
      },
    };
    const generateAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction: async () => stateOverride.data,
          stateOverride,
          generateAction,
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成草稿'),
    );

    expect(button).not.toBeNull();
    expect(button?.getAttribute('disabled')).toBe('');
    expect(generateAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('当前来源不在首发平台范围内');
    expect(collectText(container)).toContain('请改走人工内容流程');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('passes the active projectId into generated discovery drafts', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 103,
            source: 'Reddit',
            title: 'Claude latency discussion',
            summary: '适合做一次针对 APAC 线路的回应稿。',
            status: 'new',
            score: 88,
            createdAt: '2026-04-19T03:00:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 88,
        },
      },
    };
    const loadDiscoveryAction = vi.fn().mockResolvedValue(stateOverride.data);
    const generateAction = vi.fn().mockResolvedValue({
      results: [
        {
          platform: 'reddit',
          title: 'Scoped Reddit launch angle',
          content: 'Draft body',
          hashtags: ['#claude'],
          draftId: 99,
        },
      ],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction,
          stateOverride,
          generateAction,
        }),
      );
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成草稿'),
    );

    expect(projectIdInput).not.toBeNull();
    expect(button).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
      await flush();
    });

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadDiscoveryAction).toHaveBeenLastCalledWith(12);
    expect(generateAction).toHaveBeenCalledWith({
      topic: 'Claude latency discussion\n\n适合做一次针对 APAC 线路的回应稿。',
      tone: 'professional',
      platforms: ['reddit'],
      saveAsDraft: true,
      projectId: 12,
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale discovery draft feedback after switching project scope with the same item id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const loadDiscoveryAction = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 103,
            source: 'Reddit',
            title: 'Project A signal',
            summary: '适合做项目 A 的首发草稿。',
            status: 'new',
            score: 88,
            createdAt: '2026-04-19T03:00:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 88,
        },
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 103,
            source: 'Reddit',
            title: 'Project B signal',
            summary: '这是另一个项目下的新信号。',
            status: 'new',
            score: 91,
            createdAt: '2026-04-19T04:00:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 91,
        },
      });
    const generateAction = vi.fn().mockResolvedValue({
      results: [
        {
          platform: 'reddit',
          title: 'Project A Reddit draft',
          content: 'Draft body',
          hashtags: ['#claude'],
          draftId: 99,
        },
      ],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction,
          generateAction,
        }),
      );
      await flush();
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成草稿'),
    );

    expect(projectIdInput).not.toBeNull();
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('草稿已生成');
    expect(collectText(container)).toContain('Project A signal');
    expect(collectText(container)).toContain('draftId: 99');

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
      await flush();
    });

    expect(loadDiscoveryAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B signal');
    expect(collectText(container)).not.toContain('草稿已生成');
    expect(collectText(container)).not.toContain('draftId: 99');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
