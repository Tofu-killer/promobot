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

describe('Publish Calendar schedule actions', () => {
  it('loads publish calendar drafts with a projectId filter through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drafts: [
          {
            id: 5,
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
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const publishCalendarModule = (await import('../../src/client/pages/PublishCalendar')) as Record<string, unknown>;

    expect(typeof publishCalendarModule.loadPublishCalendarRequest).toBe('function');

    const loadPublishCalendarRequest = publishCalendarModule.loadPublishCalendarRequest as (
      projectId?: number,
    ) => Promise<{ drafts: Array<{ id: number; title?: string; status: string }> }>;

    const result = await loadPublishCalendarRequest(12);

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts?projectId=12', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.title).toBe('Scheduled launch thread');
  });

  it('patches draft scheduledAt through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        draft: {
          id: 5,
          platform: 'x',
          title: 'Scheduled launch thread',
          content: 'Queued for later',
          hashtags: ['#launch'],
          status: 'scheduled',
          scheduledAt: '2026-04-20T09:30',
          createdAt: '2026-04-19T08:00:00.000Z',
          updatedAt: '2026-04-19T08:10:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const publishCalendarModule = (await import('../../src/client/pages/PublishCalendar')) as Record<string, unknown>;

    expect(typeof publishCalendarModule.updatePublishCalendarDraftScheduleRequest).toBe('function');

    const updatePublishCalendarDraftScheduleRequest =
      publishCalendarModule.updatePublishCalendarDraftScheduleRequest as (
        id: number,
        input: { scheduledAt: string | null },
      ) => Promise<{ draft: { id: number; scheduledAt?: string } }>;

    const result = await updatePublishCalendarDraftScheduleRequest(5, {
      scheduledAt: '2026-04-20T09:30',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/5',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: '2026-04-20T09:30',
        }),
      }),
    );
    expect(result.draft.scheduledAt).toBe('2026-04-20T09:30');
  });

  it('writes scheduledAt and shows success feedback after saving a scheduled draft', async () => {
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
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30',
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
                  scheduledAt: '2026-04-19T09:00',
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
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '11',
    );

    await act(async () => {
      updateFieldValue(scheduledAtField, '2026-04-20T09:30', window);
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-save-id') === '11' &&
        collectText(element).includes('保存排程'),
    );

    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftScheduleAction).toHaveBeenCalledWith(11, {
      scheduledAt: '2026-04-20T09:30',
    });
    expect(collectText(container)).toContain('排程已保存');
    expect(collectText(container)).toContain('排程时间：2026-04-20T09:30');

    const updatedField = findElement(
      container,
      (element) => element.getAttribute('data-calendar-scheduled-at-id') === '11',
    );
    expect(updatedField?.value).toBe('2026-04-20T09:30');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows failure feedback when scheduledAt writeback fails', async () => {
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

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('retries failed drafts through the publish contract and updates the card', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    const retryPublishDraftAction = vi.fn().mockResolvedValue({
      success: true,
      status: 'published',
      publishUrl: 'https://x.com/promobot/status/18',
      message: 'retry accepted',
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
                  id: 18,
                  platform: 'x',
                  title: 'Retry failed thread',
                  content: 'Original publish failed',
                  hashtags: ['#launch'],
                  status: 'failed',
                  lastPublishError: 'rate limited',
                  createdAt: '2026-04-19T08:00:00.000Z',
                  updatedAt: '2026-04-19T08:10:00.000Z',
                },
              ],
            },
          },
          retryPublishDraftAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('发布失败 1');

    const retryButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-calendar-retry-id') === '18' &&
        collectText(element).includes('重试发布'),
    );

    expect(retryButton).not.toBeNull();

    await act(async () => {
      retryButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(retryPublishDraftAction).toHaveBeenCalledWith(18);
    expect(collectText(container)).toContain('已发布 1');
    expect(collectText(container)).toContain('发布失败 0');
    expect(collectText(container)).toContain('发布链接：https://x.com/promobot/status/18');
    expect(collectText(container)).toContain('回执消息：retry accepted');

    const updatedRetryButton = findElement(
      container,
      (element) => element.getAttribute('data-calendar-retry-id') === '18',
    );
    expect(updatedRetryButton).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

});
