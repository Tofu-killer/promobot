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
  disabled: boolean;
  private listeners: Map<string, EventListenerEntry[]>;

  constructor(tagName: string, ownerDocument: FakeDocument | null) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.style = {};
    this.attributes = new Map();
    this.value = '';
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
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function collectInputs(node: FakeNode): string[] {
  const values: string[] = [];

  if (node instanceof FakeElement && node.tagName === 'INPUT') {
    values.push(`value="${node.value}"`);
  }

  for (const child of node.childNodes) {
    values.push(...collectInputs(child));
  }

  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('channel account edit actions', () => {
  it('applies launch presets to the create form when a platform preset is selected', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'idle',
            error: null,
          },
        }),
      );
      await flush();
    });

    const redditPreset = findElement(
      container,
      (element) => element.getAttribute('data-create-platform-preset') === 'reddit',
    );

    expect(redditPreset).not.toBeNull();

    await act(async () => {
      redditPreset?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const inputs = collectInputs(container);

    expect(inputs).toContain('value="reddit"');
    expect(inputs).toContain('value="reddit-main"');
    expect(inputs).toContain('value="Reddit Primary"');
    expect(inputs).toContain('value="oauth"');
    expect(inputs).toContain('value="unknown"');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('passes projectId through the create form when creating a channel account', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const deferred = createDeferredPromise<{
      channelAccount: {
        id: number;
        projectId: number | null;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const createChannelAccountAction = vi.fn().mockReturnValue(deferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [],
            },
          },
          createChannelAccountAction,
        }),
      );
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(container, (element) => element.getAttribute('data-create-project-id') === 'true'),
        '12',
        window,
      );
      updateFieldValue(
        findElement(container, (element) => element.getAttribute('data-create-account-key') === 'true'),
        'acct-x-2',
        window,
      );
      updateFieldValue(
        findElement(container, (element) => element.getAttribute('data-create-display-name') === 'true'),
        'X Secondary',
        window,
      );
      await flush();
    });

    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建账号'),
    );

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createChannelAccountAction).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 12,
        accountKey: 'acct-x-2',
        displayName: 'X Secondary',
      }),
    );

    await act(async () => {
      deferred.resolve({
        channelAccount: {
          id: 11,
          projectId: 12,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Secondary',
          authType: 'api',
          status: 'unknown',
          metadata: {},
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('X Secondary');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks invalid projectId input in channel accounts create and edit forms', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const createChannelAccountAction = vi.fn();
    const updateChannelAccountAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  projectId: 7,
                  platform: 'x',
                  accountKey: 'acct-x-2',
                  displayName: 'X Secondary',
                  authType: 'api-key',
                  status: 'healthy',
                  metadata: {},
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          createChannelAccountAction,
          updateChannelAccountAction,
        }),
      );
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(container, (element) => element.getAttribute('data-create-project-id') === 'true'),
        'invalid-project-id',
        window,
      );
      await flush();
    });

    const createButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && collectText(element).includes('创建账号'),
    );

    await act(async () => {
      createButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(createChannelAccountAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('创建失败：项目 ID 必须是大于 0 的整数');

    await act(async () => {
      updateFieldValue(
        findElement(container, (element) => element.getAttribute('data-create-project-id') === 'true'),
        '12',
        window,
      );
      await flush();
    });

    expect(collectText(container)).not.toContain('创建失败：项目 ID 必须是大于 0 的整数');

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '3',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-project-id') === '3',
        ),
        'invalid-project-id',
        window,
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-account-id') === '3',
    );

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateChannelAccountAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('更新失败：项目 ID 必须是大于 0 的整数');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('uses the explicitly selected target account for header connection actions', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const testChannelAccountAction = vi.fn().mockResolvedValue({
      ok: true,
      test: {
        checkedAt: '2026-04-19T02:00:00.000Z',
        status: 'healthy',
      },
      channelAccount: {
        id: 7,
        platform: 'reddit',
        accountKey: 'acct-reddit',
        displayName: 'Reddit Ops',
        authType: 'oauth',
        status: 'healthy',
        metadata: {},
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  platform: 'x',
                  accountKey: 'acct-x',
                  displayName: 'X / Twitter',
                  authType: 'api',
                  status: 'healthy',
                  metadata: {},
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
                {
                  id: 7,
                  platform: 'reddit',
                  accountKey: 'acct-reddit',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {},
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          testChannelAccountAction,
        }),
      );
      await flush();
    });

    const actionTargetButton = findElement(
      container,
      (element) => element.getAttribute('data-action-target-account') === '7',
    );
    const testConnectionButton = findElement(
      container,
      (element) => element.getAttribute('data-header-test-connection-action') === 'true',
    );

    expect(actionTargetButton).not.toBeNull();
    expect(testConnectionButton).not.toBeNull();

    await act(async () => {
      actionTargetButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      testConnectionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(testChannelAccountAction).toHaveBeenCalledWith(7);
    expect(collectText(container)).toContain('当前目标账号：Reddit Ops');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps the recent create CTA pinned to the newly created account instead of the global target', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const testChannelAccountAction = vi.fn().mockResolvedValue({
      ok: true,
      test: {
        checkedAt: '2026-04-19T02:30:00.000Z',
        status: 'healthy',
      },
      channelAccount: {
        id: 11,
        platform: 'reddit',
        accountKey: 'acct-new',
        displayName: 'Reddit Fresh',
        authType: 'oauth',
        status: 'healthy',
        metadata: {},
        createdAt: '2026-04-19T02:00:00.000Z',
        updatedAt: '2026-04-19T02:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  platform: 'x',
                  accountKey: 'acct-x',
                  displayName: 'X / Twitter',
                  authType: 'api',
                  status: 'healthy',
                  metadata: {},
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
                {
                  id: 7,
                  platform: 'reddit',
                  accountKey: 'acct-reddit',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {},
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          createStateOverride: {
            status: 'success',
            data: {
              channelAccount: {
                id: 11,
                platform: 'reddit',
                accountKey: 'acct-new',
                displayName: 'Reddit Fresh',
                authType: 'oauth',
                status: 'healthy',
                metadata: {},
                createdAt: '2026-04-19T02:00:00.000Z',
                updatedAt: '2026-04-19T02:00:00.000Z',
              },
            },
          },
          testChannelAccountAction,
        }),
      );
      await flush();
    });

    const actionTargetButton = findElement(
      container,
      (element) => element.getAttribute('data-action-target-account') === '7',
    );

    expect(actionTargetButton).not.toBeNull();

    await act(async () => {
      actionTargetButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('当前目标账号：Reddit Ops');
    expect(collectText(container)).toContain('账号：Reddit Fresh');

    const recentCreateTestButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        collectText(element) === '测试连接' &&
        element.getAttribute('data-header-test-connection-action') !== 'true' &&
        element.getAttribute('data-recovery-test-connection-action') !== 'true',
    );

    expect(recentCreateTestButton).not.toBeNull();

    await act(async () => {
      recentCreateTestButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(testChannelAccountAction).toHaveBeenCalledWith(11);
    expect(testChannelAccountAction).not.toHaveBeenCalledWith(7);

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('disables the no-target connection test CTAs without reloading the account list', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const loadChannelAccountsAction = vi.fn().mockResolvedValue({
      channelAccounts: [],
    });
    const testChannelAccountAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          loadChannelAccountsAction,
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [],
            },
          },
          testChannelAccountAction,
        }),
      );
      await flush();
    });

    const headerTestConnectionButton = findElement(
      container,
      (element) => element.getAttribute('data-header-test-connection-action') === 'true',
    );
    const recoveryTestConnectionButton = findElement(
      container,
      (element) => element.getAttribute('data-recovery-test-connection-action') === 'true',
    );

    expect(loadChannelAccountsAction).toHaveBeenCalledTimes(1);
    expect(headerTestConnectionButton).not.toBeNull();
    expect(recoveryTestConnectionButton).not.toBeNull();
    expect(collectText(headerTestConnectionButton as never)).toContain('暂无测试目标');
    expect(collectText(recoveryTestConnectionButton as never)).toContain('暂无测试目标');
    expect((headerTestConnectionButton as FakeElement).disabled).toBe(true);
    expect((recoveryTestConnectionButton as FakeElement).disabled).toBe(true);
    expect(collectText(container)).toContain('没有目标账号时，“测试连接”会禁用；先创建账号或选择动作目标账号。');

    await act(async () => {
      headerTestConnectionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      recoveryTestConnectionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(loadChannelAccountsAction).toHaveBeenCalledTimes(1);
    expect(testChannelAccountAction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('uses the selected target account default session action for the header session CTA', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      ok: true,
      sessionAction: {
        action: 'request_session',
        accountId: 7,
        status: 'pending',
        requestedAt: '2026-04-19T03:10:00.000Z',
        message: 'Browser login requested.',
        nextStep: '/api/channel-accounts/7/session',
      },
      channelAccount: {
        id: 7,
        platform: 'reddit',
        accountKey: 'acct-reddit',
        displayName: 'Reddit Ops',
        authType: 'oauth',
        status: 'healthy',
        metadata: {},
        session: {
          hasSession: false,
          status: 'missing',
          validatedAt: null,
          storageStatePath: null,
        },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  platform: 'x',
                  accountKey: 'acct-x',
                  displayName: 'X / Twitter',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: true,
                    status: 'active',
                    validatedAt: '2026-04-19T01:00:00.000Z',
                    storageStatePath: 'artifacts/browser-sessions/acct-x.json',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
                {
                  id: 7,
                  platform: 'reddit',
                  accountKey: 'acct-reddit',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: false,
                    status: 'missing',
                    validatedAt: null,
                    storageStatePath: null,
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const actionTargetButton = findElement(
      container,
      (element) => element.getAttribute('data-action-target-account') === '7',
    );

    expect(actionTargetButton).not.toBeNull();

    await act(async () => {
      actionTargetButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('当前目标账号：Reddit Ops');

    const headerSessionButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.parentNode instanceof FakeElement &&
        element.parentNode.getAttribute('data-header-session-action') === 'true',
    );

    expect(headerSessionButton).not.toBeNull();
    expect(collectText(headerSessionButton as never)).toContain('请求登录');

    await act(async () => {
      headerSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      action: 'request_session',
    });
    expect(requestChannelAccountSessionAction).not.toHaveBeenCalledWith(7, {
      action: 'relogin',
    });
    expect(collectText(container)).toContain('请求登录占位已记录');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('disables the header session CTA when no target account is available', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const requestChannelAccountSessionAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [],
            },
          },
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const headerSessionButton = findElement(
      container,
      (element) =>
        element.tagName === 'BUTTON' &&
        element.parentNode instanceof FakeElement &&
        element.parentNode.getAttribute('data-header-session-action') === 'true',
    );

    expect(headerSessionButton).not.toBeNull();
    expect(collectText(headerSessionButton as never)).toContain('暂无登录目标');
    expect((headerSessionButton as FakeElement).disabled).toBe(true);
    expect(collectText(container)).toContain('当前目标账号：未选定');

    await act(async () => {
      headerSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('patches a channel account through the shared API helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        channelAccount: {
          id: 3,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Growth',
          authType: 'api-key',
          status: 'failed',
          metadata: {
            team: 'revops',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const channelsModule = (await import('../../src/client/pages/ChannelAccounts')) as Record<string, unknown>;

    expect(typeof channelsModule.updateChannelAccountRequest).toBe('function');

    const updateChannelAccountRequest = channelsModule.updateChannelAccountRequest as (
      id: number,
      input: {
        displayName?: string;
        status?: string;
        metadata?: Record<string, unknown>;
      },
    ) => Promise<{
      channelAccount: {
        id: number;
        displayName: string;
        status: string;
      };
    }>;

    const result = await updateChannelAccountRequest(3, {
      displayName: 'X Growth',
      status: 'failed',
      metadata: {
        team: 'revops',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/channel-accounts/3',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'X Growth',
          status: 'failed',
          metadata: {
            team: 'revops',
          },
        }),
      }),
    );
    expect(result.channelAccount.displayName).toBe('X Growth');
    expect(result.channelAccount.status).toBe('failed');
  });

  it('shows loading and success feedback and backfills the edited account after saving', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const deferred = createDeferredPromise<{
        channelAccount: {
          id: number;
          projectId?: number | null;
          platform: string;
          accountKey: string;
          displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const updateChannelAccountAction = vi.fn().mockReturnValue(deferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  projectId: 7,
                  platform: 'x',
                  accountKey: 'acct-x-2',
                  displayName: 'X Secondary',
                  authType: 'api-key',
                  status: 'healthy',
                  metadata: {
                    team: 'growth',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          updateChannelAccountAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '3',
    );

    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-project-id') === '3',
        ),
        '',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-display-name-id') === '3',
        ),
        'X Growth',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-status-id') === '3',
        ),
        'failed',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-metadata-id') === '3',
        ),
        'team=revops,region=apac',
        window,
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-account-id') === '3',
    );

    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateChannelAccountAction).toHaveBeenCalledWith(3, {
      projectId: null,
      platform: 'x',
      accountKey: 'acct-x-2',
      displayName: 'X Growth',
      authType: 'api-key',
      status: 'failed',
      metadata: {
        team: 'revops',
        region: 'apac',
      },
    });
    expect(collectText(container)).toContain('正在保存账号...');

    await act(async () => {
      deferred.resolve({
        channelAccount: {
          id: 3,
          projectId: null,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Growth',
          authType: 'api-key',
          status: 'failed',
          metadata: {
            team: 'revops',
            region: 'apac',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('账号已更新');
    expect(collectText(container)).toContain('X Growth');
    expect(collectText(container)).toContain('x · api-key · failed');

    const displayNameInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-display-name-id') === '3',
    );
    const metadataInput = findElement(
      container,
      (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-metadata-id') === '3',
    );

    expect(displayNameInput?.value).toBe('X Growth');
    expect(metadataInput?.value).toBe('team=revops,region=apac');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('hides stale update success when projectId validation blocks a later edit save', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const deferred = createDeferredPromise<{
      channelAccount: {
        id: number;
        projectId?: number | null;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const updateChannelAccountAction = vi.fn().mockReturnValue(deferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  projectId: 7,
                  platform: 'x',
                  accountKey: 'acct-x-2',
                  displayName: 'X Secondary',
                  authType: 'api-key',
                  status: 'healthy',
                  metadata: {
                    team: 'growth',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          updateChannelAccountAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '3',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-project-id') === '3',
        ),
        '',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-display-name-id') === '3',
        ),
        'X Growth',
        window,
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-account-id') === '3',
    );

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateChannelAccountAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({
        channelAccount: {
          id: 3,
          projectId: null,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Growth',
          authType: 'api-key',
          status: 'healthy',
          metadata: {
            team: 'growth',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('账号已更新');

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-project-id') === '3',
        ),
        'invalid-project-id',
        window,
      );
      await flush();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateChannelAccountAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('更新失败：项目 ID 必须是大于 0 的整数');
    expect(collectText(container)).not.toContain('账号已更新');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('keeps stale update success hidden after switching to another account following local projectId validation failure', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const deferred = createDeferredPromise<{
      channelAccount: {
        id: number;
        projectId?: number | null;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const updateChannelAccountAction = vi.fn().mockReturnValue(deferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 3,
                  projectId: 7,
                  platform: 'x',
                  accountKey: 'acct-x-2',
                  displayName: 'X Secondary',
                  authType: 'api-key',
                  status: 'healthy',
                  metadata: {
                    team: 'growth',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
                {
                  id: 4,
                  projectId: 8,
                  platform: 'reddit',
                  accountKey: 'acct-reddit',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {},
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          updateChannelAccountAction,
        }),
      );
      await flush();
    });

    const firstEditButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '3',
    );

    await act(async () => {
      firstEditButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-project-id') === '3',
        ),
        '',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-display-name-id') === '3',
        ),
        'X Growth',
        window,
      );
      await flush();
    });

    const firstSaveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-account-id') === '3',
    );

    await act(async () => {
      firstSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      deferred.resolve({
        channelAccount: {
          id: 3,
          projectId: null,
          platform: 'x',
          accountKey: 'acct-x-2',
          displayName: 'X Growth',
          authType: 'api-key',
          status: 'healthy',
          metadata: {
            team: 'growth',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T01:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('账号已更新');

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-project-id') === '3',
        ),
        'invalid-project-id',
        window,
      );
      await flush();
    });

    await act(async () => {
      firstSaveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('更新失败：项目 ID 必须是大于 0 的整数');
    expect(collectText(container)).not.toContain('账号已更新');

    const secondEditButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '4',
    );

    await act(async () => {
      secondEditButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).not.toContain('账号已更新');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('shows error feedback when saving an edited account fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const updateChannelAccountAction = vi.fn().mockRejectedValue(new Error('permission denied'));

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 5,
                  platform: 'reddit',
                  accountKey: 'acct-r-1',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {
                    team: 'ops',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          updateChannelAccountAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '5',
    );

    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-display-name-id') === '5',
        ),
        'Reddit Escalations',
        window,
      );
      await flush();
    });

    const saveButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-account-id') === '5',
    );

    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(updateChannelAccountAction).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        displayName: 'Reddit Escalations',
      }),
    );
    expect(collectText(container)).toContain('更新失败：permission denied');
    expect(collectText(container)).toContain('reddit · oauth · healthy');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('saves session metadata and triggers relogin actions without regressing account editing', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveSessionDeferred = createDeferredPromise<{
      ok: boolean;
      session: {
        hasSession: boolean;
        id: string;
        status: string;
        validatedAt: string | null;
        storageStatePath: string | null;
        notes?: string;
      };
      channelAccount: {
        id: number;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        session: {
          hasSession: boolean;
          status: string;
          validatedAt: string | null;
          storageStatePath: string | null;
          id?: string;
          notes?: string;
        };
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const saveChannelAccountSessionAction = vi.fn().mockReturnValue(saveSessionDeferred.promise);
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      ok: true,
      sessionAction: {
        action: 'relogin',
        accountId: 7,
        status: 'pending',
        requestedAt: '2026-04-19T03:10:00.000Z',
        message:
          'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
        nextStep: '/api/channel-accounts/7/session',
        jobId: 17,
        jobStatus: 'pending',
        artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
      },
      channelAccount: {
        id: 7,
        platform: 'x',
        accountKey: 'acct-browser',
        displayName: 'Browser X',
        authType: 'browser',
        status: 'healthy',
        metadata: {},
        session: {
          hasSession: true,
          status: 'expired',
          validatedAt: '2026-04-19T02:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
          id: 'x:acct-browser',
        },
        latestBrowserLaneArtifact: {
          action: 'relogin',
          jobStatus: 'pending',
          requestedAt: '2026-04-19T03:10:00.000Z',
          artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
          resolvedAt: null,
        },
        publishReadiness: {
          platform: 'x',
          ready: false,
          mode: 'browser',
          status: 'needs_relogin',
          message: '已有 X 浏览器 session，但需要重新登录刷新。',
          action: 'relogin',
        },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: true,
                    status: 'expired',
                    validatedAt: '2026-04-19T02:00:00.000Z',
                    storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
                    id: 'x:acct-browser',
                  },
                  publishReadiness: {
                    platform: 'x',
                    ready: false,
                    mode: 'browser',
                    status: 'needs_relogin',
                    message: '已有 X 浏览器 session，但需要重新登录刷新。',
                    action: 'relogin',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          testConnectionStateOverride: {
            status: 'success',
            data: {
              ok: true,
              test: {
                checkedAt: '2026-04-19T03:05:00.000Z',
                status: 'needs_relogin',
                result: {
                  label: '需要重新登录',
                },
                feedback: {
                  message: '检测到 X 浏览器 session 已过期，请重新登录后重新保存 session 元数据。',
                },
                recommendedAction: {
                  action: 'relogin',
                  label: '重新登录',
                },
                nextStep: {
                  path: '/api/channel-accounts/7/session',
                },
                details: {
                  ready: false,
                  mode: 'browser',
                  authType: 'browser',
                  session: {
                    hasSession: true,
                    status: 'expired',
                    validatedAt: '2026-04-19T02:00:00.000Z',
                    storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
                    id: 'x:acct-browser',
                  },
                },
              },
              channelAccount: {
                id: 7,
                platform: 'x',
                accountKey: 'acct-browser',
                displayName: 'Browser X',
                authType: 'browser',
                status: 'healthy',
                metadata: {},
                session: {
                  hasSession: true,
                  status: 'expired',
                  validatedAt: '2026-04-19T02:00:00.000Z',
                  storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
                  id: 'x:acct-browser',
                },
                publishReadiness: {
                  platform: 'x',
                  ready: false,
                  mode: 'browser',
                  status: 'needs_relogin',
                  message: '已有 X 浏览器 session，但需要重新登录刷新。',
                  action: 'relogin',
                },
                createdAt: '2026-04-19T00:00:00.000Z',
                updatedAt: '2026-04-19T00:00:00.000Z',
              },
            },
          },
          saveChannelAccountSessionAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    expect(collectText(container)).toContain('最近一次连接测试');
    expect(collectText(container)).toContain('连接结果：需要重新登录');
    expect(collectText(container)).toContain('建议动作：重新登录');
    expect(collectText(container)).toContain('下一步：/api/channel-accounts/7/session');
    expect(collectText(container)).toContain('发布就绪：需要重新登录');
    expect(collectText(container)).toContain('发布方式：浏览器接管');
    expect(collectText(container)).toContain('编辑账号');
    expect(collectText(container)).toContain('编辑 Session 元数据');

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-storage-path-id') === '7',
        ),
        'artifacts/browser-sessions/browser-x-fresh.json',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-status-id') === '7',
        ),
        'active',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-validated-at-id') === '7',
        ),
        '2026-04-19T03:00:00.000Z',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-notes-id') === '7',
        ),
        'cookie refreshed in headed browser',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
      status: 'active',
      validatedAt: '2026-04-19T03:00:00.000Z',
      notes: 'cookie refreshed in headed browser',
    });
    expect(collectText(container)).toContain('正在保存 Session...');

    await act(async () => {
      saveSessionDeferred.resolve({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-19T03:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
          notes: 'cookie refreshed in headed browser',
        },
        channelAccount: {
          id: 7,
          platform: 'x',
          accountKey: 'acct-browser',
          displayName: 'Browser X',
          authType: 'browser',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-19T03:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
            notes: 'cookie refreshed in headed browser',
          },
          publishReadiness: {
            platform: 'x',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: 'X 浏览器发布链路已具备可用 session。',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T03:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Session 元数据已保存');
    expect(collectText(container)).toContain('Session 状态：active');
    expect(collectText(container)).toContain('最近验证：2026-04-19T03:00:00.000Z');
    expect(collectText(container)).toContain('Storage Path：artifacts/browser-sessions/browser-x-fresh.json');
    expect(collectText(container)).toContain('Session 备注：cookie refreshed in headed browser');
    expect(collectText(container)).toContain('发布就绪：已就绪');

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-session-action-id') === '7',
    );

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      action: 'relogin',
    });
    expect(collectText(container)).toContain('重新登录占位已记录');
    expect(collectText(container)).toContain('Refresh login manually');
    expect(collectText(container)).toContain('请求时间：2026-04-19T03:10:00.000Z');
    expect(collectText(container)).toContain('工单状态：pending');
    expect(collectText(container)).toContain('下一步：/api/channel-accounts/7/session');
    expect(collectText(container)).toContain(
      'Artifact Path：artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
    );
    expect(collectText(container)).toContain('最近工单：重新登录');
    expect(collectText(container)).toContain('工单时间：2026-04-19T03:10:00.000Z');
    expect(collectText(container)).toContain('工单结单：未结单');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale relogin receipts after saving refreshed session metadata for the same account', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveSessionDeferred = createDeferredPromise<{
      ok: boolean;
      session: {
        hasSession: boolean;
        id: string;
        status: string;
        validatedAt: string | null;
        storageStatePath: string | null;
        notes?: string;
      };
      channelAccount: {
        id: number;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        session: {
          hasSession: boolean;
          status: string;
          validatedAt: string | null;
          storageStatePath: string | null;
          id?: string;
          notes?: string;
        };
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const saveChannelAccountSessionAction = vi.fn().mockReturnValue(saveSessionDeferred.promise);
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      ok: true,
      sessionAction: {
        action: 'relogin',
        accountId: 7,
        status: 'pending',
        requestedAt: '2026-04-19T03:10:00.000Z',
        message:
          'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
        nextStep: '/api/channel-accounts/7/session',
        jobId: 17,
        jobStatus: 'pending',
        artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
      },
      channelAccount: {
        id: 7,
        platform: 'x',
        accountKey: 'acct-browser',
        displayName: 'Browser X',
        authType: 'browser',
        status: 'healthy',
        metadata: {},
        session: {
          hasSession: true,
          status: 'expired',
          validatedAt: '2026-04-19T02:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
          id: 'x:acct-browser',
        },
        latestBrowserLaneArtifact: {
          action: 'relogin',
          jobStatus: 'pending',
          requestedAt: '2026-04-19T03:10:00.000Z',
          artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
          resolvedAt: null,
        },
        publishReadiness: {
          platform: 'x',
          ready: false,
          mode: 'browser',
          status: 'needs_relogin',
          message: '已有 X 浏览器 session，但需要重新登录刷新。',
          action: 'relogin',
        },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: true,
                    status: 'expired',
                    validatedAt: '2026-04-19T02:00:00.000Z',
                    storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
                    id: 'x:acct-browser',
                  },
                  publishReadiness: {
                    platform: 'x',
                    ready: false,
                    mode: 'browser',
                    status: 'needs_relogin',
                    message: '已有 X 浏览器 session，但需要重新登录刷新。',
                    action: 'relogin',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-session-action-id') === '7',
    );

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      action: 'relogin',
    });
    expect(collectText(container)).toContain('重新登录占位已记录');
    expect(collectText(container)).toContain('Refresh login manually');
    expect(collectText(container)).toContain('工单状态：pending');
    expect(collectText(container)).toContain(
      'Artifact Path：artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
    );
    expect(collectText(container)).toContain('最近工单：重新登录');

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-storage-path-id') === '7',
        ),
        'artifacts/browser-sessions/browser-x-fresh.json',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-status-id') === '7',
        ),
        'active',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-validated-at-id') === '7',
        ),
        '2026-04-19T03:00:00.000Z',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-notes-id') === '7',
        ),
        'cookie refreshed in headed browser',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
      status: 'active',
      validatedAt: '2026-04-19T03:00:00.000Z',
      notes: 'cookie refreshed in headed browser',
    });
    expect(collectText(container)).toContain('正在保存 Session...');

    await act(async () => {
      saveSessionDeferred.resolve({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-19T03:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
          notes: 'cookie refreshed in headed browser',
        },
        channelAccount: {
          id: 7,
          platform: 'x',
          accountKey: 'acct-browser',
          displayName: 'Browser X',
          authType: 'browser',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-19T03:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
            notes: 'cookie refreshed in headed browser',
          },
          publishReadiness: {
            platform: 'x',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: 'X 浏览器发布链路已具备可用 session。',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T03:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Session 元数据已保存');
    expect(collectText(container)).toContain('Session 状态：active');
    expect(collectText(container)).toContain('最近验证：2026-04-19T03:00:00.000Z');
    expect(collectText(container)).toContain('Storage Path：artifacts/browser-sessions/browser-x-fresh.json');
    expect(collectText(container)).toContain('Session 备注：cookie refreshed in headed browser');
    expect(collectText(container)).toContain('发布就绪：已就绪');
    expect(collectText(container)).not.toContain('重新登录占位已记录');
    expect(collectText(container)).not.toContain('Refresh login manually');
    expect(collectText(container)).not.toContain('工单状态：pending');
    expect(collectText(container)).not.toContain(
      'Artifact Path：artifacts/browser-lane-requests/x/acct-browser/relogin-job-17.json',
    );
    expect(collectText(container)).not.toContain('最近工单：重新登录');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('clears stale request-session receipts after saving session metadata for the same account', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveSessionDeferred = createDeferredPromise<{
      ok: boolean;
      session: {
        hasSession: boolean;
        id: string;
        status: string;
        validatedAt: string | null;
        storageStatePath: string | null;
        notes?: string;
      };
      channelAccount: {
        id: number;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        session: {
          hasSession: boolean;
          status: string;
          validatedAt: string | null;
          storageStatePath: string | null;
          id?: string;
          notes?: string;
        };
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const saveChannelAccountSessionAction = vi.fn().mockReturnValue(saveSessionDeferred.promise);
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      ok: true,
      sessionAction: {
        action: 'request_session',
        accountId: 7,
        status: 'pending',
        requestedAt: '2026-04-19T03:10:00.000Z',
        message: 'Browser login requested.',
        nextStep: '/api/channel-accounts/7/session',
        jobId: 19,
        jobStatus: 'pending',
        artifactPath: 'artifacts/browser-lane-requests/reddit/acct-reddit/request-session-job-19.json',
      },
      channelAccount: {
        id: 7,
        platform: 'reddit',
        accountKey: 'acct-reddit',
        displayName: 'Reddit Ops',
        authType: 'oauth',
        status: 'healthy',
        metadata: {},
        session: {
          hasSession: false,
          status: 'missing',
          validatedAt: null,
          storageStatePath: null,
        },
        latestBrowserLaneArtifact: {
          action: 'request_session',
          jobStatus: 'pending',
          requestedAt: '2026-04-19T03:10:00.000Z',
          artifactPath: 'artifacts/browser-lane-requests/reddit/acct-reddit/request-session-job-19.json',
          resolvedAt: null,
        },
        publishReadiness: {
          platform: 'reddit',
          ready: false,
          mode: 'oauth',
          status: 'needs_session',
          message: 'Reddit OAuth 账号尚未保存登录态，请先登录。',
          action: 'request_session',
        },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'reddit',
                  accountKey: 'acct-reddit',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: false,
                    status: 'missing',
                    validatedAt: null,
                    storageStatePath: null,
                  },
                  publishReadiness: {
                    platform: 'reddit',
                    ready: false,
                    mode: 'oauth',
                    status: 'needs_session',
                    message: 'Reddit OAuth 账号尚未保存登录态，请先登录。',
                    action: 'request_session',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const requestSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-session-action-id') === '7',
    );

    expect(collectText(requestSessionButton as never)).toContain('请求登录');

    await act(async () => {
      requestSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      action: 'request_session',
    });
    expect(collectText(container)).toContain('请求登录占位已记录');
    expect(collectText(container)).toContain('Browser login requested.');
    expect(collectText(container)).toContain('工单状态：pending');
    expect(collectText(container)).toContain('下一步：/api/channel-accounts/7/session');
    expect(collectText(container)).toContain('最近工单：请求登录');

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-storage-path-id') === '7',
        ),
        'artifacts/browser-sessions/reddit-oauth-fresh.json',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-status-id') === '7',
        ),
        'active',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-validated-at-id') === '7',
        ),
        '2026-04-19T03:20:00.000Z',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-notes-id') === '7',
        ),
        'oauth refreshed after browser login',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      storageStatePath: 'artifacts/browser-sessions/reddit-oauth-fresh.json',
      status: 'active',
      validatedAt: '2026-04-19T03:20:00.000Z',
      notes: 'oauth refreshed after browser login',
    });

    await act(async () => {
      saveSessionDeferred.resolve({
        ok: true,
        session: {
          hasSession: true,
          id: 'reddit:acct-reddit',
          status: 'active',
          validatedAt: '2026-04-19T03:20:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/reddit-oauth-fresh.json',
          notes: 'oauth refreshed after browser login',
        },
        channelAccount: {
          id: 7,
          platform: 'reddit',
          accountKey: 'acct-reddit',
          displayName: 'Reddit Ops',
          authType: 'oauth',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'reddit:acct-reddit',
            status: 'active',
            validatedAt: '2026-04-19T03:20:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/reddit-oauth-fresh.json',
            notes: 'oauth refreshed after browser login',
          },
          publishReadiness: {
            platform: 'reddit',
            ready: true,
            mode: 'oauth',
            status: 'ready',
            message: 'Reddit OAuth 登录态已可用。',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T03:20:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Session 元数据已保存');
    expect(collectText(container)).toContain('Session 状态：active');
    expect(collectText(container)).toContain('最近验证：2026-04-19T03:20:00.000Z');
    expect(collectText(container)).toContain('Storage Path：artifacts/browser-sessions/reddit-oauth-fresh.json');
    expect(collectText(container)).toContain('Session 备注：oauth refreshed after browser login');
    expect(collectText(container)).toContain('发布就绪：已就绪');
    expect(collectText(container)).not.toContain('请求登录占位已记录');
    expect(collectText(container)).not.toContain('Browser login requested.');
    expect(collectText(container)).not.toContain('工单状态：pending');
    expect(collectText(container)).not.toContain('下一步：/api/channel-accounts/7/session');
    expect(collectText(container)).not.toContain('最近工单：请求登录');
    expect(collectText(container)).toContain('重新登录');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('preserves saved session overlay for one account when another account triggers a new session action', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveSessionDeferred = createDeferredPromise<{
      ok: boolean;
      session: {
        hasSession: boolean;
        id: string;
        status: string;
        validatedAt: string | null;
        storageStatePath: string | null;
        notes?: string;
      };
      channelAccount: {
        id: number;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        session: {
          hasSession: boolean;
          status: string;
          validatedAt: string | null;
          storageStatePath: string | null;
          id?: string;
          notes?: string;
        };
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const saveChannelAccountSessionAction = vi.fn().mockReturnValue(saveSessionDeferred.promise);
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      ok: true,
      sessionAction: {
        action: 'request_session',
        accountId: 8,
        status: 'pending',
        requestedAt: '2026-04-19T03:30:00.000Z',
        message: 'Browser login requested.',
        nextStep: '/api/channel-accounts/8/session',
        jobId: 22,
        jobStatus: 'pending',
        artifactPath: 'artifacts/browser-lane-requests/reddit/acct-reddit/request-session-job-22.json',
      },
      channelAccount: {
        id: 8,
        platform: 'reddit',
        accountKey: 'acct-reddit',
        displayName: 'Reddit Ops',
        authType: 'oauth',
        status: 'healthy',
        metadata: {},
        session: {
          hasSession: false,
          status: 'missing',
          validatedAt: null,
          storageStatePath: null,
        },
        latestBrowserLaneArtifact: {
          action: 'request_session',
          jobStatus: 'pending',
          requestedAt: '2026-04-19T03:30:00.000Z',
          artifactPath: 'artifacts/browser-lane-requests/reddit/acct-reddit/request-session-job-22.json',
          resolvedAt: null,
        },
        publishReadiness: {
          platform: 'reddit',
          ready: false,
          mode: 'oauth',
          status: 'needs_session',
          message: 'Reddit OAuth 账号尚未保存登录态，请先登录。',
          action: 'request_session',
        },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: true,
                    status: 'expired',
                    validatedAt: '2026-04-19T02:00:00.000Z',
                    storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
                    id: 'x:acct-browser',
                  },
                  publishReadiness: {
                    platform: 'x',
                    ready: false,
                    mode: 'browser',
                    status: 'needs_relogin',
                    message: '已有 X 浏览器 session，但需要重新登录刷新。',
                    action: 'relogin',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
                {
                  id: 8,
                  platform: 'reddit',
                  accountKey: 'acct-reddit',
                  displayName: 'Reddit Ops',
                  authType: 'oauth',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: false,
                    status: 'missing',
                    validatedAt: null,
                    storageStatePath: null,
                  },
                  publishReadiness: {
                    platform: 'reddit',
                    ready: false,
                    mode: 'oauth',
                    status: 'needs_session',
                    message: 'Reddit OAuth 账号尚未保存登录态，请先登录。',
                    action: 'request_session',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-storage-path-id') === '7',
        ),
        'artifacts/browser-sessions/browser-x-fresh.json',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-status-id') === '7',
        ),
        'active',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-validated-at-id') === '7',
        ),
        '2026-04-19T03:00:00.000Z',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-notes-id') === '7',
        ),
        'cookie refreshed in headed browser',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      saveSessionDeferred.resolve({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-19T03:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
          notes: 'cookie refreshed in headed browser',
        },
        channelAccount: {
          id: 7,
          platform: 'x',
          accountKey: 'acct-browser',
          displayName: 'Browser X',
          authType: 'browser',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-19T03:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/browser-x-fresh.json',
            notes: 'cookie refreshed in headed browser',
          },
          publishReadiness: {
            platform: 'x',
            ready: true,
            mode: 'browser',
            status: 'ready',
            message: 'X 浏览器发布链路已具备可用 session。',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T03:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Storage Path：artifacts/browser-sessions/browser-x-fresh.json');
    expect(collectText(container)).toContain('Session 备注：cookie refreshed in headed browser');

    const requestSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-session-action-id') === '8',
    );

    await act(async () => {
      requestSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(requestChannelAccountSessionAction).toHaveBeenCalledWith(8, {
      action: 'request_session',
    });
    expect(collectText(container)).toContain('请求登录占位已记录');
    expect(collectText(container)).toContain('Browser login requested.');
    expect(collectText(container)).toContain('Storage Path：artifacts/browser-sessions/browser-x-fresh.json');
    expect(collectText(container)).toContain('Session 备注：cookie refreshed in headed browser');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('saves imported storage state JSON without requiring a manually typed storage path', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveSessionDeferred = createDeferredPromise<{
      ok: boolean;
      session: {
        hasSession: boolean;
        id: string;
        status: string;
        validatedAt: string | null;
        storageStatePath: string | null;
        notes?: string;
      };
      channelAccount: {
        id: number;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        session: {
          hasSession: boolean;
          status: string;
          validatedAt: string | null;
          storageStatePath: string | null;
          id?: string;
          notes?: string;
        };
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const saveChannelAccountSessionAction = vi.fn().mockReturnValue(saveSessionDeferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: false,
                    status: 'missing',
                    validatedAt: null,
                    storageStatePath: null,
                    id: 'x:acct-browser',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const importedStorageState = JSON.stringify(
      {
        cookies: [
          {
            name: 'sid',
            value: 'fresh-cookie',
            domain: '.x.com',
            path: '/',
            expires: 1893456000,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      null,
      2,
    );

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'TEXTAREA' && element.getAttribute('data-edit-session-storage-state-json-id') === '7',
        ),
        importedStorageState,
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-status-id') === '7',
        ),
        'active',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-validated-at-id') === '7',
        ),
        '2026-04-19T04:00:00.000Z',
        window,
      );
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-notes-id') === '7',
        ),
        'imported from Playwright storage state',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).toHaveBeenCalledWith(7, {
      storageState: {
        cookies: [
          {
            name: 'sid',
            value: 'fresh-cookie',
            domain: '.x.com',
            path: '/',
            expires: 1893456000,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      status: 'active',
      validatedAt: '2026-04-19T04:00:00.000Z',
      notes: 'imported from Playwright storage state',
    });
    expect(collectText(container)).toContain('正在保存 Session...');

    await act(async () => {
      saveSessionDeferred.resolve({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-19T04:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/browser-x-imported.json',
          notes: 'imported from Playwright storage state',
        },
        channelAccount: {
          id: 7,
          platform: 'x',
          accountKey: 'acct-browser',
          displayName: 'Browser X',
          authType: 'browser',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-19T04:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/browser-x-imported.json',
            notes: 'imported from Playwright storage state',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T04:00:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Session 元数据已保存');
    expect(collectText(container)).toContain('Storage Path：artifacts/browser-sessions/browser-x-imported.json');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('blocks session save and shows a validation error when imported storage state JSON is invalid', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveChannelAccountSessionAction = vi.fn();

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: false,
                    status: 'missing',
                    validatedAt: null,
                    storageStatePath: null,
                    id: 'x:acct-browser',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) =>
            element.tagName === 'TEXTAREA' &&
            element.getAttribute('data-edit-session-storage-state-json-id') === '7',
        ),
        '{"cookies": [}',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Session 保存失败：storage state JSON 必须是合法 JSON');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('hides stale session save success when a later local storage-state validation fails', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveSessionDeferred = createDeferredPromise<{
      ok: boolean;
      session: {
        hasSession: boolean;
        id: string;
        status: string;
        validatedAt: string | null;
        storageStatePath: string | null;
        notes?: string;
      };
      channelAccount: {
        id: number;
        platform: string;
        accountKey: string;
        displayName: string;
        authType: string;
        status: string;
        metadata: Record<string, unknown>;
        session: {
          hasSession: boolean;
          status: string;
          validatedAt: string | null;
          storageStatePath: string | null;
          id?: string;
          notes?: string;
        };
        createdAt: string;
        updatedAt: string;
      };
    }>();
    const saveChannelAccountSessionAction = vi.fn().mockReturnValue(saveSessionDeferred.promise);

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: false,
                    status: 'missing',
                    validatedAt: null,
                    storageStatePath: null,
                    id: 'x:acct-browser',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) => element.tagName === 'INPUT' && element.getAttribute('data-edit-session-storage-path-id') === '7',
        ),
        'artifacts/browser-sessions/browser-x-valid.json',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      saveSessionDeferred.resolve({
        ok: true,
        session: {
          hasSession: true,
          id: 'x:acct-browser',
          status: 'active',
          validatedAt: '2026-04-19T04:30:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/browser-x-valid.json',
        },
        channelAccount: {
          id: 7,
          platform: 'x',
          accountKey: 'acct-browser',
          displayName: 'Browser X',
          authType: 'browser',
          status: 'healthy',
          metadata: {},
          session: {
            hasSession: true,
            id: 'x:acct-browser',
            status: 'active',
            validatedAt: '2026-04-19T04:30:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/browser-x-valid.json',
          },
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T04:30:00.000Z',
        },
      });
      await flush();
    });

    expect(collectText(container)).toContain('Session 元数据已保存');

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) =>
            element.tagName === 'TEXTAREA' &&
            element.getAttribute('data-edit-session-storage-state-json-id') === '7',
        ),
        '{"cookies": [}',
        window,
      );
      await flush();
    });

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).toHaveBeenCalledTimes(1);
    expect(collectText(container)).toContain('Session 保存失败：storage state JSON 必须是合法 JSON');
    expect(collectText(container)).not.toContain('Session 元数据已保存');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });

  it('hides stale session-action overlays when a later local save validation fails for the same account', async () => {
    const { container, window } = installMinimalDom();
    const { createRoot } = await import('react-dom/client');
    const { ChannelAccountsPage } = await import('../../src/client/pages/ChannelAccounts');

    const saveChannelAccountSessionAction = vi.fn();
    const requestChannelAccountSessionAction = vi.fn().mockResolvedValue({
      ok: true,
      sessionAction: {
        action: 'relogin',
        accountId: 7,
        status: 'pending',
        requestedAt: '2026-04-19T05:00:00.000Z',
        message:
          'Browser relogin request queued. Refresh login manually and attach updated session metadata after the browser lane picks up the job.',
        nextStep: '/api/channel-accounts/7/session',
        jobId: 27,
        jobStatus: 'pending',
        artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/relogin-job-27.json',
      },
      channelAccount: {
        id: 7,
        platform: 'x',
        accountKey: 'acct-browser',
        displayName: 'Browser X',
        authType: 'browser',
        status: 'healthy',
        metadata: {},
        session: {
          hasSession: true,
          status: 'expired',
          validatedAt: '2026-04-19T02:00:00.000Z',
          storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
          id: 'x:acct-browser',
        },
        latestBrowserLaneArtifact: {
          action: 'relogin',
          jobStatus: 'pending',
          requestedAt: '2026-04-19T05:00:00.000Z',
          artifactPath: 'artifacts/browser-lane-requests/x/acct-browser/relogin-job-27.json',
          resolvedAt: null,
        },
        publishReadiness: {
          platform: 'x',
          ready: false,
          mode: 'browser',
          status: 'needs_relogin',
          message: '已有 X 浏览器 session，但需要重新登录刷新。',
          action: 'relogin',
        },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    const root = createRoot(container as never);
    await act(async () => {
      root.render(
        createElement(ChannelAccountsPage as never, {
          stateOverride: {
            status: 'success',
            data: {
              channelAccounts: [
                {
                  id: 7,
                  platform: 'x',
                  accountKey: 'acct-browser',
                  displayName: 'Browser X',
                  authType: 'browser',
                  status: 'healthy',
                  metadata: {},
                  session: {
                    hasSession: true,
                    status: 'expired',
                    validatedAt: '2026-04-19T02:00:00.000Z',
                    storageStatePath: 'artifacts/browser-sessions/acct-browser.json',
                    id: 'x:acct-browser',
                  },
                  publishReadiness: {
                    platform: 'x',
                    ready: false,
                    mode: 'browser',
                    status: 'needs_relogin',
                    message: '已有 X 浏览器 session，但需要重新登录刷新。',
                    action: 'relogin',
                  },
                  createdAt: '2026-04-19T00:00:00.000Z',
                  updatedAt: '2026-04-19T00:00:00.000Z',
                },
              ],
            },
          },
          saveChannelAccountSessionAction,
          requestChannelAccountSessionAction,
        }),
      );
      await flush();
    });

    const reloginButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-session-action-id') === '7',
    );

    await act(async () => {
      reloginButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(collectText(container)).toContain('最近工单：重新登录');

    const editButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-edit-account-id') === '7',
    );

    await act(async () => {
      editButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      updateFieldValue(
        findElement(
          container,
          (element) =>
            element.tagName === 'TEXTAREA' &&
            element.getAttribute('data-edit-session-storage-state-json-id') === '7',
        ),
        '{"cookies": [}',
        window,
      );
      await flush();
    });

    const saveSessionButton = findElement(
      container,
      (element) => element.tagName === 'BUTTON' && element.getAttribute('data-save-session-id') === '7',
    );

    await act(async () => {
      saveSessionButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(saveChannelAccountSessionAction).not.toHaveBeenCalled();
    expect(collectText(container)).toContain('Session 保存失败：storage state JSON 必须是合法 JSON');
    expect(collectText(container)).not.toContain('重新登录占位已记录');
    expect(collectText(container)).not.toContain('最近工单：重新登录');

    await act(async () => {
      root.unmount();
      await flush();
    });
  });
});
