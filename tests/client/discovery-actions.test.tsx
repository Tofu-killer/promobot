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

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
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
  it('posts discovery immediate fetch through the shared API helper', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [],
          inserted: 2,
          total: 2,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [],
          inserted: 1,
          total: 1,
          unread: 1,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/pages/Discovery')) as Record<string, unknown>;

    expect(typeof discoveryModule.fetchDiscoverySignalsRequest).toBe('function');

    const fetchDiscoverySignalsRequest = discoveryModule.fetchDiscoverySignalsRequest as (
      projectId?: number,
    ) => Promise<{ monitorInserted: number; inboxInserted: number; totalInserted: number }>;

    const result = await fetchDiscoverySignalsRequest();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/monitor/fetch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/inbox/fetch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result).toEqual({
      monitorInserted: 2,
      inboxInserted: 1,
      totalInserted: 3,
    });
  });

  it('passes projectId into discovery immediate fetch helper', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], inserted: 0, total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], inserted: 0, total: 0, unread: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/pages/Discovery')) as Record<string, unknown>;
    const fetchDiscoverySignalsRequest = discoveryModule.fetchDiscoverySignalsRequest as (
      projectId?: number,
    ) => Promise<{ monitorInserted: number; inboxInserted: number; totalInserted: number }>;

    await fetchDiscoverySignalsRequest(12);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/monitor/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 12 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/inbox/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 12 }),
      }),
    );
  });

  it('patches discovery item actions through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        item: {
          id: 'monitor-7',
          source: 'x',
          type: 'monitor',
          title: 'Competitor onboarding teardown',
          detail: '值得保留为后续拆解选题。',
          status: 'saved',
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const discoveryModule = (await import('../../src/client/pages/Discovery')) as Record<string, unknown>;

    expect(typeof discoveryModule.updateDiscoveryItemActionRequest).toBe('function');

    const updateDiscoveryItemActionRequest = discoveryModule.updateDiscoveryItemActionRequest as (
      id: string,
      action: 'save' | 'ignore',
      projectId?: number,
    ) => Promise<{ item: { id: string; status: string } }>;

    const result = await updateDiscoveryItemActionRequest('monitor-7', 'save', 12);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/discovery/monitor-7',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', projectId: 12 }),
      }),
    );
    expect(result.item.status).toBe('saved');
  });

  it('saves and ignores monitor discovery items through the page action wiring', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 'monitor-1',
            source: 'X / Twitter',
            title: 'Competitor onboarding teardown',
            summary: '值得保留为后续拆解选题。',
            status: 'new',
            score: 91,
            createdAt: '2026-04-19T09:00:00.000Z',
          },
          {
            id: 'monitor-2',
            source: 'Reddit',
            title: 'Weak launch angle',
            summary: '这个方向本轮先忽略。',
            status: 'new',
            score: 65,
            createdAt: '2026-04-19T09:05:00.000Z',
          },
          {
            id: 'inbox-3',
            source: 'Reddit',
            title: 'Inbox lead',
            summary: '需要回复，这条信号也应该支持 Discovery 保存/忽略。',
            status: 'needs_review',
            score: 72,
            createdAt: '2026-04-19T09:10:00.000Z',
          },
        ],
        total: 3,
        stats: {
          sources: 2,
          averageScore: 76,
        },
      },
    };
    const updateDiscoveryItemAction = vi
      .fn()
      .mockResolvedValueOnce({
        item: {
          id: 'monitor-1',
          source: 'X / Twitter',
          type: 'monitor',
          title: 'Competitor onboarding teardown',
          detail: '值得保留为后续拆解选题。',
          status: 'saved',
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        item: {
          id: 'monitor-2',
          source: 'Reddit',
          type: 'monitor',
          title: 'Weak launch angle',
          detail: '这个方向本轮先忽略。',
          status: 'ignored',
          createdAt: '2026-04-19T09:05:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        item: {
          id: 'inbox-3',
          source: 'Reddit',
          type: 'inbox',
          title: 'Inbox lead',
          detail: '需要回复，这条信号也应该支持 Discovery 保存/忽略。',
          status: 'ignored',
          createdAt: '2026-04-19T09:10:00.000Z',
        },
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride,
          updateDiscoveryItemAction,
        }),
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-save-id') === 'monitor-1',
    );
    const ignoreButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-ignore-id') === 'monitor-2',
    );
    const inboxSaveButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-save-id') === 'inbox-3',
    );
    const inboxIgnoreButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-ignore-id') === 'inbox-3',
    );

    expect(saveButton).not.toBeNull();
    expect(ignoreButton).not.toBeNull();
    expect(inboxSaveButton).not.toBeNull();
    expect(inboxIgnoreButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDiscoveryItemAction).toHaveBeenNthCalledWith(1, 'monitor-1', 'save');
    expect(collectText(container)).toContain('已保存到发现池。');
    expect(collectText(container)).toContain('X / Twitter · saved · 2026-04-19T09:00:00.000Z');

    await act(async () => {
      ignoreButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDiscoveryItemAction).toHaveBeenNthCalledWith(2, 'monitor-2', 'ignore');
    expect(collectText(container)).toContain('已保存到发现池。');
    expect(collectText(container)).toContain('已忽略该条发现。');
    expect(collectText(container)).toContain('Reddit · ignored · 2026-04-19T09:05:00.000Z');

    await act(async () => {
      inboxIgnoreButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDiscoveryItemAction).toHaveBeenNthCalledWith(3, 'inbox-3', 'ignore');
    expect(collectText(container)).toContain('Inbox lead');
    expect(collectText(container)).toContain('Reddit · ignored · 2026-04-19T09:10:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

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

  it('generates a saved Instagram draft for supported multi-platform discovery sources', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 106,
            source: 'Instagram',
            title: 'Instagram reel teardown',
            summary: '适合直接生成 Instagram 跟进草稿。',
            status: 'new',
            score: 89,
            createdAt: '2026-04-19T01:10:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 89,
        },
      },
    };
    const generateAction = vi.fn().mockResolvedValue({
      results: [
        {
          platform: 'instagram',
          title: 'Instagram follow-up draft',
          content: 'Draft body',
          draftId: 1060,
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
      topic: 'Instagram reel teardown\n\n适合直接生成 Instagram 跟进草稿。',
      tone: 'professional',
      platforms: ['instagram'],
      saveAsDraft: true,
    });
    expect(collectText(container)).toContain('草稿已生成');
    expect(collectText(container)).toContain('draftId: 1060');
    expect(collectText(container)).toContain('platform: instagram');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('routes non-launch discovery sources into the manual generate handoff', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 102,
            type: 'monitor',
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
    const openGenerateCenter = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction: async () => stateOverride.data,
          stateOverride,
          generateAction,
          onOpenGenerateCenter: openGenerateCenter,
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

    const handoffButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-manual-generate-id') === 'monitor-102',
    );

    expect(handoffButton).not.toBeNull();

    await act(async () => {
      handoffButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(openGenerateCenter).toHaveBeenCalledWith({
      topic: '竞品推出周报模板\n\n竞品把周报模板打包成独立资源，适合做拆解复盘。',
      preferredPlatforms: ['facebook-group', 'instagram', 'tiktok', 'xiaohongshu', 'weibo'],
    });

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

  it('does not fall back to an unscoped discovery load when a controlled projectId draft is invalid', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const loadDiscoveryAction = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      stats: {
        sources: 0,
        averageScore: 0,
      },
    });
    const fetchDiscoveryAction = vi.fn().mockResolvedValue({
      monitorInserted: 2,
      inboxInserted: 1,
      totalInserted: 3,
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction,
          fetchDiscoveryAction,
          projectIdDraft: 'invalid-project-id',
        }),
      );
      await flush();
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    ) as FakeElement & { value?: string };
    const fetchButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-fetch-action') === 'true',
    );

    expect(projectIdInput).not.toBeNull();
    expect(projectIdInput.value).toBe('invalid-project-id');
    expect(loadDiscoveryAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('项目 ID 必须是大于 0 的整数');
    expect(collectText(container)).not.toContain('发现池加载失败');

    await act(async () => {
      fetchButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(fetchDiscoveryAction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live discovery items visible while a project-scoped reload is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const pendingReload = createDeferredPromise<{
      items: Array<{
        id: number;
        source: string;
        title: string;
        summary: string;
        status: string;
        score: number;
        createdAt: string;
      }>;
      total: number;
      stats: {
        sources: number;
        averageScore: number;
      };
    }>();
    const loadDiscoveryAction = vi
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockImplementationOnce(() => pendingReload.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction,
        }),
      );
      await flush();
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(projectIdInput).not.toBeNull();
    expect(collectText(container)).toContain('Claude latency discussion');

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
    });

    expect(loadDiscoveryAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Claude latency discussion');
    expect(collectText(container)).not.toContain('当前展示的是预览数据，真实发现池加载完成后会自动替换。');

    await act(async () => {
      pendingReload.resolve({
        items: [
          {
            id: 104,
            source: 'Reddit',
            title: 'Scoped discovery result',
            summary: '切换项目后的新条目。',
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
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('filters discovery items by source and platform and keeps metrics aligned with the current filter', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 201,
            source: 'Reddit',
            title: 'Reddit launch signal',
            summary: '适合转成 reddit 首发草稿。',
            status: 'new',
            score: 92,
            createdAt: '2026-04-19T05:00:00.000Z',
          },
          {
            id: 202,
            source: 'X / Twitter',
            title: 'X trend signal',
            summary: '适合转成 X 短帖。',
            status: 'triaged',
            score: 84,
            createdAt: '2026-04-19T05:10:00.000Z',
          },
          {
            id: 203,
            source: 'Product Hunt',
            title: 'Manual research note',
            summary: '当前来源不在首发平台范围内。',
            status: 'saved',
            score: 71,
            createdAt: '2026-04-19T05:20:00.000Z',
          },
        ],
        total: 3,
        stats: {
          sources: 3,
          averageScore: 82,
        },
      },
    };

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride,
        }),
      );
      await flush();
    });

    const redditSourceFilter = findElement(
      container,
      (element) => element.getAttribute('data-discovery-filter-source') === 'reddit',
    );
    const manualPlatformFilter = findElement(
      container,
      (element) => element.getAttribute('data-discovery-filter-platform') === 'manual',
    );

    expect(redditSourceFilter).not.toBeNull();
    expect(manualPlatformFilter).not.toBeNull();

    await act(async () => {
      redditSourceFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(redditSourceFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('Reddit launch signal');
    expect(collectText(container)).not.toContain('X trend signal');
    expect(collectText(container)).not.toContain('Manual research note');
    expect(collectText(container)).toContain('当前筛选下 1 条 / 总计 3 条发现条目');
    expect(collectText(container)).toContain('候选条目1当前统一发现池中的条目数');
    expect(collectText(container)).toContain('数据源1聚合后的来源渠道数');

    await act(async () => {
      manualPlatformFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(manualPlatformFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('当前筛选下 0 条 / 总计 3 条发现条目');
    expect(collectText(container)).toContain('当前筛选下暂无发现条目');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('renders human-readable platform filter labels for supported multi-platform discovery sources', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 206,
                  source: 'Instagram',
                  title: 'Instagram discovery signal',
                  summary: '用于验证平台筛选标签。',
                  status: 'new',
                  score: 84,
                  createdAt: '2026-04-19T06:10:00.000Z',
                },
              ],
              total: 1,
              stats: {
                sources: 1,
                averageScore: 84,
              },
            },
          },
        }),
      );
      await flush();
    });

    const instagramPlatformFilter = findElement(
      container,
      (element) => element.getAttribute('data-discovery-filter-platform') === 'instagram',
    );

    expect(instagramPlatformFilter).not.toBeNull();
    expect(collectText(instagramPlatformFilter as never)).toBe('Instagram');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps draft generation working after narrowing to a matching discovery source filter', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 204,
            source: 'Reddit',
            title: 'Scoped Reddit signal',
            summary: '适合做 reddit 跟进稿。',
            status: 'new',
            score: 87,
            createdAt: '2026-04-19T06:00:00.000Z',
          },
          {
            id: 205,
            source: 'X / Twitter',
            title: 'Scoped X signal',
            summary: '适合做 X 跟进稿。',
            status: 'new',
            score: 81,
            createdAt: '2026-04-19T06:05:00.000Z',
          },
        ],
        total: 2,
        stats: {
          sources: 2,
          averageScore: 84,
        },
      },
    };
    const generateAction = vi.fn().mockResolvedValue({
      results: [
        {
          platform: 'reddit',
          title: 'Scoped reddit draft',
          content: 'Draft body',
          draftId: 300,
        },
      ],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride,
          generateAction,
        }),
      );
      await flush();
    });

    const redditSourceFilter = findElement(
      container,
      (element) => element.getAttribute('data-discovery-filter-source') === 'reddit',
    );
    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成草稿'),
    );

    expect(redditSourceFilter).not.toBeNull();
    expect(button).not.toBeNull();

    await act(async () => {
      redditSourceFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).toHaveBeenCalledWith({
      topic: 'Scoped Reddit signal\n\n适合做 reddit 跟进稿。',
      tone: 'professional',
      platforms: ['reddit'],
      saveAsDraft: true,
    });
    expect(collectText(container)).toContain('草稿已生成');
    expect(collectText(container)).toContain('draftId: 300');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('batch-generates drafts for the selected discovery items', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 301,
            type: 'monitor',
            source: 'Reddit',
            title: 'Batch reddit signal',
            summary: '适合做 reddit 批量跟进稿。',
            status: 'new',
            score: 90,
            createdAt: '2026-04-19T07:00:00.000Z',
          },
          {
            id: 302,
            type: 'monitor',
            source: 'X / Twitter',
            title: 'Batch x signal',
            summary: '适合做 X 批量跟进稿。',
            status: 'new',
            score: 83,
            createdAt: '2026-04-19T07:05:00.000Z',
          },
        ],
        total: 2,
        stats: {
          sources: 2,
          averageScore: 87,
        },
      },
    };
    const generateAction = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            platform: 'reddit',
            title: 'Batch reddit draft',
            content: 'Draft body',
            draftId: 401,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            platform: 'x',
            title: 'Batch x draft',
            content: 'Draft body',
            draftId: 402,
          },
        ],
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride,
          generateAction,
        }),
      );
      await flush();
    });

    const firstSelectButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-select-item') === 'monitor-301',
    );
    const secondSelectButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-select-item') === 'monitor-302',
    );
    const batchGenerateButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-batch-generate') === 'true',
    );

    expect(firstSelectButton).not.toBeNull();
    expect(secondSelectButton).not.toBeNull();
    expect(batchGenerateButton).not.toBeNull();

    await act(async () => {
      firstSelectButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSelectButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(firstSelectButton?.getAttribute('aria-pressed')).toBe('true');
    expect(secondSelectButton?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('已选 2 条可批量生成的发现条目');

    await act(async () => {
      batchGenerateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).toHaveBeenNthCalledWith(1, {
      topic: 'Batch reddit signal\n\n适合做 reddit 批量跟进稿。',
      tone: 'professional',
      platforms: ['reddit'],
      saveAsDraft: true,
    });
    expect(generateAction).toHaveBeenNthCalledWith(2, {
      topic: 'Batch x signal\n\n适合做 X 批量跟进稿。',
      tone: 'professional',
      platforms: ['x'],
      saveAsDraft: true,
    });
    expect(collectText(container)).toContain('已批量生成 2 条发现草稿');
    expect(collectText(container)).toContain('draftId: 401');
    expect(collectText(container)).toContain('draftId: 402');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live discovery items visible while an immediate fetch triggers a reload', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const pendingReload = createDeferredPromise<{
      items: Array<{
        id: number;
        source: string;
        title: string;
        summary: string;
        status: string;
        score: number;
        createdAt: string;
      }>;
      total: number;
      stats: {
        sources: number;
        averageScore: number;
      };
    }>();
    const loadDiscoveryAction = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 401,
            source: 'Reddit',
            title: 'Discovery item before fetch',
            summary: '抓取前的现有条目。',
            status: 'new',
            score: 90,
            createdAt: '2026-04-19T08:00:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 90,
        },
      })
      .mockImplementationOnce(() => pendingReload.promise);
    const fetchDiscoveryAction = vi.fn().mockResolvedValue({
      monitorInserted: 2,
      inboxInserted: 1,
      totalInserted: 3,
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          loadDiscoveryAction,
          fetchDiscoveryAction,
        }),
      );
      await flush();
      await flush();
    });

    const fetchButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-fetch-action') === 'true',
    );

    expect(fetchButton).not.toBeNull();
    expect(collectText(container)).toContain('Discovery item before fetch');

    await act(async () => {
      fetchButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(fetchDiscoveryAction).toHaveBeenCalledWith();
    expect(loadDiscoveryAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('已同步发现信号：monitor 2 条，inbox 1 条');
    expect(collectText(container)).toContain('Discovery item before fetch');

    await act(async () => {
      pendingReload.resolve({
        items: [
          {
            id: 402,
            source: 'X / Twitter',
            title: 'Discovery item after fetch',
            summary: '抓取后的新条目。',
            status: 'new',
            score: 88,
            createdAt: '2026-04-19T08:05:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 88,
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('saves a monitor discovery item and reflects the updated status without regressing the current list', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 'monitor-7',
            source: 'X / Twitter',
            title: 'Competitor onboarding teardown',
            summary: '值得保留为后续拆解选题。',
            status: 'new',
            score: 86,
            createdAt: '2026-04-19T09:00:00.000Z',
          },
        ],
        total: 1,
        stats: {
          sources: 1,
          averageScore: 86,
        },
      },
    };
    const updateDiscoveryAction = vi.fn().mockResolvedValue({
      item: {
        id: 'monitor-7',
        source: 'X / Twitter',
        type: 'monitor',
        title: 'Competitor onboarding teardown',
        detail: '值得保留为后续拆解选题。',
        status: 'saved',
        createdAt: '2026-04-19T09:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride,
          updateDiscoveryAction,
        }),
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-item-action') === 'save-monitor-7',
    );

    expect(saveButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
        ),
        '12',
        window,
      );
      await flush();
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDiscoveryAction).toHaveBeenCalledWith('monitor-7', 'save', 12);
    expect(collectText(container)).toContain('条目已保存');
    expect(collectText(container)).toContain('X / Twitter · saved · 2026-04-19T09:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('enables discovery save/ignore for inbox-derived items with canonical ids', async () => {
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const html = renderToStaticMarkup(
      createElement(DiscoveryPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            items: [
              {
                id: 'inbox-9',
                source: 'Reddit',
                type: 'inbox',
                title: 'Inbox-derived discovery item',
                summary: '来源于 inbox 的聚合项。',
                status: 'needs_review',
                score: 78,
                createdAt: '2026-04-19T09:10:00.000Z',
              },
            ],
            total: 1,
            stats: {
              sources: 1,
              averageScore: 78,
            },
          },
        },
      }),
    );

    expect(html).toContain('data-discovery-save-id="inbox-9"');
    expect(html).toContain('data-discovery-ignore-id="inbox-9"');
    expect(html).not.toContain('来源于 inbox 的聚合项暂不支持保存 / 忽略动作');
    expect(html).not.toMatch(/data-discovery-item-action=\"save-inbox-9\"[^>]*disabled=\"\"/);
    expect(html).not.toMatch(/data-discovery-item-action=\"ignore-inbox-9\"[^>]*disabled=\"\"/);
  });

  it('normalizes numeric monitor ids before dispatching discovery save actions', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const updateDiscoveryAction = vi.fn().mockResolvedValue({
      item: {
        id: 'monitor-7',
        source: 'Reddit',
        type: 'monitor',
        title: 'Type-driven monitor item',
        detail: '数字 id 的 monitor 条目应该归一到可 PATCH 的 monitor-7。',
        status: 'saved',
        createdAt: '2026-04-19T09:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(DiscoveryPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              items: [
                {
                  id: 7,
                  source: 'Reddit',
                  type: 'monitor',
                  title: 'Type-driven monitor item',
                  summary: '数字 id 的 monitor 条目应该可保存。',
                  status: 'new',
                  score: 81,
                  createdAt: '2026-04-19T09:00:00.000Z',
                },
              ],
              total: 1,
              stats: {
                sources: 1,
                averageScore: 81,
              },
            },
          },
          updateDiscoveryAction,
        }),
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.getAttribute('data-discovery-save-id') === 'monitor-7',
    );

    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDiscoveryAction).toHaveBeenCalledWith('monitor-7', 'save');
    expect(collectText(container)).toContain('条目已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps discovery save and ignore disabled for monitor items with non-actionable ids', async () => {
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const html = renderToStaticMarkup(
      createElement(DiscoveryPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            items: [
              {
                id: 'lead-7',
                source: 'Reddit',
                type: 'monitor',
                title: 'Type-driven monitor item',
                summary: '这条 monitor 项虽然类型正确，但 id 不可 PATCH，动作应该保持禁用。',
                status: 'new',
                score: 81,
                createdAt: '2026-04-19T09:00:00.000Z',
              },
              {
                id: 'lead-8',
                source: 'Reddit',
                type: 'inbox',
                title: 'Type-driven inbox item with invalid id',
                summary: '这条 inbox 项应该保持禁用。',
                status: 'needs_review',
                score: 74,
                createdAt: '2026-04-19T09:05:00.000Z',
              },
            ],
            total: 2,
            stats: {
              sources: 1,
              averageScore: 78,
            },
          },
        },
      }),
    );

    expect(html).not.toContain('data-discovery-save-id="lead-7"');
    expect(html).not.toContain('data-discovery-ignore-id="lead-7"');
    expect(html).toMatch(/data-discovery-item-action=\"save-lead-7\"[^>]*disabled=\"\"/);
    expect(html).toMatch(/data-discovery-item-action=\"ignore-lead-7\"[^>]*disabled=\"\"/);
    expect(html).toMatch(/data-discovery-item-action=\"save-lead-8\"[^>]*disabled=\"\"/);
    expect(html).toMatch(/data-discovery-item-action=\"ignore-lead-8\"[^>]*disabled=\"\"/);
  });

  it('keeps discovery save and ignore disabled for legacy items without canonical monitor ids', async () => {
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const html = renderToStaticMarkup(
      createElement(DiscoveryPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            items: [
              {
                id: '701',
                source: 'Product Hunt',
                type: 'unknown',
                title: 'Legacy discovery item without explicit type',
                summary: '裸数字 legacy id 不能默认打开 monitor save/ignore。',
                status: 'triaged',
                score: 79,
                createdAt: '2026-04-19T07:00:00.000Z',
              },
              {
                id: 'discovery-2',
                source: 'Reddit',
                type: 'monitor',
                title: 'Monitor item without id',
                summary: '缺失 id 的 monitor 条目应该保持不可操作。',
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
          },
        },
      }),
    );

    expect(html).not.toContain('data-discovery-save-id="monitor-701"');
    expect(html).not.toContain('data-discovery-ignore-id="monitor-701"');
    expect(html).not.toContain('data-discovery-save-id="discovery-2"');
    expect(html).not.toContain('data-discovery-ignore-id="discovery-2"');
    expect(html).toMatch(/data-discovery-item-action=\"save-701\"[^>]*disabled=\"\"/);
    expect(html).toMatch(/data-discovery-item-action=\"ignore-701\"[^>]*disabled=\"\"/);
    expect(html).toMatch(/data-discovery-item-action=\"save-discovery-2\"[^>]*disabled=\"\"/);
    expect(html).toMatch(/data-discovery-item-action=\"ignore-discovery-2\"[^>]*disabled=\"\"/);
  });

  it('treats prefixed inbox ids as actionable inbox items even when type says monitor', async () => {
    const { DiscoveryPage } = await import('../../src/client/pages/Discovery');

    const html = renderToStaticMarkup(
      createElement(DiscoveryPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            items: [
              {
                id: 'inbox-9',
                source: 'Reddit',
                type: 'monitor',
                title: 'Conflicting discovery item',
                summary: '前缀化 inbox id 必须压过错误的 monitor type，并走 inbox 动作。',
                status: 'needs_review',
                score: 74,
                createdAt: '2026-04-19T09:05:00.000Z',
              },
            ],
            total: 1,
            stats: {
              sources: 1,
              averageScore: 74,
            },
          },
        },
      }),
    );

    expect(html).toContain('data-discovery-save-id="inbox-9"');
    expect(html).toContain('data-discovery-ignore-id="inbox-9"');
    expect(html).not.toMatch(/data-discovery-item-action=\"save-inbox-9\"[^>]*disabled=\"\"/);
    expect(html).not.toMatch(/data-discovery-item-action=\"ignore-inbox-9\"[^>]*disabled=\"\"/);
    expect(html).not.toContain('来源于 inbox 的聚合项暂不支持保存 / 忽略动作');
  });
});
