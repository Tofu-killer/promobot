import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserLaneDispatch } from '../../src/server/services/browser/browserLaneDispatch';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBrowserLaneDispatch', () => {
  it('does nothing when no browser lane command is configured', () => {
    const spawn = vi.fn();
    const dispatch = createBrowserLaneDispatch({
      env: {},
      spawn,
    });

    dispatch({
      kind: 'publish_handoff',
      artifactPath: 'artifacts/browser-handoffs/instagram/main/instagram-draft-1.json',
      platform: 'instagram',
      accountKey: 'main',
      draftId: '1',
    });

    expect(spawn).not.toHaveBeenCalled();
  });

  it('prefers the kind-specific command and forwards dispatch metadata to the child env', () => {
    const listeners: Partial<Record<'error' | 'close', (...args: unknown[]) => void>> = {};
    const child = {
      once: vi.fn((event: 'error' | 'close', listener: (...args: unknown[]) => void) => {
        listeners[event] = listener;
        return child;
      }),
      unref: vi.fn(),
    };
    const spawn = vi.fn().mockReturnValue(child);
    const dispatch = createBrowserLaneDispatch({
      cwd: '/tmp/promobot',
      env: {
        PROMOBOT_BROWSER_LANE_COMMAND: 'fallback-browser-lane',
        PROMOBOT_BROWSER_PUBLISH_HANDOFF_COMMAND: 'publish-browser-lane',
      },
      now: () => new Date('2026-04-30T02:03:04.000Z'),
      spawn,
    });

    dispatch({
      kind: 'publish_handoff',
      artifactPath: 'artifacts/browser-handoffs/instagram/main/instagram-draft-1.json',
      platform: 'instagram',
      accountKey: 'main',
      channelAccountId: 7,
      draftId: '1',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('publish-browser-lane', {
      cwd: '/tmp/promobot',
      env: expect.objectContaining({
        PROMOBOT_BROWSER_LANE_COMMAND: 'fallback-browser-lane',
        PROMOBOT_BROWSER_PUBLISH_HANDOFF_COMMAND: 'publish-browser-lane',
        PROMOBOT_BROWSER_DISPATCHED_AT: '2026-04-30T02:03:04.000Z',
        PROMOBOT_BROWSER_DISPATCH_KIND: 'publish_handoff',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-handoffs/instagram/main/instagram-draft-1.json',
        PROMOBOT_BROWSER_PLATFORM: 'instagram',
        PROMOBOT_BROWSER_ACCOUNT_KEY: 'main',
        PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID: '7',
        PROMOBOT_BROWSER_DRAFT_ID: '1',
      }),
      shell: true,
      stdio: 'ignore',
    });
    expect(child.unref).toHaveBeenCalledTimes(1);
    listeners.close?.(0, null);
  });

  it('falls back to the generic browser lane command when a kind-specific command is absent', () => {
    const child = {
      once: vi.fn().mockReturnThis(),
      unref: vi.fn(),
    };
    const spawn = vi.fn().mockReturnValue(child);
    const dispatch = createBrowserLaneDispatch({
      env: {
        PROMOBOT_BROWSER_LANE_COMMAND: 'generic-browser-lane',
      },
      spawn,
    });

    dispatch({
      kind: 'session_request',
      artifactPath: 'artifacts/browser-lane-requests/x/-promobot/request-session-job-41.json',
      platform: 'x',
      accountKey: '@promobot',
      requestJobId: 41,
      sessionAction: 'request_session',
    });

    expect(spawn).toHaveBeenCalledWith('generic-browser-lane', {
      cwd: process.cwd(),
      env: expect.objectContaining({
        PROMOBOT_BROWSER_LANE_COMMAND: 'generic-browser-lane',
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_REQUEST_JOB_ID: '41',
        PROMOBOT_BROWSER_SESSION_ACTION: 'request_session',
      }),
      shell: true,
      stdio: 'ignore',
    });
  });

  it('logs and keeps going when the browser lane child fails to start or exits non-zero', () => {
    const logger = {
      warn: vi.fn(),
    };
    const listeners: Partial<Record<'error' | 'close', (...args: unknown[]) => void>> = {};
    const child = {
      once: vi.fn((event: 'error' | 'close', listener: (...args: unknown[]) => void) => {
        listeners[event] = listener;
        return child;
      }),
      unref: vi.fn(),
    };
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('spawn exploded');
      })
      .mockReturnValueOnce(child);
    const dispatch = createBrowserLaneDispatch({
      env: {
        PROMOBOT_BROWSER_INBOX_REPLY_HANDOFF_COMMAND: 'reply-browser-lane',
      },
      logger,
      spawn,
    });

    expect(() =>
      dispatch({
        kind: 'inbox_reply_handoff',
        artifactPath: 'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-1.json',
        platform: 'weibo',
        accountKey: 'main',
        itemId: '1',
      }),
    ).not.toThrow();
    expect(() =>
      dispatch({
        kind: 'inbox_reply_handoff',
        artifactPath: 'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-2.json',
        platform: 'weibo',
        accountKey: 'main',
        itemId: '2',
      }),
    ).not.toThrow();

    listeners.close?.(1, null);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'inbox_reply_handoff failed for artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-1.json: spawn exploded',
      ),
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'inbox_reply_handoff exited with code 1 for artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-2.json',
      ),
    );
  });

  it('logs async child errors and signal exits without throwing', () => {
    const logger = {
      warn: vi.fn(),
    };
    const listeners: Partial<Record<'error' | 'close', (...args: unknown[]) => void>> = {};
    const child = {
      once: vi.fn((event: 'error' | 'close', listener: (...args: unknown[]) => void) => {
        listeners[event] = listener;
        return child;
      }),
      unref: vi.fn(),
    };
    const spawn = vi.fn().mockReturnValue(child);
    const dispatch = createBrowserLaneDispatch({
      env: {
        PROMOBOT_BROWSER_PUBLISH_HANDOFF_COMMAND: 'publish-browser-lane',
      },
      logger,
      spawn,
    });

    expect(() =>
      dispatch({
        kind: 'publish_handoff',
        artifactPath: 'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
        platform: 'instagram',
        accountKey: 'main',
        draftId: '9',
      }),
    ).not.toThrow();

    listeners.error?.(new Error('async boom'));
    listeners.close?.(null, 'SIGTERM');

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'publish_handoff failed for artifacts/browser-handoffs/instagram/main/instagram-draft-9.json: async boom',
      ),
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'publish_handoff exited with signal SIGTERM for artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
      ),
    );
  });
});
