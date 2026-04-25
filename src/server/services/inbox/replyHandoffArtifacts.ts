import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import type { InboxItemRecord } from '../../store/inbox.js';
import type { SessionSummary } from '../browser/sessionStore.js';

export type InboxReplyHandoffArtifactStatus = 'pending' | 'resolved' | 'obsolete';
export type InboxReplyHandoffPlatform = 'x' | 'reddit' | 'facebookGroup' | 'xiaohongshu' | 'weibo';

interface InboxReplyHandoffArtifactRecord {
  type: 'browser_inbox_reply_handoff';
  channelAccountId?: number;
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
  const artifactRecord: InboxReplyHandoffArtifactRecord = {
    type: 'browser_inbox_reply_handoff',
    ...(typeof input.channelAccountId === 'number' ? { channelAccountId: input.channelAccountId } : {}),
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

        artifacts.push({
          ...(typeof artifact.channelAccountId === 'number'
            ? { channelAccountId: artifact.channelAccountId }
            : {}),
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

  return {
    ...artifact,
    artifactPath: portablePath,
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
