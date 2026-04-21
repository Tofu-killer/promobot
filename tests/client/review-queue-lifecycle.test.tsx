import React, { act, createElement } from 'react';
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
  style: Record<string, string>;
  attributes: Map<string, string>;
  dataset: Record<string, string>;
  eventListeners: Map<string, EventListenerEntry[]>;
  namespaceURI: string;
  value: string;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = new Map();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.value = '';
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'value') {
      this.value = value;
    }

    if (name.startsWith('data-')) {
      const datasetKey = name
        .slice(5)
        .split('-')
        .map((part, index) => (index === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
        .join('');
      this.dataset[datasetKey] = value;
    }
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }) {
    const entries = this.eventListeners.get(type) ?? [];
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    entries.push({ capture, listener });
    this.eventListeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    const entries = this.eventListeners.get(type);
    if (!entries) {
      return;
    }

    this.eventListeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event: FakeEvent) {
    event.target = this;

    const path: Array<FakeNode | FakeWindow> = [];
    let current: FakeNode | null = this;
    while (current) {
      path.push(current);
      current = current.parentNode;
    }

    const view = this.ownerDocument?.defaultView;
    if (view) {
      path.push(view);
    }

    for (let index = path.length - 1; index >= 0; index -= 1) {
      const currentTarget = path[index];
      if (!(currentTarget instanceof FakeElement || currentTarget instanceof FakeDocument || currentTarget instanceof FakeWindow)) {
        continue;
      }

      const entries = currentTarget.eventListeners.get(event.type) ?? [];
      for (const entry of entries) {
        if (!entry.capture) {
          continue;
        }

        event.currentTarget = currentTarget;
        event.eventPhase = currentTarget === this ? 2 : 1;
        entry.listener(event);
        if (event.propagationStopped) {
          return !event.defaultPrevented;
        }
      }
    }

    for (let index = 0; index < path.length; index += 1) {
      const currentTarget = path[index];
      if (!(currentTarget instanceof FakeElement || currentTarget instanceof FakeDocument || currentTarget instanceof FakeWindow)) {
        continue;
      }

      const entries = currentTarget.eventListeners.get(event.type) ?? [];
      for (const entry of entries) {
        if (entry.capture) {
          continue;
        }

        event.currentTarget = currentTarget;
        event.eventPhase = currentTarget === this ? 2 : 3;
        entry.listener(event);
        if (event.propagationStopped) {
          return !event.defaultPrevented;
        }
      }

      if (!event.bubbles && currentTarget === this) {
        break;
      }
    }

    return !event.defaultPrevented;
  }

  get innerHTML() {
    return '';
  }

  set innerHTML(value: string) {
    this.textContent = value;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
}

class FakeDocument extends FakeNode {
  defaultView: FakeWindow | null;
  documentElement: FakeElement;
  body: FakeElement;
  eventListeners: Map<string, EventListenerEntry[]>;
  activeElement: FakeElement | null;

  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.defaultView = null;
    this.eventListeners = new Map();
    this.activeElement = null;
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespaceURI: string, tagName: string) {
    return this.createElement(tagName);
  }

  createTextNode(data: string) {
    return new FakeText(data, this);
  }

  createComment(data: string) {
    return new FakeComment(data, this);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }) {
    const entries = this.eventListeners.get(type) ?? [];
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    entries.push({ capture, listener });
    this.eventListeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    const entries = this.eventListeners.get(type);
    if (!entries) {
      return;
    }

    this.eventListeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }
}

class FakeWindow {
  document: FakeDocument;
  navigator: { userAgent: string };
  location: { href: string };
  eventListeners: Map<string, EventListenerEntry[]>;
  HTMLElement: typeof FakeElement;
  HTMLIFrameElement: typeof FakeElement;
  Element: typeof FakeElement;
  Node: typeof FakeNode;
  Text: typeof FakeText;
  Comment: typeof FakeComment;
  Event: typeof FakeEvent;
  MouseEvent: typeof FakeEvent;

  constructor(document: FakeDocument) {
    this.document = document;
    this.navigator = { userAgent: 'fake' };
    this.location = { href: 'http://localhost/' };
    this.eventListeners = new Map();
    this.HTMLElement = FakeElement;
    this.HTMLIFrameElement = FakeElement;
    this.Element = FakeElement;
    this.Node = FakeNode;
    this.Text = FakeText;
    this.Comment = FakeComment;
    this.Event = FakeEvent;
    this.MouseEvent = FakeEvent;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }) {
    const entries = this.eventListeners.get(type) ?? [];
    const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
    entries.push({ capture, listener });
    this.eventListeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    const entries = this.eventListeners.get(type);
    if (!entries) {
      return;
    }

    this.eventListeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event: FakeEvent) {
    const entries = this.eventListeners.get(event.type) ?? [];
    for (const entry of entries) {
      if (entry.capture) {
        continue;
      }

      event.currentTarget = this;
      event.eventPhase = 3;
      entry.listener(event);
      if (event.propagationStopped) {
        return !event.defaultPrevented;
      }
    }

    return !event.defaultPrevented;
  }

  requestAnimationFrame(callback: FrameRequestCallback) {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }

  cancelAnimationFrame(handle: number) {
    clearTimeout(handle);
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
  vi.stubGlobal('HTMLInputElement', FakeElement);
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

  element.value = value;

  const reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'));
  const reactProps =
    reactPropsKey && reactPropsKey in element
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

describe('Review Queue lifecycle actions', () => {
  it('passes the projectId filter into review queue loads', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
        }),
      );
      await flush();
    });

    expect(loadReviewQueueAction).toHaveBeenCalledTimes(1);

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    ) as FakeElement & { value?: string };

    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
    });

    expect(loadReviewQueueAction).toHaveBeenCalledTimes(2);
    expect(loadReviewQueueAction).toHaveBeenLastCalledWith(12);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('publishes review drafts through POST /api/drafts/:id/publish', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        publishUrl: 'https://x.com/promobot/status/11',
        message: 'published immediately',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reviewQueueModule = (await import('../../src/client/pages/ReviewQueue')) as Record<string, unknown>;

    expect(typeof reviewQueueModule.publishReviewDraftRequest).toBe('function');

    const publishReviewDraftRequest = reviewQueueModule.publishReviewDraftRequest as (id: number) => Promise<{
      success: boolean;
      publishUrl: string | null;
      message: string;
    }>;

    const result = await publishReviewDraftRequest(11);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/11/publish',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.publishUrl).toBe('https://x.com/promobot/status/11');
  });

  it('schedules review drafts through PATCH /api/drafts/:id with scheduled status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        draft: {
          id: 11,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'scheduled',
          scheduledAt: '2026-04-20T09:30',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:20:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reviewQueueModule = (await import('../../src/client/pages/ReviewQueue')) as Record<string, unknown>;

    expect(typeof reviewQueueModule.scheduleReviewDraftRequest).toBe('function');

    const scheduleReviewDraftRequest = reviewQueueModule.scheduleReviewDraftRequest as (
      id: number,
      input: { scheduledAt: string | null; status: 'scheduled' },
    ) => Promise<{ draft: { status: string; scheduledAt?: string } }>;

    const result = await scheduleReviewDraftRequest(11, {
      scheduledAt: '2026-04-20T09:30',
      status: 'scheduled',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/11',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: '2026-04-20T09:30',
          status: 'scheduled',
        }),
      }),
    );
    expect(result.draft.status).toBe('scheduled');
    expect(result.draft.scheduledAt).toBe('2026-04-20T09:30');
  });

  it('shows publish success feedback and removes the draft from the review queue', async () => {
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
      ],
    });
    const publishReviewDraftAction = vi.fn().mockResolvedValue({
      success: true,
      publishUrl: 'https://x.com/promobot/status/11',
      message: 'published immediately',
    });
    const scheduleReviewDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 11,
        platform: 'x',
        title: 'Launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T01:20:00.000Z',
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

    expect(publishButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(publishReviewDraftAction).toHaveBeenCalledWith(11);
    expect(collectText(container)).toContain('已发布：Launch thread');
    expect(collectText(container)).toContain('发布链接：https://x.com/promobot/status/11');
    expect(collectText(container)).toContain('回执消息：published immediately');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '11'),
      ),
    ).toBe(false);
    expect(collectText(container)).toContain('暂无待审核草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows schedule success feedback and removes the draft from the review queue', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 12,
          platform: 'x',
          title: 'Scheduled launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const scheduleReviewDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 12,
        platform: 'x',
        title: 'Scheduled launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T01:20:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          scheduleReviewDraftAction,
        }),
      );
      await flush();
    });

    const scheduleField = findElement(
      container,
      (element) => element.getAttribute('data-review-scheduled-at-id') === '12',
    );
    const scheduleButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '12',
    );

    expect(scheduleField).not.toBeNull();
    expect(scheduleButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(scheduleField, '2026-04-20T09:30', window);
      await flush();
    });

    await act(async () => {
      scheduleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(scheduleReviewDraftAction).toHaveBeenCalledWith(12, {
      scheduledAt: '2026-04-20T09:30',
      status: 'scheduled',
    });
    expect(collectText(container)).toContain('已排程：Scheduled launch thread');
    expect(collectText(container)).toContain('排程时间：2026-04-20T09:30');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '12'),
      ),
    ).toBe(false);
    expect(collectText(container)).toContain('暂无待审核草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows publish now and schedule failure feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 21,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
        {
          id: 22,
          platform: 'reddit',
          title: 'AMA post',
          content: 'Draft AMA body',
          hashtags: ['#ama'],
          status: 'review',
          createdAt: '2026-04-19T00:30:00.000Z',
          updatedAt: '2026-04-19T00:30:00.000Z',
        },
      ],
    });
    const publishReviewDraftAction = vi.fn().mockResolvedValue({
      success: false,
      publishUrl: null,
      message: 'publisher offline',
    });
    const scheduleReviewDraftAction = vi.fn().mockRejectedValue(new Error('draft not found'));

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
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '21',
    );
    const scheduleField = findElement(
      container,
      (element) => element.getAttribute('data-review-scheduled-at-id') === '22',
    );
    const scheduleButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '22',
    );

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(publishReviewDraftAction).toHaveBeenCalledWith(21);
    expect(collectText(container)).toContain('发布失败：publisher offline');
    expect(collectText(container)).toContain('回执状态：失败');
    expect(collectText(container)).toContain('回执消息：publisher offline');

    await act(async () => {
      updateFieldValue(scheduleField, '2026-04-19T18:45', window);
      await flush();
    });

    await act(async () => {
      scheduleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(scheduleReviewDraftAction).toHaveBeenCalledWith(22, {
      scheduledAt: '2026-04-19T18:45',
      status: 'scheduled',
    });
    expect(collectText(container)).toContain('排程失败：draft not found');
    expect(collectText(container)).toContain('计划推送时间：2026-04-19T18:45');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows pending-schedule feedback when a review draft is marked scheduled without a time', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 41,
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
    const scheduleReviewDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 41,
        platform: 'x',
        title: 'Launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: null,
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T01:20:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          scheduleReviewDraftAction,
        }),
      );
      await flush();
    });

    const scheduleButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '41',
    );

    expect(scheduleButton).not.toBeNull();

    await act(async () => {
      scheduleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(scheduleReviewDraftAction).toHaveBeenCalledWith(41, {
      scheduledAt: '',
      status: 'scheduled',
    });
    expect(collectText(container)).toContain('已标记待补排程：Launch thread');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-schedule-id') === '41'),
      ),
    ).toBe(false);
    expect(collectText(container)).toContain('暂无待审核草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows manual handoff feedback when publish returns manual_required', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 31,
          platform: 'facebook-group',
          title: 'Community handoff',
          content: 'Draft body',
          hashtags: ['#community'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const publishReviewDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'facebookGroup draft 31 is ready for manual browser handoff with the saved session.',
      details: {
        browserHandoff: {
          readiness: 'ready',
          sessionAction: null,
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-31.json',
        },
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          publishReviewDraftAction,
        }),
      );
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '31',
    );

    expect(publishButton).not.toBeNull();
    expect(collectText(publishButton as unknown as FakeNode)).toContain('转入人工接管');

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(publishReviewDraftAction).toHaveBeenCalledWith(31);
    expect(collectText(container)).toContain('已生成人工接管回执：Community handoff');
    expect(collectText(container)).toContain('回执状态：人工接管');
    expect(collectText(container)).toContain('回执消息：facebookGroup draft 31 is ready for manual browser handoff with the saved session.');
    expect(collectText(container)).toContain('Handoff 状态：ready');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-31.json',
    );
    expect(collectText(container)).toContain('Community handoff');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '31'),
      ),
    ).toBe(true);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows queued publish feedback when publish returns queued', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ReviewQueuePage } = await import('../../src/client/pages/ReviewQueue');

    const loadReviewQueueAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 51,
          platform: 'x',
          title: 'Queued launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    const publishReviewDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'queued',
      publishUrl: null,
      message: 'queued for downstream publisher',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ReviewQueuePage as never, {
          loadReviewQueueAction,
          publishReviewDraftAction,
        }),
      );
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '51',
    );

    expect(publishButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(publishReviewDraftAction).toHaveBeenCalledWith(51);
    expect(collectText(container)).toContain('已入队等待发布：Queued launch thread');
    expect(collectText(container)).toContain('回执状态：已入队');
    expect(collectText(container)).toContain('回执消息：queued for downstream publisher');
    expect(
      Boolean(
        findElement(container, (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-publish-id') === '51'),
      ),
    ).toBe(false);
    expect(collectText(container)).toContain('暂无待审核草稿');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
