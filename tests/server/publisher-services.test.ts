import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SessionStore,
  type SessionMetadata,
} from '../../src/server/services/browser/sessionStore';
import * as sessionStoreModule from '../../src/server/services/browser/sessionStore';
import { publishToWeibo } from '../../src/server/services/publishers/weibo';
import { publishToXiaohongshu } from '../../src/server/services/publishers/xiaohongshu';
import { publishToX } from '../../src/server/services/publishers/x';

const tempDirs: string[] = [];

describe('SessionStore', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }

    delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    vi.restoreAllMocks();
  });

  it('persists and reloads local session metadata for a platform account', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'promobot-session-store-'));
    tempDirs.push(rootDir);

    const storageStatePath = path.join(rootDir, 'data', 'sessions', 'facebook-group.json');
    mkdirSync(path.dirname(storageStatePath), { recursive: true });
    writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

    const store = new SessionStore({ rootDir });
    const saved = store.saveSession({
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'data/sessions/facebook-group.json',
      status: 'active',
      notes: 'manual login completed',
    });

    const loaded = store.getSession('facebookGroup', 'launch-campaign');
    const listed = store.listSessions();

    expect(saved.id).toBe('facebookGroup:launch-campaign');
    expect(loaded).toMatchObject<Partial<SessionMetadata>>({
      id: 'facebookGroup:launch-campaign',
      platform: 'facebookGroup',
      accountKey: 'launch-campaign',
      storageStatePath: 'data/sessions/facebook-group.json',
      status: 'active',
      notes: 'manual login completed',
    });
    expect(loaded?.createdAt).toBeTypeOf('string');
    expect(loaded?.updatedAt).toBeTypeOf('string');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('facebookGroup:launch-campaign');
  });

  it('rejects account keys that collapse to the same storage key', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'promobot-session-store-'));
    tempDirs.push(rootDir);

    const firstStorageStatePath = path.join(rootDir, 'data', 'sessions', 'a.json');
    const secondStorageStatePath = path.join(rootDir, 'data', 'sessions', 'b.json');
    mkdirSync(path.dirname(firstStorageStatePath), { recursive: true });
    writeFileSync(firstStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    writeFileSync(secondStorageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

    const store = new SessionStore({ rootDir });
    store.saveSession({
      platform: 'facebookGroup',
      accountKey: 'team/a',
      storageStatePath: 'data/sessions/a.json',
      status: 'active',
    });

    expect(() =>
      store.saveSession({
        platform: 'facebookGroup',
        accountKey: 'team-a',
        storageStatePath: 'data/sessions/b.json',
        status: 'active',
      }),
    ).toThrow('session key collision');
  });

  it('downgrades manually planted session metadata to missing when the storage path is outside allowed roots', () => {
    // rootDir must live one level deep inside a unique parent so that
    // getAllowedStorageStateRoots(rootDir) does not include tmpdir() itself —
    // otherwise a sibling directory in tmpdir() would still be "allowed".
    const storeParentDir = mkdtempSync(path.join(tmpdir(), 'promobot-test-'));
    const rootDir = mkdtempSync(path.join(storeParentDir, 'session-store-'));
    const externalDir = mkdtempSync(path.join(tmpdir(), 'promobot-session-outside-'));
    tempDirs.push(storeParentDir, externalDir);

    const externalStorageStatePath = path.join(externalDir, 'facebook-group.json');
    writeFileSync(
      externalStorageStatePath,
      JSON.stringify({ cookies: [], origins: [] }, null, 2),
    );

    const metadataDir = path.join(rootDir, 'facebookGroup');
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      path.join(metadataDir, 'launch-campaign.json'),
      JSON.stringify(
        {
          id: 'facebookGroup:launch-campaign',
          platform: 'facebookGroup',
          accountKey: 'launch-campaign',
          storageStatePath: externalStorageStatePath,
          status: 'active',
          createdAt: '2026-04-19T10:00:00.000Z',
          updatedAt: '2026-04-19T10:30:00.000Z',
          lastValidatedAt: '2026-04-19T10:25:00.000Z',
        },
        null,
        2,
      ),
    );

    const store = new SessionStore({ rootDir });
    const loaded = store.getSession('facebookGroup', 'launch-campaign');

    expect(loaded).toMatchObject<Partial<SessionMetadata>>({
      id: 'facebookGroup:launch-campaign',
      status: 'missing',
      storageStatePath: externalStorageStatePath,
    });
  });
});

describe('publishers', () => {
  function mockSession(session: SessionMetadata | null) {
    const getSession = vi.fn().mockReturnValue(session);
    const createSessionStore = vi
      .spyOn(sessionStoreModule, 'createSessionStore')
      .mockReturnValue({ getSession } as unknown as sessionStoreModule.SessionStore);

    return { createSessionStore, getSession };
  }

  it('returns a failed publish result contract for X drafts when credentials are missing', async () => {
    const result = await publishToX({
      content: 'Claude 3.5 Sonnet is now available with lower pricing.',
      draftId: 42,
      target: '@promobot',
    });

    expect(result).toMatchObject({
      platform: 'x',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      details: {
        error: {
          category: 'auth',
          retriable: false,
          stage: 'publish',
        },
      },
    });
    expect(result.message).toContain('missing x credentials');
    expect(result.publishedAt).toBeNull();
  });

  it('requests a saved browser session before xiaohongshu manual handoff when no session exists', async () => {
    const sessionStore = mockSession(null);

    const result = await publishToXiaohongshu({
      draftId: 12,
      content: 'Needs browser handoff',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.createSessionStore).toHaveBeenCalledTimes(1);
    expect(sessionStore.getSession).toHaveBeenCalledWith('xiaohongshu', 'launch-campaign');
    expect(result).toEqual({
      platform: 'xiaohongshu',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'xiaohongshu draft 12 requires a saved browser session before manual handoff.',
      publishedAt: null,
      details: {
        target: 'brand-account',
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

  it('returns a ready browser handoff for xiaohongshu when an active session exists', async () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'promobot-browser-handoff-'));
    tempDirs.push(outputDir);
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = outputDir;

    const sessionStore = mockSession({
      id: 'xiaohongshu:launch-campaign',
      platform: 'xiaohongshu',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
      status: 'active',
      notes: 'manual login completed',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    const result = await publishToXiaohongshu({
      draftId: 18,
      content: 'Ready for browser handoff',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.getSession).toHaveBeenCalledWith('xiaohongshu', 'launch-campaign');
    expect(
      JSON.parse(
        readFileSync(
          path.join(
            outputDir,
            'artifacts',
            'browser-handoffs',
            'xiaohongshu',
            'launch-campaign',
            'xiaohongshu-draft-18.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      type: 'browser_manual_handoff',
      status: 'pending',
      platform: 'xiaohongshu',
      draftId: '18',
      title: null,
      content: 'Ready for browser handoff',
      target: 'brand-account',
      accountKey: 'launch-campaign',
      session: {
        hasSession: true,
        id: 'xiaohongshu:launch-campaign',
        status: 'active',
        validatedAt: '2026-04-19T10:25:00.000Z',
        storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
        notes: 'manual login completed',
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      resolvedAt: null,
      resolution: null,
    });
    expect(result).toEqual({
      platform: 'xiaohongshu',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'xiaohongshu draft 18 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: 'brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'xiaohongshu:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
            notes: 'manual login completed',
          },
          sessionAction: null,
          artifactPath:
            'artifacts/browser-handoffs/xiaohongshu/launch-campaign/xiaohongshu-draft-18.json',
        },
      },
    });
  });

  it('requests xiaohongshu relogin when the saved session is expired', async () => {
    const sessionStore = mockSession({
      id: 'xiaohongshu:launch-campaign',
      platform: 'xiaohongshu',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
      status: 'expired',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    const result = await publishToXiaohongshu({
      draftId: 19,
      content: 'Needs relogin',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.getSession).toHaveBeenCalledWith('xiaohongshu', 'launch-campaign');
    expect(result).toEqual({
      platform: 'xiaohongshu',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'xiaohongshu draft 19 requires the browser session to be refreshed before manual handoff.',
      publishedAt: null,
      details: {
        target: 'brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'blocked',
          session: {
            hasSession: true,
            id: 'xiaohongshu:launch-campaign',
            status: 'expired',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/xiaohongshu.json',
          },
          sessionAction: 'relogin',
        },
      },
    });
  });

  it('requests a saved browser session before weibo manual handoff when no session exists', async () => {
    const sessionStore = mockSession(null);

    const result = await publishToWeibo({
      draftId: 22,
      content: 'Needs browser handoff',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.getSession).toHaveBeenCalledWith('weibo', 'launch-campaign');
    expect(result).toEqual({
      platform: 'weibo',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'weibo draft 22 requires a saved browser session before manual handoff.',
      publishedAt: null,
      details: {
        target: 'brand-account',
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

  it('returns a ready browser handoff for weibo when an active session exists', async () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'promobot-browser-handoff-'));
    tempDirs.push(outputDir);
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = outputDir;

    const sessionStore = mockSession({
      id: 'weibo:launch-campaign',
      platform: 'weibo',
      accountKey: 'launch-campaign',
      storageStatePath: 'artifacts/browser-sessions/weibo.json',
      status: 'active',
      notes: 'manual login completed',
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:30:00.000Z',
      lastValidatedAt: '2026-04-19T10:25:00.000Z',
    });

    const result = await publishToWeibo({
      draftId: 28,
      content: 'Ready for browser handoff',
      target: 'brand-account',
      metadata: {
        accountKey: 'launch-campaign',
      },
    });

    expect(sessionStore.getSession).toHaveBeenCalledWith('weibo', 'launch-campaign');
    expect(
      JSON.parse(
        readFileSync(
          path.join(
            outputDir,
            'artifacts',
            'browser-handoffs',
            'weibo',
            'launch-campaign',
            'weibo-draft-28.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      type: 'browser_manual_handoff',
      status: 'pending',
      platform: 'weibo',
      draftId: '28',
      title: null,
      content: 'Ready for browser handoff',
      target: 'brand-account',
      accountKey: 'launch-campaign',
      session: {
        hasSession: true,
        id: 'weibo:launch-campaign',
        status: 'active',
        validatedAt: '2026-04-19T10:25:00.000Z',
        storageStatePath: 'artifacts/browser-sessions/weibo.json',
        notes: 'manual login completed',
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      resolvedAt: null,
      resolution: null,
    });
    expect(result).toEqual({
      platform: 'weibo',
      mode: 'browser',
      status: 'manual_required',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'weibo draft 28 is ready for manual browser handoff with the saved session.',
      publishedAt: null,
      details: {
        target: 'brand-account',
        accountKey: 'launch-campaign',
        browserHandoff: {
          readiness: 'ready',
          session: {
            hasSession: true,
            id: 'weibo:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-19T10:25:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/weibo.json',
            notes: 'manual login completed',
          },
          sessionAction: null,
          artifactPath: 'artifacts/browser-handoffs/weibo/launch-campaign/weibo-draft-28.json',
        },
      },
    });
  });
});
