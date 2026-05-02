import React, { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  value: string;
  private listeners: Map<string, EventListenerEntry[]>;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = new Map();
    this.value = '';
    this.listeners = new Map();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'value') {
      this.value = value;
    }
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

describe('Publish Calendar lifecycle', () => {
  it('passes the projectId filter into publish calendar loads', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
        }),
      );
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenCalledTimes(1);

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    ) as FakeElement & { value?: string };

    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(loadDraftsAction).toHaveBeenLastCalledWith(12);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('prefers a controlled projectId draft prop for publish calendar loads', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [],
    });
    const onProjectIdDraftChange = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
          browserHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [],
              total: 0,
            },
          },
          projectIdDraft: ' 0012 ',
          onProjectIdDraftChange,
        }),
      );
      await flush();
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    ) as FakeElement & { value?: string };

    expect(projectIdInput).not.toBeNull();
    expect(projectIdInput.value).toBe(' 0012 ');
    expect(loadDraftsAction).toHaveBeenLastCalledWith(12);

    await act(async () => {
      updateFieldValue(projectIdInput, ' 0042 ', window);
      await flush();
      await flush();
    });

    expect(onProjectIdDraftChange).toHaveBeenCalledWith(' 0042 ');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('does not fall back to an unscoped publish calendar load when a controlled projectId draft is invalid', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [],
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
          browserHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [],
              total: 0,
            },
          },
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

    expect(projectIdInput).not.toBeNull();
    expect(projectIdInput.value).toBe('invalid-project-id');
    expect(loadDraftsAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('项目 ID 必须是大于 0 的整数');
    expect(collectText(container)).not.toContain('日历加载失败');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows publishedAt details for published drafts', async () => {
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const html = renderToStaticMarkup(
      createElement(PublishCalendarPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            drafts: [
              {
                id: 22,
                platform: 'reddit',
                title: 'Already live AMA',
                content: 'Published at 10:15',
                hashtags: ['#ama'],
                status: 'published',
                publishedAt: '2026-04-19T10:15:00.000Z',
                createdAt: '2026-04-19T07:00:00.000Z',
                updatedAt: '2026-04-19T10:15:00.000Z',
              },
            ],
          },
        },
      }),
    );

    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('发布时间：2026-04-19T10:15:00.000Z');
    expect(html).toContain('当前页是草稿状态视图，不等同于真实 job_queue 或发布执行结果。');
  });

  it('shows failed drafts with retry controls in publish calendar', async () => {
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const html = renderToStaticMarkup(
      createElement(PublishCalendarPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            drafts: [
              {
                id: 27,
                platform: 'x',
                title: 'Retry launch thread',
                content: 'First publish failed',
                hashtags: ['#launch'],
                status: 'failed',
                lastPublishError: 'x publisher timed out',
                lastPublishUrl: 'https://x.test/status/27',
                lastPublishMessage: 'first attempt reached publisher',
                createdAt: '2026-04-19T07:00:00.000Z',
                updatedAt: '2026-04-19T10:20:00.000Z',
              },
            ],
          },
        },
      }),
    );

    expect(html).toContain('发布失败 1');
    expect(html).toContain('Retry launch thread');
    expect(html).toContain('当前排程状态：最近一次发布失败，可直接重试。');
    expect(html).toContain('发布链接：https://x.test/status/27');
    expect(html).toContain('回执消息：first attempt reached publisher');
    expect(html).toContain('最近错误：x publisher timed out');
    expect(html).toContain('重试发布');
  });

  it('clears scheduledAt and persists null with explicit clear feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const updateDraftScheduleAction = vi.fn().mockResolvedValue({
      draft: {
        id: 11,
        platform: 'x',
        title: 'Scheduled launch thread',
        content: 'Queued for later',
        hashtags: ['#launch'],
        status: 'approved',
        scheduledAt: null,
        createdAt: '2026-04-19T08:00:00.000Z',
        updatedAt: '2026-04-19T08:10:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              drafts: [
                {
                  id: 11,
                  platform: 'x',
                  title: 'Scheduled launch thread',
                  content: 'Queued for later',
                  hashtags: ['#launch'],
                  status: 'scheduled',
                  scheduledAt: '2026-04-20T09:30',
                  createdAt: '2026-04-19T08:00:00.000Z',
                  updatedAt: '2026-04-19T08:10:00.000Z',
                },
              ],
            },
          },
          updateDraftScheduleAction,
        }),
      );
      await flush();
    });

    const clearButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-clear-id') === '11' &&
        collectText(element).includes('清空排程'),
    );

    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const clearedField = findElement(
      container,
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '11',
    );

    expect(clearedField?.value).toBe('');

    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-save-id') === '11' &&
        collectText(element).includes('保存排程'),
    );

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftScheduleAction).toHaveBeenCalledWith(11, {
      scheduledAt: null,
    });
    expect(collectText(container)).toContain('排程已清空');
    expect(collectText(container)).toContain('待补排程 0');
    expect(collectText(container)).toContain('暂无 scheduled 或 published 草稿。');
    expect(collectText(container)).not.toContain('当前排程状态：尚未提供 scheduledAt');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('refreshes scheduledAt from a later successful reload after a prior save updated local cache', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Scheduled launch thread',
            content: 'Queued for later',
            hashtags: ['#launch'],
            status: 'scheduled',
            scheduledAt: '2026-04-19T09:00',
            createdAt: '2026-04-19T08:00:00.000Z',
            updatedAt: '2026-04-19T08:10:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Scheduled launch thread',
            content: 'Queued for later',
            hashtags: ['#launch'],
            status: 'scheduled',
            scheduledAt: '2026-04-21T08:00',
            createdAt: '2026-04-19T08:00:00.000Z',
            updatedAt: '2026-04-19T09:00:00.000Z',
          },
        ],
      });
    const updateDraftScheduleAction = vi
      .fn()
      .mockResolvedValueOnce({
        draft: {
          id: 11,
          platform: 'x',
          title: 'Scheduled launch thread',
          content: 'Queued for later',
          hashtags: ['#launch'],
          status: 'scheduled',
          scheduledAt: '2026-04-20T09:30',
          createdAt: '2026-04-19T08:00:00.000Z',
          updatedAt: '2026-04-19T08:20:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        draft: {
          id: 11,
          platform: 'x',
          title: 'Scheduled launch thread',
          content: 'Queued for later',
          hashtags: ['#launch'],
          status: 'scheduled',
          scheduledAt: '2026-04-21T08:00',
          createdAt: '2026-04-19T08:00:00.000Z',
          updatedAt: '2026-04-19T09:10:00.000Z',
        },
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
          updateDraftScheduleAction,
        }),
      );
      await flush();
      await flush();
    });

    const scheduledAtField = findElement(
      container,
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '11',
    );
    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-save-id') === '11' &&
        collectText(element).includes('保存排程'),
    );
    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    expect(scheduledAtField).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(scheduledAtField, '2026-04-20T09:30', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftScheduleAction).toHaveBeenNthCalledWith(1, 11, {
      scheduledAt: '2026-04-20T09:30',
    });
    expect(scheduledAtField?.value).toBe('2026-04-20T09:30');

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const refreshedField = findElement(
      container,
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '11',
    );

    expect(refreshedField?.value).toBe('2026-04-21T08:00');

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftScheduleAction).toHaveBeenNthCalledWith(2, 11, {
      scheduledAt: '2026-04-21T08:00',
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps live publish calendar drafts visible while a reload is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const pendingReload = createDeferredPromise<{
      drafts: Array<{
        id: number;
        platform: string;
        title: string;
        content: string;
        hashtags: string[];
        status: string;
        scheduledAt: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>();
    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Scheduled launch thread',
            content: 'Queued for later',
            hashtags: ['#launch'],
            status: 'scheduled',
            scheduledAt: '2026-04-20T09:30',
            createdAt: '2026-04-19T08:00:00.000Z',
            updatedAt: '2026-04-19T08:10:00.000Z',
          },
        ],
      })
      .mockImplementationOnce(() => pendingReload.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
        }),
      );
      await flush();
      await flush();
    });

    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    expect(reloadButton).not.toBeNull();
    expect(collectText(container)).toContain('Scheduled launch thread');

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('正在加载发布日历...');
    expect(collectText(container)).toContain('Scheduled launch thread');
    expect(collectText(container)).not.toContain('暂无 scheduled 或 published 草稿。');

    await act(async () => {
      pendingReload.resolve({
        drafts: [
          {
            id: 21,
            platform: 'reddit',
            title: 'Scoped AMA',
            content: 'Reloaded scheduled draft',
            hashtags: ['#ama'],
            status: 'scheduled',
            scheduledAt: '2026-04-21T10:00',
            createdAt: '2026-04-20T08:00:00.000Z',
            updatedAt: '2026-04-20T08:10:00.000Z',
          },
        ],
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale schedule feedback after a manual reload in the same project scope', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 11,
            platform: 'x',
            title: 'Scheduled launch thread',
            content: 'Queued for later',
            hashtags: ['#launch'],
            status: 'scheduled',
            scheduledAt: '2026-04-19T09:00',
            createdAt: '2026-04-19T08:00:00.000Z',
            updatedAt: '2026-04-19T08:10:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 21,
            platform: 'reddit',
            title: 'Reloaded AMA',
            content: 'Refreshed scheduled draft',
            hashtags: ['#ama'],
            status: 'scheduled',
            scheduledAt: '2026-04-21T10:00',
            createdAt: '2026-04-20T08:00:00.000Z',
            updatedAt: '2026-04-20T08:10:00.000Z',
          },
        ],
      });
    const updateDraftScheduleAction = vi.fn().mockResolvedValue({
      draft: {
        id: 11,
        platform: 'x',
        title: 'Scheduled launch thread',
        content: 'Queued for later',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30',
        createdAt: '2026-04-19T08:00:00.000Z',
        updatedAt: '2026-04-19T08:20:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
          updateDraftScheduleAction,
        }),
      );
      await flush();
      await flush();
    });

    const scheduledAtField = findElement(
      container,
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '11',
    );
    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-save-id') === '11' &&
        collectText(element).includes('保存排程'),
    );
    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载'),
    );

    expect(scheduledAtField).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(scheduledAtField, '2026-04-20T09:30', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('排程已保存');

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Reloaded AMA');
    expect(collectText(container)).not.toContain('排程已保存');
    expect(collectText(container)).not.toContain('排程时间：2026-04-20T09:30');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('surfaces scheduled drafts without scheduledAt as pending scheduling instead of scheduled', async () => {
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const html = renderToStaticMarkup(
      createElement(PublishCalendarPage as never, {
        stateOverride: {
          status: 'success',
          data: {
            drafts: [
              {
                id: 31,
                platform: 'x',
                title: 'Needs schedule time',
                content: 'Queue but no timestamp yet',
                hashtags: ['#launch'],
                status: 'scheduled',
                scheduledAt: null,
                createdAt: '2026-04-19T08:00:00.000Z',
                updatedAt: '2026-04-19T08:10:00.000Z',
              },
            ],
          },
        },
      }),
    );

    expect(html).toContain('已排程 0');
    expect(html).toContain('待补排程 1');
    expect(html).toContain('当前排程状态：尚未提供 scheduledAt');
  });

  it('shows attempted scheduledAt in failure feedback when save fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const updateDraftScheduleAction = vi.fn().mockRejectedValue(new Error('draft not found'));

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              drafts: [
                {
                  id: 15,
                  platform: 'reddit',
                  title: 'Queued AMA',
                  content: 'Hold for APAC window',
                  hashtags: ['#ama'],
                  status: 'scheduled',
                  scheduledAt: '2026-04-19T16:00',
                  createdAt: '2026-04-19T08:00:00.000Z',
                  updatedAt: '2026-04-19T08:10:00.000Z',
                },
              ],
            },
          },
          updateDraftScheduleAction,
        }),
      );
      await flush();
    });

    const scheduledAtField = findElement(
      container,
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '15',
    );

    await act(async () => {
      updateFieldValue(scheduledAtField, '2026-04-19T18:45', window);
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-save-id') === '15' &&
        collectText(element).includes('保存排程'),
    );

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftScheduleAction).toHaveBeenCalledWith(15, {
      scheduledAt: '2026-04-19T18:45',
    });
    expect(collectText(container)).toContain('排程保存失败：draft not found');
    expect(collectText(container)).toContain('待保存时间：2026-04-19T18:45');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('requests browser session actions directly from manual-required calendar retry feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi.fn().mockResolvedValue({
      drafts: [
        {
          id: 41,
          platform: 'instagram',
          title: 'Instagram relaunch reel',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'failed',
          lastPublishError: 'missing browser session',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    });
    const retryPublishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'instagram draft 41 requires a saved browser session before manual handoff.',
      details: {
        browserHandoff: {
          platform: 'instagram',
          channelAccountId: 88,
          readiness: 'blocked',
          sessionAction: 'request_session',
          artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-41.json',
        },
      },
    });
    const requestChannelAccountSessionActionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'request_session',
        message: 'Instagram session request queued for operator pickup.',
        artifactPath: 'artifacts/browser-lane-requests/instagram/relaunch/session-request-41.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
          retryPublishDraftAction,
          requestChannelAccountSessionActionAction,
        }),
      );
      await flush();
      await flush();
    });

    const retryButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-calendar-retry-id') === '41',
    );

    await act(async () => {
      retryButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const sessionActionButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-session-action') === 'request_session',
    );

    expect(sessionActionButton).not.toBeNull();

    await act(async () => {
      sessionActionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(requestChannelAccountSessionActionAction).toHaveBeenCalledWith(88, {
      action: 'request_session',
    });
    expect(collectText(container)).toContain('Instagram session request queued for operator pickup.');
    expect(collectText(container)).toContain(
      'Session 请求路径：artifacts/browser-lane-requests/instagram/relaunch/session-request-41.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('completes browser handoffs directly from manual-required calendar retry feedback', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadDraftsAction = vi
      .fn()
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 42,
            platform: 'tiktok',
            title: 'TikTok relaunch clip',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'failed',
            lastPublishError: 'waiting for browser lane',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        drafts: [
          {
            id: 42,
            platform: 'tiktok',
            title: 'TikTok relaunch clip',
            content: 'Draft body',
            hashtags: ['#launch'],
            status: 'published',
            publishUrl: 'https://www.tiktok.com/@promobot/video/42',
            publishedAt: '2026-04-27T01:00:00.000Z',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T01:00:00.000Z',
          },
        ],
      });
    const retryPublishDraftAction = vi.fn().mockResolvedValue({
      success: false,
      status: 'manual_required',
      publishUrl: null,
      message: 'tiktok draft 42 is ready for manual browser handoff with the saved session.',
      details: {
        browserHandoff: {
          platform: 'tiktok',
          readiness: 'ready',
          artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-42.json',
          handoffAttempt: 1,
        },
      },
    });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-42.json',
      draftId: 42,
      draftStatus: 'published',
      platform: 'tiktok',
      mode: 'browser_handoff',
      status: 'published',
      success: true,
      publishUrl: 'https://www.tiktok.com/@promobot/video/42',
      externalId: null,
      message: 'TikTok browser handoff completed.',
      publishedAt: '2026-04-27T01:00:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          loadDraftsAction,
          retryPublishDraftAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    const retryButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-calendar-retry-id') === '42',
    );

    await act(async () => {
      retryButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const publishUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-field') === 'publishUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-field') === 'message',
    );
    const completeButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-complete') === 'published',
    );

    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(completeButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://www.tiktok.com/@promobot/video/42',
        window as never,
      );
      updateFieldValue(messageInput as never, 'Posted from browser lane.', window as never);
      await flush();
    });

    await act(async () => {
      completeButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-42.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://www.tiktok.com/@promobot/video/42',
      message: 'Posted from browser lane.',
    });
    expect(loadDraftsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).not.toContain('Publish browser handoff 结单');
    expect(collectText(container)).toContain('发布时间：2026-04-27T01:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores blocked persisted calendar browser handoffs after reload', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const requestChannelAccountSessionActionAction = vi.fn().mockResolvedValue({
      sessionAction: {
        action: 'request_session',
        message: 'Instagram session request queued for operator pickup.',
        artifactPath: 'artifacts/browser-lane-requests/instagram/relaunch/session-request-141.json',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              drafts: [
                {
                  id: 141,
                  platform: 'instagram',
                  title: 'Instagram relaunch reel',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  status: 'failed',
                  lastPublishError: 'missing browser session',
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:00:00.000Z',
                },
              ],
            },
          },
          browserHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'instagram',
                  channelAccountId: 88,
                  draftId: 141,
                  title: 'Instagram relaunch reel',
                  accountKey: 'instagram:relaunch',
                  status: 'pending',
                  readiness: 'blocked',
                  sessionAction: 'request_session',
                  artifactPath: 'artifacts/browser-handoffs/instagram/relaunch/instagram-draft-141.json',
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          },
          requestChannelAccountSessionActionAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('已恢复人工接管：Instagram relaunch reel');
    expect(collectText(container)).toContain('等待补充 Session 后继续发布接管。');
    expect(collectText(container)).toContain('Handoff 状态：blocked');
    expect(collectText(container)).toContain('Handoff 动作：request_session');
    expect(collectText(container)).toContain(
      'Handoff 路径：artifacts/browser-handoffs/instagram/relaunch/instagram-draft-141.json',
    );
    expect(collectText(container)).not.toContain('Publish browser handoff 结单');

    const sessionActionButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-session-action') === 'request_session',
    );

    expect(sessionActionButton).not.toBeNull();

    await act(async () => {
      sessionActionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(requestChannelAccountSessionActionAction).toHaveBeenCalledWith(88, {
      action: 'request_session',
    });
    expect(collectText(container)).toContain('Instagram session request queued for operator pickup.');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores ready persisted calendar browser handoffs after reload and completes them inline', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-142.json',
      draftId: 142,
      draftStatus: 'published',
      platform: 'tiktok',
      mode: 'browser_handoff',
      status: 'published',
      success: true,
      publishUrl: 'https://www.tiktok.com/@promobot/video/142',
      externalId: null,
      message: 'TikTok browser handoff completed.',
      publishedAt: '2026-04-29T01:00:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              drafts: [
                {
                  id: 142,
                  platform: 'tiktok',
                  title: 'TikTok relaunch clip',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  status: 'failed',
                  lastPublishError: 'waiting for browser lane',
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:00:00.000Z',
                },
              ],
            },
          },
          browserHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'tiktok',
                  draftId: 142,
                  title: 'TikTok relaunch clip',
                  accountKey: 'tiktok:relaunch',
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-142.json',
                  handoffAttempt: 1,
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          },
          completeBrowserHandoffAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 browser handoff，可以直接结单。');

    const publishUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-field') === 'publishUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-field') === 'message',
    );
    const completeButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-complete') === 'published',
    );

    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(completeButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://www.tiktok.com/@promobot/video/142',
        window as never,
      );
      updateFieldValue(messageInput as never, 'Recovered after reload.', window as never);
      await flush();
    });

    await act(async () => {
      completeButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-142.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: 'https://www.tiktok.com/@promobot/video/142',
      message: 'Recovered after reload.',
    });
    expect(collectText(container)).toContain('TikTok browser handoff completed.');
    expect(collectText(container)).toContain('发布时间：2026-04-29T01:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('restores ready persisted calendar browser handoffs without a handoff attempt and completes them inline', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-142-legacy.json',
      draftId: 142,
      draftStatus: 'published',
      platform: 'tiktok',
      mode: 'browser_handoff',
      status: 'published',
      success: true,
      publishUrl: 'https://www.tiktok.com/@promobot/video/142-legacy',
      externalId: null,
      message: 'Legacy TikTok browser handoff completed.',
      publishedAt: '2026-04-29T01:10:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              drafts: [
                {
                  id: 142,
                  platform: 'tiktok',
                  title: 'TikTok relaunch clip',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  status: 'failed',
                  lastPublishError: 'waiting for browser lane',
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:00:00.000Z',
                },
              ],
            },
          },
          browserHandoffsStateOverride: {
            status: 'success',
            data: {
              handoffs: [
                {
                  platform: 'tiktok',
                  draftId: 142,
                  title: 'TikTok relaunch clip',
                  accountKey: 'tiktok:relaunch',
                  status: 'pending',
                  readiness: 'ready',
                  sessionAction: null,
                  artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-142-legacy.json',
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:05:00.000Z',
                  resolvedAt: null,
                },
              ],
              total: 1,
            },
          },
          completeBrowserHandoffAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发现待处理的 browser handoff，可以直接结单。');

    const publishUrlInput = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-field') === 'publishUrl',
    );
    const messageInput = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-field') === 'message',
    );
    const completeButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-complete') === 'published',
    );

    expect(publishUrlInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    expect(completeButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(
        publishUrlInput as never,
        'https://www.tiktok.com/@promobot/video/142-legacy',
        window as never,
      );
      updateFieldValue(messageInput as never, 'Recovered after reload without attempt.', window as never);
      await flush();
    });

    await act(async () => {
      completeButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(completeBrowserHandoffAction).toHaveBeenCalledWith({
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-142-legacy.json',
      publishStatus: 'published',
      publishUrl: 'https://www.tiktok.com/@promobot/video/142-legacy',
      message: 'Recovered after reload without attempt.',
    });
    expect(collectText(container)).toContain('Legacy TikTok browser handoff completed.');
    expect(collectText(container)).toContain('发布时间：2026-04-29T01:10:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('loads persisted calendar browser handoffs live when only drafts use state overrides and clears them after reload', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const loadBrowserHandoffsAction = vi
      .fn()
      .mockResolvedValueOnce({
        handoffs: [
          {
            platform: 'tiktok',
            draftId: 143,
            title: 'TikTok relaunch clip',
            accountKey: 'tiktok:relaunch',
            status: 'pending',
            readiness: 'ready',
            sessionAction: null,
            artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-143.json',
            handoffAttempt: 1,
            createdAt: '2026-04-29T00:00:00.000Z',
            updatedAt: '2026-04-29T00:05:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      })
      .mockResolvedValue({
        handoffs: [],
        total: 0,
      });
    const completeBrowserHandoffAction = vi.fn().mockResolvedValue({
      ok: true,
      imported: true,
      artifactPath: 'artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-143.json',
      draftId: 143,
      draftStatus: 'published',
      platform: 'tiktok',
      mode: 'browser_handoff',
      status: 'published',
      success: true,
      publishUrl: 'https://www.tiktok.com/@promobot/video/143',
      externalId: null,
      message: 'TikTok browser handoff completed.',
      publishedAt: '2026-04-29T01:30:00.000Z',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(PublishCalendarPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              drafts: [
                {
                  id: 143,
                  platform: 'tiktok',
                  title: 'TikTok relaunch clip',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  status: 'failed',
                  lastPublishError: 'waiting for browser lane',
                  createdAt: '2026-04-29T00:00:00.000Z',
                  updatedAt: '2026-04-29T00:00:00.000Z',
                },
              ],
            },
          },
          loadBrowserHandoffsAction,
          completeBrowserHandoffAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('发现待处理的 browser handoff，可以直接结单。');

    const completeButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-browser-handoff-complete') === 'published',
    );

    expect(completeButton).not.toBeNull();

    await act(async () => {
      completeButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).not.toContain('Publish browser handoff 结单');

    const reloadButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('重新加载 Calendar'),
    );

    expect(reloadButton).not.toBeNull();

    await act(async () => {
      reloadButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(loadBrowserHandoffsAction).toHaveBeenCalledTimes(3);
    expect(collectText(container)).not.toContain(
      'Handoff 路径：artifacts/browser-handoffs/tiktok/relaunch/tiktok-draft-143.json',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
