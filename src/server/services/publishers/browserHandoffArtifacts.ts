import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import { createChannelAccountStore } from '../../store/channelAccounts.js';
import { createSQLiteDraftStore } from '../../store/drafts.js';
import type { SessionSummary } from '../browser/sessionStore.js';
import type { PublishRequest, PublisherPlatform } from './types.js';

const channelAccountStore = createChannelAccountStore();
const draftStore = createSQLiteDraftStore();

type BrowserHandoffArtifactStatus = 'pending' | 'resolved' | 'obsolete';
type BrowserHandoffOwnership = 'direct' | 'draft_project' | 'unmatched';

interface BrowserHandoffArtifactRecord {
  type: 'browser_manual_handoff';
  channelAccountId?: number;
  status: BrowserHandoffArtifactStatus;
  platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
  draftId: string;
  title: string | null;
  content: string;
  target: string | null;
  accountKey: string;
  session: SessionSummary;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: Record<string, unknown> | null;
}

export interface BrowserHandoffArtifactSummary {
  channelAccountId?: number;
  accountDisplayName?: string;
  ownership: BrowserHandoffOwnership;
  platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
  draftId: string;
  title: string | null;
  accountKey: string;
  status: BrowserHandoffArtifactStatus;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: Record<string, unknown> | null;
}

export function writeBrowserHandoffArtifact(input: {
  channelAccountId?: number;
  platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
  accountKey: string;
  request: PublishRequest;
  session: SessionSummary;
}) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, String(input.request.draftId));
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);
  const now = new Date().toISOString();
  const existingArtifact = readBrowserHandoffArtifact(absolutePath);
  const artifactRecord: BrowserHandoffArtifactRecord = {
    type: 'browser_manual_handoff',
    ...(typeof input.channelAccountId === 'number' ? { channelAccountId: input.channelAccountId } : {}),
    status: 'pending',
    platform: input.platform,
    draftId: String(input.request.draftId),
    title: input.request.title ?? null,
    content: input.request.content,
    target: input.request.target ?? null,
    accountKey: input.accountKey,
    session: input.session,
    createdAt: existingArtifact?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: null,
    resolution: null,
  };

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(artifactRecord, null, 2), 'utf8');

  return {
    artifactPath,
    createdAt: artifactRecord.createdAt,
    updatedAt: artifactRecord.updatedAt,
    absolutePath,
  };
}

export function markBrowserHandoffArtifactObsolete(input: {
  platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
  accountKey: string;
  draftId: string;
  reason: 'request_session' | 'relogin';
}) {
  return updateBrowserHandoffArtifact(input, {
    status: 'obsolete',
    reason: input.reason,
  });
}

export function markBrowserHandoffArtifactsObsoleteForAccount(input: {
  platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
  accountKey: string;
  reason: 'request_session' | 'relogin';
}) {
  const artifactRootDir = resolveArtifactRootDir();
  const accountDir = path.join(
    artifactRootDir,
    'artifacts',
    'browser-handoffs',
    sanitizeSegment(input.platform),
    sanitizeSegment(input.accountKey),
  );
  if (!fs.existsSync(accountDir)) {
    return [];
  }

  const updatedArtifacts: Array<{ artifactPath: string; resolvedAt: string }> = [];

  for (const artifactEntry of fs.readdirSync(accountDir, { withFileTypes: true })) {
    if (!artifactEntry.isFile() || !artifactEntry.name.endsWith('.json')) {
      continue;
    }

    const absolutePath = path.join(accountDir, artifactEntry.name);
    const artifact = readBrowserHandoffArtifact(absolutePath);
    if (!artifact || artifact.status !== 'pending') {
      continue;
    }

    const nextArtifact = updateBrowserHandoffArtifact(
      {
        platform: input.platform,
        accountKey: input.accountKey,
        draftId: artifact.draftId,
      },
      {
        status: 'obsolete',
        reason: input.reason,
      },
    );

    if (nextArtifact?.artifactPath && nextArtifact.resolvedAt) {
      updatedArtifacts.push({
        artifactPath: nextArtifact.artifactPath,
        resolvedAt: nextArtifact.resolvedAt,
      });
    }
  }

  return updatedArtifacts;
}

export function resolveBrowserHandoffArtifact(input: {
  platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
  accountKey: string;
  draftId: string;
  publishStatus: string;
  draftStatus: string;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
}) {
  return updateBrowserHandoffArtifact(input, {
    status: 'resolved',
    publishStatus: input.publishStatus,
    draftStatus: input.draftStatus,
    publishUrl: input.publishUrl,
    externalId: input.externalId,
    message: input.message,
    publishedAt: input.publishedAt,
  });
}

export function listBrowserHandoffArtifacts(limit?: number): BrowserHandoffArtifactSummary[] {
  const artifactRootDir = resolveArtifactRootDir();
  const browserHandoffDir = path.join(artifactRootDir, 'artifacts', 'browser-handoffs');
  if (!fs.existsSync(browserHandoffDir)) {
    return [];
  }

  const channelAccounts = channelAccountStore.list();
  const artifacts: BrowserHandoffArtifactSummary[] = [];

  for (const platformEntry of fs.readdirSync(browserHandoffDir, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) {
      continue;
    }

    const platformDir = path.join(browserHandoffDir, platformEntry.name);
    for (const accountEntry of fs.readdirSync(platformDir, { withFileTypes: true })) {
      if (!accountEntry.isDirectory()) {
        continue;
      }

      const accountDir = path.join(platformDir, accountEntry.name);
      for (const artifactEntry of fs.readdirSync(accountDir, { withFileTypes: true })) {
        if (!artifactEntry.isFile() || !artifactEntry.name.endsWith('.json')) {
          continue;
        }

        const absolutePath = path.join(accountDir, artifactEntry.name);
        const artifact = readBrowserHandoffArtifact(absolutePath);
        if (!artifact) {
          continue;
        }

        const ownership = resolveBrowserHandoffOwnership(artifact, channelAccounts);

        artifacts.push({
          ...('channelAccountId' in ownership &&
          typeof ownership.channelAccountId === 'number'
            ? { channelAccountId: ownership.channelAccountId }
            : {}),
          ...('accountDisplayName' in ownership && ownership.accountDisplayName
            ? { accountDisplayName: ownership.accountDisplayName }
            : {}),
          ownership: ownership.ownership,
          platform: artifact.platform,
          draftId: artifact.draftId,
          title: artifact.title,
          accountKey: artifact.accountKey,
          status: artifact.status,
          artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
          resolvedAt: artifact.resolvedAt,
          resolution: artifact.resolution,
        });
      }
    }
  }

  const sorted = artifacts.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }

    return right.artifactPath.localeCompare(left.artifactPath);
  });

  return limit === undefined ? sorted : sorted.slice(0, limit);
}

export function getLatestBrowserHandoffArtifact(input: {
  channelAccountId?: number;
  platform: string;
  accountKey: string;
}): BrowserHandoffArtifactSummary | null {
  const normalizedPlatform = normalizeBrowserHandoffPlatform(input.platform);
  const artifacts = listBrowserHandoffArtifacts().filter(
    (artifact) =>
      artifact.platform === normalizedPlatform &&
      artifact.accountKey === input.accountKey,
  );

  if (typeof input.channelAccountId === 'number') {
    const exactMatch = artifacts.find((artifact) => artifact.channelAccountId === input.channelAccountId);
    if (exactMatch) {
      return exactMatch;
    }

    if (artifacts.some((artifact) => typeof artifact.channelAccountId === 'number')) {
      return null;
    }
  }

  const latest = artifacts[0];

  return latest ?? null;
}

export function getBrowserHandoffArtifactByPath(
  artifactPath: string,
): BrowserHandoffArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const normalizedPath = artifactPath.trim().replace(/\\/g, '/');
  const absolutePath = path.resolve(artifactRootDir, normalizedPath);
  const relativePath = path.relative(artifactRootDir, absolutePath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    !relativePath.split(path.sep).join('/').startsWith('artifacts/browser-handoffs/')
  ) {
    return null;
  }

  const artifact = readBrowserHandoffArtifact(absolutePath);
  if (!artifact) {
    return null;
  }

  const ownership = resolveBrowserHandoffOwnership(artifact, channelAccountStore.list());

  return {
    ...('channelAccountId' in ownership &&
    typeof ownership.channelAccountId === 'number'
      ? { channelAccountId: ownership.channelAccountId }
      : {}),
    ...('accountDisplayName' in ownership && ownership.accountDisplayName
      ? { accountDisplayName: ownership.accountDisplayName }
      : {}),
    ownership: ownership.ownership,
    platform: artifact.platform,
    draftId: artifact.draftId,
    title: artifact.title,
    accountKey: artifact.accountKey,
    status: artifact.status,
    artifactPath: relativePath.split(path.sep).join('/'),
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    resolvedAt: artifact.resolvedAt,
    resolution: artifact.resolution,
  };
}

function resolveBrowserHandoffOwnership(
  artifact: BrowserHandoffArtifactRecord,
  channelAccounts: Array<{
    id: number;
    projectId: number | null;
    platform: string;
    accountKey: string;
    displayName: string;
  }>,
) {
  if (typeof artifact.channelAccountId === 'number') {
    const channelAccount = channelAccounts.find((account) => account.id === artifact.channelAccountId);
    if (channelAccount) {
      return {
        channelAccountId: artifact.channelAccountId,
        accountDisplayName: channelAccount.displayName,
        ownership: 'direct' as const,
      };
    }
  }

  const matchingChannelAccounts = channelAccounts.filter(
    (channelAccount) =>
      normalizeBrowserHandoffPlatform(channelAccount.platform) === artifact.platform &&
      channelAccount.accountKey === artifact.accountKey,
  );

  const draftProjectId = readDraftProjectId(artifact);
  if (typeof draftProjectId === 'number') {
    const projectMatches = matchingChannelAccounts.filter(
      (channelAccount) => channelAccount.projectId === draftProjectId,
    );

    if (projectMatches.length === 1) {
      return {
        channelAccountId: projectMatches[0]?.id,
        accountDisplayName: projectMatches[0]?.displayName,
        ownership: 'draft_project' as const,
      };
    }

    if (projectMatches.length === 0) {
      return {
        ownership: 'unmatched' as const,
      };
    }
  }

  if (matchingChannelAccounts.length === 1) {
    return {
      channelAccountId: matchingChannelAccounts[0]?.id,
      accountDisplayName: matchingChannelAccounts[0]?.displayName,
      ownership: 'direct' as const,
    };
  }

  const inferredChannelAccountId = inferChannelAccountIdFromDraft(artifact, channelAccounts);
  if (typeof inferredChannelAccountId === 'number') {
    const channelAccount = channelAccounts.find((account) => account.id === inferredChannelAccountId);
    return {
      channelAccountId: inferredChannelAccountId,
      ...(channelAccount ? { accountDisplayName: channelAccount.displayName } : {}),
      ownership: 'draft_project' as const,
    };
  }

  return {
    ownership: 'unmatched' as const,
  };
}

function buildArtifactPath(platform: string, accountKey: string, draftId: string) {
  return path.join(
    'artifacts',
    'browser-handoffs',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
    `${sanitizeSegment(platform)}-draft-${draftId}.json`,
  );
}

function sanitizeSegment(value: string) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function resolveArtifactRootDir() {
  const configured = process.env.BROWSER_HANDOFF_OUTPUT_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const databasePath = getDatabasePath();
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return process.cwd();
  }

  const databaseDir = path.dirname(databasePath);
  return path.basename(databaseDir) === 'data' ? path.dirname(databaseDir) : databaseDir;
}

function updateBrowserHandoffArtifact(
  input: {
    platform: Extract<PublisherPlatform, 'facebookGroup' | 'xiaohongshu' | 'weibo'>;
    accountKey: string;
    draftId: string;
  },
  resolution: Record<string, unknown>,
) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, input.draftId);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);
  const existingArtifact = readBrowserHandoffArtifact(absolutePath);
  if (!existingArtifact) {
    return null;
  }

  const now = new Date().toISOString();
  const nextStatus =
    resolution.status === 'resolved' || resolution.status === 'obsolete'
      ? (resolution.status as BrowserHandoffArtifactStatus)
      : 'obsolete';
  const nextArtifact: BrowserHandoffArtifactRecord = {
    ...existingArtifact,
    status: nextStatus,
    updatedAt: now,
    resolvedAt: now,
    resolution,
  };

  fs.writeFileSync(absolutePath, JSON.stringify(nextArtifact, null, 2), 'utf8');

  return {
    artifactPath,
    absolutePath,
    updatedAt: now,
    resolvedAt: now,
  };
}

function readBrowserHandoffArtifact(absolutePath: string): BrowserHandoffArtifactRecord | null {
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    const artifact = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as BrowserHandoffArtifactRecord;
    return artifact.type === 'browser_manual_handoff' ? artifact : null;
  } catch {
    return null;
  }
}

function normalizeBrowserHandoffPlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function inferChannelAccountIdFromDraft(
  artifact: BrowserHandoffArtifactRecord,
  channelAccounts: Array<{
    id: number;
    projectId: number | null;
    platform: string;
    accountKey: string;
  }>,
) {
  const draftId = Number(artifact.draftId);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return undefined;
  }

  const draftProjectId = readDraftProjectId(artifact);
  if (typeof draftProjectId !== 'number') {
    return undefined;
  }

  const matches = channelAccounts.filter(
      (channelAccount) =>
        channelAccount.projectId === draftProjectId &&
        normalizeBrowserHandoffPlatform(channelAccount.platform) === artifact.platform &&
        channelAccount.accountKey === artifact.accountKey,
    );

  return matches.length === 1 ? matches[0]?.id : undefined;
}

function readDraftProjectId(artifact: BrowserHandoffArtifactRecord) {
  const draftId = Number(artifact.draftId);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return undefined;
  }

  const draft = draftStore.getById(draftId);
  return draft && typeof draft.projectId === 'number' ? draft.projectId : undefined;
}
