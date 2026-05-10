import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getUnresolvedRequestedSessionArtifact,
  requestChannelAccountSessionAction,
  resolveCurrentSessionAction,
  type SessionActionAccountLike,
} from '../../src/client/lib/channelAccountSession';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function buildAccount(overrides: Partial<SessionActionAccountLike> = {}): SessionActionAccountLike {
  return {
    authType: 'browser',
    metadata: {},
    publishReadiness: {
      mode: 'browser',
      status: 'needs_session',
      action: 'request_session',
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('channelAccountSession helpers', () => {
  it('posts session request actions through the shared client helper', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          sessionAction: {
            action: 'request_session',
            message: 'queued request_session',
            artifactPath: 'artifacts/browser-lane-requests/x/acct-main/request-session-job-9.json',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sessionAction: {
            action: 'relogin',
            message: 'queued relogin',
            artifactPath: 'artifacts/browser-lane-requests/x/acct-main/relogin-job-10.json',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const requestSessionResult = await requestChannelAccountSessionAction(3);
    const reloginResult = await requestChannelAccountSessionAction(3, { action: 'relogin' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/channel-accounts/3/session/request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/channel-accounts/3/session/request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'relogin' }),
      }),
    );
    expect(requestSessionResult.sessionAction.action).toBe('request_session');
    expect(reloginResult.sessionAction.action).toBe('relogin');
  });

  it('prefers the unresolved requested-action artifact over a newer different-action latest artifact', () => {
    const account = buildAccount({
      latestBrowserLaneArtifact: {
        action: 'relogin',
        jobStatus: 'pending',
        requestedAt: '2026-04-19T05:00:00.000Z',
        artifactPath: 'artifacts/browser-lane-requests/instagram/acct-instagram/relogin-job-27.json',
        resolvedAt: null,
      },
      activeSessionActionArtifacts: {
        request_session: {
          action: 'request_session',
          jobStatus: 'pending',
          requestedAt: '2026-04-19T03:10:00.000Z',
          artifactPath:
            'artifacts/browser-lane-requests/instagram/acct-instagram/request-session-job-19.json',
          resolvedAt: null,
        },
      },
    });

    expect(getUnresolvedRequestedSessionArtifact(account)?.artifactPath).toBe(
      'artifacts/browser-lane-requests/instagram/acct-instagram/request-session-job-19.json',
    );
    expect(resolveCurrentSessionAction(null, account)).toBe('request_session');
  });

  it('falls back to the latest unresolved artifact when the requested action has no active artifact', () => {
    const account = buildAccount({
      latestBrowserLaneArtifact: {
        action: 'relogin',
        jobStatus: 'pending',
        requestedAt: '2026-04-19T05:00:00.000Z',
        artifactPath: 'artifacts/browser-lane-requests/instagram/acct-instagram/relogin-job-27.json',
        resolvedAt: null,
      },
    });

    expect(getUnresolvedRequestedSessionArtifact(account)).toBeUndefined();
    expect(resolveCurrentSessionAction(null, account)).toBe('relogin');
  });

  it('keeps explicit local feedback as the highest-precedence current action signal', () => {
    const account = buildAccount({
      latestBrowserLaneArtifact: {
        action: 'request_session',
        jobStatus: 'pending',
        requestedAt: '2026-04-19T03:10:00.000Z',
        artifactPath:
          'artifacts/browser-lane-requests/instagram/acct-instagram/request-session-job-19.json',
        resolvedAt: null,
      },
    });

    expect(resolveCurrentSessionAction({ action: 'relogin' }, account)).toBe('relogin');
  });
});
