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
  namespaceURI: string;
  style: Record<string, string>;
  attributes: Map<string, string>;
  disabled: boolean;
  private listeners: Map<string, EventListenerEntry[]>;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = new Map();
    this.disabled = false;
    this.listeners = new Map();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);

    if (name === 'disabled') {
      this.disabled = true;
    }
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);

    if (name === 'disabled') {
      this.disabled = false;
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

function findPlatformCheckbox(container: FakeNode, platformValue: string) {
  const platformCard = findElement(
    container,
    (element) => element.getAttribute('data-generate-platform') === platformValue,
  );

  return platformCard ? findElement(platformCard, (element) => element.tagName === 'INPUT') : null;
}

function updateFieldValue(element: FakeElement | null, value: string, window: FakeWindow) {
  if (!element) {
    throw new Error('expected form field');
  }

  (element as FakeElement & { value?: string }).value = value;

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Generate review actions', () => {
  it('keeps only the latest async action result when earlier requests resolve later', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { useAsyncAction } = await import('../../src/client/hooks/useAsyncRequest');

    let resolveFirst: ((value: { label: string }) => void) | null = null;
    let resolveSecond: ((value: { label: string }) => void) | null = null;
    const action = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ label: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ label: string }>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    function Harness() {
      const { state, run } = useAsyncAction(action);

      return createElement(
        'section',
        null,
        createElement(
          'button',
          {
            type: 'button',
            'data-async-action': 'first',
            onClick: () => {
              void run('first');
            },
          },
          'first',
        ),
        createElement(
          'button',
          {
            type: 'button',
            'data-async-action': 'second',
            onClick: () => {
              void run('second');
            },
          },
          'second',
        ),
        createElement('div', { 'data-async-state': 'status' }, state.status),
        createElement('div', { 'data-async-state': 'result' }, state.data?.label ?? ''),
      );
    }

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(Harness as never));
      await flush();
    });

    const firstButton = findElement(
      container,
      (element) => element.getAttribute('data-async-action') === 'first',
    );
    const secondButton = findElement(
      container,
      (element) => element.getAttribute('data-async-action') === 'second',
    );

    await act(async () => {
      firstButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      secondButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      resolveSecond?.({ label: 'second' });
      await flush();
    });

    await act(async () => {
      resolveFirst?.({ label: 'first' });
      await flush();
    });

    const statusNode = findElement(
      container,
      (element) => element.getAttribute('data-async-state') === 'status',
    );
    const resultNode = findElement(
      container,
      (element) => element.getAttribute('data-async-state') === 'result',
    );

    expect(action).toHaveBeenNthCalledWith(1, 'first');
    expect(action).toHaveBeenNthCalledWith(2, 'second');
    expect(collectText(statusNode as never)).toContain('success');
    expect(collectText(resultNode as never)).toContain('second');
    expect(collectText(resultNode as never)).not.toContain('first');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the latest generated results visible while a new generate request is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    let resolveFirst!: (value: { results: Array<Record<string, unknown>> }) => void;
    const secondDeferred = createDeferredPromise<{ results: Array<Record<string, unknown>> }>();
    const generateAction = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(() => secondDeferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
        }),
      );
      await flush();
    });

    const saveDraftButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    );
    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('一键生成'),
    );

    expect(saveDraftButton).not.toBeNull();
    expect(generateButton).not.toBeNull();

    await act(async () => {
      saveDraftButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      resolveFirst({
        results: [
          {
            platform: 'x',
            title: 'First generated draft',
            content: 'First draft body',
            hashtags: ['#launch'],
            draftId: 42,
          },
        ],
      });
      await flush();
    });

    expect(collectText(container)).toContain('First generated draft');
    expect(collectText(container)).toContain('已返回 1 条生成结果');

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('正在生成草稿...');
    expect(collectText(container)).toContain('First generated draft');
    expect(collectText(container)).toContain('已返回 1 条生成结果');

    await act(async () => {
      secondDeferred.resolve({
        results: [
          {
            platform: 'reddit',
            title: 'Second generated draft',
            content: 'Second draft body',
            hashtags: ['#launch'],
            draftId: 99,
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

  it('shows phased generation progress while a generate request is pending', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const pendingGeneration = createDeferredPromise<{ results: Array<Record<string, unknown>> }>();
    const generateAction = vi.fn().mockImplementation(() => pendingGeneration.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
        }),
      );
      await flush();
    });

    vi.useFakeTimers();

    const generateButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('一键生成'),
    );

    expect(generateButton).not.toBeNull();

    await act(async () => {
      generateButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(collectText(container)).toContain('生成进行中');
    expect(collectText(container)).toContain('已接收生成请求');
    expect(collectText(container)).toContain('1/3');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(collectText(container)).toContain('正在拆解平台策略');
    expect(collectText(container)).toContain('2/3');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(collectText(container)).toContain('正在生成平台草稿');
    expect(collectText(container)).toContain('3/3');

    await act(async () => {
      pendingGeneration.resolve({ results: [] });
      await Promise.resolve();
    });

    expect(collectText(container)).not.toContain('生成进行中');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps only ready launch platforms selectable by default', async () => {
    const { container } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(GeneratePage as never));
      await flush();
    });

    const xCheckbox = findPlatformCheckbox(container, 'x') as (FakeElement & { checked?: boolean }) | null;
    const redditCheckbox = findPlatformCheckbox(container, 'reddit') as (FakeElement & { checked?: boolean }) | null;
    const facebookGroupCheckbox = findPlatformCheckbox(container, 'facebook-group') as (FakeElement & {
      checked?: boolean;
    }) | null;
    const instagramCheckbox = findPlatformCheckbox(container, 'instagram') as (FakeElement & {
      checked?: boolean;
    }) | null;
    const tiktokCheckbox = findPlatformCheckbox(container, 'tiktok') as (FakeElement & {
      checked?: boolean;
    }) | null;
    const xiaohongshuCheckbox = findPlatformCheckbox(container, 'xiaohongshu') as (FakeElement & {
      checked?: boolean;
    }) | null;
    const weiboCheckbox = findPlatformCheckbox(container, 'weibo') as (FakeElement & { checked?: boolean }) | null;
    const blogCheckbox = findPlatformCheckbox(container, 'blog') as (FakeElement & { checked?: boolean }) | null;

    expect(xCheckbox).not.toBeNull();
    expect(redditCheckbox).not.toBeNull();
    expect(facebookGroupCheckbox).not.toBeNull();
    expect(instagramCheckbox).not.toBeNull();
    expect(tiktokCheckbox).not.toBeNull();
    expect(xiaohongshuCheckbox).not.toBeNull();
    expect(weiboCheckbox).not.toBeNull();
    expect(blogCheckbox).not.toBeNull();

    expect(xCheckbox?.checked).toBe(true);
    expect(redditCheckbox?.checked).toBe(true);
    expect(blogCheckbox?.checked).toBe(true);
    expect(facebookGroupCheckbox?.checked).toBe(false);
    expect(instagramCheckbox?.checked).toBe(false);
    expect(tiktokCheckbox?.checked).toBe(false);
    expect(xiaohongshuCheckbox?.checked).toBe(false);
    expect(weiboCheckbox?.checked).toBe(false);

    expect(xCheckbox?.disabled).toBe(false);
    expect(redditCheckbox?.disabled).toBe(false);
    expect(blogCheckbox?.disabled).toBe(false);
    expect(facebookGroupCheckbox?.disabled).toBe(false);
    expect(instagramCheckbox?.disabled).toBe(false);
    expect(tiktokCheckbox?.disabled).toBe(false);
    expect(xiaohongshuCheckbox?.disabled).toBe(false);
    expect(weiboCheckbox?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the legacy generate payload when projectId is omitted', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const generateAction = vi.fn().mockResolvedValue({ results: [] });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
        }),
      );
      await flush();
    });

    const saveDraftButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    );

    expect(saveDraftButton).not.toBeNull();

    await act(async () => {
      saveDraftButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).toHaveBeenCalledWith({
      topic: 'We added a cheaper Claude-compatible endpoint for Australian customers.',
      tone: 'professional',
      platforms: ['x', 'reddit', 'blog'],
      saveAsDraft: true,
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('parses the optional projectId from the raw draft string when saving generated drafts', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const generateAction = vi.fn().mockResolvedValue({ results: [] });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
        }),
      );
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    const saveDraftButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    );

    expect(projectIdInput).not.toBeNull();
    expect(saveDraftButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, ' 0012 ', window);
      await flush();
    });

    expect((projectIdInput as FakeElement & { value?: string }).value).toBe(' 0012 ');

    await act(async () => {
      saveDraftButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).toHaveBeenCalledWith({
      topic: 'We added a cheaper Claude-compatible endpoint for Australian customers.',
      tone: 'professional',
      platforms: ['x', 'reddit', 'blog'],
      saveAsDraft: true,
      projectId: 12,
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows a validation error and blocks saving drafts when projectId is invalid', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const generateAction = vi.fn().mockResolvedValue({ results: [] });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
        }),
      );
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    const saveDraftButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    );

    expect(projectIdInput).not.toBeNull();
    expect(saveDraftButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(projectIdInput, 'invalid-project-id', window);
      await flush();
    });

    expect(collectText(container)).toContain('项目 ID 必须是大于 0 的整数');
    expect((saveDraftButton as FakeElement | null)?.disabled).toBe(true);

    await act(async () => {
      saveDraftButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('prefers a controlled projectId draft prop and reports raw string changes', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const generateAction = vi.fn().mockResolvedValue({ results: [] });
    const onProjectIdDraftChange = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
          projectIdDraft: ' 0012 ',
          onProjectIdDraftChange,
        }),
      );
      await flush();
    });

    const projectIdInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('placeholder') === '例如 12',
    );
    const saveDraftButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    );

    expect((projectIdInput as FakeElement & { value?: string } | null)?.value).toBe(' 0012 ');
    expect(saveDraftButton).not.toBeNull();

    await act(async () => {
      saveDraftButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(generateAction).toHaveBeenCalledWith({
      topic: 'We added a cheaper Claude-compatible endpoint for Australian customers.',
      tone: 'professional',
      platforms: ['x', 'reddit', 'blog'],
      saveAsDraft: true,
      projectId: 12,
    });

    await act(async () => {
      updateFieldValue(projectIdInput, ' 0042 ', window);
      await flush();
    });

    expect(onProjectIdDraftChange).toHaveBeenCalledWith(' 0042 ');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('disables generate controls while a generation request is in flight', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    let resolveGeneration: ((value: { results: unknown[] }) => void) | null = null;
    const generateAction = vi.fn().mockImplementation(
      () =>
        new Promise<{ results: unknown[] }>((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          generateAction,
        }),
      );
      await flush();
    });

    const saveDraftButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    ) as FakeElement | null;

    expect(saveDraftButton).not.toBeNull();

    await act(async () => {
      saveDraftButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const generateNowButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('正在生成草稿...'),
    ) as FakeElement | null;
    const saveDraftButtonWhileLoading = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('保存为草稿'),
    ) as FakeElement | null;

    expect(generateAction).toHaveBeenCalledTimes(1);
    expect(generateNowButton).not.toBeNull();
    expect(generateNowButton?.disabled).toBe(true);
    expect(saveDraftButtonWhileLoading).not.toBeNull();
    expect(saveDraftButtonWhileLoading?.disabled).toBe(true);

    await act(async () => {
      resolveGeneration?.({ results: [] });
      await flush();
    });

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('patches generated drafts into review through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        draft: {
          id: 42,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'review',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const generateModule = (await import('../../src/client/pages/Generate')) as Record<string, unknown>;

    expect(typeof generateModule.sendDraftToReviewRequest).toBe('function');

    const sendDraftToReviewRequest = generateModule.sendDraftToReviewRequest as (
      id: number,
    ) => Promise<{ draft: { id: number; status: string } }>;

    const result = await sendDraftToReviewRequest(42);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/42',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'review' }),
      }),
    );
    expect(result.draft.id).toBe(42);
    expect(result.draft.status).toBe('review');
  });

  it('publishes generated drafts through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        status: 'published',
        publishUrl: 'https://x.com/promobot/status/42',
        message: 'publish ok',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const generateModule = (await import('../../src/client/pages/Generate')) as Record<string, unknown>;

    expect(typeof generateModule.publishGeneratedDraftRequest).toBe('function');

    const publishGeneratedDraftRequest = generateModule.publishGeneratedDraftRequest as (
      id: number,
    ) => Promise<{ success: boolean; status?: string; publishUrl: string | null; message: string }>;

    const result = await publishGeneratedDraftRequest(42);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/42/publish',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.status).toBe('published');
    expect(result.publishUrl).toBe('https://x.com/promobot/status/42');
  });

  it('patches generated draft schedules through the shared schedule API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        draft: {
          id: 42,
          platform: 'x',
          title: 'Launch thread',
          content: 'Draft body',
          hashtags: ['#launch'],
          status: 'scheduled',
          scheduledAt: '2026-04-20T09:30',
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:10:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const generateModule = (await import('../../src/client/pages/Generate')) as Record<string, unknown>;

    expect(typeof generateModule.scheduleGeneratedDraftRequest).toBe('function');

    const scheduleGeneratedDraftRequest = generateModule.scheduleGeneratedDraftRequest as (
      id: number,
      input: { scheduledAt: string | null },
    ) => Promise<{ draft: { id: number; status: string; scheduledAt?: string } }>;

    const result = await scheduleGeneratedDraftRequest(42, { scheduledAt: '2026-04-20T09:30' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drafts/42',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: '2026-04-20T09:30' }),
      }),
    );
    expect(result.draft.id).toBe(42);
    expect(result.draft.status).toBe('scheduled');
    expect(result.draft.scheduledAt).toBe('2026-04-20T09:30');
  });

  it('shows review success feedback after clicking send to review', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const sendDraftToReviewAction = vi.fn().mockResolvedValue({
      draft: {
        id: 42,
        platform: 'x',
        title: 'Launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'review',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          stateOverride: {
            status: 'success',
            data: {
              results: [
                {
                  platform: 'x',
                  title: 'Launch thread',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  draftId: 42,
                },
              ],
            },
          },
          sendDraftToReviewAction,
        }),
      );
      await flush();
    });

    const reviewButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-review-draft-id') === '42' &&
        collectText(element).includes('送审'),
    );

    expect(reviewButton).not.toBeNull();

    await act(async () => {
      reviewButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendDraftToReviewAction).toHaveBeenCalledWith(42);
    expect(collectText(container)).toContain('已送审');
    expect(collectText(container)).toContain('status: review');
    expect(collectText(container)).toContain('当前状态：review');

    const updatedReviewButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-draft-id') === '42',
    );

    expect(updatedReviewButton).not.toBeNull();
    expect(collectText(updatedReviewButton as FakeElement)).toContain('已送审');
    expect((updatedReviewButton as FakeElement).disabled).toBe(true);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale review feedback when a new generate result reuses the same draftId', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const sendDraftToReviewAction = vi.fn().mockResolvedValue({
      draft: {
        id: 42,
        platform: 'x',
        title: 'Launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'review',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          stateOverride: {
            status: 'success',
            data: {
              results: [
                {
                  platform: 'x',
                  title: 'Launch thread',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  draftId: 42,
                },
              ],
            },
          },
          sendDraftToReviewAction,
        }),
      );
      await flush();
    });

    const reviewButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-review-draft-id') === '42' &&
        collectText(element).includes('送审'),
    );

    expect(reviewButton).not.toBeNull();

    await act(async () => {
      reviewButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('已送审');
    expect(collectText(container)).toContain('当前状态：review');

    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          stateOverride: {
            status: 'success',
            data: {
              results: [
                {
                  platform: 'x',
                  title: 'Launch thread v2',
                  content: 'Freshly generated draft body',
                  hashtags: ['#launch'],
                  draftId: 42,
                },
              ],
            },
          },
          sendDraftToReviewAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('Launch thread v2');
    expect(collectText(container)).not.toContain('已送审');
    expect(collectText(container)).not.toContain('当前状态：review');

    const refreshedReviewButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-review-draft-id') === '42',
    );

    expect(refreshedReviewButton).not.toBeNull();
    expect(collectText(refreshedReviewButton as FakeElement)).toContain('送审');
    expect((refreshedReviewButton as FakeElement).disabled).toBe(false);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows review failure feedback when send to review fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const sendDraftToReviewAction = vi.fn().mockRejectedValue(new Error('draft not found'));

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          stateOverride: {
            status: 'success',
            data: {
              results: [
                {
                  platform: 'reddit',
                  title: 'Launch post',
                  content: 'Longer draft',
                  hashtags: ['#launch'],
                  draftId: 77,
                },
              ],
            },
          },
          sendDraftToReviewAction,
        }),
      );
      await flush();
    });

    const reviewButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-review-draft-id') === '77' &&
        collectText(element).includes('送审'),
    );

    expect(reviewButton).not.toBeNull();

    await act(async () => {
      reviewButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(sendDraftToReviewAction).toHaveBeenCalledWith(77);
    expect(collectText(container)).toContain('送审失败：draft not found');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows publish success feedback after clicking immediate publish', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const publishGeneratedDraftAction = vi.fn().mockResolvedValue({
      success: true,
      status: 'published',
      publishUrl: 'https://x.com/promobot/status/42',
      message: 'publish ok',
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          stateOverride: {
            status: 'success',
            data: {
              results: [
                {
                  platform: 'x',
                  title: 'Launch thread',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  draftId: 42,
                },
              ],
            },
          },
          publishGeneratedDraftAction,
        }),
      );
      await flush();
    });

    const publishButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-publish-draft-id') === '42' &&
        collectText(element).includes('立即发布'),
    );

    expect(publishButton).not.toBeNull();

    await act(async () => {
      publishButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(publishGeneratedDraftAction).toHaveBeenCalledWith(42);
    expect(collectText(container)).toContain('publish ok');
    expect(collectText(container)).toContain('status: published');
    expect(collectText(container)).toContain('https://x.com/promobot/status/42');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows schedule success feedback after pushing a generated draft into publish calendar', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { GeneratePage } = await import('../../src/client/pages/Generate');

    const scheduleGeneratedDraftAction = vi.fn().mockResolvedValue({
      draft: {
        id: 42,
        platform: 'x',
        title: 'Launch thread',
        content: 'Draft body',
        hashtags: ['#launch'],
        status: 'scheduled',
        scheduledAt: '2026-04-20T09:30:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(GeneratePage as never, {
          stateOverride: {
            status: 'success',
            data: {
              results: [
                {
                  platform: 'x',
                  title: 'Launch thread',
                  content: 'Draft body',
                  hashtags: ['#launch'],
                  draftId: 42,
                },
              ],
            },
          },
          scheduleGeneratedDraftAction,
        }),
      );
      await flush();
    });

    const scheduledAtField = findElement(
      container,
      (element) => element.getAttribute('data-generate-scheduled-at-id') === '42',
    );
    const scheduleButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.getAttribute('data-schedule-draft-id') === '42' &&
        collectText(element).includes('推入排程'),
    );

    expect(scheduledAtField).not.toBeNull();
    expect(scheduleButton).not.toBeNull();

    await act(async () => {
      updateFieldValue(scheduledAtField, '2026-04-20T09:30:00.000Z', window);
      await flush();
    });

    await act(async () => {
      scheduleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(scheduleGeneratedDraftAction).toHaveBeenCalledWith(42, {
      scheduledAt: '2026-04-20T09:30:00.000Z',
    });
    expect(collectText(container)).toContain('排程已保存');
    expect(collectText(container)).toContain('status: scheduled');
    expect(collectText(container)).toContain('计划发布时间：2026-04-20T09:30:00.000Z');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
