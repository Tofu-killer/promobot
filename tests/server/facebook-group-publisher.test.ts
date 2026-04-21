import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionMetadata } from '../../src/server/services/browser/sessionStore';
import * as sessionStoreModule from '../../src/server/services/browser/sessionStore';
import { publishToFacebookGroup } from '../../src/server/services/publishers/facebookGroup';

function mockSession(session: SessionMetadata | null) {
  const getSession = vi.fn().mockReturnValue(session);
  const createSessionStore = vi
    .spyOn(sessionStoreModule, 'createSessionStore')
    .mockReturnValue({ getSession } as unknown as sessionStoreModule.SessionStore);

  return { createSessionStore, getSession };
}

describe('publishToFacebookGroup', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(path.join(tmpdir(), 'promobot-browser-handoff-'));
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = outputDir;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));
  });

  afterEach(() => {
    delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(outputDir, { force: true, recursive: true });
  });

  it('returns a blocked browser handoff when no saved session exists', async () => {
    const sessionStore = mockSession(null);

    const result = await publishToFacebookGroup({
      draftId: 12,
      content: 'Needs browser handoff',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.createSessionStore).toHaveBeenCalledTimes(1);
    expect(sessionStore.getSession).toHaveBeenCalledWith('facebookGroup', 'launch-campaign');
    expect(result).toEqual({
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'facebookGroup draft 12 requires a saved browser session before manual handoff.',
      publishedAt: null,
      details: {
        target: 'group-123',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'blocked',
          session: {
            hasSession: false,
            status: 'missing',
            validatedAt: null,
            storageStatePath: null,
          },
          sessionAction: 'request_session',
        },
      },
    });
  });

  it('returns a ready browser handoff when an active session exists', async () => {
    const sessionStore = mockSession({
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      status: 'active',
      notes: 'manual login completed',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    const result = await publishToFacebookGroup({
      draftId: 18,
      content: 'Ready for browser handoff',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.getSession).toHaveBeenCalledWith('facebookGroup', 'launch-campaign');
    const artifactPath = path.join(
      outputDir,
      'artifacts',
      'browser-handoffs',
      'facebookGroup',
      'launch-campaign',
      'facebookGroup-draft-18.json',
    );
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual({
      type: 'browser_manual_handoff',
      status: 'pending',
      platform: 'facebookGroup',
      draftId: '18',
      title: null,
      content: 'Ready for browser handoff',
      target: 'group-123',
      accountKey: 'launch-campaign',
      session: {
        hasSession: true,
        id: 'facebookGroup:launch-campaign',
        status: 'active',
        validatedAt: '2026-04-19T10:25:00.000Z',
        storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
        notes: 'manual login completed',
      },
      createdAt: '2026-04-21T12:00:00.000Z',
      updatedAt: '2026-04-21T12:00:00.000Z',
      resolvedAt: null,
      resolution: null,
    });
    expect(result).toEqual({
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'facebookGroup draft 18 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: 'group-123',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
            notes: 'manual login completed',
          },
          sessionAction: null,
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-18.json',
        },
      },
    });
  });

  it('marks an existing browser handoff artifact obsolete when the saved session later requires relogin', async () => {
    mockSession({
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      status: 'active',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    await publishToFacebookGroup({
      draftId: 21,
      content: 'Ready for browser handoff',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    mockSession({
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      status: 'expired',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T11:30:00.000Z',
      lastValidatedAt: '2026-04-19T11:25:00.000Z',
    });

    await publishToFacebookGroup({
      draftId: 21,
      content: 'Needs relogin now',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    const artifactPath = path.join(
      outputDir,
      'artifacts',
      'browser-handoffs',
      'facebookGroup',
      'launch-campaign',
      'facebookGroup-draft-21.json',
    );
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(
      expect.objectContaining({
        type: 'browser_manual_handoff',
        status: 'obsolete',
        resolvedAt: '2026-04-21T12:00:00.000Z',
        resolution: {
          status: 'obsolete',
          reason: 'relogin',
        },
      }),
    );
  });

  it('requests relogin when the saved session is expired', async () => {
    const sessionStore = mockSession({
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
      status: 'expired',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    const result = await publishToFacebookGroup({
      draftId: 19,
      content: 'Needs relogin',
      target: 'group-123',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.getSession).toHaveBeenCalledWith('facebookGroup', 'launch-campaign');
    expect(result).toEqual({
      platform: 'facebookGroup',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'facebookGroup draft 19 requires the browser session to be refreshed before manual handoff.',
      publishedAt: null,
      details: {
        target: 'group-123',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'blocked',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'expired',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          sessionAction: 'relogin',
        },
      },
    });
  });
});
