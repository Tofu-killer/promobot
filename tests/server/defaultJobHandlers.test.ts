import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createJobRecord } from '../../src/server/lib/jobs';
import { createDefaultJobHandlers } from '../../src/server/runtime/defaultJobHandlers';
import {
  createSessionRequestArtifact,
  resolveSessionRequestArtifacts,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import { createSessionStore } from '../../src/server/services/browser/sessionStore';
import { createChannelAccountStore } from '../../src/server/store/channelAccounts';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

const defaultStorageState = {
  cookies: [],
  origins: [],
};

function writeStorageStateFile(rootDir: string, storageStatePath: string) {
  const filePath = path.join(rootDir, storageStatePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultStorageState, null, 2));
}

describe('default job handlers', () => {
  it('passes projectId through to monitor, inbox, and reputation fetch handlers', async () => {
    const monitorFetchNow = vi.fn().mockResolvedValue({ items: [], inserted: 0 });
    const inboxFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });
    const reputationFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });

    const handlers = createDefaultJobHandlers({
      monitorFetchService: {
        fetchNow: monitorFetchNow,
      },
      inboxFetchService: {
        fetchNow: inboxFetchNow,
      },
      reputationFetchService: {
        fetchNow: reputationFetchNow,
      },
      channelAccountSessionRequestHandler: vi.fn(),
      publishJobHandler: vi.fn(),
    });

    await handlers.monitor_fetch({ projectId: 7 }, {} as never);
    await handlers.inbox_fetch({ projectId: 8 }, {} as never);
    await handlers.reputation_fetch({ projectId: 9 }, {} as never);

    expect(monitorFetchNow).toHaveBeenCalledWith(7);
    expect(inboxFetchNow).toHaveBeenCalledWith(8);
    expect(reputationFetchNow).toHaveBeenCalledWith(9);
  });

  it('falls back to global fetches when projectId is missing or invalid', async () => {
    const monitorFetchNow = vi.fn().mockResolvedValue({ items: [], inserted: 0 });
    const inboxFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });
    const reputationFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });

    const handlers = createDefaultJobHandlers({
      monitorFetchService: {
        fetchNow: monitorFetchNow,
      },
      inboxFetchService: {
        fetchNow: inboxFetchNow,
      },
      reputationFetchService: {
        fetchNow: reputationFetchNow,
      },
      channelAccountSessionRequestHandler: vi.fn(),
      publishJobHandler: vi.fn(),
    });

    await handlers.monitor_fetch({}, {} as never);
    await handlers.inbox_fetch({ projectId: 'bad' }, {} as never);
    await handlers.reputation_fetch({ projectId: 0 }, {} as never);

    expect(monitorFetchNow).toHaveBeenCalledWith(undefined);
    expect(inboxFetchNow).toHaveBeenCalledWith(undefined);
    expect(reputationFetchNow).toHaveBeenCalledWith(undefined);
  });

  it('keeps route-resolved browser-lane artifacts stable when the default session request handler runs', async () => {
    const { rootDir } = createTestDatabasePath();

    try {
      const channelAccountStore = createChannelAccountStore();
      const channelAccount = channelAccountStore.create({
        platform: 'x',
        accountKey: '@promobot',
        displayName: 'PromoBot X',
        authType: 'browser',
        status: 'healthy',
      });
      const requestedAt = '2026-04-21T09:15:00.000Z';
      const nextStep = `/api/channel-accounts/${channelAccount.id}/session`;
      const artifactPath = createSessionRequestArtifact({
        channelAccountId: channelAccount.id,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'pending',
        nextStep,
      });
      const storageStatePath = 'artifacts/browser-sessions/x-promobot-default-handler.json';
      writeStorageStateFile(rootDir, storageStatePath);

      const sessionMetadata = createSessionStore().saveSession({
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
        storageStatePath,
        status: 'active',
        notes: 'saved before default handler tick',
        lastValidatedAt: '2026-04-21T09:16:00.000Z',
      });
      expect(
        resolveSessionRequestArtifacts({
          channelAccountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          resolvedAt: sessionMetadata.updatedAt,
          resolvedJobStatus: 'resolved',
          resolution: {
            status: 'resolved',
            session: {
              hasSession: true,
              id: 'x:-promobot',
              status: 'active',
              validatedAt: '2026-04-21T09:16:00.000Z',
              storageStatePath,
              notes: 'saved before default handler tick',
            },
          },
          savedStorageStatePath: sessionMetadata.storageStatePath,
        }),
      ).toEqual([artifactPath]);

      const expectedArtifact = {
        type: 'browser_lane_request',
        channelAccountId: channelAccount.id,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt,
        jobId: 41,
        jobStatus: 'resolved',
        nextStep,
        resolvedAt: sessionMetadata.updatedAt,
        resolution: {
          status: 'resolved',
          session: {
            hasSession: true,
            id: 'x:-promobot',
            status: 'active',
            validatedAt: '2026-04-21T09:16:00.000Z',
            storageStatePath,
            notes: 'saved before default handler tick',
          },
        },
        savedStorageStatePath: storageStatePath,
      };

      expect(JSON.parse(readFileSync(path.join(rootDir, artifactPath), 'utf8'))).toEqual(
        expectedArtifact,
      );

      const handlers = createDefaultJobHandlers();
      await handlers.channel_account_session_request(
        {
          accountId: channelAccount.id,
          platform: channelAccount.platform,
          accountKey: channelAccount.accountKey,
          action: 'request_session',
        },
        createJobRecord({
          id: 41,
          type: 'channel_account_session_request',
          payload: {
            accountId: channelAccount.id,
            platform: channelAccount.platform,
            accountKey: channelAccount.accountKey,
            action: 'request_session',
          },
          runAt: requestedAt,
        }),
      );

      expect(JSON.parse(readFileSync(path.join(rootDir, artifactPath), 'utf8'))).toEqual(
        expectedArtifact,
      );
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
