import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getBrowserLaneSubmitHelpText,
  parseBrowserLaneSubmitArgs,
} from '../../src/server/cli/browserLaneSubmit';
import {
  createSessionRequestArtifact,
  getSessionRequestArtifactByPath,
  getSessionRequestResultArtifactByPath,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import {
  SessionRequestResultSubmitError,
  submitSessionRequestResult,
} from '../../src/server/services/browser/sessionResultSubmitter';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser lane session result submitter', () => {
  it('writes a browser lane result artifact and optionally imports it through the api', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 7,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-23T14:00:00.000Z',
        jobId: 19,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/7/session',
      });
      const storageStateFilePath = path.join(rootDir, 'lane-storage-state.json');
      fs.writeFileSync(
        storageStateFilePath,
        JSON.stringify(
          {
            cookies: [{ name: 'sid', value: 'abc', domain: '.x.com', path: '/' }],
            origins: [],
          },
          null,
          2,
        ),
      );

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          imported: true,
          artifactPath:
            'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.result.json',
        }),
      });

      const result = await submitSessionRequestResult(
        {
          requestArtifactPath,
          storageStateFilePath,
          sessionStatus: 'active',
          validatedAt: '2026-04-23T14:01:00.000Z',
          notes: 'browser lane cli',
          completedAt: '2026-04-23T14:00:30.000Z',
          importBaseUrl: 'http://127.0.0.1:3001/',
          adminPassword: 'secret',
        },
        {
          fetchImpl: fetchMock as typeof fetch,
        },
      );

      expect(result).toEqual({
        ok: true,
        imported: true,
        requestArtifactPath,
        resultArtifactPath:
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.result.json',
        importResult: {
          ok: true,
          imported: true,
          artifactPath:
            'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.result.json',
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3001/api/system/browser-lane-requests/import',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': 'secret',
          },
          body: JSON.stringify({
            artifactPath:
              'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.result.json',
          }),
        }),
      );
      expect(getSessionRequestArtifactByPath(requestArtifactPath)).toEqual(
        expect.objectContaining({
          channelAccountId: 7,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          jobId: 19,
          resolvedAt: null,
        }),
      );
      expect(
        getSessionRequestResultArtifactByPath(
          'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.result.json',
        ),
      ).toEqual(
        expect.objectContaining({
          channelAccountId: 7,
          platform: 'x',
          accountKey: '@promobot',
          action: 'request_session',
          requestJobId: 19,
          completedAt: '2026-04-23T14:00:30.000Z',
          sessionStatus: 'active',
          validatedAt: '2026-04-23T14:01:00.000Z',
          notes: 'browser lane cli',
          consumedAt: null,
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('writes a browser lane result artifact without importing when api credentials are omitted', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const requestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 8,
        platform: 'reddit',
        accountKey: 'acct-reddit',
        action: 'relogin',
        requestedAt: '2026-04-23T15:00:00.000Z',
        jobId: 21,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/8/session',
      });
      const storageStateFilePath = path.join(rootDir, 'reddit-storage-state.json');
      fs.writeFileSync(
        storageStateFilePath,
        JSON.stringify({ cookies: [], origins: [] }, null, 2),
      );

      const result = await submitSessionRequestResult({
        requestArtifactPath,
        storageStateFilePath,
        sessionStatus: 'expired',
        notes: 'manual relogin pending import',
        completedAt: '2026-04-23T15:05:00.000Z',
      });

      expect(result).toEqual({
        ok: true,
        imported: false,
        requestArtifactPath,
        resultArtifactPath:
          'artifacts/browser-lane-requests/reddit/acct-reddit/relogin-job-21.result.json',
      });
      expect(
        getSessionRequestResultArtifactByPath(
          'artifacts/browser-lane-requests/reddit/acct-reddit/relogin-job-21.result.json',
        ),
      ).toEqual(
        expect.objectContaining({
          channelAccountId: 8,
          platform: 'reddit',
          accountKey: 'acct-reddit',
          action: 'relogin',
          requestJobId: 21,
          sessionStatus: 'expired',
          notes: 'manual relogin pending import',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rejects resolved request artifacts and invalid storage state files', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const resolvedRequestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 9,
        platform: 'x',
        accountKey: '@resolved',
        action: 'request_session',
        requestedAt: '2026-04-23T16:00:00.000Z',
        jobId: 31,
        jobStatus: 'resolved',
        nextStep: '/api/channel-accounts/9/session',
      });
      const resolvedArtifactAbsolutePath = path.join(rootDir, resolvedRequestArtifactPath);
      fs.writeFileSync(
        resolvedArtifactAbsolutePath,
        JSON.stringify(
          {
            ...JSON.parse(fs.readFileSync(resolvedArtifactAbsolutePath, 'utf8')),
            resolvedAt: '2026-04-23T16:01:00.000Z',
            resolution: { status: 'resolved' },
          },
          null,
          2,
        ),
      );

      const storageStateFilePath = path.join(rootDir, 'invalid-storage-state.json');
      fs.writeFileSync(storageStateFilePath, '["not-an-object"]');

      await expect(
        submitSessionRequestResult({
          requestArtifactPath: resolvedRequestArtifactPath,
          storageStateFilePath,
        }),
      ).rejects.toMatchObject<Partial<SessionRequestResultSubmitError>>({
        message: 'browser lane request artifact already resolved',
        statusCode: 409,
      });

      const pendingRequestArtifactPath = createSessionRequestArtifact({
        channelAccountId: 10,
        platform: 'x',
        accountKey: '@invalid',
        action: 'request_session',
        requestedAt: '2026-04-23T17:00:00.000Z',
        jobId: 32,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/10/session',
      });

      await expect(
        submitSessionRequestResult({
          requestArtifactPath: pendingRequestArtifactPath,
          storageStateFilePath,
        }),
      ).rejects.toMatchObject<Partial<SessionRequestResultSubmitError>>({
        message: 'storage state file must contain a JSON object',
        statusCode: 400,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('parses the browser lane submit cli arguments', () => {
    expect(
      parseBrowserLaneSubmitArgs([
        '--request-artifact',
        'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.json',
        '--storage-state-file',
        '/tmp/storage.json',
        '--status',
        'active',
        '--validated-at',
        '2026-04-23T14:01:00.000Z',
        '--notes',
        'browser lane cli',
        '--completed-at',
        '2026-04-23T14:00:30.000Z',
        '--base-url',
        'http://127.0.0.1:3001',
        '--admin-password',
        'secret',
      ]),
    ).toEqual({
      requestArtifactPath:
        'artifacts/browser-lane-requests/x/-promobot/request-session-job-19.json',
      storageStateFilePath: '/tmp/storage.json',
      sessionStatus: 'active',
      validatedAt: '2026-04-23T14:01:00.000Z',
      notes: 'browser lane cli',
      completedAt: '2026-04-23T14:00:30.000Z',
      importBaseUrl: 'http://127.0.0.1:3001',
      adminPassword: 'secret',
    });
    expect(getBrowserLaneSubmitHelpText()).toContain('--request-artifact <path>');
  });
});
