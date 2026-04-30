import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  BrowserLaneBridgeError,
  getBrowserLaneBridgeHelpText,
  parseBrowserLaneBridgeEnv,
  runBrowserLaneBridge,
} from '../../src/server/cli/browserLaneBridge';

describe('browser lane bridge cli', () => {
  it('exposes a package script for the unified bridge entrypoint', () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      'browser:lane:bridge': 'tsx src/server/cli/browserLaneBridge.ts',
    });
  });

  it('parses session request env into a session result submit input', () => {
    expect(
      parseBrowserLaneBridgeEnv({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.json',
        PROMOBOT_BROWSER_STORAGE_STATE_FILE: '/tmp/storage-state.json',
        PROMOBOT_BROWSER_SESSION_STATUS: 'expired',
        PROMOBOT_BROWSER_VALIDATED_AT: '2026-04-30T12:00:00.000Z',
        PROMOBOT_BROWSER_NOTES: 'bridge import',
        PROMOBOT_BROWSER_COMPLETED_AT: '2026-04-30T11:59:00.000Z',
        PROMOBOT_BROWSER_IMPORT_BASE_URL: 'http://127.0.0.1:3001',
        PROMOBOT_BROWSER_ADMIN_PASSWORD: 'secret',
      }),
    ).toEqual({
      kind: 'session_request',
      input: {
        requestArtifactPath:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.json',
        storageStateFilePath: '/tmp/storage-state.json',
        sessionStatus: 'expired',
        validatedAt: '2026-04-30T12:00:00.000Z',
        notes: 'bridge import',
        completedAt: '2026-04-30T11:59:00.000Z',
        importBaseUrl: 'http://127.0.0.1:3001',
        adminPassword: 'secret',
      },
    });
  });

  it('falls back to the dispatched managed storage path for session request imports', () => {
    expect(
      parseBrowserLaneBridgeEnv({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-20.json',
        PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH:
          'browser-sessions/managed/x/-promobot.json',
        PROMOBOT_BROWSER_SESSION_STATUS: 'active',
      }),
    ).toEqual({
      kind: 'session_request',
      input: {
        requestArtifactPath:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-20.json',
        storageStateFilePath: 'browser-sessions/managed/x/-promobot.json',
        sessionStatus: 'active',
      },
    });
  });

  it('parses publish handoff env into a publish completion input', () => {
    expect(
      parseBrowserLaneBridgeEnv({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'publish_handoff',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
        PROMOBOT_BROWSER_QUEUE_RESULT: 'true',
        PROMOBOT_BROWSER_MESSAGE: 'published by bridge',
        PROMOBOT_BROWSER_PUBLISH_URL: 'https://instagram.test/p/9',
        PROMOBOT_BROWSER_EXTERNAL_ID: 'ig-9',
        PROMOBOT_BROWSER_PUBLISHED_AT: '2026-04-30T12:05:00.000Z',
      }),
    ).toEqual({
      kind: 'publish_handoff',
      input: {
        artifactPath: 'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
        publishStatus: 'published',
        queueResult: true,
        message: 'published by bridge',
        publishUrl: 'https://instagram.test/p/9',
        externalId: 'ig-9',
        publishedAt: '2026-04-30T12:05:00.000Z',
      },
    });
  });

  it('routes each dispatch kind to the matching submitter', async () => {
    const scenarios = [
      {
        env: {
          PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
          PROMOBOT_BROWSER_ARTIFACT_PATH:
            'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.json',
          PROMOBOT_BROWSER_STORAGE_STATE_FILE: '/tmp/storage-state.json',
          PROMOBOT_BROWSER_SESSION_STATUS: 'active',
        },
        expectedResult: { ok: true, kind: 'session_request' },
        expectedCalls: {
          session: {
            requestArtifactPath:
              'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.json',
            storageStateFilePath: '/tmp/storage-state.json',
            sessionStatus: 'active',
          },
          publish: 0,
          reply: 0,
        },
      },
      {
        env: {
          PROMOBOT_BROWSER_DISPATCH_KIND: 'publish_handoff',
          PROMOBOT_BROWSER_ARTIFACT_PATH:
            'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
          PROMOBOT_BROWSER_PUBLISH_STATUS: 'failed',
          PROMOBOT_BROWSER_MESSAGE: 'publish failed',
        },
        expectedResult: { ok: true, kind: 'publish_handoff' },
        expectedCalls: {
          session: 0,
          publish: {
            artifactPath: 'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
            publishStatus: 'failed',
            message: 'publish failed',
          },
          reply: 0,
        },
      },
      {
        env: {
          PROMOBOT_BROWSER_DISPATCH_KIND: 'inbox_reply_handoff',
          PROMOBOT_BROWSER_ARTIFACT_PATH:
            'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-7.json',
          PROMOBOT_BROWSER_REPLY_STATUS: 'failed',
          PROMOBOT_BROWSER_MESSAGE: 'lane failed',
          PROMOBOT_BROWSER_DELIVERY_URL: 'https://weibo.test/reply/7',
          PROMOBOT_BROWSER_EXTERNAL_ID: 'reply-7',
          PROMOBOT_BROWSER_DELIVERED_AT: '2026-04-30T12:10:00.000Z',
          PROMOBOT_BROWSER_QUEUE_RESULT: '1',
        },
        expectedResult: { ok: true, kind: 'inbox_reply_handoff' },
        expectedCalls: {
          session: 0,
          publish: 0,
          reply: {
            artifactPath: 'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-7.json',
            replyStatus: 'failed',
            message: 'lane failed',
            deliveryUrl: 'https://weibo.test/reply/7',
            externalId: 'reply-7',
            deliveredAt: '2026-04-30T12:10:00.000Z',
            queueResult: true,
          },
        },
      },
    ] as const;

    for (const scenario of scenarios) {
      const sessionSubmit = vi.fn().mockResolvedValue({ ok: true, kind: 'session_request' });
      const publishSubmit = vi.fn().mockResolvedValue({ ok: true, kind: 'publish_handoff' });
      const replySubmit = vi.fn().mockResolvedValue({ ok: true, kind: 'inbox_reply_handoff' });

      const result = await runBrowserLaneBridge(scenario.env, {
        submitSessionRequestResult: sessionSubmit,
        submitBrowserHandoffCompletion: publishSubmit,
        submitInboxReplyHandoffCompletion: replySubmit,
      });

      expect(result).toEqual(scenario.expectedResult);
      if (scenario.expectedCalls.session === 0) {
        expect(sessionSubmit).not.toHaveBeenCalled();
      } else {
        expect(sessionSubmit).toHaveBeenCalledWith(scenario.expectedCalls.session);
      }
      if (scenario.expectedCalls.publish === 0) {
        expect(publishSubmit).not.toHaveBeenCalled();
      } else {
        expect(publishSubmit).toHaveBeenCalledWith(scenario.expectedCalls.publish);
      }
      if (scenario.expectedCalls.reply === 0) {
        expect(replySubmit).not.toHaveBeenCalled();
      } else {
        expect(replySubmit).toHaveBeenCalledWith(scenario.expectedCalls.reply);
      }
    }
  });

  it('rejects unsupported kinds and missing required env', () => {
    expect(() =>
      parseBrowserLaneBridgeEnv({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'publish_handoff',
      }),
    ).toThrowError(
      new BrowserLaneBridgeError(
        'PROMOBOT_BROWSER_ARTIFACT_PATH is required for publish_handoff dispatches',
      ),
    );

    expect(() =>
      parseBrowserLaneBridgeEnv({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'wat',
        PROMOBOT_BROWSER_ARTIFACT_PATH: 'artifacts/unknown.json',
      }),
    ).toThrowError(
      new BrowserLaneBridgeError(
        'PROMOBOT_BROWSER_DISPATCH_KIND must be one of session_request, publish_handoff, inbox_reply_handoff',
      ),
    );

    expect(() =>
      parseBrowserLaneBridgeEnv({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-33.json',
      }),
    ).toThrowError(
      new BrowserLaneBridgeError(
        'PROMOBOT_BROWSER_STORAGE_STATE_FILE or PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH is required for session_request dispatches',
      ),
    );
  });

  it('documents the bridge env contract in help text', () => {
    expect(getBrowserLaneBridgeHelpText()).toContain('pnpm browser:lane:bridge');
    expect(getBrowserLaneBridgeHelpText()).toContain('PROMOBOT_BROWSER_DISPATCH_KIND');
    expect(getBrowserLaneBridgeHelpText()).toContain('PROMOBOT_BROWSER_STORAGE_STATE_FILE');
    expect(getBrowserLaneBridgeHelpText()).toContain(
      'PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH',
    );
    expect(getBrowserLaneBridgeHelpText()).toContain('PROMOBOT_BROWSER_PUBLISH_STATUS');
    expect(getBrowserLaneBridgeHelpText()).toContain('PROMOBOT_BROWSER_REPLY_STATUS');
  });
});
