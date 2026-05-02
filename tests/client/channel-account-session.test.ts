import { describe, expect, it } from 'vitest';

import {
  getUnresolvedRequestedSessionArtifact,
  resolveCurrentSessionAction,
  type SessionActionAccountLike,
} from '../../src/client/lib/channelAccountSession';

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

describe('channelAccountSession helpers', () => {
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
