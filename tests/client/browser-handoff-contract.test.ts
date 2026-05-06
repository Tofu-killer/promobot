import { describe, expect, it } from 'vitest';

import {
  findPendingBrowserHandoff,
  getBrowserHandoffIdentity,
  readBrowserHandoffContract,
  toBrowserHandoffContract,
} from '../../src/client/lib/browserHandoffContract';
import type { BrowserHandoffRecord } from '../../src/client/lib/systemHandoffs';

describe('browser handoff contract helpers', () => {
  it('reads browser handoff contract details from mixed legacy shapes', () => {
    expect(
      readBrowserHandoffContract({
        browserHandoff: {
          platform: 'instagram',
          accountKey: 'instagram:launch',
          channelAccountId: 19,
          handoffAttempt: 2,
          readiness: 'blocked',
          artifact: {
            relativePath: 'artifacts/browser-handoffs/instagram/launch/draft-19-v2.json',
          },
          sessionAction: {
            type: 'relogin',
          },
        },
      }),
    ).toEqual({
      platform: 'instagram',
      accountKey: 'instagram:launch',
      channelAccountId: 19,
      handoffAttempt: 2,
      readiness: 'blocked',
      sessionAction: 'relogin',
      artifactPath: 'artifacts/browser-handoffs/instagram/launch/draft-19-v2.json',
    });
  });

  it('creates stable browser handoff identities from artifactPath or fallback fields', () => {
    expect(
      getBrowserHandoffIdentity({
        platform: 'instagram',
        accountKey: 'instagram:launch',
        channelAccountId: 19,
        handoffAttempt: 3,
        readiness: 'ready',
        sessionAction: 'request_session',
        artifactPath: 'artifacts/browser-handoffs/instagram/launch/draft-19-v3.json',
      }),
    ).toBe('artifacts/browser-handoffs/instagram/launch/draft-19-v3.json#3');

    expect(
      getBrowserHandoffIdentity({
        platform: 'instagram',
        accountKey: 'instagram:launch',
        channelAccountId: 19,
        handoffAttempt: 3,
        readiness: 'blocked',
        sessionAction: 'relogin',
        artifactPath: null,
      }),
    ).toBe('instagram|instagram:launch|19|relogin|3');
  });

  it('finds pending browser handoffs by normalized draft id and preserves readiness defaults', () => {
    const handoffs: BrowserHandoffRecord[] = [
      {
        platform: 'instagram',
        channelAccountId: 19,
        draftId: '42',
        handoffAttempt: 1,
        title: 'Launch reel',
        accountKey: 'instagram:launch',
        status: 'pending',
        artifactPath: 'artifacts/browser-handoffs/instagram/launch/draft-42-v1.json',
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:00:00.000Z',
        resolvedAt: null,
      },
      {
        platform: 'instagram',
        channelAccountId: 19,
        draftId: 43,
        handoffAttempt: 1,
        title: 'Published reel',
        accountKey: 'instagram:launch',
        status: 'resolved',
        artifactPath: 'artifacts/browser-handoffs/instagram/launch/draft-43-v1.json',
        createdAt: '2026-04-29T00:01:00.000Z',
        updatedAt: '2026-04-29T00:02:00.000Z',
        resolvedAt: '2026-04-29T00:03:00.000Z',
      },
    ];

    const pending = findPendingBrowserHandoff(handoffs, 42);

    expect(pending).toEqual(handoffs[0]);
    expect(toBrowserHandoffContract(handoffs[0])).toEqual({
      platform: 'instagram',
      accountKey: 'instagram:launch',
      channelAccountId: 19,
      handoffAttempt: 1,
      readiness: 'ready',
      sessionAction: null,
      artifactPath: 'artifacts/browser-handoffs/instagram/launch/draft-42-v1.json',
    });
  });
});
