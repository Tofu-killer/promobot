import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SessionStore,
  type SessionMetadata,
} from '../../src/server/services/browser/sessionStore';
import { publishToX } from '../../src/server/services/publishers/x';

describe('SessionStore', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('persists and reloads local session metadata for a platform account', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'promobot-session-store-'));
    tempDirs.push(rootDir);

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
});

describe('publishers', () => {
  it('returns the shared publish result contract for X drafts', async () => {
    const result = await publishToX({
      content: 'Claude 3.5 Sonnet is now available with lower pricing.',
      draftId: 42,
      target: '@promobot',
    });

    expect(result).toMatchObject({
      platform: 'x',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://x.com/promobot/status/42',
      externalId: 'x-42',
    });
    expect(result.message).toContain('stub');
    expect(result.publishedAt).toBeTypeOf('string');
  });
});
