import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import { createChannelAccountStore } from '../../store/channelAccounts.js';
import { createInboxStore, type InboxItemRecord } from '../../store/inbox.js';
import type { SessionSummary } from '../browser/sessionStore.js';

export type InboxReplyHandoffArtifactStatus = 'pending' | 'resolved' | 'obsolete';
export type InboxReplyHandoffPlatform =
  | 'x'
  | 'reddit'
  | 'facebookGroup'
  | 'instagram'
  | 'tiktok'
  | 'xiaohongshu'
  | 'weibo';
export type InboxReplyHandoffOwnership = 'direct' | 'item_project' | 'unmatched';

const channelAccountStore = createChannelAccountStore();
const inboxStore = createInboxStore();

interface InboxReplyHandoffArtifactRecord {
  type: 'browser_inbox_reply_handoff';
  channelAccountId?: number;
  ownership?: InboxReplyHandoffOwnership;
  projectId?: number;
  status: InboxReplyHandoffArtifactStatus;
  platform: InboxReplyHandoffPlatform;
  itemId: string;
  source: string;
  title: string | null;
  excerpt: string;
  reply: string;
  author: string | null;
  sourceUrl: string | null;
  accountKey: string;
  session: SessionSummary;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: Record<string, unknown> | null;
}

export interface InboxReplyHandoffArtifactSummary {
  channelAccountId?: number;
  ownership: InboxReplyHandoffOwnership;
  projectId?: number;
  platform: InboxReplyHandoffPlatform;
  itemId: string;
  source: string;
  title: string | null;
  author: string | null;
  accountKey: string;
  status: InboxReplyHandoffArtifactStatus;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: Record<string, unknown> | null;
}

export function writeInboxReplyHandoffArtifact(input: {
  channelAccountId?: number;
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  item: InboxItemRecord;
  reply: string;
  sourceUrl: string | null;
  session: SessionSummary;
}) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, String(input.item.id));
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);
  const now = new Date().toISOString();
  const existingArtifact = readInboxReplyHandoffArtifact(absolutePath);
  const ownership: InboxReplyHandoffOwnership =
    typeof input.channelAccountId === 'number'
      ? 'direct'
      : typeof input.item.projectId === 'number'
        ? 'item_project'
        : 'unmatched';
  const artifactRecord: InboxReplyHandoffArtifactRecord = {
    type: 'browser_inbox_reply_handoff',
    ...(typeof input.channelAccountId === 'number' ? { channelAccountId: input.channelAccountId } : {}),
    ownership,
    ...(typeof input.item.projectId === 'number' ? { projectId: input.item.projectId } : {}),
    status: 'pending',
    platform: input.platform,
    itemId: String(input.item.id),
    source: input.item.source,
    title: input.item.title ?? null,
    excerpt: input.item.excerpt,
    reply: input.reply,
    author: input.item.author ?? null,
    sourceUrl: input.sourceUrl,
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

export function markInboxReplyHandoffArtifactsObsoleteForAccount(input: {
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  reason: 'request_session' | 'relogin';
}) {
  const artifactRootDir = resolveArtifactRootDir();
  const accountDir = path.join(
    artifactRootDir,
    'artifacts',
    'inbox-reply-handoffs',
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
    const artifact = readInboxReplyHandoffArtifact(absolutePath);
    if (!artifact || artifact.status !== 'pending') {
      continue;
    }

    const nextArtifact = updateInboxReplyHandoffArtifact(
      {
        platform: input.platform,
        accountKey: input.accountKey,
        itemId: artifact.itemId,
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

export function resolveInboxReplyHandoffArtifact(input: {
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  itemId: string;
  replyStatus: 'sent' | 'failed';
  itemStatus: string;
  deliveryUrl: string | null;
  externalId: string | null;
  message: string;
  deliveredAt: string | null;
}) {
  return updateInboxReplyHandoffArtifact(input, {
    status: 'resolved',
    replyStatus: input.replyStatus,
    itemStatus: input.itemStatus,
    deliveryUrl: input.deliveryUrl,
    externalId: input.externalId,
    message: input.message,
    deliveredAt: input.deliveredAt,
  });
}

export function listInboxReplyHandoffArtifacts(limit?: number): InboxReplyHandoffArtifactSummary[] {
  const artifactRootDir = resolveArtifactRootDir();
  const handoffDir = path.join(artifactRootDir, 'artifacts', 'inbox-reply-handoffs');
  if (!fs.existsSync(handoffDir)) {
    return [];
  }

  const channelAccounts = channelAccountStore.list();
  const inboxProjectIdByItemId = buildInboxProjectIdByItemIdMap();
  const artifacts: InboxReplyHandoffArtifactSummary[] = [];

  for (const platformEntry of fs.readdirSync(handoffDir, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) {
      continue;
    }

    const platformDir = path.join(handoffDir, platformEntry.name);
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
        const artifact = readInboxReplyHandoffArtifact(absolutePath);
        if (!artifact) {
          continue;
        }

        const ownership = resolveInboxReplyHandoffOwnership(
          artifact,
          channelAccounts,
          inboxProjectIdByItemId,
        );

        artifacts.push({
          ...(typeof ownership.channelAccountId === 'number'
            ? { channelAccountId: ownership.channelAccountId }
            : {}),
          ownership: ownership.ownership,
          ...(typeof ownership.projectId === 'number' ? { projectId: ownership.projectId } : {}),
          platform: artifact.platform,
          itemId: artifact.itemId,
          source: artifact.source,
          title: artifact.title,
          author: artifact.author,
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

export function getInboxReplyHandoffArtifactByPath(artifactPath: string) {
  const artifactRootDir = resolveArtifactRootDir();
  const normalizedPath = artifactPath.trim().replace(/\\/g, '/');
  if (!normalizedPath) {
    return null;
  }

  const absolutePath = path.resolve(artifactRootDir, normalizedPath);
  const portablePath = path.relative(artifactRootDir, absolutePath).split(path.sep).join('/');
  if (!portablePath.startsWith('artifacts/inbox-reply-handoffs/')) {
    return null;
  }

  const artifact = readInboxReplyHandoffArtifact(absolutePath);
  if (!artifact) {
    return null;
  }

  const ownership = resolveInboxReplyHandoffOwnership(
    artifact,
    channelAccountStore.list(),
    buildInboxProjectIdByItemIdMap(),
  );

  return {
    type: artifact.type,
    ...(typeof ownership.channelAccountId === 'number'
      ? { channelAccountId: ownership.channelAccountId }
      : {}),
    ownership: ownership.ownership,
    ...(typeof ownership.projectId === 'number' ? { projectId: ownership.projectId } : {}),
    status: artifact.status,
    platform: artifact.platform,
    itemId: artifact.itemId,
    source: artifact.source,
    title: artifact.title,
    excerpt: artifact.excerpt,
    reply: artifact.reply,
    author: artifact.author,
    sourceUrl: artifact.sourceUrl,
    accountKey: artifact.accountKey,
    session: artifact.session,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    resolvedAt: artifact.resolvedAt,
    resolution: artifact.resolution,
    artifactPath: portablePath,
  };
}

export function getLatestInboxReplyHandoffArtifact(input: {
  channelAccountId?: number;
  platform: string;
  accountKey: string;
}): InboxReplyHandoffArtifactSummary | null {
  const normalizedPlatform = normalizeInboxReplyHandoffPlatform(input.platform);
  const artifacts = listInboxReplyHandoffArtifacts().filter(
    (artifact) =>
      normalizeInboxReplyHandoffPlatform(artifact.platform) === normalizedPlatform &&
      artifact.accountKey === input.accountKey,
  );

  if (artifacts.length === 0) {
    return null;
  }

  if (typeof input.channelAccountId === 'number') {
    return artifacts.find((artifact) => artifact.channelAccountId === input.channelAccountId) ?? null;
  }

  return artifacts[0] ?? null;
}

function resolveInboxReplyHandoffOwnership(
  artifact: InboxReplyHandoffArtifactRecord,
  channelAccounts: Array<{
    id: number;
    projectId: number | null;
    platform: string;
    accountKey: string;
  }>,
  inboxProjectIdByItemId: Map<string, number>,
): {
  channelAccountId?: number;
  ownership: InboxReplyHandoffOwnership;
  projectId?: number;
} {
  const projectId = readInboxReplyHandoffProjectId(artifact, inboxProjectIdByItemId);
  const directMatch =
    typeof artifact.channelAccountId === 'number'
      ? channelAccounts.find((channelAccount) => channelAccount.id === artifact.channelAccountId)
      : undefined;
  const matchingChannelAccounts = channelAccounts.filter(
    (channelAccount) =>
      normalizeInboxReplyHandoffPlatform(channelAccount.platform) ===
        normalizeInboxReplyHandoffPlatform(artifact.platform) &&
      channelAccount.accountKey === artifact.accountKey,
  );

  if (artifact.ownership === 'direct') {
    const projectMatches =
      typeof projectId === 'number'
        ? matchingChannelAccounts.filter((channelAccount) => channelAccount.projectId === projectId)
        : [];

    return {
      ...(directMatch
        ? { channelAccountId: directMatch.id }
        : projectMatches.length === 1
          ? { channelAccountId: projectMatches[0]?.id }
          : typeof projectId !== 'number' && matchingChannelAccounts.length === 1
            ? { channelAccountId: matchingChannelAccounts[0]?.id }
            : {}),
      ownership: 'direct' as const,
      ...(typeof projectId === 'number' ? { projectId } : {}),
    };
  }

  if (artifact.ownership === 'item_project') {
    const projectMatches =
      typeof projectId === 'number'
        ? matchingChannelAccounts.filter((channelAccount) => channelAccount.projectId === projectId)
        : [];

    return {
      ...(projectMatches.length === 1 ? { channelAccountId: projectMatches[0]?.id } : {}),
      ownership: 'item_project' as const,
      ...(typeof projectId === 'number' ? { projectId } : {}),
    };
  }

  if (artifact.ownership === 'unmatched') {
    return {
      ownership: 'unmatched' as const,
      ...(typeof projectId === 'number' ? { projectId } : {}),
    };
  }

  if (typeof artifact.channelAccountId === 'number') {
    if (directMatch) {
      return {
        channelAccountId: artifact.channelAccountId,
        ownership: 'direct' as const,
        ...(typeof projectId === 'number' ? { projectId } : {}),
      };
    }
  }

  if (typeof projectId === 'number') {
    const projectMatches = matchingChannelAccounts.filter(
      (channelAccount) => channelAccount.projectId === projectId,
    );

    if (projectMatches.length === 1) {
      return {
        channelAccountId: projectMatches[0]?.id,
        ownership: 'item_project' as const,
        projectId,
      };
    }

    return {
      ownership: 'unmatched' as const,
      projectId,
    };
  }

  if (matchingChannelAccounts.length === 1) {
    return {
      channelAccountId: matchingChannelAccounts[0]?.id,
      ownership: 'direct' as const,
    };
  }

  return {
    ownership: 'unmatched' as const,
  };
}

function buildArtifactPath(
  platform: InboxReplyHandoffPlatform,
  accountKey: string,
  itemId: string,
) {
  return path
    .join(
      'artifacts',
      'inbox-reply-handoffs',
      sanitizeSegment(platform),
      sanitizeSegment(accountKey),
      `${sanitizeSegment(platform)}-inbox-item-${sanitizeSegment(itemId)}.json`,
    )
    .split(path.sep)
    .join('/');
}

function updateInboxReplyHandoffArtifact(
  input: {
    platform: InboxReplyHandoffPlatform;
    accountKey: string;
    itemId: string;
  },
  resolution: Record<string, unknown>,
) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, input.itemId);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);
  const existingArtifact = readInboxReplyHandoffArtifact(absolutePath);
  if (!existingArtifact) {
    return null;
  }

  const resolvedAt = new Date().toISOString();
  const nextArtifact: InboxReplyHandoffArtifactRecord = {
    ...existingArtifact,
    status: resolution.status === 'obsolete' ? 'obsolete' : 'resolved',
    updatedAt: resolvedAt,
    resolvedAt,
    resolution: {
      status: resolution.status === 'obsolete' ? 'obsolete' : 'resolved',
      ...resolution,
    },
  };

  fs.writeFileSync(absolutePath, JSON.stringify(nextArtifact, null, 2), 'utf8');

  return {
    artifactPath,
    resolvedAt,
  };
}

function readInboxReplyHandoffArtifact(absolutePath: string): InboxReplyHandoffArtifactRecord | null {
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as InboxReplyHandoffArtifactRecord;
    return parsed.type === 'browser_inbox_reply_handoff' ? parsed : null;
  } catch {
    return null;
  }
}

function readInboxReplyHandoffProjectId(
  artifact: InboxReplyHandoffArtifactRecord,
  inboxProjectIdByItemId: Map<string, number>,
) {
  const artifactProjectId = parsePositiveInteger(artifact.projectId);
  if (artifactProjectId !== undefined) {
    return artifactProjectId;
  }

  return inboxProjectIdByItemId.get(artifact.itemId);
}

function buildInboxProjectIdByItemIdMap() {
  const projectIdByItemId = new Map<string, number>();

  for (const item of inboxStore.list()) {
    if (typeof item.projectId === 'number') {
      projectIdByItemId.set(String(item.id), item.projectId);
    }
  }

  return projectIdByItemId;
}

function parsePositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function sanitizeSegment(value: string) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function normalizeInboxReplyHandoffPlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
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
