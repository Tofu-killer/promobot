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

function renderPage(Component: unknown, props: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(Component as (properties: Record<string, unknown>) => React.JSX.Element, props),
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

describe('Monitor follow-up actions', () => {
  it('posts monitor fetch enqueue through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        job: {
          id: 11,
          type: 'monitor_fetch',
          status: 'pending',
          runAt: '2026-04-19T10:00:00.000Z',
        },
        runtime: {
          available: true,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.enqueueMonitorFetchJobRequest).toBe('function');

    const enqueueMonitorFetchJobRequest = monitorModule.enqueueMonitorFetchJobRequest as () => Promise<unknown>;
    await enqueueMonitorFetchJobRequest();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'monitor_fetch',
          payload: {},
        }),
      }),
    );
  });

  it('posts manual monitor fetch through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          items: [
            {
              id: 1,
              source: 'rss',
              title: 'APAC pricing watch',
              detail: 'Tracked a competitor pricing update.',
              status: 'new',
              createdAt: '2026-04-19T00:00:00.000Z',
            },
          ],
          inserted: 1,
          total: 1,
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.fetchMonitorFeedRequest).toBe('function');

    const fetchMonitorFeedRequest = monitorModule.fetchMonitorFeedRequest as () => Promise<{
      inserted: number;
      total: number;
    }>;

    const result = await fetchMonitorFeedRequest();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/monitor/fetch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.inserted).toBe(1);
    expect(result.total).toBe(1);
  });

  it('posts manual monitor fetch with projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          items: [],
          inserted: 2,
          total: 5,
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.fetchMonitorFeedRequest).toBe('function');

    const fetchMonitorFeedRequest = monitorModule.fetchMonitorFeedRequest as (projectId?: number) => Promise<{
      inserted: number;
      total: number;
    }>;

    const result = await fetchMonitorFeedRequest(9);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/monitor/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 9 }),
      }),
    );
    expect(result.inserted).toBe(2);
    expect(result.total).toBe(5);
  });

  it('posts queued monitor fetch jobs through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          job: {
            id: 5,
            type: 'monitor_fetch',
            status: 'pending',
            runAt: '2026-04-20T09:00:00.000Z',
            attempts: 0,
          },
          runtime: {
            available: true,
          },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.enqueueMonitorFetchJobRequest).toBe('function');

    const enqueueMonitorFetchJobRequest = monitorModule.enqueueMonitorFetchJobRequest as (
      runAt?: string,
    ) => Promise<{ job: { id: number; type: string; runAt: string } }>;

    const result = await enqueueMonitorFetchJobRequest('2026-04-20T09:00:00.000Z');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'monitor_fetch',
          payload: {},
          runAt: '2026-04-20T09:00:00.000Z',
        }),
      }),
    );
    expect(result.job.id).toBe(5);
    expect(result.job.type).toBe('monitor_fetch');
  });

  it('posts queued monitor fetch jobs with projectId through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          job: {
            id: 6,
            type: 'monitor_fetch',
            status: 'pending',
            runAt: '2026-04-20T10:00:00.000Z',
            attempts: 0,
          },
          runtime: {
            available: true,
          },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.enqueueMonitorFetchJobRequest).toBe('function');

    const enqueueMonitorFetchJobRequest = monitorModule.enqueueMonitorFetchJobRequest as (
      runAt?: string,
      projectId?: number,
    ) => Promise<{ job: { id: number; type: string; runAt: string } }>;

    const result = await enqueueMonitorFetchJobRequest('2026-04-20T10:00:00.000Z', 9);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'monitor_fetch',
          payload: { projectId: 9 },
          runAt: '2026-04-20T10:00:00.000Z',
        }),
      }),
    );
    expect(result.job.id).toBe(6);
    expect(result.job.type).toBe('monitor_fetch');
  });

  it('posts follow-up generation through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          draft: {
            id: 42,
            platform: 'x',
            title: 'Follow-up: Competitor launched a lower tier',
            content: 'Follow-up draft for x.',
            status: 'draft',
          },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const monitorModule = (await import('../../src/client/pages/Monitor')) as Record<string, unknown>;

    expect(typeof monitorModule.generateFollowUpRequest).toBe('function');

    const generateFollowUpRequest = monitorModule.generateFollowUpRequest as (
      id: number,
      platform?: string,
    ) => Promise<{ draft: { id: number; title: string; platform: string } }>;

    const result = await generateFollowUpRequest(7, 'x');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/monitor/7/generate-follow-up',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'x' }),
      }),
    );
    expect(result.draft.id).toBe(42);
    expect(result.draft.title).toContain('Follow-up');
  });

  it('does not default to the first new monitor item when no item is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 7,
            source: 'x',
            title: 'Competitor launched a lower tier',
            detail: 'Observed a cheaper plan and a follow-up opportunity.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 9,
            source: 'reddit',
            title: 'Users are asking about APAC latency',
            detail: 'A follow-up draft should mention recent infra work.',
            status: 'new',
            createdAt: '2026-04-19T01:00:00.000Z',
          },
        ],
        total: 2,
      },
    };
    const generateFollowUpAction = vi.fn().mockResolvedValue({
      draft: {
        id: 42,
        platform: 'x',
        title: 'Follow-up draft',
        content: 'unused',
        status: 'draft',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('请先从当前列表中选择一条动态');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows generated draft feedback after selecting a monitor item and clicking the action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 7,
            source: 'x',
            title: 'Competitor launched a lower tier',
            detail: 'Observed a cheaper plan and a follow-up opportunity.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 8,
            source: 'reddit',
            title: 'Users are asking about APAC latency',
            detail: 'A follow-up draft should mention recent infra work.',
            status: 'new',
            createdAt: '2026-04-19T01:00:00.000Z',
          },
        ],
        total: 2,
      },
    };
    const generateFollowUpAction = vi.fn().mockResolvedValue({
      draft: {
        id: 42,
        platform: 'reddit',
        title: 'Follow-up: Users are asking about APAC latency',
        content: 'Follow-up draft for reddit.\n\nSignal: Users are asking about APAC latency',
        status: 'draft',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const selectedItem = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '8',
    );

    expect(selectedItem).not.toBeNull();

    await act(async () => {
      selectedItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(selectedItem?.getAttribute('data-monitor-item-selected')).toBe('true');

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).toHaveBeenCalledWith(8, 'reddit');
    expect(collectText(container)).toContain('跟进草稿已生成');
    expect(collectText(container)).toContain('Follow-up: Users are asking about APAC latency');
    expect(collectText(container)).toContain('draftId: 42');
    expect(collectText(container)).toContain('status: draft');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('reloads the selected monitor project scope before generating a follow-up draft', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const loadMonitorAction = vi.fn().mockResolvedValue({
      items: [
        {
          id: 7,
          source: 'x',
          title: 'Competitor launched a lower tier',
          detail: 'Observed a cheaper plan and a follow-up opportunity.',
          status: 'new',
          createdAt: '2026-04-19T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    const generateFollowUpAction = vi.fn().mockResolvedValue({
      draft: {
        id: 52,
        projectId: 12,
        platform: 'x',
        title: 'Follow-up: Competitor launched a lower tier',
        content: 'Follow-up draft for x.',
        status: 'draft',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(projectIdInput).not.toBeNull();
    expect(generateButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
      await flush();
    });

    await act(async () => {
      const monitorItem = findElement(
        container,
        (element) => element.getAttribute('data-monitor-item-id') === '7',
      );
      expect(monitorItem).not.toBeNull();
      monitorItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadMonitorAction).toHaveBeenLastCalledWith(12);
    expect(generateFollowUpAction).toHaveBeenCalledWith(7, 'x');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('disables follow-up generation while the request is in flight', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 7,
            source: 'x',
            title: 'Competitor launched a lower tier',
            detail: 'Observed a cheaper plan and a follow-up opportunity.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    };

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          stateOverride,
          followUpStateOverride: {
            status: 'loading',
            error: null,
          },
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('正在生成跟进草稿...'),
    ) as FakeElement | null;

    expect(button).not.toBeNull();
    expect(button?.getAttribute('disabled')).toBe('');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('filters monitor items by source before generating a follow-up draft', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 7,
            source: 'x',
            title: 'Competitor launched a lower tier',
            detail: 'Observed a cheaper plan and a follow-up opportunity.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 9,
            source: 'reddit',
            title: 'Users are asking about APAC latency',
            detail: 'A follow-up draft should mention recent infra work.',
            status: 'new',
            createdAt: '2026-04-19T01:00:00.000Z',
          },
          {
            id: 10,
            source: 'rss',
            title: 'RSS pricing watch',
            detail: 'Tracked a competitor pricing update.',
            status: 'new',
            createdAt: '2026-04-19T02:00:00.000Z',
          },
        ],
        total: 3,
      },
    };
    const generateFollowUpAction = vi.fn().mockResolvedValue({
      draft: {
        id: 77,
        platform: 'reddit',
        title: 'Follow-up: Users are asking about APAC latency',
        content: 'Follow-up draft for reddit.',
        status: 'draft',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const redditFilter = findElement(
      container,
      (element) => element.getAttribute('data-monitor-filter-source') === 'reddit',
    );

    expect(redditFilter).not.toBeNull();

    await act(async () => {
      redditFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(redditFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(collectText(container)).toContain('Users are asking about APAC latency');
    expect(collectText(container)).not.toContain('Competitor launched a lower tier');
    expect(collectText(container)).not.toContain('RSS pricing watch');

    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).not.toHaveBeenCalled();

    const redditItem = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '9',
    );

    expect(redditItem).not.toBeNull();

    await act(async () => {
      redditItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(redditItem?.getAttribute('data-monitor-item-selected')).toBe('true');

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).toHaveBeenCalledWith(9, 'reddit');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('preserves the selected monitor item when narrowing to a matching source filter', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 7,
            source: 'x',
            title: 'Competitor launched a lower tier',
            detail: 'Observed a cheaper plan and a follow-up opportunity.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 9,
            source: 'reddit',
            title: 'Users are asking about APAC latency',
            detail: 'A follow-up draft should mention recent infra work.',
            status: 'new',
            createdAt: '2026-04-19T01:00:00.000Z',
          },
        ],
        total: 2,
      },
    };
    const generateFollowUpAction = vi.fn().mockResolvedValue({
      draft: {
        id: 88,
        platform: 'reddit',
        title: 'Follow-up: Users are asking about APAC latency',
        content: 'Follow-up draft for reddit.',
        status: 'draft',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const redditItemBeforeFilter = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '9',
    );

    expect(redditItemBeforeFilter).not.toBeNull();

    await act(async () => {
      redditItemBeforeFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(redditItemBeforeFilter?.getAttribute('data-monitor-item-selected')).toBe('true');

    const redditFilter = findElement(
      container,
      (element) => element.getAttribute('data-monitor-filter-source') === 'reddit',
    );

    expect(redditFilter).not.toBeNull();

    await act(async () => {
      redditFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const redditItemAfterFilter = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '9',
    );
    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(redditFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(redditItemAfterFilter).not.toBeNull();
    expect(redditItemAfterFilter?.getAttribute('data-monitor-item-selected')).toBe('true');

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).toHaveBeenCalledWith(9, 'reddit');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears the selected monitor item when source filtering hides it', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 7,
            source: 'x',
            title: 'Competitor launched a lower tier',
            detail: 'Observed a cheaper plan and a follow-up opportunity.',
            status: 'new',
            createdAt: '2026-04-19T00:00:00.000Z',
          },
          {
            id: 9,
            source: 'reddit',
            title: 'Users are asking about APAC latency',
            detail: 'A follow-up draft should mention recent infra work.',
            status: 'new',
            createdAt: '2026-04-19T01:00:00.000Z',
          },
        ],
        total: 2,
      },
    };
    const generateFollowUpAction = vi.fn().mockResolvedValue({
      draft: {
        id: 89,
        platform: 'x',
        title: 'Follow-up: Competitor launched a lower tier',
        content: 'Follow-up draft for x.',
        status: 'draft',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const xItem = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '7',
    );

    expect(xItem).not.toBeNull();

    await act(async () => {
      xItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(xItem?.getAttribute('data-monitor-item-selected')).toBe('true');

    const redditFilter = findElement(
      container,
      (element) => element.getAttribute('data-monitor-filter-source') === 'reddit',
    );
    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(redditFilter).not.toBeNull();
    expect(generateButton).not.toBeNull();

    await act(async () => {
      redditFilter?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('Users are asking about APAC latency');
    expect(collectText(container)).not.toContain('Competitor launched a lower tier');

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('请先从当前列表中选择一条动态');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks follow-up draft generation for non-launch monitor sources', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 10,
            source: 'rss',
            title: 'RSS pricing watch',
            detail: 'Tracked a competitor pricing update.',
            status: 'new',
            createdAt: '2026-04-19T02:00:00.000Z',
          },
        ],
        total: 1,
      },
    };
    const generateFollowUpAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const rssItem = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '10',
    );
    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(rssItem).not.toBeNull();
    expect(generateButton).not.toBeNull();

    await act(async () => {
      rssItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('当前动态来源不在首发平台范围内');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows monitor fetch feedback after clicking the action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [],
        total: 0,
      },
    };
    const fetchMonitorAction = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          source: 'rss',
          title: 'APAC pricing watch',
          detail: 'Tracked a competitor pricing update.',
          status: 'new',
          createdAt: '2026-04-19T00:00:00.000Z',
        },
      ],
      inserted: 1,
      total: 1,
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          fetchMonitorAction,
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('抓取新动态'),
    );

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(fetchMonitorAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('已抓取 1 条监控动态，当前总数 1');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows monitor enqueue feedback when available', async () => {
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const html = renderPage(MonitorPage, {
      stateOverride: {
        status: 'success',
        data: {
          items: [],
          total: 0,
        },
      },
      enqueueStateOverride: {
        status: 'success',
        data: {
          job: {
            id: 11,
            type: 'monitor_fetch',
            status: 'pending',
            runAt: '2026-04-19T10:00:00.000Z',
          },
          runtime: {
            available: true,
          },
        },
      },
    });

    expect(html).toContain('加入队列 / 定时抓取');
    expect(html).toContain('计划抓取时间（可选）');
    expect(html).toContain('项目 ID（可选）');
    expect(html).toContain('已将监控抓取加入队列，job #11');
    expect(html).toContain('2026-04-19T10:00:00.000Z');
  });

  it('passes the projectId filter into monitor load, fetch, and enqueue actions', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const loadMonitorAction = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
    });
    const fetchMonitorAction = vi.fn().mockResolvedValue({
      items: [],
      inserted: 1,
      total: 1,
    });
    const enqueueMonitorAction = vi.fn().mockResolvedValue({
      job: {
        id: 8,
        type: 'monitor_fetch',
        status: 'pending',
        runAt: '2026-04-20T11:00:00.000Z',
      },
      runtime: {
        available: true,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction,
          fetchMonitorAction,
          enqueueMonitorAction,
        }),
      );
      await flush();
    });

    expect(loadMonitorAction).toHaveBeenCalledTimes(1);

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    ) as FakeElement & { value?: string };

    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, '12', window);
      await flush();
    });

    expect(loadMonitorAction).toHaveBeenCalledTimes(2);
    expect(loadMonitorAction).toHaveBeenLastCalledWith(12);

    const fetchButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('抓取新动态'),
    );
    const enqueueButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('加入队列'),
    );

    await act(async () => {
      fetchButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(fetchMonitorAction).toHaveBeenCalledWith(12);

    await act(async () => {
      enqueueButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(enqueueMonitorAction).toHaveBeenCalledWith(undefined, 12);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows queued monitor fetch feedback after clicking the action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [],
        total: 0,
      },
    };
    const enqueueMonitorAction = vi.fn().mockResolvedValue({
      job: {
        id: 5,
        type: 'monitor_fetch',
        status: 'pending',
        runAt: '2026-04-20T09:00:00.000Z',
        attempts: 0,
      },
      runtime: {
        available: true,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          enqueueMonitorAction,
        }),
      );
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('加入队列'),
    );

    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(enqueueMonitorAction).toHaveBeenCalledWith(undefined);
    expect(collectText(container)).toContain('已将监控抓取加入队列，job #5');
    expect(collectText(container)).toContain('2026-04-20T09:00:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows failure feedback when draft generation fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { MonitorPage } = await import('../../src/client/pages/Monitor');

    const stateOverride = {
      status: 'success' as const,
      data: {
        items: [
          {
            id: 9,
            source: 'reddit',
            title: 'Users are asking about APAC latency',
            detail: 'A follow-up draft should mention recent infra work.',
            status: 'new',
            createdAt: '2026-04-19T01:00:00.000Z',
          },
        ],
        total: 1,
      },
    };
    const generateFollowUpAction = vi.fn().mockRejectedValue(new Error('monitor item not found'));

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(MonitorPage as never, {
          loadMonitorAction: async () => stateOverride.data,
          stateOverride,
          generateFollowUpAction,
        }),
      );
      await flush();
    });

    const selectedItem = findElement(
      container,
      (element) => element.getAttribute('data-monitor-item-id') === '9',
    );

    expect(selectedItem).not.toBeNull();

    await act(async () => {
      selectedItem?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const button = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('生成跟进草稿'),
    );

    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateFollowUpAction).toHaveBeenCalledWith(9, 'reddit');
    expect(collectText(container)).toContain('跟进草稿生成失败：monitor item not found');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
