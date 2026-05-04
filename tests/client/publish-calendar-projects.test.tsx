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

function renderComponent(Component: unknown, props: Record<string, unknown> = {}) {
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
  selected: boolean;
  multiple: boolean;
  disabled: boolean;
  private currentValue: string;
  private listeners: Map<string, EventListenerEntry[]>;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = new Map();
    this.currentValue = '';
    this.selected = false;
    this.multiple = false;
    this.disabled = false;
    this.listeners = new Map();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);

    if (name === 'value') {
      this.value = value;
    }

    if (name === 'disabled') {
      this.disabled = true;
    }

    if (name === 'selected') {
      this.selected = true;
    }

    if (name === 'multiple') {
      this.multiple = true;
    }
  }

  get value() {
    if (this.tagName === 'SELECT') {
      const selectedOption = this.options?.find((option) => option.selected);
      if (selectedOption) {
        return selectedOption.value;
      }
    }

    return this.currentValue;
  }

  set value(nextValue: string) {
    this.currentValue = nextValue;

    if (this.tagName !== 'SELECT') {
      return;
    }

    const options = this.options;
    if (!options) {
      return;
    }

    options.forEach((option) => {
      option.selected = option.value === nextValue;
    });
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);

    if (name === 'disabled') {
      this.disabled = false;
    }

    if (name === 'selected') {
      this.selected = false;
    }

    if (name === 'multiple') {
      this.multiple = false;
    }
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

  get options() {
    if (this.tagName !== 'SELECT') {
      return undefined;
    }

    return this.children.filter((child) => child.tagName === 'OPTION');
  }

  get selectedIndex() {
    const options = this.options;
    if (!options) {
      return -1;
    }

    return options.findIndex((option) => option.selected);
  }

  set selectedIndex(nextIndex: number) {
    const options = this.options;
    if (!options) {
      return;
    }

    options.forEach((option, index) => {
      option.selected = index === nextIndex;
    });

    const nextOption = options[nextIndex];
    if (nextOption) {
      this.currentValue = nextOption.value;
    }
  }

  getListeners(type: string) {
    return this.listeners.get(type) ?? [];
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
          ? target.getListeners(event.type)
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PublishCalendar and Projects pages', () => {
  it('loads publish calendar drafts through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drafts: [
          {
            id: 5,
            platform: 'x',
            title: 'Scheduled launch thread',
            content: 'Queued for 09:30',
            hashtags: ['#launch'],
            status: 'scheduled',
            createdAt: '2026-04-19T08:00:00.000Z',
            updatedAt: '2026-04-19T08:10:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const publishCalendarModule = (await import('../../src/client/pages/PublishCalendar')) as Record<string, unknown>;

    expect(typeof publishCalendarModule.loadPublishCalendarRequest).toBe('function');

    const loadPublishCalendarRequest = publishCalendarModule.loadPublishCalendarRequest as () => Promise<{
      drafts: Array<{ id: number; title?: string; status: string }>;
    }>;

    const result = await loadPublishCalendarRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/drafts', undefined);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.status).toBe('scheduled');
  });

  it('shows publish calendar loading, error, and filtered success states', async () => {
    const { PublishCalendarPage } = await import('../../src/client/pages/PublishCalendar');

    expect(renderComponent(PublishCalendarPage, { stateOverride: { status: 'loading' } })).toContain('正在加载发布日历');

    expect(
      renderComponent(PublishCalendarPage, {
        stateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('发布日历加载失败');

    const html = renderComponent(PublishCalendarPage, {
      stateOverride: {
        status: 'success',
        data: {
          drafts: [
            {
              id: 11,
              platform: 'x',
              title: 'Scheduled launch thread',
              content: 'Queued for 09:30',
              hashtags: ['#launch'],
              status: 'scheduled',
              scheduledAt: '2026-04-20T09:30',
              createdAt: '2026-04-19T08:00:00.000Z',
              updatedAt: '2026-04-19T08:10:00.000Z',
            },
            {
              id: 12,
              platform: 'reddit',
              title: 'Already live AMA',
              content: 'Published at 10:15',
              hashtags: ['#ama'],
              status: 'published',
              publishedAt: '2026-04-19T10:15:00.000Z',
              publishUrl: 'https://reddit.test/r/ama-12',
              publishMessage: 'publisher accepted AMA post',
              createdAt: '2026-04-19T07:00:00.000Z',
              updatedAt: '2026-04-19T10:15:00.000Z',
            },
            {
              id: 13,
              platform: 'x',
              title: 'Internal draft',
              content: 'Not ready',
              hashtags: [],
              status: 'draft',
              createdAt: '2026-04-19T06:00:00.000Z',
              updatedAt: '2026-04-19T06:00:00.000Z',
            },
          ],
        },
      },
    });

    expect(html).toContain('已排程 1');
    expect(html).toContain('已发布 1');
    expect(html).toContain('Scheduled launch thread');
    expect(html).toContain('Already live AMA');
    expect(html).toContain('当前排程状态：已写入 scheduled，等待发布器消费。');
    expect(html).toContain('发布 contract');
    expect(html).toContain('发布链接：https://reddit.test/r/ama-12');
    expect(html).toContain('回执消息：publisher accepted AMA post');
    expect(html).not.toContain('Internal draft');
  });

  it('clears stale publish calendar schedule feedback after switching project scope', async () => {
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
            title: 'Project A launch thread',
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
            title: 'Project B AMA',
            content: 'Scoped to another project',
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
        title: 'Project A launch thread',
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
    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );

    expect(scheduledAtField).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(projectIdInput).not.toBeNull();

    await act(async () => {
      updateFieldValue(scheduledAtField as never, '2026-04-20T09:30', window as never);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateDraftScheduleAction).toHaveBeenCalledWith(11, {
      scheduledAt: '2026-04-20T09:30',
    });
    expect(collectText(container)).toContain('排程已保存');
    expect(collectText(container)).toContain('排程时间：2026-04-20T09:30');

    await act(async () => {
      updateFieldValue(projectIdInput as never, '12', window as never);
      await flush();
      await flush();
    });

    expect(loadDraftsAction).toHaveBeenLastCalledWith(12);
    expect(collectText(container)).toContain('Project B AMA');
    expect(collectText(container)).not.toContain('排程已保存');
    expect(collectText(container)).not.toContain('排程时间：2026-04-20T09:30');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('loads projects through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        projects: [
          {
            id: 2,
            name: 'Acme Launch',
            siteName: 'Acme',
            siteUrl: 'https://acme.test',
            siteDescription: 'Launch week campaign',
            sellingPoints: ['Cheap', 'Fast'],
            createdAt: '2026-04-19T08:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.loadProjectsRequest).toBe('function');

    const loadProjectsRequest = projectsModule.loadProjectsRequest as () => Promise<{
      projects: Array<{ id: number; name: string; siteUrl: string }>;
    }>;

    const result = await loadProjectsRequest();

    expect(fetchMock).toHaveBeenCalledWith('/api/projects', undefined);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.siteUrl).toBe('https://acme.test');
  });

  it('patches a project through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        project: {
          id: 2,
          name: 'Acme Launch Updated',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Updated brief',
          sellingPoints: ['Faster', 'Cheaper'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const projectsModule = (await import('../../src/client/pages/Projects')) as Record<string, unknown>;

    expect(typeof projectsModule.updateProjectRequest).toBe('function');

    const updateProjectRequest = projectsModule.updateProjectRequest as (
      id: number,
      input: {
        name?: string;
        siteDescription?: string;
        sellingPoints?: string[];
      },
    ) => Promise<{ project: { id: number; name: string; siteDescription: string } }>;

    const result = await updateProjectRequest(2, {
      name: 'Acme Launch Updated',
      siteDescription: 'Updated brief',
      sellingPoints: ['Faster', 'Cheaper'],
      riskPolicy: 'auto_approve',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/2',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Acme Launch Updated',
          siteDescription: 'Updated brief',
          sellingPoints: ['Faster', 'Cheaper'],
          riskPolicy: 'auto_approve',
        }),
      }),
    );
    expect(result.project.name).toBe('Acme Launch Updated');
    expect(result.project.siteDescription).toBe('Updated brief');
  });

  it('shows project list loading, error, and success states', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    expect(
      renderComponent(ProjectsPage, {
        stateOverride: { status: 'idle' },
        projectsStateOverride: { status: 'loading' },
      }),
    ).toContain('正在加载项目列表');

    expect(
      renderComponent(ProjectsPage, {
        stateOverride: { status: 'idle' },
        projectsStateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('项目列表加载失败');

    const html = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'success',
        data: {
          projects: [
            {
              id: 1,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
              createdAt: '2026-04-19T08:00:00.000Z',
            },
            {
              id: 2,
              name: 'Bravo Refresh',
              siteName: 'Bravo',
              siteUrl: 'https://bravo.test',
              siteDescription: 'Homepage refresh',
              sellingPoints: ['Stable'],
              createdAt: '2026-04-19T09:00:00.000Z',
            },
          ],
        },
      },
    });

    expect(html).toContain('已加载 2 个项目');
    expect(html).toContain('Acme Launch');
    expect(html).toContain('Bravo Refresh');
    expect(html).toContain('保存项目');
    expect(html).toContain('Source Configs');
  });

  it('keeps cached projects visible during project list loading and error states', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadingHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'loading',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
    });

    expect(loadingHtml).toContain('正在加载项目列表');
    expect(loadingHtml).toContain('Acme Launch');
    expect(loadingHtml).not.toContain('暂无项目');

    const errorHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'error',
        error: 'Request failed with status 500',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
    });

    expect(errorHtml).toContain('项目列表加载失败');
    expect(errorHtml).toContain('Acme Launch');
    expect(errorHtml).not.toContain('暂无项目');
  });

  it('does not mix loading or error placeholders with empty project and source config states', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadingProjectsHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'loading' },
      projectsStateOverride: { status: 'loading' },
    });

    expect(loadingProjectsHtml).toContain('正在创建项目...');
    expect(loadingProjectsHtml).toContain('disabled=""');
    expect(loadingProjectsHtml).toContain('正在加载项目列表');
    expect(loadingProjectsHtml).not.toContain('暂无项目');
    expect(loadingProjectsHtml).not.toContain('已加载 0 个项目');

    const errorProjectsHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'error',
        error: 'Request failed with status 500',
      },
    });

    expect(errorProjectsHtml).toContain('项目列表加载失败');
    expect(errorProjectsHtml).not.toContain('暂无项目');
    expect(errorProjectsHtml).not.toContain('已加载 0 个项目');

    const loadingSourceConfigsHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'success',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
      sourceConfigsStateOverride: { status: 'loading' },
    });

    expect(loadingSourceConfigsHtml).toContain('正在加载 SourceConfig');
    expect(loadingSourceConfigsHtml).not.toContain('暂无 SourceConfig');

    const errorSourceConfigsHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'success',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
      sourceConfigsStateOverride: {
        status: 'error',
        error: 'Request failed with status 500',
      },
    });

    expect(errorSourceConfigsHtml).toContain('SourceConfig 加载失败');
    expect(errorSourceConfigsHtml).not.toContain('暂无 SourceConfig');
  });

  it('shows source config loading, error, and success states inside loaded projects', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    expect(
      renderComponent(ProjectsPage, {
        stateOverride: { status: 'idle' },
        projectsStateOverride: {
          status: 'success',
          data: {
            projects: [
              {
                id: 7,
                name: 'Acme Launch',
                siteName: 'Acme',
                siteUrl: 'https://acme.test',
                siteDescription: 'Launch week campaign',
                sellingPoints: ['Cheap', 'Fast'],
              },
            ],
          },
        },
        sourceConfigsStateOverride: { status: 'loading' },
      }),
    ).toContain('正在加载 SourceConfig');

    expect(
      renderComponent(ProjectsPage, {
        stateOverride: { status: 'idle' },
        projectsStateOverride: {
          status: 'success',
          data: {
            projects: [
              {
                id: 7,
                name: 'Acme Launch',
                siteName: 'Acme',
                siteUrl: 'https://acme.test',
                siteDescription: 'Launch week campaign',
                sellingPoints: ['Cheap', 'Fast'],
              },
            ],
          },
        },
        sourceConfigsStateOverride: {
          status: 'error',
          error: 'Request failed with status 500',
        },
      }),
    ).toContain('SourceConfig 加载失败');

    const html = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'success',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
      sourceConfigsStateOverride: {
        status: 'success',
        data: {
          sourceConfigsByProject: {
            7: [
              {
                id: 3,
                projectId: 7,
                sourceType: 'keyword+reddit',
                platform: 'reddit',
                label: 'Reddit mentions',
                configJson: { keywords: ['claude latency australia'] },
                enabled: true,
                pollIntervalMinutes: 30,
                createdAt: '2026-04-19T08:00:00.000Z',
                updatedAt: '2026-04-19T08:00:00.000Z',
              },
            ],
          },
        },
      },
    });

    expect(html).toContain('Reddit mentions');
    expect(html).toContain('keyword+reddit');
    expect(html).toContain('30 分钟');
  });

  it('keeps cached source configs visible during loading and error states', async () => {
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadingHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'success',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
      sourceConfigsStateOverride: {
        status: 'loading',
        data: {
          sourceConfigsByProject: {
            7: [
              {
                id: 3,
                projectId: 7,
                sourceType: 'keyword+reddit',
                platform: 'reddit',
                label: 'Reddit mentions',
                configJson: { keywords: ['claude latency australia'] },
                enabled: true,
                pollIntervalMinutes: 30,
              },
            ],
          },
        },
      },
    });

    expect(loadingHtml).toContain('正在加载 SourceConfig');
    expect(loadingHtml).toContain('Reddit mentions');
    expect(loadingHtml).not.toContain('暂无 SourceConfig');

    const errorHtml = renderComponent(ProjectsPage, {
      stateOverride: { status: 'idle' },
      projectsStateOverride: {
        status: 'success',
        data: {
          projects: [
            {
              id: 7,
              name: 'Acme Launch',
              siteName: 'Acme',
              siteUrl: 'https://acme.test',
              siteDescription: 'Launch week campaign',
              sellingPoints: ['Cheap', 'Fast'],
            },
          ],
        },
      },
      sourceConfigsStateOverride: {
        status: 'error',
        error: 'Request failed with status 500',
        data: {
          sourceConfigsByProject: {
            7: [
              {
                id: 3,
                projectId: 7,
                sourceType: 'keyword+reddit',
                platform: 'reddit',
                label: 'Reddit mentions',
                configJson: { keywords: ['claude latency australia'] },
                enabled: true,
                pollIntervalMinutes: 30,
              },
            ],
          },
        },
      },
    });

    expect(errorHtml).toContain('SourceConfig 加载失败');
    expect(errorHtml).toContain('Reddit mentions');
    expect(errorHtml).not.toContain('暂无 SourceConfig');
  });

  it('keeps create project working and appends the created project to the list', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 1,
          name: 'Existing Project',
          siteName: 'Existing',
          siteUrl: 'https://existing.test',
          siteDescription: 'Already in database',
          sellingPoints: ['Known'],
          riskPolicy: 'requires_review',
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const createProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 2,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        riskPolicy: 'auto_approve',
        createdAt: '2026-04-19T09:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          createProjectAction,
        }),
      );
      await flush();
    });

    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建项目'),
    );

    expect(createButton).not.toBeNull();

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createProjectAction).toHaveBeenCalledWith({
      name: 'Acme Launch',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      siteDescription: 'Launch week campaign',
      sellingPoints: ['Cheap', 'Fast'],
      brandVoice: 'Direct, calm, proof-first',
      ctas: ['Start free', 'Book a demo'],
      bannedPhrases: ['Guaranteed #1', 'Zero risk'],
      defaultLanguagePolicy: 'en-AU first, zh-CN fallback',
      riskPolicy: 'auto_approve',
    });
    expect(collectText(container)).toContain('最近创建结果');
    expect(collectText(container)).toContain('Existing Project');
    expect(collectText(container)).toContain('Acme Launch');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('does not resurrect a just-created project after archive reload when the list entry only comes from the recent-create patch', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 1,
          name: 'Existing Project',
          siteName: 'Existing',
          siteUrl: 'https://existing.test',
          siteDescription: 'Already in database',
          sellingPoints: ['Known'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const createProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 2,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        createdAt: '2026-04-19T09:00:00.000Z',
      },
    });
    const archiveProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 2,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        createdAt: '2026-04-19T09:00:00.000Z',
        archivedAt: '2026-04-23T10:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createProjectAction,
          archiveProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建项目'),
    );

    expect(createButton).not.toBeNull();

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    const createdProjectArchiveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-archive-id') === '2',
    );

    expect(createdProjectArchiveButton).not.toBeNull();
    expect(collectText(container)).toContain('已加载 2 个项目');

    await act(async () => {
      createdProjectArchiveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(archiveProjectAction).toHaveBeenCalledWith(2);
    expect(collectText(container)).toContain('已加载 1 个项目');
    expect(findElement(container, (element) => element.getAttribute('data-project-archive-id') === '2')).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('edits a loaded project through PATCH and updates the visible project data', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi
      .fn()
      .mockResolvedValueOnce({
        projects: [
          {
            id: 7,
            name: 'Acme Launch',
            siteName: 'Acme',
            siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          riskPolicy: 'requires_review',
          defaultLanguagePolicy: 'English only',
          createdAt: '2026-04-19T08:00:00.000Z',
        },
        ],
      })
      .mockResolvedValueOnce({
        projects: [
          {
            id: 7,
            name: 'Acme Launch',
            siteName: 'Acme',
            siteUrl: 'https://acme.test',
            siteDescription: 'Launch week campaign',
            sellingPoints: ['Cheap', 'Fast'],
            riskPolicy: 'auto_approve',
            createdAt: '2026-04-19T08:00:00.000Z',
          },
        ],
      });
    const updateProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 7,
        name: 'Acme Launch Updated',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Updated brief',
        sellingPoints: ['Faster', 'Cheaper'],
        bannedPhrases: ['No hype'],
        defaultLanguagePolicy: 'English only',
        riskPolicy: 'auto_approve',
        createdAt: '2026-04-19T08:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          updateProjectAction,
        }),
      );
      await flush();
    });

    const nameField = findElement(container, (element) => element.getAttribute('data-project-field') === 'name-7');
    const descriptionField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'description-7',
    );
    const sellingPointsField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'selling-points-7',
    );
    const riskPolicyField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'risk-policy-7',
    );
    const bannedPhrasesField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'banned-phrases-7',
    );
    const defaultLanguagePolicyField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'default-language-policy-7',
    );

    await act(async () => {
      updateFieldValue(nameField, 'Acme Launch Updated', window);
      updateFieldValue(descriptionField, 'Updated brief', window);
      updateFieldValue(sellingPointsField, 'Faster, Cheaper', window);
      updateFieldValue(bannedPhrasesField, 'No hype', window);
      updateFieldValue(defaultLanguagePolicyField, 'English only', window);
      updateFieldValue(riskPolicyField, 'auto_approve', window);
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '7' &&
        collectText(element).includes('保存项目'),
    );

    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateProjectAction).toHaveBeenCalledWith(7, {
      name: 'Acme Launch Updated',
      siteDescription: 'Updated brief',
      sellingPoints: ['Faster', 'Cheaper'],
      brandVoice: '',
      ctas: [],
      bannedPhrases: ['No hype'],
      defaultLanguagePolicy: 'English only',
      riskPolicy: 'auto_approve',
    });
    const projectSaveFeedback = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '7',
    );

    expect(projectSaveFeedback).not.toBeNull();
    expect(collectText(projectSaveFeedback as never)).toContain('项目已保存');
    expect(collectText(container)).toContain('项目：Acme Launch Updated');

    const updatedNameField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'name-7',
    );
    const updatedSellingPointsField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'selling-points-7',
    );
    const updatedRiskPolicyField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'risk-policy-7',
    );
    const updatedBannedPhrasesField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'banned-phrases-7',
    );
    const updatedDefaultLanguagePolicyField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'default-language-policy-7',
    );

    expect(updatedNameField?.value).toBe('Acme Launch Updated');
    expect(updatedSellingPointsField?.value).toBe('Faster, Cheaper');
    expect(updatedBannedPhrasesField?.value).toBe('No hype');
    expect(updatedDefaultLanguagePolicyField?.value).toBe('English only');
    expect(updatedRiskPolicyField?.value).toBe('auto_approve');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps project save loading scoped to each project when multiple saves overlap', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const firstSaveDeferred = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        createdAt: string;
      };
    }>();
    const secondSaveDeferred = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        createdAt: string;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
        {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const updateProjectAction = vi.fn((projectId: number) =>
      projectId === 7
        ? firstSaveDeferred.promise
        : secondSaveDeferred.promise,
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstSaveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '7' &&
        collectText(element).includes('保存项目'),
    );
    const secondSaveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '8' &&
        collectText(element).includes('保存项目'),
    );

    expect(firstSaveButton).not.toBeNull();
    expect(secondSaveButton).not.toBeNull();

    await act(async () => {
      firstSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstPendingButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '7',
    );
    const secondIdleButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '8',
    );

    expect(collectText(firstPendingButton as never)).toContain('正在保存项目...');
    expect(firstPendingButton?.disabled).toBe(true);
    expect(collectText(secondIdleButton as never)).toContain('保存项目');
    expect(secondIdleButton?.disabled).toBe(false);

    await act(async () => {
      secondIdleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstStillPendingButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '7',
    );
    const secondPendingButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '8',
    );

    expect(updateProjectAction).toHaveBeenCalledTimes(2);
    expect(collectText(firstStillPendingButton as never)).toContain('正在保存项目...');
    expect(firstStillPendingButton?.disabled).toBe(true);
    expect(collectText(secondPendingButton as never)).toContain('正在保存项目...');
    expect(secondPendingButton?.disabled).toBe(true);

    await act(async () => {
      firstSaveDeferred.resolve({
        project: {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    const firstCompletedButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '7',
    );
    const secondStillPendingButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '8',
    );

    expect(collectText(firstCompletedButton as never)).toContain('保存项目');
    expect(firstCompletedButton?.disabled).toBe(false);
    expect(collectText(secondStillPendingButton as never)).toContain('正在保存项目...');
    expect(secondStillPendingButton?.disabled).toBe(true);

    await act(async () => {
      secondSaveDeferred.resolve({
        project: {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps project save feedback scoped when concurrent project saves resolve out of order', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const firstSaveDeferred = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        createdAt: string;
      };
    }>();
    const secondSaveDeferred = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        createdAt: string;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
        {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const updateProjectAction = vi.fn((projectId: number) =>
      projectId === 7 ? firstSaveDeferred.promise : secondSaveDeferred.promise,
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstSaveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '7',
    );
    const secondSaveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '8',
    );

    await act(async () => {
      firstSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      firstSaveDeferred.resolve({
        project: {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    const firstProjectFeedback = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '7',
    );
    const secondProjectFeedbackBeforeResolve = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '8',
    );
    const secondPendingButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '8',
    );

    expect(firstProjectFeedback).not.toBeNull();
    expect(collectText(firstProjectFeedback as never)).toContain('项目已保存');
    expect(secondProjectFeedbackBeforeResolve).toBeNull();
    expect(collectText(secondPendingButton as never)).toContain('正在保存项目...');

    await act(async () => {
      secondSaveDeferred.resolve({
        project: {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    const secondProjectFeedback = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '8',
    );
    const firstProjectFeedbackAfterBothSaves = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '7',
    );

    expect(secondProjectFeedback).not.toBeNull();
    expect(collectText(secondProjectFeedback as never)).toContain('项目已保存');
    expect(firstProjectFeedbackAfterBothSaves).not.toBeNull();
    expect(collectText(firstProjectFeedbackAfterBothSaves as never)).toContain('项目已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows pending project actions without clearing scoped project save feedback while a new project request is in flight', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const pendingCreateProject = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const updateProjectAction = vi
      .fn()
      .mockResolvedValueOnce({
        project: {
          id: 7,
          name: 'Acme Launch Updated',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Updated brief',
          sellingPoints: ['Faster', 'Cheaper'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        project: {
          id: 7,
          name: 'Acme Launch Updated Again',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Updated brief v2',
          sellingPoints: ['Faster', 'Cheaper'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      });
    const createProjectAction = vi.fn().mockReturnValue(pendingCreateProject.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          createProjectAction,
          updateProjectAction,
        }),
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '7' &&
        collectText(element).includes('保存项目'),
    );

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const projectSaveFeedback = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '7',
    );

    expect(projectSaveFeedback).not.toBeNull();
    expect(collectText(projectSaveFeedback as never)).toContain('项目已保存');

    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建项目'),
    );

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const pendingCreateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.textContent.includes('正在创建项目...'),
    );
    const projectSaveFeedbackWhileCreatePending = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '7',
    );

    expect(createProjectAction).toHaveBeenCalledWith({
      name: 'Acme Launch',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      siteDescription: 'Launch week campaign',
      sellingPoints: ['Cheap', 'Fast'],
      brandVoice: 'Direct, calm, proof-first',
      ctas: ['Start free', 'Book a demo'],
      bannedPhrases: ['Guaranteed #1', 'Zero risk'],
      defaultLanguagePolicy: 'en-AU first, zh-CN fallback',
      riskPolicy: 'auto_approve',
    });
    expect(pendingCreateButton?.disabled).toBe(true);
    expect(projectSaveFeedbackWhileCreatePending).not.toBeNull();
    expect(collectText(projectSaveFeedbackWhileCreatePending as never)).toContain('项目已保存');

    await act(async () => {
      pendingCreateProject.resolve({
        project: {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Fast'],
        },
      });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores stale project save success after the operator keeps editing the same project while save is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const pendingSave = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        brandVoice?: string;
        ctas?: string[];
        createdAt: string;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          brandVoice: '',
          ctas: [],
          bannedPhrases: [],
          defaultLanguagePolicy: '',
          riskPolicy: 'requires_review',
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const updateProjectAction = vi.fn().mockReturnValue(pendingSave.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const nameField = findElement(container, (element) => element.getAttribute('data-project-field') === 'name-7');
    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '7',
    );

    await act(async () => {
      updateFieldValue(nameField, 'Acme Launch Saved', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateProjectAction).toHaveBeenCalledWith(7, {
      name: 'Acme Launch Saved',
      siteDescription: 'Launch week campaign',
      sellingPoints: ['Cheap', 'Fast'],
      brandVoice: '',
      ctas: [],
      bannedPhrases: [],
      defaultLanguagePolicy: '',
      riskPolicy: 'requires_review',
    });

    const pendingNameField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'name-7',
    );
    expect(pendingNameField?.getAttribute('disabled')).toBeNull();

    await act(async () => {
      updateFieldValue(pendingNameField, 'Acme Launch Unsaved Local Edit', window);
      await flush();
    });

    await act(async () => {
      pendingSave.resolve({
        project: {
          id: 7,
          name: 'Acme Launch Saved',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          brandVoice: '',
          ctas: [],
          bannedPhrases: [],
          defaultLanguagePolicy: '',
          riskPolicy: 'requires_review',
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    const resolvedNameField = findElement(
      container,
      (element) => element.getAttribute('data-project-field') === 'name-7',
    );
    const projectSaveFeedback = findElement(
      container,
      (element) => element.getAttribute('data-project-save-feedback-id') === '7',
    );

    expect(resolvedNameField?.value).toBe('Acme Launch Unsaved Local Edit');
    expect(collectText(container)).toContain('项目：Acme Launch Unsaved Local Edit');
    expect(projectSaveFeedback).toBeNull();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores stale project save success after the same project is archived while save is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const pendingSave = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        brandVoice?: string;
        ctas?: string[];
        bannedPhrases?: string[];
        defaultLanguagePolicy?: string;
        riskPolicy?: 'requires_review' | 'auto_approve';
        createdAt: string;
      };
    }>();
    const loadProjectsAction = vi
      .fn()
      .mockResolvedValueOnce({
        projects: [
          {
            id: 7,
            name: 'Acme Launch',
            siteName: 'Acme',
            siteUrl: 'https://acme.test',
            siteDescription: 'Launch week campaign',
            sellingPoints: ['Cheap', 'Fast'],
            brandVoice: '',
            ctas: [],
            bannedPhrases: [],
            defaultLanguagePolicy: '',
            riskPolicy: 'requires_review',
            createdAt: '2026-04-19T08:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({
        projects: [],
      });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const updateProjectAction = vi.fn().mockReturnValue(pendingSave.promise);
    const archiveProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 7,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        brandVoice: '',
        ctas: [],
        bannedPhrases: [],
        defaultLanguagePolicy: '',
        riskPolicy: 'requires_review',
        createdAt: '2026-04-19T08:00:00.000Z',
        archivedAt: '2026-04-23T10:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateProjectAction,
          archiveProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-save-id') === '7',
    );
    const archiveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-archive-id') === '7',
    );

    expect(saveButton).not.toBeNull();
    expect(archiveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateProjectAction).toHaveBeenCalledWith(7, {
      name: 'Acme Launch',
      siteDescription: 'Launch week campaign',
      sellingPoints: ['Cheap', 'Fast'],
      brandVoice: '',
      ctas: [],
      bannedPhrases: [],
      defaultLanguagePolicy: '',
      riskPolicy: 'requires_review',
    });

    await act(async () => {
      archiveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(archiveProjectAction).toHaveBeenCalledWith(7);
    expect(collectText(container)).toContain('项目已归档：Acme Launch');
    expect(findElement(container, (element) => element.getAttribute('data-project-save-id') === '7')).toBeNull();
    expect(findElement(container, (element) => element.getAttribute('data-project-archive-id') === '7')).toBeNull();

    await act(async () => {
      pendingSave.resolve({
        project: {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          brandVoice: '',
          ctas: [],
          bannedPhrases: [],
          defaultLanguagePolicy: '',
          riskPolicy: 'requires_review',
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).not.toContain('项目已保存');
    expect(findElement(container, (element) => element.getAttribute('data-project-save-feedback-id') === '7')).toBeNull();
    expect(findElement(container, (element) => element.getAttribute('data-project-field') === 'name-7')).toBeNull();
    expect(loadSourceConfigsAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps project archive pending scoped when multiple archives overlap', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const firstArchiveDeferred = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        createdAt: string;
        archivedAt: string;
      };
    }>();
    const secondArchiveDeferred = createDeferredPromise<{
      project: {
        id: number;
        name: string;
        siteName: string;
        siteUrl: string;
        siteDescription: string;
        sellingPoints: string[];
        createdAt: string;
        archivedAt: string;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
        {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const archiveProjectAction = vi.fn((projectId: number) =>
      projectId === 7 ? firstArchiveDeferred.promise : secondArchiveDeferred.promise,
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          archiveProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstArchiveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-archive-id') === '7' &&
        collectText(element).includes('归档项目'),
    );
    const secondArchiveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-archive-id') === '8' &&
        collectText(element).includes('归档项目'),
    );

    expect(firstArchiveButton).not.toBeNull();
    expect(secondArchiveButton).not.toBeNull();

    await act(async () => {
      firstArchiveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstPendingArchiveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-archive-id') === '7',
    );
    const secondIdleArchiveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-archive-id') === '8',
    );

    expect(collectText(firstPendingArchiveButton as never)).toContain('正在归档项目...');
    expect(firstPendingArchiveButton?.disabled).toBe(true);
    expect(collectText(secondIdleArchiveButton as never)).toContain('归档项目');
    expect(secondIdleArchiveButton?.disabled).toBe(false);

    await act(async () => {
      secondIdleArchiveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstStillPendingArchiveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-archive-id') === '7',
    );
    const secondPendingArchiveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-project-archive-id') === '8',
    );

    expect(archiveProjectAction).toHaveBeenCalledTimes(2);
    expect(collectText(firstStillPendingArchiveButton as never)).toContain('正在归档项目...');
    expect(firstStillPendingArchiveButton?.disabled).toBe(true);
    expect(collectText(secondPendingArchiveButton as never)).toContain('正在归档项目...');
    expect(secondPendingArchiveButton?.disabled).toBe(true);

    await act(async () => {
      firstArchiveDeferred.resolve({
        project: {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
          archivedAt: '2026-04-23T10:00:00.000Z',
        },
      });
      secondArchiveDeferred.resolve({
        project: {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
          archivedAt: '2026-04-23T10:05:00.000Z',
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('loads, creates, and updates project source configs through the project page', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Reddit mentions',
            configJson: { keywords: ['claude latency australia'] },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      })
      .mockResolvedValue({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Reddit mentions',
            configJson: { keywords: ['claude latency australia'] },
            enabled: true,
            pollIntervalMinutes: 30,
          },
          {
            id: 4,
            projectId: 7,
            sourceType: 'v2ex_search',
            platform: 'v2ex',
            label: 'V2EX mentions updated',
            configJson: { query: 'cursor api' },
            enabled: false,
            pollIntervalMinutes: 60,
          },
        ],
      });
    const createSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'v2ex_search',
        platform: 'v2ex',
        label: 'V2EX mentions',
        configJson: { query: 'cursor api' },
        enabled: true,
        pollIntervalMinutes: 45,
      },
    });
    const updateSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'v2ex_search',
        platform: 'v2ex',
        label: 'V2EX mentions updated',
        configJson: { query: 'cursor api' },
        enabled: false,
        pollIntervalMinutes: 60,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(loadSourceConfigsAction).toHaveBeenCalledWith(7);
    expect(collectText(container)).toContain('Reddit mentions');

    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const pollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-poll-7',
    );

    await act(async () => {
      updateFieldValue(presetField, 'keyword+reddit', window);
      updateFieldValue(labelField, 'V2EX mentions', window);
      updateFieldValue(configJsonField, '{\"query\":\"cursor api\"}', window);
      updateFieldValue(pollField, '45', window);
      await flush();
    });

    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).toHaveBeenCalledWith(7, {
      projectId: 7,
      sourceType: 'keyword+reddit',
      platform: 'reddit',
      label: 'V2EX mentions',
      configJson: { query: 'cursor api' },
      enabled: true,
      pollIntervalMinutes: 45,
    });

    const existingLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const existingPollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'poll-4',
    );

    await act(async () => {
      updateFieldValue(existingLabelField, 'V2EX mentions updated', window);
      updateFieldValue(existingPollField, '60', window);
      await flush();
    });

    const updateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    await act(async () => {
      updateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateSourceConfigAction).toHaveBeenCalledWith(7, 4, {
      projectId: 7,
      sourceType: 'v2ex_search',
      platform: 'v2ex',
      label: 'V2EX mentions updated',
      configJson: { query: 'cursor api' },
      enabled: false,
      pollIntervalMinutes: 60,
    });
    expect(collectText(container)).toContain('SourceConfig 已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('applies instagram and tiktok source config presets before creating a new source config', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const createSourceConfigAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfig: {
          id: 4,
          projectId: 7,
          sourceType: 'profile+instagram',
          platform: 'instagram',
          label: 'Instagram profile',
          configJson: { handle: '@openai' },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      })
      .mockResolvedValueOnce({
        sourceConfig: {
          id: 5,
          projectId: 7,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok profile',
          configJson: { handle: 'openai' },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const pollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-poll-7',
    );
    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    expect(presetField?.value).toBe('custom');

    await act(async () => {
      updateFieldValue(presetField, 'profile+instagram', window);
      await flush();
    });

    expect(configJsonField?.value).toBe('{"handle":""}');
    expect(pollField?.value).toBe('60');

    await act(async () => {
      updateFieldValue(labelField, 'Instagram profile', window);
      updateFieldValue(configJsonField, '{"handle":"@openai"}', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).toHaveBeenNthCalledWith(1, 7, {
      projectId: 7,
      sourceType: 'profile+instagram',
      platform: 'instagram',
      label: 'Instagram profile',
      configJson: { handle: '@openai' },
      enabled: true,
      pollIntervalMinutes: 60,
    });

    await act(async () => {
      updateFieldValue(presetField, 'profile+tiktok', window);
      await flush();
    });

    expect(configJsonField?.value).toBe('{"handle":""}');
    expect(pollField?.value).toBe('60');

    await act(async () => {
      updateFieldValue(labelField, 'TikTok profile', window);
      updateFieldValue(configJsonField, '{"handle":"openai"}', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).toHaveBeenNthCalledWith(2, 7, {
      projectId: 7,
      sourceType: 'profile+tiktok',
      platform: 'tiktok',
      label: 'TikTok profile',
      configJson: { handle: 'openai' },
      enabled: true,
      pollIntervalMinutes: 60,
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks invalid source config submissions and clears preset fields when switching back to custom', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const createSourceConfigAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const sourceTypeField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-source-type-7',
    );
    const platformField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-platform-7',
    );
    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const pollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-poll-7',
    );
    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    expect(presetField?.value).toBe('custom');
    expect(sourceTypeField?.value).toBe('');
    expect(platformField?.value).toBe('');
    expect(labelField?.value).toBe('');
    expect(configJsonField?.value).toBe('{}');
    expect(pollField?.value).toBe('30');

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Source Type 不能为空');

    await act(async () => {
      updateFieldValue(presetField, 'profile+instagram', window);
      await flush();
    });

    expect(sourceTypeField?.value).toBe('profile+instagram');
    expect(platformField?.value).toBe('instagram');
    expect(labelField?.value).toBe('Instagram profile');
    expect(configJsonField?.value).toBe('{"handle":""}');
    expect(pollField?.value).toBe('60');

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Profile source config 需要 handle、username、profileUrl 或 url');

    await act(async () => {
      updateFieldValue(presetField, 'custom', window);
      await flush();
    });

    expect(sourceTypeField?.value).toBe('');
    expect(platformField?.value).toBe('');
    expect(labelField?.value).toBe('');
    expect(configJsonField?.value).toBe('{}');
    expect(pollField?.value).toBe('30');

    await act(async () => {
      updateFieldValue(sourceTypeField, 'rss', window);
      updateFieldValue(platformField, 'rss', window);
      updateFieldValue(labelField, 'RSS feed', window);
      updateFieldValue(configJsonField, '{', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Config JSON 必须是有效的 JSON object');

    await act(async () => {
      updateFieldValue(sourceTypeField, 'keyword+reddit', window);
      updateFieldValue(platformField, 'x', window);
      updateFieldValue(labelField, 'Cross-wired source config', window);
      updateFieldValue(configJsonField, '{"query":"promobot"}', window);
      updateFieldValue(pollField, '30', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Source Type keyword+reddit 只能搭配 platform reddit');

    await act(async () => {
      updateFieldValue(sourceTypeField, 'custom-rss', window);
      updateFieldValue(platformField, 'rss', window);
      updateFieldValue(labelField, 'Unsupported source type', window);
      updateFieldValue(configJsonField, '{"feedUrl":"https://example.com/feed.xml"}', window);
      updateFieldValue(pollField, '30', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Unsupported Source Type custom-rss');

    await act(async () => {
      updateFieldValue(sourceTypeField, 'profile+instagram', window);
      updateFieldValue(platformField, 'instagram', window);
      updateFieldValue(labelField, 'Instagram profile', window);
      updateFieldValue(configJsonField, '{"handle":"@Explore"}', window);
      updateFieldValue(pollField, '60', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain(
      'Instagram profile source config 需要有效的 handle、username、profileUrl 或 url',
    );

    await act(async () => {
      updateFieldValue(sourceTypeField, 'profile+tiktok', window);
      updateFieldValue(platformField, 'tiktok', window);
      updateFieldValue(labelField, 'TikTok profile', window);
      updateFieldValue(configJsonField, '{"profileUrl":"https://www.tiktok.com/@openai/video/123"}', window);
      updateFieldValue(pollField, '60', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain(
      'TikTok profile source config 需要有效的 handle、username、profileUrl 或 url',
    );

    await act(async () => {
      updateFieldValue(sourceTypeField, 'profile+instagram', window);
      updateFieldValue(platformField, 'instagram', window);
      updateFieldValue(labelField, 'Malformed Instagram handle', window);
      updateFieldValue(configJsonField, '{"handle":"@openai/reel/123"}', window);
      updateFieldValue(pollField, '60', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain(
      'Instagram profile source config 需要有效的 handle、username、profileUrl 或 url',
    );

    await act(async () => {
      updateFieldValue(sourceTypeField, 'profile+tiktok', window);
      updateFieldValue(platformField, 'tiktok', window);
      updateFieldValue(labelField, 'Malformed TikTok handle', window);
      updateFieldValue(configJsonField, '{"handle":"open ai"}', window);
      updateFieldValue(pollField, '60', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain(
      'TikTok profile source config 需要有效的 handle、username、profileUrl 或 url',
    );

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('allows runtime-supported profile fallback configs on create and save', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [
        {
          id: 4,
          projectId: 7,
          sourceType: 'profile+tiktok',
          platform: 'tiktok',
          label: 'TikTok fallback source',
          configJson: {
            handle: 'openai',
            profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
          },
          enabled: true,
          pollIntervalMinutes: 60,
        },
      ],
    });
    const createSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 5,
        projectId: 7,
        sourceType: 'profile+instagram',
        platform: 'instagram',
        label: 'Instagram fallback source',
        configJson: {
          handle: '@Explore',
          profileUrl: 'https://www.instagram.com/openai/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
    });
    const updateSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'profile+tiktok',
        platform: 'tiktok',
        label: 'TikTok fallback source archived',
        configJson: {
          handle: 'openai',
          profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
        },
        enabled: true,
        pollIntervalMinutes: 60,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    await act(async () => {
      updateFieldValue(presetField, 'profile+instagram', window);
      updateFieldValue(labelField, 'Instagram fallback source', window);
      updateFieldValue(configJsonField, '{"handle":"@Explore","profileUrl":"https://www.instagram.com/openai/"}', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createSourceConfigAction).toHaveBeenCalledWith(7, {
      projectId: 7,
      sourceType: 'profile+instagram',
      platform: 'instagram',
      label: 'Instagram fallback source',
      configJson: {
        handle: '@Explore',
        profileUrl: 'https://www.instagram.com/openai/',
      },
      enabled: true,
      pollIntervalMinutes: 60,
    });

    const existingLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4' &&
        collectText(element).includes('保存 SourceConfig'),
    );

    await act(async () => {
      updateFieldValue(existingLabelField, 'TikTok fallback source archived', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateSourceConfigAction).toHaveBeenCalledWith(7, 4, {
      projectId: 7,
      sourceType: 'profile+tiktok',
      platform: 'tiktok',
      label: 'TikTok fallback source archived',
      configJson: {
        handle: 'openai',
        profileUrl: 'https://vt.tiktok.com/ZSh0rt/',
      },
      enabled: true,
      pollIntervalMinutes: 60,
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('replaces cached source configs when a later successful reload returns an empty list', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Reddit mentions',
            configJson: { keywords: ['claude latency australia'] },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      })
      .mockResolvedValueOnce({
        sourceConfigs: [],
      });
    const updateProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 7,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        createdAt: '2026-04-19T08:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(loadSourceConfigsAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('Reddit mentions');

    const saveProjectButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '7' &&
        collectText(element).includes('保存项目'),
    );

    expect(saveProjectButton).not.toBeNull();

    await act(async () => {
      saveProjectButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();
    });

    expect(updateProjectAction).toHaveBeenCalledWith(7, {
      name: 'Acme Launch',
      siteDescription: 'Launch week campaign',
      sellingPoints: ['Cheap', 'Fast'],
      brandVoice: '',
      ctas: [],
      bannedPhrases: [],
      defaultLanguagePolicy: '',
      riskPolicy: 'requires_review',
    });
    expect(collectText(container)).not.toContain('Reddit mentions');
    expect(collectText(container)).toContain('暂无 SourceConfig');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps a locally created source config when an older page-wide source-config reload resolves stale data', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const initialPageWideReload = createDeferredPromise<{
      sourceConfigs: Array<{
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      }>;
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockReturnValueOnce(initialPageWideReload.promise)
      .mockResolvedValueOnce({
        sourceConfigs: [],
      });
    const createSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Launch feed',
        configJson: { feedUrl: 'https://feeds.test/launch.xml' },
        enabled: true,
        pollIntervalMinutes: 30,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('正在加载 SourceConfig');

    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    await act(async () => {
      updateFieldValue(presetField, 'rss', window);
      updateFieldValue(labelField, 'Launch feed', window);
      updateFieldValue(configJsonField, '{"feedUrl":"https://feeds.test/launch.xml"}', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(createSourceConfigAction).toHaveBeenCalledWith(7, {
      projectId: 7,
      sourceType: 'rss',
      platform: 'rss',
      label: 'Launch feed',
      configJson: { feedUrl: 'https://feeds.test/launch.xml' },
      enabled: true,
      pollIntervalMinutes: 30,
    });
    expect(loadSourceConfigsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    await act(async () => {
      initialPageWideReload.resolve({
        sourceConfigs: [],
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('reconciles to the latest page-wide source config snapshot when no newer local mutation exists', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const initialLoadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const createSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'rss',
        platform: 'rss',
        label: 'Launch feed',
        configJson: { feedUrl: 'https://feeds.test/launch.xml' },
        enabled: true,
        pollIntervalMinutes: 30,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction: initialLoadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    await act(async () => {
      updateFieldValue(presetField, 'rss', window);
      updateFieldValue(labelField, 'Launch feed', window);
      updateFieldValue(configJsonField, '{"feedUrl":"https://feeds.test/launch.xml"}', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    const laterPageWideReload = createDeferredPromise<{
      sourceConfigs: Array<{
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      }>;
    }>();
    const laterLoadSourceConfigsAction = vi.fn().mockReturnValue(laterPageWideReload.promise);

    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction: laterLoadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('正在加载 SourceConfig');
    expect(collectText(container)).toContain('Launch feed');

    await act(async () => {
      laterPageWideReload.resolve({
        sourceConfigs: [],
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).not.toContain('Launch feed');
    expect(collectText(container)).toContain('暂无 SourceConfig');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('reconciles to an empty page-wide source config snapshot after a project save-triggered reload when no newer local mutation exists', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfigs: [],
      })
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 4,
            projectId: 7,
            sourceType: 'rss',
            platform: 'rss',
            label: 'Launch feed',
            configJson: { feedUrl: 'https://feeds.test/launch.xml' },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      });
    const updateProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 7,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        brandVoice: '',
        ctas: [],
        createdAt: '2026-04-19T08:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const saveProjectButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '7' &&
        collectText(element).includes('保存项目'),
    );

    expect(saveProjectButton).not.toBeNull();

    await act(async () => {
      saveProjectButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(loadSourceConfigsAction).toHaveBeenCalledTimes(2);
    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    const laterPageWideReload = createDeferredPromise<{
      sourceConfigs: Array<{
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      }>;
    }>();
    const laterLoadSourceConfigsAction = vi.fn().mockReturnValue(laterPageWideReload.promise);

    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction: laterLoadSourceConfigsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).toContain('正在加载 SourceConfig');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    await act(async () => {
      laterPageWideReload.resolve({
        sourceConfigs: [],
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).not.toContain('Launch feed');
    expect(collectText(container)).toContain('暂无 SourceConfig');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores an older page-wide source config reload that resolves after a newer project-save reload', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const initialPageWideReload = createDeferredPromise<{
      sourceConfigs: Array<{
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      }>;
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockReturnValueOnce(initialPageWideReload.promise)
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 4,
            projectId: 7,
            sourceType: 'rss',
            platform: 'rss',
            label: 'Launch feed',
            configJson: { feedUrl: 'https://feeds.test/launch.xml' },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      });
    const updateProjectAction = vi.fn().mockResolvedValue({
      project: {
        id: 7,
        name: 'Acme Launch',
        siteName: 'Acme',
        siteUrl: 'https://acme.test',
        siteDescription: 'Launch week campaign',
        sellingPoints: ['Cheap', 'Fast'],
        brandVoice: '',
        ctas: [],
        createdAt: '2026-04-19T08:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateProjectAction,
        }),
      );
      await flush();
      await flush();
    });

    const saveProjectButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-project-save-id') === '7' &&
        collectText(element).includes('保存项目'),
    );

    expect(saveProjectButton).not.toBeNull();

    await act(async () => {
      saveProjectButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    await act(async () => {
      initialPageWideReload.resolve({
        sourceConfigs: [],
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Launch feed');
    expect(collectText(container)).not.toContain('暂无 SourceConfig');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('syncs existing source config form fields to the saved server response', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [
        {
          id: 4,
          projectId: 7,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'V2EX mentions',
          configJson: { query: 'cursor api' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      ],
    });
    const updateSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'v2ex_search',
        platform: 'v2ex',
        label: 'V2EX mentions normalized',
        configJson: { query: 'cursor api', locale: 'au' },
        enabled: false,
        pollIntervalMinutes: 60,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const pollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'poll-4',
    );
    const enabledField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'enabled-4',
    );
    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4' &&
        collectText(element).includes('保存 SourceConfig'),
    );

    expect(labelField).not.toBeNull();
    expect(pollField).not.toBeNull();
    expect(enabledField).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(labelField, 'Client label draft', window);
      updateFieldValue(pollField, '59', window);
      updateFieldValue(enabledField, 'true', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateSourceConfigAction).toHaveBeenCalledWith(7, 4, {
      projectId: 7,
      sourceType: 'v2ex_search',
      platform: 'v2ex',
      label: 'Client label draft',
      configJson: { query: 'cursor api' },
      enabled: true,
      pollIntervalMinutes: 59,
    });

    const updatedLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const updatedPollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'poll-4',
    );
    const updatedEnabledField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'enabled-4',
    );
    const updatedConfigJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'config-json-4',
    );

    expect(updatedLabelField?.value).toBe('V2EX mentions normalized');
    expect(updatedPollField?.value).toBe('60');
    expect(updatedEnabledField?.value).toBe('false');
    expect(updatedConfigJsonField?.value).toBe('{"query":"cursor api","locale":"au"}');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('ignores stale source config save success after the operator keeps editing the same source config while save is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const pendingSave = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [
        {
          id: 4,
          projectId: 7,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'V2EX mentions',
          configJson: { query: 'cursor api' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      ],
    });
    const updateSourceConfigAction = vi.fn().mockReturnValue(pendingSave.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const pollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'poll-4',
    );
    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4' &&
        collectText(element).includes('保存 SourceConfig'),
    );

    expect(labelField).not.toBeNull();
    expect(pollField).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(labelField, 'Saved source config label', window);
      updateFieldValue(pollField, '59', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateSourceConfigAction).toHaveBeenCalledWith(7, 4, {
      projectId: 7,
      sourceType: 'v2ex_search',
      platform: 'v2ex',
      label: 'Saved source config label',
      configJson: { query: 'cursor api' },
      enabled: true,
      pollIntervalMinutes: 59,
    });

    await act(async () => {
      updateFieldValue(labelField, 'Edited after save started', window);
      updateFieldValue(pollField, '61', window);
      await flush();
    });

    await act(async () => {
      pendingSave.resolve({
        sourceConfig: {
          id: 4,
          projectId: 7,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'Saved source config label',
          configJson: { query: 'cursor api', locale: 'au' },
          enabled: false,
          pollIntervalMinutes: 59,
        },
      });
      await flush();
      await flush();
    });

    const updatedLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const updatedPollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'poll-4',
    );
    const updatedEnabledField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'enabled-4',
    );
    const updatedConfigJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'config-json-4',
    );

    expect(updatedLabelField?.value).toBe('Edited after save started');
    expect(updatedPollField?.value).toBe('61');
    expect(updatedEnabledField?.value).toBe('true');
    expect(updatedConfigJsonField?.value).toBe('{"query":"cursor api"}');
    expect(collectText(container)).not.toContain('SourceConfig 已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('allows saving metadata-only changes for legacy source configs that keep their existing contract fields', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [
        {
          id: 4,
          projectId: 7,
          sourceType: 'custom-rss',
          platform: 'rss',
          label: 'Legacy RSS source',
          configJson: { url: 'https://example.com/feed.xml' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      ],
    });
    const updateSourceConfigAction = vi.fn().mockResolvedValue({
      sourceConfig: {
        id: 4,
        projectId: 7,
        sourceType: 'custom-rss',
        platform: 'rss',
        label: 'Legacy RSS source archived',
        configJson: { url: 'https://example.com/feed.xml' },
        enabled: false,
        pollIntervalMinutes: 60,
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const pollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'poll-4',
    );
    const enabledField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'enabled-4',
    );
    const saveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4' &&
        collectText(element).includes('保存 SourceConfig'),
    );

    await act(async () => {
      updateFieldValue(labelField, 'Legacy RSS source archived', window);
      updateFieldValue(pollField, '60', window);
      updateFieldValue(enabledField, 'false', window);
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateSourceConfigAction).toHaveBeenCalledWith(7, 4, {
      projectId: 7,
      sourceType: 'custom-rss',
      platform: 'rss',
      label: 'Legacy RSS source archived',
      configJson: { url: 'https://example.com/feed.xml' },
      enabled: false,
      pollIntervalMinutes: 60,
    });
    expect(collectText(container)).toContain('SourceConfig 已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows pending source config actions and clears old success while a new source config request is in flight', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const pendingCreateSourceConfig = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const pendingUpdateSourceConfig = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Reddit mentions',
            configJson: { keywords: ['claude latency australia'] },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      })
      .mockResolvedValue({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Reddit mentions',
            configJson: { keywords: ['claude latency australia'] },
            enabled: true,
            pollIntervalMinutes: 30,
          },
          {
            id: 4,
            projectId: 7,
            sourceType: 'v2ex_search',
            platform: 'v2ex',
            label: 'V2EX mentions',
            configJson: { query: 'cursor api' },
            enabled: true,
            pollIntervalMinutes: 45,
          },
        ],
      });
    const createSourceConfigAction = vi
      .fn()
      .mockReturnValueOnce(pendingCreateSourceConfig.promise)
      .mockResolvedValue({
        sourceConfig: {
          id: 4,
          projectId: 7,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'V2EX mentions',
          configJson: { query: 'cursor api' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      });
    const updateSourceConfigAction = vi.fn().mockReturnValue(pendingUpdateSourceConfig.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const newLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const newPresetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const newConfigJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const newPollField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-poll-7',
    );

    await act(async () => {
      updateFieldValue(newPresetField, 'keyword+reddit', window);
      updateFieldValue(newLabelField, 'V2EX mentions', window);
      updateFieldValue(newConfigJsonField, '{"query":"cursor api"}', window);
      updateFieldValue(newPollField, '45', window);
      await flush();
    });

    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const pendingCreateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    expect(pendingCreateButton?.disabled).toBe(true);
    expect(collectText(pendingCreateButton as FakeElement)).toContain('正在创建 SourceConfig...');

    await act(async () => {
      pendingCreateSourceConfig.resolve({
        sourceConfig: {
          id: 4,
          projectId: 7,
          sourceType: 'v2ex_search',
          platform: 'v2ex',
          label: 'V2EX mentions',
          configJson: { query: 'cursor api' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('SourceConfig 已保存');

    const updateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    await act(async () => {
      updateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const pendingUpdateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    expect(pendingUpdateButton?.disabled).toBe(true);
    expect(collectText(pendingUpdateButton as FakeElement)).toContain('正在保存 SourceConfig...');
    expect(collectText(container)).not.toContain('SourceConfig 已保存');

    await act(async () => {
      pendingUpdateSourceConfig.reject(new Error('Request failed with status 500'));
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('preserves the new source config draft when create succeeds after the operator keeps editing while the request is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const pendingCreateSourceConfig = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfigs: [],
      })
      .mockResolvedValue({
        sourceConfigs: [
          {
            id: 4,
            projectId: 7,
            sourceType: 'rss',
            platform: 'rss',
            label: 'Launch RSS',
            configJson: { feedUrl: 'https://feeds.test/launch.xml' },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      });
    const createSourceConfigAction = vi.fn().mockReturnValue(pendingCreateSourceConfig.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const presetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const labelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const createButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );

    await act(async () => {
      updateFieldValue(presetField, 'rss', window);
      updateFieldValue(labelField, 'Launch RSS', window);
      updateFieldValue(configJsonField, '{"feedUrl":"https://feeds.test/launch.xml"}', window);
      await flush();
    });

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const pendingLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const pendingConfigJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );

    expect(pendingLabelField?.getAttribute('disabled')).toBeNull();
    expect(pendingConfigJsonField?.getAttribute('disabled')).toBeNull();

    await act(async () => {
      updateFieldValue(pendingLabelField, 'Edited after create started', window);
      updateFieldValue(pendingConfigJsonField, '{"feedUrl":"https://feeds.test/edited-after-submit.xml"}', window);
      await flush();
    });

    await act(async () => {
      pendingCreateSourceConfig.resolve({
        sourceConfig: {
          id: 4,
          projectId: 7,
          sourceType: 'rss',
          platform: 'rss',
          label: 'Launch RSS',
          configJson: { feedUrl: 'https://feeds.test/launch.xml' },
          enabled: true,
          pollIntervalMinutes: 30,
        },
      });
      await flush();
      await flush();
    });

    const labelFieldAfterResolve = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-label-7',
    );
    const configJsonFieldAfterResolve = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );

    expect(collectText(container)).toContain('Launch RSS');
    expect(labelFieldAfterResolve?.value).toBe('Edited after create started');
    expect(configJsonFieldAfterResolve?.value).toBe('{"feedUrl":"https://feeds.test/edited-after-submit.xml"}');
    expect(collectText(container)).not.toContain('SourceConfig 已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps source config save pending scoped when concurrent saves start on different projects', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const firstSaveDeferred = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const secondSaveDeferred = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
        {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi
      .fn()
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 3,
            projectId: 7,
            sourceType: 'keyword+reddit',
            platform: 'reddit',
            label: 'Reddit mentions',
            configJson: { query: 'acme launch' },
            enabled: true,
            pollIntervalMinutes: 30,
          },
        ],
      })
      .mockResolvedValueOnce({
        sourceConfigs: [
          {
            id: 4,
            projectId: 8,
            sourceType: 'rss',
            platform: 'rss',
            label: 'Expansion RSS',
            configJson: { feedUrl: 'https://feeds.test/expansion.xml' },
            enabled: true,
            pollIntervalMinutes: 45,
          },
        ],
      });
    const updateSourceConfigAction = vi.fn((_projectId: number, sourceConfigId: number) =>
      sourceConfigId === 3 ? firstSaveDeferred.promise : secondSaveDeferred.promise,
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstSaveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '3',
    );
    const secondSaveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    await act(async () => {
      firstSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstPendingButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '3',
    );
    const secondPendingButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    expect(firstPendingButton?.disabled).toBe(true);
    expect(collectText(firstPendingButton as FakeElement)).toContain('正在保存 SourceConfig...');
    expect(secondPendingButton?.disabled).toBe(true);
    expect(collectText(secondPendingButton as FakeElement)).toContain('正在保存 SourceConfig...');

    await act(async () => {
      firstSaveDeferred.resolve({
        sourceConfig: {
          id: 3,
          projectId: 7,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Reddit mentions',
          configJson: { query: 'acme launch' },
          enabled: true,
          pollIntervalMinutes: 30,
        },
      });
      await flush();
      await flush();
    });

    const firstButtonAfterResolve = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '3',
    );
    const secondButtonAfterFirstResolve = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    expect(firstButtonAfterResolve?.disabled).toBe(false);
    expect(collectText(firstButtonAfterResolve as FakeElement)).toContain('保存 SourceConfig');
    expect(secondButtonAfterFirstResolve?.disabled).toBe(true);
    expect(collectText(secondButtonAfterFirstResolve as FakeElement)).toContain('正在保存 SourceConfig...');

    await act(async () => {
      secondSaveDeferred.resolve({
        sourceConfig: {
          id: 4,
          projectId: 8,
          sourceType: 'rss',
          platform: 'rss',
          label: 'Expansion RSS',
          configJson: { feedUrl: 'https://feeds.test/expansion.xml' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps source config create pending scoped when concurrent creates start on different projects', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const firstCreateDeferred = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const secondCreateDeferred = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
        {
          id: 8,
          name: 'Acme Expansion',
          siteName: 'Acme Expansion',
          siteUrl: 'https://acme.test/expansion',
          siteDescription: 'Expansion brief',
          sellingPoints: ['Broader'],
          createdAt: '2026-04-19T09:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [],
    });
    const createSourceConfigAction = vi.fn((projectId: number) =>
      projectId === 7 ? firstCreateDeferred.promise : secondCreateDeferred.promise,
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          createSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstPresetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-7',
    );
    const firstConfigJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-7',
    );
    const secondPresetField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-preset-8',
    );
    const secondConfigJsonField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'new-config-json-8',
    );

    await act(async () => {
      updateFieldValue(firstPresetField, 'rss', window);
      updateFieldValue(firstConfigJsonField, '{"feedUrl":"https://feeds.test/launch.xml"}', window);
      updateFieldValue(secondPresetField, 'rss', window);
      updateFieldValue(secondConfigJsonField, '{"feedUrl":"https://feeds.test/expansion.xml"}', window);
      await flush();
    });

    const firstCreateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );
    const secondCreateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '8',
    );

    await act(async () => {
      firstCreateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondCreateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const firstPendingCreateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );
    const secondPendingCreateButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '8',
    );

    expect(firstPendingCreateButton?.disabled).toBe(true);
    expect(collectText(firstPendingCreateButton as FakeElement)).toContain('正在创建 SourceConfig...');
    expect(secondPendingCreateButton?.disabled).toBe(true);
    expect(collectText(secondPendingCreateButton as FakeElement)).toContain('正在创建 SourceConfig...');

    await act(async () => {
      firstCreateDeferred.resolve({
        sourceConfig: {
          id: 5,
          projectId: 7,
          sourceType: 'rss',
          platform: 'rss',
          label: 'RSS feed',
          configJson: { feedUrl: 'https://feeds.test/launch.xml' },
          enabled: true,
          pollIntervalMinutes: 30,
        },
      });
      await flush();
      await flush();
    });

    const firstCreateButtonAfterResolve = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '7',
    );
    const secondCreateButtonAfterFirstResolve = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-create-id') === '8',
    );

    expect(firstCreateButtonAfterResolve?.disabled).toBe(false);
    expect(collectText(firstCreateButtonAfterResolve as FakeElement)).toContain('创建 SourceConfig');
    expect(secondCreateButtonAfterFirstResolve?.disabled).toBe(true);
    expect(collectText(secondCreateButtonAfterFirstResolve as FakeElement)).toContain('正在创建 SourceConfig...');

    await act(async () => {
      secondCreateDeferred.resolve({
        sourceConfig: {
          id: 6,
          projectId: 8,
          sourceType: 'rss',
          platform: 'rss',
          label: 'RSS feed',
          configJson: { feedUrl: 'https://feeds.test/expansion.xml' },
          enabled: true,
          pollIntervalMinutes: 30,
        },
      });
      await flush();
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('preserves both source config updates when concurrent saves on the same project resolve out of order', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ProjectsPage } = await import('../../src/client/pages/Projects');

    const firstSaveDeferred = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const secondSaveDeferred = createDeferredPromise<{
      sourceConfig: {
        id: number;
        projectId: number;
        sourceType: string;
        platform: string;
        label: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
        pollIntervalMinutes: number;
      };
    }>();
    const loadProjectsAction = vi.fn().mockResolvedValue({
      projects: [
        {
          id: 7,
          name: 'Acme Launch',
          siteName: 'Acme',
          siteUrl: 'https://acme.test',
          siteDescription: 'Launch week campaign',
          sellingPoints: ['Cheap', 'Fast'],
          createdAt: '2026-04-19T08:00:00.000Z',
        },
      ],
    });
    const loadSourceConfigsAction = vi.fn().mockResolvedValue({
      sourceConfigs: [
        {
          id: 3,
          projectId: 7,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Reddit mentions',
          configJson: { query: 'acme launch' },
          enabled: true,
          pollIntervalMinutes: 30,
        },
        {
          id: 4,
          projectId: 7,
          sourceType: 'rss',
          platform: 'rss',
          label: 'Expansion RSS',
          configJson: { feedUrl: 'https://feeds.test/expansion.xml' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      ],
    });
    const updateSourceConfigAction = vi.fn((_projectId: number, sourceConfigId: number) =>
      sourceConfigId === 3 ? firstSaveDeferred.promise : secondSaveDeferred.promise,
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ProjectsPage as never, {
          loadProjectsAction,
          loadSourceConfigsAction,
          updateSourceConfigAction,
        }),
      );
      await flush();
      await flush();
    });

    const firstLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-3',
    );
    const secondLabelField = findElement(
      container,
      (element) => element.getAttribute('data-source-config-field') === 'label-4',
    );
    const firstSaveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '3',
    );
    const secondSaveButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-source-config-save-id') === '4',
    );

    await act(async () => {
      updateFieldValue(firstLabelField, 'Reddit mentions updated', window);
      updateFieldValue(secondLabelField, 'Expansion RSS updated', window);
      await flush();
    });

    await act(async () => {
      firstSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      secondSaveDeferred.resolve({
        sourceConfig: {
          id: 4,
          projectId: 7,
          sourceType: 'rss',
          platform: 'rss',
          label: 'Expansion RSS updated',
          configJson: { feedUrl: 'https://feeds.test/expansion.xml' },
          enabled: true,
          pollIntervalMinutes: 45,
        },
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Expansion RSS updated');

    await act(async () => {
      firstSaveDeferred.resolve({
        sourceConfig: {
          id: 3,
          projectId: 7,
          sourceType: 'keyword+reddit',
          platform: 'reddit',
          label: 'Reddit mentions updated',
          configJson: { query: 'acme launch updated' },
          enabled: true,
          pollIntervalMinutes: 30,
        },
      });
      await flush();
      await flush();
    });

    expect(collectText(container)).toContain('Reddit mentions updated');
    expect(collectText(container)).toContain('Expansion RSS updated');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
