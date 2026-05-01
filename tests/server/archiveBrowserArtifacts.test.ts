import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionRequestArtifact,
  createSessionRequestResultArtifact,
  markSessionRequestResultArtifactConsumed,
  resolveSessionRequestArtifacts,
} from '../../src/server/services/browser/sessionRequestArtifacts';
import { archiveBrowserArtifacts } from '../../src/server/services/browser/artifactArchiver';
import {
  getArchiveBrowserArtifactsHelpText,
  parseArchiveBrowserArtifactsArgs,
  runArchiveBrowserArtifactsCli,
} from '../../src/server/cli/archiveBrowserArtifacts';
import { cleanupTestDatabasePath, createTestDatabasePath, isolateProcessCwd } from './testDb';

let restoreCwd: (() => void) | null = null;

function writeJsonArtifact(rootDir: string, relativePath: string, value: Record<string, unknown>) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(value, null, 2), 'utf8');
  return relativePath;
}

function writeBrowserHandoffArtifact(
  rootDir: string,
  input: {
    artifactPath: string;
    status: 'pending' | 'resolved' | 'obsolete';
    updatedAt: string;
    resolvedAt: string | null;
  },
) {
  return writeJsonArtifact(rootDir, input.artifactPath, {
    type: 'browser_manual_handoff',
    status: input.status,
    platform: 'facebookGroup',
    draftId: '1',
    title: 'Community update',
    content: 'Need manual browser handoff',
    target: 'group-123',
    accountKey: 'launch-campaign',
    session: {
      hasSession: true,
      id: 'facebookGroup:launch-campaign',
      status: 'active',
      validatedAt: '2026-04-22T08:00:00.000Z',
      storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
    },
    createdAt: '2026-04-22T08:05:00.000Z',
    updatedAt: input.updatedAt,
    resolvedAt: input.resolvedAt,
    resolution:
      input.status === 'pending'
        ? null
        : {
            status: input.status,
          },
  });
}

function writeInboxReplyHandoffArtifact(
  rootDir: string,
  input: {
    artifactPath: string;
    status: 'pending' | 'resolved' | 'obsolete';
    updatedAt: string;
    resolvedAt: string | null;
  },
) {
  const itemIdMatch = input.artifactPath.match(/inbox-item-(\d+)\.json$/);
  const itemId = itemIdMatch?.[1] ?? '12';
  return writeJsonArtifact(rootDir, input.artifactPath, {
    type: 'browser_inbox_reply_handoff',
    status: input.status,
    platform: 'weibo',
    itemId,
    source: 'weibo',
    title: 'Community question',
    excerpt: 'Can you share current response times?',
    reply: 'Thanks for reaching out.',
    author: 'ops-user',
    sourceUrl: 'https://weibo.test/post/12',
    accountKey: 'weibo-browser-main',
    session: {
      hasSession: true,
      id: 'weibo:weibo-browser-main',
      status: 'active',
      validatedAt: '2026-04-22T08:00:00.000Z',
      storageStatePath: 'artifacts/browser-sessions/weibo-browser-main.json',
    },
    createdAt: '2026-04-22T08:05:00.000Z',
    updatedAt: input.updatedAt,
    resolvedAt: input.resolvedAt,
    resolution:
      input.status === 'pending'
        ? null
        : {
            status: input.status,
          },
  });
}

describe('browser artifact archiver', () => {
  beforeEach(() => {
    restoreCwd = isolateProcessCwd();
  });

  afterEach(() => {
    restoreCwd?.();
    restoreCwd = null;
  });

  it('defaults to dry-run and only plans old non-pending request and handoff artifacts', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const resolvedRequestPath = createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-22T08:00:00.000Z',
        jobId: 17,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });
      resolveSessionRequestArtifacts({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        jobId: 17,
        resolvedAt: '2026-04-22T09:00:00.000Z',
        resolvedJobStatus: 'resolved',
        resolution: {
          status: 'resolved',
        },
        savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
      });

      createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-22T09:30:00.000Z',
        jobId: 18,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });

      const resultArtifactPath = createSessionRequestResultArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestJobId: 17,
        completedAt: '2026-04-22T09:05:00.000Z',
        storageState: {
          cookies: [],
          origins: [],
        },
      });
      markSessionRequestResultArtifactConsumed({
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestJobId: 17,
        consumedAt: '2026-04-22T09:10:00.000Z',
        savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        resolution: {
          status: 'resolved',
        },
      });

      createSessionRequestResultArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestJobId: 18,
        completedAt: '2026-04-22T09:20:00.000Z',
        storageState: {
          cookies: [],
          origins: [],
        },
        notes: 'still waiting for import',
      });

      const resolvedHandoffPath = writeBrowserHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-1.json',
        status: 'resolved',
        updatedAt: '2026-04-22T10:00:00.000Z',
        resolvedAt: '2026-04-22T10:00:00.000Z',
      });
      const obsoleteHandoffPath = writeBrowserHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-2.json',
        status: 'obsolete',
        updatedAt: '2026-04-22T11:00:00.000Z',
        resolvedAt: '2026-04-22T11:00:00.000Z',
      });
      writeBrowserHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-3.json',
        status: 'pending',
        updatedAt: '2026-04-22T12:00:00.000Z',
        resolvedAt: null,
      });
      writeJsonArtifact(
        rootDir,
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-4.json',
        {
          type: 'browser_manual_handoff',
          status: 'unknown',
          platform: 'facebookGroup',
          draftId: '4',
          title: 'Unexpected status',
          content: 'Should not be archived',
          target: 'group-123',
          accountKey: 'launch-campaign',
          session: {
            hasSession: true,
            id: 'facebookGroup:launch-campaign',
            status: 'active',
            validatedAt: '2026-04-22T08:00:00.000Z',
            storageStatePath: 'artifacts/browser-sessions/facebook-group.json',
          },
          createdAt: '2026-04-22T08:05:00.000Z',
          updatedAt: '2026-04-22T12:30:00.000Z',
          resolvedAt: '2026-04-22T12:30:00.000Z',
          resolution: {
            status: 'unknown',
          },
        },
      );
      const resolvedInboxReplyHandoffPath = writeInboxReplyHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-12.json',
        status: 'resolved',
        updatedAt: '2026-04-22T10:30:00.000Z',
        resolvedAt: '2026-04-22T10:30:00.000Z',
      });
      const obsoleteInboxReplyHandoffPath = writeInboxReplyHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-13.json',
        status: 'obsolete',
        updatedAt: '2026-04-22T10:45:00.000Z',
        resolvedAt: '2026-04-22T10:45:00.000Z',
      });
      writeInboxReplyHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-14.json',
        status: 'pending',
        updatedAt: '2026-04-22T11:00:00.000Z',
        resolvedAt: null,
      });

      const summary = await archiveBrowserArtifacts({
        olderThanHours: 24,
        now: () => new Date('2026-04-24T12:00:00.000Z'),
      });

      expect(summary).toEqual(
        expect.objectContaining({
          ok: true,
          dryRun: true,
          apply: false,
          olderThanHours: 24,
          includeResults: false,
          cutoff: '2026-04-23T12:00:00.000Z',
          totals: {
            scanned: 11,
            eligible: 5,
            archived: 0,
            skipped: 0,
            errors: 1,
          },
          categories: {
            browserLaneRequests: {
              scanned: 2,
              eligible: 1,
              archived: 0,
            },
            browserLaneResults: {
              scanned: 2,
              eligible: 0,
              archived: 0,
              included: false,
            },
            browserHandoffs: {
              scanned: 4,
              eligible: 2,
              archived: 0,
            },
            inboxReplyHandoffs: {
              scanned: 3,
              eligible: 2,
              archived: 0,
            },
          },
        }),
      );
      expect(summary.items).toEqual([
        expect.objectContaining({
          kind: 'browser_handoff',
          sourcePath: resolvedHandoffPath,
          archivePath:
            'artifacts/archive/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-1.json',
          status: 'would_archive',
        }),
        expect.objectContaining({
          kind: 'browser_handoff',
          sourcePath: obsoleteHandoffPath,
          archivePath:
            'artifacts/archive/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-2.json',
          status: 'would_archive',
        }),
        expect.objectContaining({
          kind: 'browser_lane_request',
          sourcePath: resolvedRequestPath,
          archivePath:
            'artifacts/archive/browser-lane-requests/x/-promobot/request-session-job-17.json',
          status: 'would_archive',
        }),
        expect.objectContaining({
          kind: 'inbox_reply_handoff',
          sourcePath: resolvedInboxReplyHandoffPath,
          archivePath:
            'artifacts/archive/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-12.json',
          status: 'would_archive',
        }),
        expect.objectContaining({
          kind: 'inbox_reply_handoff',
          sourcePath: obsoleteInboxReplyHandoffPath,
          archivePath:
            'artifacts/archive/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-13.json',
          status: 'would_archive',
        }),
      ]);
      expect(summary.errors).toEqual([
        {
          category: 'browserHandoffs',
          sourcePath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-4.json',
          message: 'unsupported browser handoff status: unknown',
        },
      ]);

      expect(fs.existsSync(path.join(rootDir, resolvedRequestPath))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, resultArtifactPath))).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            rootDir,
            'artifacts/archive/browser-lane-requests/x/-promobot/request-session-job-17.json',
          ),
        ),
      ).toBe(false);
    } finally {
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('moves eligible artifacts into artifacts/archive when apply and include-results are enabled', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const resolvedRequestPath = createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-22T08:00:00.000Z',
        jobId: 21,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });
      resolveSessionRequestArtifacts({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        jobId: 21,
        resolvedAt: '2026-04-22T09:00:00.000Z',
        resolvedJobStatus: 'resolved',
        resolution: {
          status: 'resolved',
        },
        savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
      });

      const resultArtifactPath = createSessionRequestResultArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestJobId: 21,
        completedAt: '2026-04-22T09:05:00.000Z',
        storageState: {
          cookies: [],
          origins: [],
        },
      });
      markSessionRequestResultArtifactConsumed({
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestJobId: 21,
        consumedAt: '2026-04-22T09:10:00.000Z',
        savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
        resolution: {
          status: 'resolved',
        },
      });

      const resolvedHandoffPath = writeBrowserHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-9.json',
        status: 'resolved',
        updatedAt: '2026-04-22T10:00:00.000Z',
        resolvedAt: '2026-04-22T10:00:00.000Z',
      });
      const resolvedInboxReplyHandoffPath = writeInboxReplyHandoffArtifact(rootDir, {
        artifactPath:
          'artifacts/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-21.json',
        status: 'resolved',
        updatedAt: '2026-04-22T10:15:00.000Z',
        resolvedAt: '2026-04-22T10:15:00.000Z',
      });

      const summary = await archiveBrowserArtifacts({
        apply: true,
        includeResults: true,
        olderThanHours: 24,
        now: () => new Date('2026-04-24T12:00:00.000Z'),
      });

      expect(summary).toEqual(
        expect.objectContaining({
          ok: true,
          dryRun: false,
          apply: true,
          includeResults: true,
          totals: {
            scanned: 4,
            eligible: 4,
            archived: 4,
            skipped: 0,
            errors: 0,
          },
        }),
      );
      expect(summary.items).toEqual([
        expect.objectContaining({
          kind: 'browser_handoff',
          sourcePath: resolvedHandoffPath,
          archivePath:
            'artifacts/archive/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-9.json',
          status: 'archived',
        }),
        expect.objectContaining({
          kind: 'browser_lane_request',
          sourcePath: resolvedRequestPath,
          archivePath:
            'artifacts/archive/browser-lane-requests/x/-promobot/request-session-job-21.json',
          status: 'archived',
        }),
        expect.objectContaining({
          kind: 'browser_lane_result',
          sourcePath: resultArtifactPath,
          archivePath:
            'artifacts/archive/browser-lane-requests/x/-promobot/request-session-job-21.result.json',
          status: 'archived',
        }),
        expect.objectContaining({
          kind: 'inbox_reply_handoff',
          sourcePath: resolvedInboxReplyHandoffPath,
          archivePath:
            'artifacts/archive/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-21.json',
          status: 'archived',
        }),
      ]);

      expect(fs.existsSync(path.join(rootDir, resolvedRequestPath))).toBe(false);
      expect(fs.existsSync(path.join(rootDir, resultArtifactPath))).toBe(false);
      expect(fs.existsSync(path.join(rootDir, resolvedHandoffPath))).toBe(false);
      expect(fs.existsSync(path.join(rootDir, resolvedInboxReplyHandoffPath))).toBe(false);

      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(
              rootDir,
              'artifacts/archive/browser-lane-requests/x/-promobot/request-session-job-21.json',
            ),
            'utf8',
          ),
        ),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_lane_request',
          jobId: 21,
          resolvedAt: '2026-04-22T09:00:00.000Z',
        }),
      );
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(
              rootDir,
              'artifacts/archive/browser-lane-requests/x/-promobot/request-session-job-21.result.json',
            ),
            'utf8',
          ),
        ),
      ).toEqual(
          expect.objectContaining({
            type: 'browser_lane_result',
            requestJobId: 21,
            consumedAt: '2026-04-22T09:10:00.000Z',
          }),
      );
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(
              rootDir,
              'artifacts/archive/inbox-reply-handoffs/weibo/weibo-browser-main/weibo-inbox-item-21.json',
            ),
            'utf8',
          ),
        ),
      ).toEqual(
        expect.objectContaining({
          type: 'browser_inbox_reply_handoff',
          itemId: '21',
          resolvedAt: '2026-04-22T10:15:00.000Z',
        }),
      );
    } finally {
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('parses cli flags and exposes help text for the dry-run archive command', () => {
    expect(parseArchiveBrowserArtifactsArgs([])).toEqual({
      apply: false,
      includeResults: false,
      olderThanHours: 24,
    });
    expect(
      parseArchiveBrowserArtifactsArgs([
        '--apply',
        '--older-than-hours',
        '72',
        '--include-results',
      ]),
    ).toEqual({
      apply: true,
      includeResults: true,
      olderThanHours: 72,
    });
    expect(parseArchiveBrowserArtifactsArgs(['--help'])).toEqual({
      apply: false,
      includeResults: false,
      olderThanHours: 24,
      showHelp: true,
    });
    expect(parseArchiveBrowserArtifactsArgs(['--', '--help'])).toEqual({
      apply: false,
      includeResults: false,
      olderThanHours: 24,
      showHelp: true,
    });
    expect(() => parseArchiveBrowserArtifactsArgs(['--older-than-hours'])).toThrow(
      '--older-than-hours requires a value',
    );
    expect(() =>
      parseArchiveBrowserArtifactsArgs(['--older-than-hours', '--apply']),
    ).toThrow('--older-than-hours requires a value');
    expect(getArchiveBrowserArtifactsHelpText()).toContain('Defaults to dry-run');
  });

  it('writes a machine-readable json summary from the cli runner', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-24T10:00:00.000Z',
        jobId: 31,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });

      let stdout = '';
      const summary = await runArchiveBrowserArtifactsCli(['--older-than-hours', '24'], {
        now: () => new Date('2026-04-24T12:00:00.000Z'),
        stdout: {
          write(chunk: string) {
            stdout += chunk;
            return true;
          },
        },
      });

      expect(summary).toEqual(
        expect.objectContaining({
          ok: true,
          dryRun: true,
          totals: {
            scanned: 1,
            eligible: 0,
            archived: 0,
            skipped: 0,
            errors: 0,
          },
        }),
      );
      expect(JSON.parse(stdout)).toEqual(
        expect.objectContaining({
          ok: true,
          dryRun: true,
          olderThanHours: 24,
        }),
      );
    } finally {
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('returns a json summary instead of throwing when apply hits a filesystem error', async () => {
    const { rootDir } = createTestDatabasePath();
    const previousHandoffOutputDir = process.env.BROWSER_HANDOFF_OUTPUT_DIR;
    process.env.BROWSER_HANDOFF_OUTPUT_DIR = rootDir;

    try {
      const resolvedRequestPath = createSessionRequestArtifact({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        requestedAt: '2026-04-22T08:00:00.000Z',
        jobId: 41,
        jobStatus: 'pending',
        nextStep: '/api/channel-accounts/1/session',
      });
      resolveSessionRequestArtifacts({
        channelAccountId: 1,
        platform: 'x',
        accountKey: '@promobot',
        action: 'request_session',
        jobId: 41,
        resolvedAt: '2026-04-22T09:00:00.000Z',
        resolvedJobStatus: 'resolved',
        resolution: {
          status: 'resolved',
        },
        savedStorageStatePath: 'browser-sessions/managed/x/-promobot.json',
      });

      const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
        throw new Error('disk full');
      });

      try {
        let stdout = '';
        const summary = await runArchiveBrowserArtifactsCli(
          ['--apply', '--older-than-hours', '24'],
          {
            now: () => new Date('2026-04-24T12:00:00.000Z'),
            stdout: {
              write(chunk: string) {
                stdout += chunk;
                return true;
              },
            },
          },
        );

        expect(summary).toEqual(
          expect.objectContaining({
            ok: true,
            apply: true,
            dryRun: false,
            totals: {
              scanned: 1,
              eligible: 1,
              archived: 0,
              skipped: 0,
              errors: 1,
            },
            errors: [
              {
                category: 'browserLaneRequests',
                sourcePath: resolvedRequestPath,
                message: 'disk full',
              },
            ],
          }),
        );
        expect(JSON.parse(stdout)).toEqual(
          expect.objectContaining({
            totals: expect.objectContaining({
              errors: 1,
            }),
          }),
        );
        expect(summary?.items).toEqual([
          expect.objectContaining({
            sourcePath: resolvedRequestPath,
            status: 'error',
          }),
        ]);
        expect(fs.existsSync(path.join(rootDir, resolvedRequestPath))).toBe(true);
      } finally {
        renameSpy.mockRestore();
      }
    } finally {
      if (previousHandoffOutputDir === undefined) {
        delete process.env.BROWSER_HANDOFF_OUTPUT_DIR;
      } else {
        process.env.BROWSER_HANDOFF_OUTPUT_DIR = previousHandoffOutputDir;
      }
      cleanupTestDatabasePath(rootDir);
    }
  });
});
