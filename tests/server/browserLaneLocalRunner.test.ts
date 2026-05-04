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

  it('routes session requests through the session automation runner instead of silently reusing the managed storage state', async () => {
    const runSessionAutomation = vi.fn().mockResolvedValue({ ok: true });
    const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-41.json',
        PROMOBOT_BROWSER_PLATFORM: 'x',
        PROMOBOT_BROWSER_ACCOUNT_KEY: '@promobot',
        PROMOBOT_BROWSER_SESSION_ACTION: 'request_session',
        PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID: '7',
        PROMOBOT_BROWSER_REQUEST_JOB_ID: '41',
        PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH:
          'browser-sessions/managed/x/-promobot.json',
      },
      {
        runSessionAutomation,
        submitSessionRequestResult,
      },
    );

    expect(runSessionAutomation).toHaveBeenCalledWith(expect.objectContaining({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/-promobot/request-session-job-41.json',
      managedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
      platform: 'x',
      accountKey: '@promobot',
      action: 'request_session',
      channelAccountId: 7,
      requestJobId: 41,
    }));
    expect(submitSessionRequestResult).not.toHaveBeenCalled();
  });

  it('passes explicit session automation overrides through to the session automation runner', async () => {
    const runSessionAutomation = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/instagram/main/relogin-job-42.json',
        PROMOBOT_BROWSER_PLATFORM: 'instagram',
        PROMOBOT_BROWSER_ACCOUNT_KEY: 'main',
        PROMOBOT_BROWSER_SESSION_ACTION: 'relogin',
        PROMOBOT_BROWSER_CHANNEL_ACCOUNT_ID: '9',
        PROMOBOT_BROWSER_REQUEST_JOB_ID: '42',
        PROMOBOT_BROWSER_MANAGED_STORAGE_STATE_PATH:
          'browser-sessions/managed/instagram/main.json',
        PROMOBOT_BROWSER_SESSION_START_URL: 'https://www.instagram.com/accounts/login/',
        PROMOBOT_BROWSER_SESSION_HEADLESS: 'true',
        PROMOBOT_BROWSER_SESSION_TIMEOUT_MS: '120000',
        PROMOBOT_BROWSER_LAUNCH_CHANNEL: 'chrome',
        PROMOBOT_BROWSER_EXECUTABLE_PATH:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      },
      {
        runSessionAutomation,
      },
    );

    expect(runSessionAutomation).toHaveBeenCalledWith(expect.objectContaining({
      requestArtifactPath:
        'artifacts/browser-lane-requests/instagram/main/relogin-job-42.json',
      managedStorageStatePath: 'browser-sessions/managed/instagram/main.json',
      platform: 'instagram',
      accountKey: 'main',
      action: 'relogin',
      channelAccountId: 9,
      requestJobId: 42,
      startUrl: 'https://www.instagram.com/accounts/login/',
      headless: true,
      timeoutMs: 120000,
      browserChannel: 'chrome',
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    }));
  });

  it('forwards session request submit metadata overrides to the session automation runner', async () => {
    const runSessionAutomation = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/relogin-job-44.json',
        PROMOBOT_BROWSER_COMPLETED_AT: '2026-05-04T18:00:00.000Z',
        PROMOBOT_BROWSER_VALIDATED_AT: '2026-05-04T18:01:00.000Z',
        PROMOBOT_BROWSER_NOTES: 'manual completion metadata from runner env',
      },
      {
        runSessionAutomation,
      },
    );

    expect(runSessionAutomation).toHaveBeenCalledWith(expect.objectContaining({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/-promobot/relogin-job-44.json',
      completedAt: '2026-05-04T18:00:00.000Z',
      validatedAt: '2026-05-04T18:01:00.000Z',
      notes: 'manual completion metadata from runner env',
    }));
  });

  it('does not inject a synthetic completedAt before session automation finishes', async () => {
    const runSessionAutomation = vi.fn().mockResolvedValue({ ok: true });

    await runBrowserLaneLocalRunner(
      {
        PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
        PROMOBOT_BROWSER_ARTIFACT_PATH:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-45.json',
      },
      {
        now: () => new Date('2026-05-04T18:30:00.000Z'),
        runSessionAutomation,
      },
    );

    expect(runSessionAutomation).toHaveBeenCalledWith(
      expect.not.objectContaining({
        completedAt: '2026-05-04T18:30:00.000Z',
      }),
    );
    expect(runSessionAutomation).toHaveBeenCalledWith(expect.not.objectContaining({
      completedAt: expect.any(String),
    }));
  });

  it('fails closed when session automation fails instead of submitting a reused managed session result', async () => {
    const runSessionAutomation = vi
      .fn()
      .mockRejectedValue(new Error('Playwright is not installed for local browser session automation'));
    const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      runBrowserLaneLocalRunner(
        {
          PROMOBOT_BROWSER_DISPATCH_KIND: 'session_request',
          PROMOBOT_BROWSER_ARTIFACT_PATH:
            'artifacts/browser-lane-requests/x/-promobot/request-session-job-43.json',
          PROMOBOT_BROWSER_PLATFORM: 'x',
          PROMOBOT_BROWSER_ACCOUNT_KEY: '@promobot',
          PROMOBOT_BROWSER_SESSION_ACTION: 'request_session',
        },
        {
          runSessionAutomation,
          submitSessionRequestResult,
        },
      ),
    ).rejects.toThrow('Playwright is not installed for local browser session automation');

    expect(submitSessionRequestResult).not.toHaveBeenCalled();
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
    expect(helpText).toContain('session_request');
    expect(helpText).toContain('PROMOBOT_BROWSER_SESSION_START_URL');
    expect(helpText).toContain('PROMOBOT_BROWSER_SESSION_TIMEOUT_MS');
    expect(helpText).toContain('PROMOBOT_BROWSER_SESSION_HEADLESS');
    expect(helpText).toContain('applied first to initial page navigation, then again to post-navigation login polling');
    expect(helpText).toContain('PROMOBOT_BROWSER_VALIDATED_AT');
    expect(helpText).toContain('PROMOBOT_BROWSER_NOTES');
    expect(helpText).toContain('PROMOBOT_BROWSER_COMPLETED_AT');
    expect(helpText).toContain('PROMOBOT_BROWSER_PUBLISH_STATUS');
    expect(helpText).toContain('PROMOBOT_BROWSER_REPLY_STATUS');
    expect(helpText).toContain('only after local autorun is enabled and no kind-specific or generic browser lane command is configured');
    expect(helpText).toContain('custom wrappers must enforce any publish/reply gating they need');
  });
});
