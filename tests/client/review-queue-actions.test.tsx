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

function renderPage(
  Component: unknown,
  props: {
    stateOverride: {
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

describe('review queue wiring', () => {
  it('loads review drafts through /api/drafts?status=review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'review',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reviewQueueModule = (await import('../../src/client/pages/ReviewQueue')) as Record<string, unknown>;

    expect(typeof reviewQueueModule.loadReviewQueueRequest).toBe('function');

    const loadReviewQueueRequest = reviewQueueModule.loadReviewQueueRequest as (projectId?: number) => Promise<{
      drafts: Array<{ id: number; status: string; title?: string }>;
    }>;

    const result = await loadReviewQueueRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts?status=review', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.title).toBe('Launch thread');
  });

  it('loads review drafts with a projectId filter through /api/drafts?status=review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drafts: [
          {
            id: 12,
            platform: 'x',
            title: 'Scoped launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'review',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reviewQueueModule = (await import('../../src/client/pages/ReviewQueue')) as Record<string, unknown>;

    expect(typeof reviewQueueModule.loadReviewQueueRequest).toBe('function');

    const loadReviewQueueRequest = reviewQueueModule.loadReviewQueueRequest as (projectId?: number) => Promise<{
      drafts: Array<{ id: number; status: string; title?: string }>;
    }>;

    const result = await loadReviewQueueRequest(12);

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts?status=review&projectId=12', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.title).toBe('Scoped launch thread');
  });

  it('shows loading, error, and success states', async () => {
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    expect(renderPage(ReviewQueuePage, { stateOverride: { status: 'loading' } })).toContain('正在加载审核队列');
    expect(
      renderPage(ReviewQueuePage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('审核队列加载失败');

    const html = renderPage(ReviewQueuePage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 11,
              platform: 'x',
              title: 'Launch thread',
              content: 'Draft body',
              hashtags: ['#launch'],
              status: 'review',
              createdAt: '2026-04-19T00:00:00.000Z',
              updatedAt: '2026-04-19T00:00:00.000Z',
            },
          ],
        },
      },
    });

    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('待审核草稿');
    expect(html).toContain('Launch thread');
    expect(html).toContain('通过');
    expect(html).toContain('退回');
    expect(html).toContain('丢弃');
    expect(html).toContain('当前去向：仍在审核队列，尚未推入 Publish Calendar。');
    expect(html).toContain('Publish contract');
    expect(html).toContain('回执状态：待触发');
  });

  it('approves and rejects review drafts through PATCH /api/drafts/:id', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 11,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
        {
          id: 12,
          platform: 'reddit',
          title: 'Launch post',
          content: 'Second draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T01:00:00.000Z',
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      ],
    });
    const updateReviewDraftAction = vi
      .fn()
      .mockResolvedValueOnce({
        draft: {
          id: 11,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'approved',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:10:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        draft: {
          id: 12,
          platform: 'reddit',
          title: 'Launch post',
          content: 'Second draft body',
          hashtags: ['#launch'],
          status: 'draft',
          createdAt: '2026-04-19T01:00:00.000Z',
          updatedAt: '2026-04-19T01:12:00.000Z',
        },
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          updateReviewDraftAction,
        }),
      );
      await flush();
    });

    const approveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-approve-id') === '11',
    );
    const rejectButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-reject-id') === '12',
    );

    expect(approveButton).not.toBeNull();
    expect(rejectButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateReviewDraftAction).toHaveBeenCalledWith(11, { status: 'approved' });
    expect(collectText(container)).toContain('已通过：Launch thread');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-approve-id') === '11'),
      ),
    ).toBe(false);

    await act(async () => {
      rejectButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateReviewDraftAction).toHaveBeenCalledWith(12, { status: 'draft' });
    expect(collectText(container)).toContain('已退回：Launch post');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-reject-id') === '12'),
      ),
    ).toBe(false);
    expect(collectText(container)).toContain('暂无待审核草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('discards review drafts through PATCH /api/drafts/:id by mapping discard to failed', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 21,
          platform: 'x',
          title: 'Discard me',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const updateReviewDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 21,
        platform: 'x',
        title: 'Discard me',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'failed',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T01:10:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          updateReviewDraftAction,
        }),
      );
      await flush();
    });

    const discardButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-discard-id') === '21',
    );

    expect(discardButton).not.toBeNull();

    await act(async () => {
      discardButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateReviewDraftAction).toHaveBeenCalledWith(21, { status: 'failed' });
    expect(collectText(container)).toContain('已丢弃：Discard me');
    expect(collectText(container)).toContain('暂无待审核草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks overlapping actions for the same draft while publish is in flight', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const pendingPublish = createDeferredPromise<{
      draftId: number;
      draftStatus: string;
      platform: string;
      mode: string;
      status: string;
      success: boolean;
      publishUrl: string | null;
      externalId: string | null;
      message: string;
      publishedAt: string | null;
    }>();
    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 11,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const publishReviewDraftAction = vi.fn().mockReturnValue(pendingPublish.promise);
    const scheduleReviewDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 11,
        platform: 'x',
        title: 'Launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: '',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T01:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          publishReviewDraftAction,
          scheduleReviewDraftAction,
        }),
      );
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '11',
    );
    const scheduleButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '11',
    );

    expect(publishButton).not.toBeNull();
    expect(scheduleButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      scheduleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(publishReviewDraftAction).toHaveBeenCalledWith(11);
    expect(scheduleReviewDraftAction).not.toHaveBeenCalled();

    await act(async () => {
      pendingPublish.resolve({
        draftId: 11,
        draftStatus: 'published',
        platform: 'x',
        mode: 'api',
        status: 'published',
        success: true,
        publishUrl: 'https://x.com/i/web/status/11',
        externalId: '11',
        message: 'published',
        publishedAt: '2026-04-19T02:00:00.000Z',
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps pending draft action locks after manual reload while publish is still in flight', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const pendingPublish = createDeferredPromise<{
      draftId: number;
      draftStatus: string;
      platform: string;
      mode: string;
      status: string;
      success: boolean;
      publishUrl: string | null;
      externalId: string | null;
      message: string;
      publishedAt: string | null;
    }>();
    const loadReviewQueueAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Launch thread',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'review',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Reloaded launch thread',
            content: 'Reloaded draft body',
            hashtags: ['#launch'],
            status: 'review',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T01:00:00.000Z',
          },
        ],
      });
    const publishReviewDraftAction = vi.fn().mockReturnValue(pendingPublish.promise);
    const scheduleReviewDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 11,
        platform: 'x',
        title: 'Reloaded launch thread',
        content: 'Reloaded draft body',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: '',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T01:10:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          publishReviewDraftAction,
          scheduleReviewDraftAction,
        }),
      );
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '11',
    );
    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    expect(publishButton).not.toBeNull();
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const scheduleButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '11',
    );

    expect(loadReviewQueueAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('Reloaded launch thread');
    expect(scheduleButton).not.toBeNull();
    expect(scheduleButton?.getAttribute('disabled')).not.toBeNull();

    await act(async () => {
      scheduleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(scheduleReviewDraftAction).not.toHaveBeenCalled();
    expect(collectText(container)).not.toContain('已标记待补排程：Reloaded launch thread');

    await act(async () => {
      pendingPublish.resolve({
        draftId: 11,
        draftStatus: 'published',
        platform: 'x',
        mode: 'api',
        status: 'published',
        success: true,
        publishUrl: 'https://x.com/i/web/status/11',
        externalId: '11',
        message: 'published',
        publishedAt: '2026-04-19T02:00:00.000Z',
      });
      await flush();
    });

    expect(collectText(container)).toContain('已发布：Launch thread');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
