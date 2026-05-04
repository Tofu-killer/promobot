import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createSessionRequestArtifact,
  getSessionRequestResultArtifactByPath,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import {
  SessionAutomationRunnerError,
  runSessionAutomationRequest,
} from '../../src/server/services/browser/sessionAutomationRunner';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

describe('session automation runner', () => {
  it('stages the captured managed session for submit and only promotes the canonical managed path after submit succeeds', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 12,
        platform: 'instagram',
        accountKey: 'main',
        action: 'request_session',
        requestedAt: '2026-05-04T10:00:00.000Z',
        jobId: 51,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/12/session',
      });
      const submitSessionRequestResult = vi.fn().mockResolvedValue({
        ok: true,
        imported: false,
        requestArtifactPath,
        resultArtifactPath:
          'artifacts/browser-lane-requests/instagram/main/request-session-job-51.result.json',
      });
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [{ name: 'sessionid', value: 'abc', domain: '.instagram.com', path: '/' }],
          origins: [],
        },
        validatedAt: '2026-05-04T10:05:00.000Z',
        completedAt: '2026-05-04T10:06:00.000Z',
        notes: 'local browser automation captured a usable session',
      });

      const result = await runSessionAutomationRequest(
        {
          requestArtifactPath,
        },
        {
          now: () => new Date('2026-05-04T10:06:00.000Z'),
          runAutomation,
          submitSessionRequestResult,
        },
      );

      expect(runAutomation).toHaveBeenCalledWith({
        requestArtifactPath,
        platform: 'instagram',
        accountKey: 'main',
        action: 'request_session',
        managedStorageStatePath: 'browser-sessions/managed/instagram/main.json',
        managedStorageStateAbsolutePath: path.join(
          rootDir,
          'browser-sessions/managed/instagram/main.json',
        ),
        initialStorageStateFilePath: null,
        startUrl: 'https://www.instagram.com/',
        headless: false,
        timeoutMs: 900000,
      });
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(rootDir, 'browser-sessions/managed/instagram/main.json'),
            'utf8',
          ),
        ),
      ).toEqual({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.instagram.com', path: '/' }],
        origins: [],
      });
      expect(submitSessionRequestResult).toHaveBeenCalledWith({
        requestArtifactPath,
        storageStateFilePath: expect.any(String),
        sessionStatus: 'active',
        validatedAt: '2026-05-04T10:05:00.000Z',
        completedAt: '2026-05-04T10:06:00.000Z',
        notes: 'local browser automation captured a usable session',
      });
      const submitInput = submitSessionRequestResult.mock.calls[0]?.[0];
      expect(submitInput?.storageStateFilePath).toBeTypeOf('string');
      expect(path.isAbsolute(submitInput?.storageStateFilePath ?? '')).toBe(true);
      expect(path.dirname(submitInput?.storageStateFilePath ?? '')).toBe(
        path.join(rootDir, 'browser-sessions/managed/instagram'),
      );
      expect(submitInput?.storageStateFilePath).not.toBe(
        path.join(rootDir, 'browser-sessions/managed/instagram/main.json'),
      );
      expect(result).toEqual({
        ok: true,
        imported: false,
        requestArtifactPath,
        resultArtifactPath:
          'artifacts/browser-lane-requests/instagram/main/request-session-job-51.result.json',
      });
      expect(
        getSessionRequestResultArtifactByPath(
          'artifacts/browser-lane-requests/instagram/main/request-session-job-51.result.json',
        ),
      ).toBeNull();
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('uses request artifact defaults for relogin requests and forwards existing managed state when present', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 18,
        platform: 'x',
        accountKey: '@promobot',
        action: 'relogin',
        requestedAt: '2026-05-04T12:00:00.000Z',
        jobId: 63,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/18/session',
      });
      const managedStorageStateAbsolutePath = path.join(
        rootDir,
        'browser-sessions/managed/x/-promobot.json',
      );
      fs.mkdirSync(path.dirname(managedStorageStateAbsolutePath), { recursive: true });
      fs.writeFileSync(
        managedStorageStateAbsolutePath,
        JSON.stringify(
          {
            cookies: [{ name: 'auth_token', value: 'existing', domain: '.x.com', path: '/' }],
            origins: [],
          },
          null,
          2,
        ),
      );
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [{ name: 'auth_token', value: 'renewed', domain: '.x.com', path: '/' }],
          origins: [],
        },
      });
      const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

      await runSessionAutomationRequest(
        {
          requestArtifactPath,
        },
        {
          now: () => new Date('2026-05-04T12:10:00.000Z'),
          runAutomation,
          submitSessionRequestResult,
        },
      );

      expect(runAutomation).toHaveBeenCalledWith({
        requestArtifactPath,
        platform: 'x',
        accountKey: '@promobot',
        action: 'relogin',
        managedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        managedStorageStateAbsolutePath,
        initialStorageStateFilePath: managedStorageStateAbsolutePath,
        startUrl: 'https://x.com/',
        headless: false,
        timeoutMs: 900000,
      });
      expect(submitSessionRequestResult).toHaveBeenCalledWith({
        requestArtifactPath,
        storageStateFilePath: expect.any(String),
        sessionStatus: 'active',
        validatedAt: '2026-05-04T12:10:00.000Z',
        completedAt: '2026-05-04T12:10:00.000Z',
        notes: 'browser lane local runner captured a managed browser session',
      });
      const submitInput = submitSessionRequestResult.mock.calls[0]?.[0];
      expect(submitInput?.storageStateFilePath).toBeTypeOf('string');
      expect(path.isAbsolute(submitInput?.storageStateFilePath ?? '')).toBe(true);
      expect(path.dirname(submitInput?.storageStateFilePath ?? '')).toBe(
        path.join(rootDir, 'browser-sessions/managed/x'),
      );
      expect(submitInput?.storageStateFilePath).not.toBe(managedStorageStateAbsolutePath);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails closed when the automation executor does not return a usable authenticated storage state', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 20,
        platform: 'tiktok',
        accountKey: 'main',
        action: 'request_session',
        requestedAt: '2026-05-04T14:00:00.000Z',
        jobId: 71,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/20/session',
      });
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [],
          origins: [],
        },
      });
      const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

      await expect(
        runSessionAutomationRequest(
          {
            requestArtifactPath,
          },
          {
            runAutomation,
            submitSessionRequestResult,
          },
        ),
      ).rejects.toThrow(SessionAutomationRunnerError);
      await expect(
        runSessionAutomationRequest(
          {
            requestArtifactPath,
          },
          {
            runAutomation,
            submitSessionRequestResult,
          },
        ),
      ).rejects.toThrow(
        'browser session automation did not capture a usable authenticated storage state',
      );
      expect(submitSessionRequestResult).not.toHaveBeenCalled();
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('fails closed when automation only captures anonymous cookies instead of an authenticated session', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 22,
        platform: 'instagram',
        accountKey: 'main',
        action: 'request_session',
        requestedAt: '2026-05-04T15:00:00.000Z',
        jobId: 73,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/22/session',
      });
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [{ name: 'csrftoken', value: 'anon', domain: '.instagram.com', path: '/' }],
          origins: [],
        },
      });
      const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

      await expect(
        runSessionAutomationRequest(
          {
            requestArtifactPath,
          },
          {
            runAutomation,
            submitSessionRequestResult,
          },
        ),
      ).rejects.toThrow(
        'browser session automation did not capture a usable authenticated storage state',
      );
      expect(submitSessionRequestResult).not.toHaveBeenCalled();
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('stages the captured storage state before submit even when the managed path override differs from the request artifact default', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 24,
        platform: 'instagram',
        accountKey: 'main',
        action: 'request_session',
        requestedAt: '2026-05-04T16:00:00.000Z',
        jobId: 75,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/24/session',
      });
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [{ name: 'sessionid', value: 'override', domain: '.instagram.com', path: '/' }],
          origins: [],
        },
      });
      const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

      await runSessionAutomationRequest(
        {
          requestArtifactPath,
          managedStorageStatePath: 'tmp/custom-instagram-session.json',
        },
        {
          now: () => new Date('2026-05-04T16:05:00.000Z'),
          runAutomation,
          submitSessionRequestResult,
        },
      );

      expect(runAutomation).toHaveBeenCalledWith({
        requestArtifactPath,
        platform: 'instagram',
        accountKey: 'main',
        action: 'request_session',
        managedStorageStatePath: 'tmp/custom-instagram-session.json',
        managedStorageStateAbsolutePath: path.join(rootDir, 'tmp/custom-instagram-session.json'),
        initialStorageStateFilePath: null,
        startUrl: 'https://www.instagram.com/',
        headless: false,
        timeoutMs: 900000,
      });
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, 'tmp/custom-instagram-session.json'), 'utf8')),
      ).toEqual({
        cookies: [{ name: 'sessionid', value: 'override', domain: '.instagram.com', path: '/' }],
        origins: [],
      });
      expect(submitSessionRequestResult).toHaveBeenCalledWith({
        requestArtifactPath,
        storageStateFilePath: expect.any(String),
        sessionStatus: 'active',
        validatedAt: '2026-05-04T16:05:00.000Z',
        completedAt: '2026-05-04T16:05:00.000Z',
        notes: 'browser lane local runner captured a managed browser session',
      });
      const submitInput = submitSessionRequestResult.mock.calls[0]?.[0];
      expect(submitInput?.storageStateFilePath).toBeTypeOf('string');
      expect(path.isAbsolute(submitInput?.storageStateFilePath ?? '')).toBe(true);
      expect(path.dirname(submitInput?.storageStateFilePath ?? '')).toBe(path.join(rootDir, 'tmp'));
      expect(submitInput?.storageStateFilePath).not.toBe(
        path.join(rootDir, 'tmp/custom-instagram-session.json'),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('keeps the existing managed session untouched when submit fails after automation captured a new session', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 25,
        platform: 'instagram',
        accountKey: 'main',
        action: 'request_session',
        requestedAt: '2026-05-04T16:30:00.000Z',
        jobId: 76,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/25/session',
      });
      const managedStorageStateAbsolutePath = path.join(
        rootDir,
        'browser-sessions/managed/instagram/main.json',
      );
      fs.mkdirSync(path.dirname(managedStorageStateAbsolutePath), { recursive: true });
      fs.writeFileSync(
        managedStorageStateAbsolutePath,
        JSON.stringify(
          {
            cookies: [{ name: 'sessionid', value: 'existing', domain: '.instagram.com', path: '/' }],
            origins: [],
          },
          null,
          2,
        ),
      );
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [{ name: 'sessionid', value: 'renewed', domain: '.instagram.com', path: '/' }],
          origins: [],
        },
      });
      const submitSessionRequestResult = vi
        .fn()
        .mockRejectedValue(new Error('browser lane request artifact already resolved'));

      await expect(
        runSessionAutomationRequest(
          {
            requestArtifactPath,
          },
          {
            now: () => new Date('2026-05-04T16:35:00.000Z'),
            runAutomation,
            submitSessionRequestResult,
          },
        ),
      ).rejects.toThrow('browser lane request artifact already resolved');

      expect(
        JSON.parse(fs.readFileSync(managedStorageStateAbsolutePath, 'utf8')),
      ).toEqual({
        cookies: [{ name: 'sessionid', value: 'existing', domain: '.instagram.com', path: '/' }],
        origins: [],
      });
      expect(fs.readdirSync(path.dirname(managedStorageStateAbsolutePath)).sort()).toEqual([
        'main.json',
      ]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('prefers explicit submit metadata overrides from the local runner over automation defaults', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 26,
        platform: 'x',
        accountKey: '@promobot',
        action: 'relogin',
        requestedAt: '2026-05-04T17:00:00.000Z',
        jobId: 77,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/26/session',
      });
      const runAutomation = vi.fn().mockResolvedValue({
        storageState: {
          cookies: [{ name: 'auth_token', value: 'renewed', domain: '.x.com', path: '/' }],
          origins: [],
        },
        validatedAt: '2026-05-04T17:02:00.000Z',
        completedAt: '2026-05-04T17:03:00.000Z',
        notes: 'automation default note',
      });
      const submitSessionRequestResult = vi.fn().mockResolvedValue({ ok: true });

      await runSessionAutomationRequest(
        {
          requestArtifactPath,
          validatedAt: '2026-05-04T17:10:00.000Z',
          completedAt: '2026-05-04T17:11:00.000Z',
          notes: 'forwarded from local runner env',
        },
        {
          runAutomation,
          submitSessionRequestResult,
        },
      );

      expect(submitSessionRequestResult).toHaveBeenCalledWith({
        requestArtifactPath,
        storageStateFilePath: expect.any(String),
        sessionStatus: 'active',
        validatedAt: '2026-05-04T17:10:00.000Z',
        completedAt: '2026-05-04T17:11:00.000Z',
        notes: 'forwarded from local runner env',
      });
      const submitInput = submitSessionRequestResult.mock.calls[0]?.[0];
      expect(submitInput?.storageStateFilePath).toBeTypeOf('string');
      expect(path.isAbsolute(submitInput?.storageStateFilePath ?? '')).toBe(true);
      expect(path.dirname(submitInput?.storageStateFilePath ?? '')).toBe(
        path.join(rootDir, 'browser-sessions/managed/x'),
      );
      expect(submitInput?.storageStateFilePath).not.toBe(
        path.join(rootDir, 'browser-sessions/managed/x/-promobot.json'),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
