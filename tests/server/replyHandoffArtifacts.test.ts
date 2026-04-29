import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getInboxReplyHandoffArtifactByPath,
  listInboxReplyHandoffArtifacts,
  promoteInboxReplyHandoffArtifactToReady,
  writeInboxReplyHandoffArtifact,
} from '../../src/server/services/inbox/replyHandoffArtifacts';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { createInboxStore } from '../../src/server/store/inbox';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

let restoreCwd: (() => void) | null = null;

describe('inbox reply handoff artifacts', () => {
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
  });

  it('persists blocked readiness metadata and can promote the handoff back to ready', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const account = channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        projectId: 22,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        channelAccountId: account.id,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: false,
          id: 'weibo:weibo-browser-main',
          status: 'missing',
          validatedAt: null,
          storageStatePath: null,
        },
        sessionAction: 'request_session',
      });

      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, artifactPath), 'utf8')),
      ).toEqual(
        expect.objectContaining({
          readiness: 'blocked',
          sessionAction: 'request_session',
        }),
      );
      expect(listInboxReplyHandoffArtifacts()).toEqual([
        expect.objectContaining({
          artifactPath,
          readiness: 'blocked',
          sessionAction: 'request_session',
        }),
      ]);
      expect(getInboxReplyHandoffArtifactByPath(artifactPath)).toEqual(
        expect.objectContaining({
          artifactPath,
          readiness: 'blocked',
          sessionAction: 'request_session',
        }),
      );

      const promotedArtifact = promoteInboxReplyHandoffArtifactToReady({
        artifactPath,
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-26T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      expect(promotedArtifact).toEqual(
        expect.objectContaining({
          artifactPath,
          readiness: 'ready',
          sessionAction: null,
        }),
      );
      expect(getInboxReplyHandoffArtifactByPath(artifactPath)).toEqual(
        expect.objectContaining({
          artifactPath,
          readiness: 'ready',
          sessionAction: null,
          session: expect.objectContaining({
            hasSession: true,
            status: 'active',
            validatedAt: '2026-04-26T10:00:00.000Z',
          }),
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('preserves persisted item_project ownership when current account scope changes', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const account = channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        projectId: 22,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      const persistedArtifact = JSON.parse(
        fs.readFileSync(path.join(rootDir, artifactPath), 'utf8'),
      ) as Record<string, unknown>;
      expect(persistedArtifact).toEqual(
        expect.objectContaining({
          ownership: 'item_project',
          projectId: 22,
        }),
      );

      channelAccountStore.update(account.id, { projectId: 33 });

      const listedArtifacts = listInboxReplyHandoffArtifacts();

      expect(listedArtifacts).toEqual([
        expect.not.objectContaining({
          channelAccountId: account.id,
        }),
      ]);
      expect(listedArtifacts).toEqual([
        expect.objectContaining({
          ownership: 'item_project',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      ]);

      const artifact = getInboxReplyHandoffArtifactByPath(artifactPath);
      expect(artifact).toEqual(
        expect.objectContaining({
          ownership: 'item_project',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      );
      expect(artifact).not.toHaveProperty('channelAccountId');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('rebinds persisted direct ownership to a unique matching account when the original channel account no longer resolves', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const account = channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        projectId: 22,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        channelAccountId: account.id,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      const absolutePath = path.join(rootDir, artifactPath);
      const persistedArtifact = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
      expect(persistedArtifact).toEqual(
        expect.objectContaining({
          ownership: 'direct',
          channelAccountId: account.id,
          projectId: 22,
        }),
      );

      fs.writeFileSync(
        absolutePath,
        JSON.stringify(
          {
            ...persistedArtifact,
            channelAccountId: 999,
          },
          null,
          2,
        ),
        'utf8',
      );

      const listedArtifacts = listInboxReplyHandoffArtifacts();
      expect(listedArtifacts).toEqual([
        expect.objectContaining({
          channelAccountId: account.id,
          ownership: 'direct',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      ]);

      const artifact = getInboxReplyHandoffArtifactByPath(artifactPath);
      expect(artifact).toEqual(
        expect.objectContaining({
          channelAccountId: account.id,
          ownership: 'direct',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('preserves persisted direct ownership without rebinding when the project scope no longer matches', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const account = channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        projectId: 22,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        channelAccountId: account.id,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      channelAccountStore.update(account.id, { projectId: 33 });

      const absolutePath = path.join(rootDir, artifactPath);
      const persistedArtifact = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
      fs.writeFileSync(
        absolutePath,
        JSON.stringify(
          {
            ...persistedArtifact,
            channelAccountId: 999,
          },
          null,
          2,
        ),
        'utf8',
      );

      const listedArtifacts = listInboxReplyHandoffArtifacts();
      expect(listedArtifacts).toEqual([
        expect.objectContaining({
          ownership: 'direct',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      ]);
      expect(listedArtifacts[0]).not.toHaveProperty('channelAccountId');

      const artifact = getInboxReplyHandoffArtifactByPath(artifactPath);
      expect(artifact).toEqual(
        expect.objectContaining({
          ownership: 'direct',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      );
      expect(artifact).not.toHaveProperty('channelAccountId');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('falls back to legacy direct matching when persisted ownership is missing', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const account = channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        channelAccountId: account.id,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      const absolutePath = path.join(rootDir, artifactPath);
      const persistedArtifact = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
      expect(persistedArtifact).toEqual(
        expect.objectContaining({
          ownership: 'direct',
          channelAccountId: account.id,
        }),
      );

      const { ownership: _ownership, ...legacyArtifact } = persistedArtifact;
      fs.writeFileSync(
        absolutePath,
        JSON.stringify(
          {
            ...legacyArtifact,
            channelAccountId: 999,
          },
          null,
          2,
        ),
        'utf8',
      );

      const listedArtifacts = listInboxReplyHandoffArtifacts();
      expect(listedArtifacts).toEqual([
        expect.objectContaining({
          channelAccountId: account.id,
          ownership: 'direct',
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      ]);

      const artifact = getInboxReplyHandoffArtifactByPath(artifactPath);
      expect(artifact).toEqual(
        expect.objectContaining({
          channelAccountId: account.id,
          ownership: 'direct',
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('omits channelAccountId when multiple accounts match the persisted item_project scope', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo A',
        authType: 'browser',
        status: 'healthy',
      });
      channelAccountStore.create({
        projectId: 22,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo B',
        authType: 'browser',
        status: 'healthy',
      });
      const item = inboxStore.create({
        projectId: 22,
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
        metadata: {
          accountKey: 'weibo-browser-main',
        },
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      const listedArtifacts = listInboxReplyHandoffArtifacts();
      expect(listedArtifacts).toEqual([
        expect.objectContaining({
          ownership: 'item_project',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      ]);
      expect(listedArtifacts[0]).not.toHaveProperty('channelAccountId');

      const artifact = getInboxReplyHandoffArtifactByPath(artifactPath);
      expect(artifact).toEqual(
        expect.objectContaining({
          ownership: 'item_project',
          projectId: 22,
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      );
      expect(artifact).not.toHaveProperty('channelAccountId');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('preserves persisted unmatched ownership when an account is added later', () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const inboxStore = createInboxStore();
      const item = inboxStore.create({
        source: 'weibo',
        status: 'needs_reply',
        author: 'ops-user',
        title: 'Community question',
        excerpt: 'Can you share current response times?',
      });

      const { artifactPath } = writeInboxReplyHandoffArtifact({
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        item,
        reply: 'Thanks for reaching out.',
        sourceUrl: 'https://weibo.test/post/12',
        session: {
          hasSession: true,
          id: 'weibo:weibo-browser-main',
          status: 'active',
          validatedAt: '2026-04-25T10:00:00.000Z',
          storageStatePath: 'browser-sessions/managed/weibo/weibo-browser-main.json',
        },
      });

      const persistedArtifact = JSON.parse(
        fs.readFileSync(path.join(rootDir, artifactPath), 'utf8'),
      ) as Record<string, unknown>;
      expect(persistedArtifact).toEqual(
        expect.objectContaining({
          ownership: 'unmatched',
        }),
      );
      expect(persistedArtifact).not.toHaveProperty('projectId');
      expect(persistedArtifact).not.toHaveProperty('channelAccountId');

      channelAccountStore.create({
        projectId: null,
        platform: 'weibo',
        accountKey: 'weibo-browser-main',
        displayName: 'PromoBot Weibo',
        authType: 'browser',
        status: 'healthy',
      });

      const listedArtifacts = listInboxReplyHandoffArtifacts();
      expect(listedArtifacts).toEqual([
        expect.objectContaining({
          ownership: 'unmatched',
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      ]);
      expect(listedArtifacts[0]).not.toHaveProperty('channelAccountId');
      expect(listedArtifacts[0]).not.toHaveProperty('projectId');

      const artifact = getInboxReplyHandoffArtifactByPath(artifactPath);
      expect(artifact).toEqual(
        expect.objectContaining({
          ownership: 'unmatched',
          platform: 'weibo',
          itemId: String(item.id),
          accountKey: 'weibo-browser-main',
        }),
      );
      expect(artifact).not.toHaveProperty('channelAccountId');
      expect(artifact).not.toHaveProperty('projectId');
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
