import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import { createChannelAccountStore } from '../../store/channelAccounts.js';
import { createSQLiteDraftStore } from '../../store/drafts.js';
import type { BrowserSessionAction, SessionSummary } from '../browser/sessionStore.js';
import type { PublishRequest, PublisherPlatform } from './types.js';

const channelAccountStore = createChannelAccountStore();
const draftStore = createSQLiteDraftStore();

type BrowserHandoffArtifactStatus = 'pending' | 'resolved' | 'obsolete';
export type BrowserHandoffArtifactReadiness = 'ready' | 'blocked';
type BrowserHandoffOwnership = 'direct' | 'draft_project' | 'unmatched';
type BrowserHandoffPlatform = Extract<
  PublisherPlatform,
  'facebookGroup' | 'instagram' | 'tiktok' | 'xiaohongshu' | 'weibo'
>;

interface BrowserHandoffArtifactRecord {
  type: 'browser_manual_handoff';
  channelAccountId?: number;
  handoffAttempt: number;
  status: BrowserHandoffArtifactStatus;
  readiness: BrowserHandoffArtifactReadiness;
  platform: BrowserHandoffPlatform;
  draftId: string;
  title: string | null;
  content: string;
  target: string | null;
  accountKey: string;
  session: SessionSummary;
  sessionAction: BrowserSessionAction | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: Record<string, unknown> | null;
}

export interface BrowserHandoffArtifactSummary {
  channelAccountId?: number;
  projectId?: number;
  accountDisplayName?: string;
  ownership: BrowserHandoffOwnership;
  handoffAttempt: number;
  platform: BrowserHandoffPlatform;
  draftId: string;
  title: string | null;
  accountKey: string;
  status: BrowserHandoffArtifactStatus;
  readiness: BrowserHandoffArtifactReadiness;
  sessionAction: BrowserSessionAction | null;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: Record<string, unknown> | null;
}

export function writeBrowserHandoffArtifact(input: {
  channelAccountId?: number;
  platform: BrowserHandoffPlatform;
  accountKey: string;
  request: PublishRequest;
  session: SessionSummary;
  sessionAction?: BrowserSessionAction | null;
}) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, String(input.request.draftId));
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);
  const now = new Date().toISOString();
  const existingArtifact = readBrowserHandoffArtifact(absolutePath);
  const handoffAttempt = existingArtifact ? existingArtifact.handoffAttempt + 1 : 1;
  const artifactRecord: BrowserHandoffArtifactRecord = {
    type: 'browser_manual_handoff',
    ...(typeof input.channelAccountId === 'number' ? { channelAccountId: input.channelAccountId } : {}),
    handoffAttempt,
    status: 'pending',
    readiness: input.sessionAction ? 'blocked' : 'ready',
    platform: input.platform,
    draftId: String(input.request.draftId),
    title: input.request.title ?? null,
    content: input.request.content,
    target: input.request.target ?? null,
    accountKey: input.accountKey,
    session: input.session,
    sessionAction: input.sessionAction ?? null,
    createdAt: existingArtifact?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: null,
    resolution: null,
  };

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(artifactRecord, null, 2), 'utf8');

  return {
    artifactPath,
    handoffAttempt: artifactRecord.handoffAttempt,
    createdAt: artifactRecord.createdAt,
    updatedAt: artifactRecord.updatedAt,
    absolutePath,
  };
}

export function markBrowserHandoffArtifactObsolete(input: {
  platform: BrowserHandoffPlatform;
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
  platform: BrowserHandoffPlatform;
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
  platform: BrowserHandoffPlatform;
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

export function promoteBrowserHandoffArtifactToReady(input: {
  artifactPath: string;
}) {
  const normalizedPath = input.artifactPath.trim().replace(/\\/g, '/');
  if (!normalizedPath) {
    return null;
  }

  const artifactRootDir = resolveArtifactRootDir();
  const absolutePath = path.resolve(artifactRootDir, normalizedPath);
  const portablePath = path.relative(artifactRootDir, absolutePath).split(path.sep).join('/');
  if (!portablePath.startsWith('artifacts/browser-handoffs/')) {
    return null;
  }

  const artifact = readBrowserHandoffArtifact(absolutePath);
  if (!artifact || artifact.status !== 'pending') {
    return null;
  }

  const nextArtifact: BrowserHandoffArtifactRecord = {
    ...artifact,
    readiness: 'ready',
    sessionAction: null,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(absolutePath, JSON.stringify(nextArtifact, null, 2), 'utf8');

  return {
    artifactPath: portablePath,
    updatedAt: nextArtifact.updatedAt,
    readiness: nextArtifact.readiness,
    sessionAction: nextArtifact.sessionAction,
  };
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

        const draftProjectId = readDraftProjectId(artifact);
        const ownership = resolveBrowserHandoffOwnership(artifact, channelAccounts, draftProjectId);

        artifacts.push({
          ...('channelAccountId' in ownership &&
          typeof ownership.channelAccountId === 'number'
            ? { channelAccountId: ownership.channelAccountId }
            : {}),
          ...(typeof draftProjectId === 'number' ? { projectId: draftProjectId } : {}),
          ...('accountDisplayName' in ownership && ownership.accountDisplayName
            ? { accountDisplayName: ownership.accountDisplayName }
            : {}),
          ownership: ownership.ownership,
          handoffAttempt: artifact.handoffAttempt,
          platform: artifact.platform,
          draftId: artifact.draftId,
          title: artifact.title,
          accountKey: artifact.accountKey,
          status: artifact.status,
          readiness: artifact.readiness,
          sessionAction: artifact.sessionAction,
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
  return findLatestBrowserHandoffArtifact(input, listBrowserHandoffArtifacts());
}

export function findLatestBrowserHandoffArtifact(
  input: {
    channelAccountId?: number;
    platform: string;
    accountKey: string;
  },
  artifacts: BrowserHandoffArtifactSummary[],
): BrowserHandoffArtifactSummary | null {
  const normalizedPlatform = normalizeBrowserHandoffPlatform(input.platform);
  const matchingArtifacts = artifacts.filter(
    (artifact) =>
      artifact.platform === normalizedPlatform &&
      artifact.accountKey === input.accountKey,
  );

  if (typeof input.channelAccountId === 'number') {
    const exactMatch = matchingArtifacts.find(
      (artifact) => artifact.channelAccountId === input.channelAccountId,
    );
    if (exactMatch) {
      return exactMatch;
    }

    if (matchingArtifacts.some((artifact) => typeof artifact.channelAccountId === 'number')) {
      return null;
    }
  }

  const latest = matchingArtifacts[0];

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

  const draftProjectId = readDraftProjectId(artifact);
  const ownership = resolveBrowserHandoffOwnership(artifact, channelAccountStore.list(), draftProjectId);

  return {
    ...('channelAccountId' in ownership &&
    typeof ownership.channelAccountId === 'number'
      ? { channelAccountId: ownership.channelAccountId }
      : {}),
    ...(typeof draftProjectId === 'number' ? { projectId: draftProjectId } : {}),
    ...('accountDisplayName' in ownership && ownership.accountDisplayName
      ? { accountDisplayName: ownership.accountDisplayName }
      : {}),
    ownership: ownership.ownership,
    handoffAttempt: artifact.handoffAttempt,
    platform: artifact.platform,
    draftId: artifact.draftId,
    title: artifact.title,
    accountKey: artifact.accountKey,
    status: artifact.status,
    readiness: artifact.readiness,
    sessionAction: artifact.sessionAction,
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
  draftProjectId = readDraftProjectId(artifact),
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

  const inferredChannelAccountId = inferChannelAccountIdFromDraft(artifact, channelAccounts, draftProjectId);
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
    platform: BrowserHandoffPlatform;
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
    return artifact.type === 'browser_manual_handoff'
      ? {
          ...artifact,
          handoffAttempt: normalizeHandoffAttempt(artifact.handoffAttempt),
          readiness: artifact.readiness === 'blocked' ? 'blocked' : 'ready',
          sessionAction:
            artifact.sessionAction === 'request_session' || artifact.sessionAction === 'relogin'
              ? artifact.sessionAction
              : null,
        }
      : null;
  } catch {
    return null;
  }
}

function normalizeHandoffAttempt(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
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
  draftProjectId = readDraftProjectId(artifact),
) {
  const draftId = Number(artifact.draftId);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return undefined;
  }

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
