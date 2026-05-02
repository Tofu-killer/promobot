import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  getBrowserLaneLocalRunnerHelpText,
  parseBrowserLaneLocalRunnerArgs,
  runBrowserLaneLocalRunner,
} from '../../src/server/cli/browserLaneLocalRunner';

describe('browser lane local runner cli', () => {
  it('exposes a package script for the local runner entrypoint', () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      'browser:lane:local': 'tsx src/server/cli/browserLaneLocalRunner.ts',
    });
  });

  it('parses help flags', () => {
    expect(parseBrowserLaneLocalRunnerArgs(['--help'])).toEqual({ showHelp: true });
    expect(parseBrowserLaneLocalRunnerArgs(['-h'])).toEqual({ showHelp: true });
    expect(parseBrowserLaneLocalRunnerArgs([])).toEqual({ showHelp: false });
  });

  it('defaults session requests to the managed storage state path and active session reuse metadata', async () => {
    const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-41.json',
        PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH:
          'browser-sessions/managed/x/-promobot.json',
      },
      {
        now: () => new Date('2026-04-30T13:00:00.000Z'),
        submitSessionRequestResult,
      },
    );

    expect(submitSessionRequestResult).toHaveBeenCalledWith({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/-promobot/request-session-job-41.json',
      storageStateFilePath: 'browser-sessions/managed/x/-promobot.json',
      sessionStatus: 'active',
      validatedAt: '2026-04-30T13:00:00.000Z',
      completedAt: '2026-04-30T13:00:00.000Z',
      notes: 'browser lane local runner reused the managed storage state',
    });
  });

  it('preserves explicit session request overrides', async () => {
    const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-42.json',
        PROMOBOT_BROWSER_STORAGE_STATE_FILE: '/tmp/custom-storage-state.json',
        PROMOBOT_BROWSER_SESSION_STATUS: 'expired',
        PROMOBOT_BROWSER_VALIDATED_AT: '2026-04-30T12:00:00.000Z',
        PROMOBOT_BROWSER_COMPLETED_AT: '2026-04-30T12:05:00.000Z',
        PROMOBOT_BROWSER_NOTES: 'custom local runner note',
      },
      {
        now: () => new Date('2026-04-30T13:00:00.000Z'),
        submitSessionRequestResult,
      },
    );

    expect(submitSessionRequestResult).toHaveBeenCalledWith({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/-promobot/request-session-job-42.json',
      storageStateFilePath: '/tmp/custom-storage-state.json',
      sessionStatus: 'expired',
      validatedAt: '2026-04-30T12:00:00.000Z',
      completedAt: '2026-04-30T12:05:00.000Z',
      notes: 'custom local runner note',
    });
  });

  it('requires an explicit publish handoff status and fills the remaining local runner defaults around it', async () => {
    const submitBrowserHandoffCompletion = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'publish_handoff',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
        PROMOBOT_BROWSER_HANDOFF_ATTEMPT: '1',
        PROMOBOT_BROWSER_PUBLISH_STATUS: 'published',
      },
      {
        now: () => new Date('2026-04-30T13:05:00.000Z'),
        submitBrowserHandoffCompletion,
      },
    );

    expect(submitBrowserHandoffCompletion).toHaveBeenCalledWith({
      artifactPath: 'artifacts/browser-handoffs/instagram/main/instagram-draft-9.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      message: 'browser handoff completed by the local runner',
      publishedAt: '2026-04-30T13:05:00.000Z',
    });
  });

  it('requires an explicit inbox reply status and fills the remaining local runner defaults around it', async () => {
    const submitInboxReplyHandoffCompletion = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'inbox_reply_handoff',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-8.json',
        PROMOBOT_BROWSER_HANDOFF_ATTEMPT: '1',
        PROMOBOT_BROWSER_REPLY_STATUS: 'sent',
      },
      {
        now: () => new Date('2026-04-30T13:10:00.000Z'),
        submitInboxReplyHandoffCompletion,
      },
    );

    expect(submitInboxReplyHandoffCompletion).toHaveBeenCalledWith({
      artifactPath: 'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-8.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      message: 'inbox reply handoff completed by the local runner',
      deliveredAt: '2026-04-30T13:10:00.000Z',
    });
  });

  it('fails closed for publish and reply handoffs when no explicit status env is present', async () => {
    await expect(
      runBrowserLaneLocalRunner({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'publish_handoff',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-handoffs/instagram/main/instagram-draft-10.json',
        PROMOBOT_BROWSER_HANDOFF_ATTEMPT: '1',
      }),
    ).rejects.toThrow(
      'PROMOBOT_BROWSER_PUBLISH_STATUS is required for publish_handoff dispatches',
    );

    await expect(
      runBrowserLaneLocalRunner({
        PROMOBOT_BROWSER_DISPATCH_KIND: 'inbox_reply_handoff',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/inbox-reply-handoffs/weibo/main/weibo-inbox-item-9.json',
        PROMOBOT_BROWSER_HANDOFF_ATTEMPT: '1',
      }),
    ).rejects.toThrow(
      'PROMOBOT_BROWSER_REPLY_STATUS is required for inbox_reply_handoff dispatches',
    );
  });

  it('documents the local autorun contract and default completion behavior', () => {
    const helpText = getBrowserLaneLocalRunnerHelpText();

    expect(helpText).toContain('pnpm browser:lane:local');
    expect(helpText).toContain('PROMOBOT_BROWSER_LOCAL_AUTORUN');
    expect(helpText).toContain('PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH');
    expect(helpText).toContain('PROMOBOT_BROWSER_PUBLISH_STATUS');
    expect(helpText).toContain('PROMOBOT_BROWSER_REPLY_STATUS');
    expect(helpText).toContain('session_request');
  });
});
