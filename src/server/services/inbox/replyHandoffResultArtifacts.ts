import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import type { InboxReplyHandoffPlatform } from './replyHandoffArtifacts.js';

interface InboxReplyHandoffResultArtifactRecord {
  type: 'browser_inbox_reply_handoff_result';
  handoffArtifactPath: string;
  channelAccountId?: number;
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  itemId: string;
  completedAt: string;
  replyStatus: 'sent' | 'failed';
  message: string;
  deliveryUrl?: string | null;
  externalId?: string | null;
  deliveredAt?: string | null;
  consumedAt?: string;
  resolution?: string | Record<string, unknown>;
}

export interface InboxReplyHandoffResultArtifactInput {
  handoffArtifactPath: string;
  channelAccountId?: number;
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  itemId: string;
  completedAt: string;
  replyStatus: 'sent' | 'failed';
  message: string;
  deliveryUrl?: string | null;
  externalId?: string | null;
  deliveredAt?: string | null;
}

export interface InboxReplyHandoffResultArtifactSummary {
  type: 'browser_inbox_reply_handoff_result';
  handoffArtifactPath: string;
  channelAccountId?: number;
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  itemId: string;
  completedAt: string;
  replyStatus: 'sent' | 'failed';
  message: string;
  deliveryUrl?: string | null;
  externalId?: string | null;
  deliveredAt?: string | null;
  artifactPath: string;
  consumedAt: string | null;
  resolution?: string | Record<string, unknown>;
}

export function createInboxReplyHandoffResultArtifact(
  input: InboxReplyHandoffResultArtifactInput,
) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, input.itemId);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_inbox_reply_handoff_result',
        handoffArtifactPath: input.handoffArtifactPath,
        ...(typeof input.channelAccountId === 'number' ? { channelAccountId: input.channelAccountId } : {}),
        platform: input.platform,
        accountKey: input.accountKey,
        itemId: input.itemId,
        completedAt: input.completedAt,
        replyStatus: input.replyStatus,
        message: input.message,
        ...(input.deliveryUrl !== undefined ? { deliveryUrl: input.deliveryUrl } : {}),
        ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
        ...(input.deliveredAt !== undefined ? { deliveredAt: input.deliveredAt } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

export function getInboxReplyHandoffResultArtifact(input: {
  platform: string;
  accountKey: string;
  itemId: string;
}): InboxReplyHandoffResultArtifactSummary | null {
  const normalizedPlatform = normalizePlatform(input.platform);
  const absolutePath = path.join(
    resolveArtifactRootDir(),
    buildArtifactPath(normalizedPlatform, input.accountKey, input.itemId),
  );

  return getInboxReplyHandoffResultArtifactByAbsolutePath(absolutePath);
}

export function getInboxReplyHandoffResultArtifactByPath(
  artifactPath: string,
): InboxReplyHandoffResultArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const normalizedPath = artifactPath.trim().replace(/\\/g, '/');
  const absolutePath = path.resolve(artifactRootDir, normalizedPath);
  const relativePath = path.relative(artifactRootDir, absolutePath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    !relativePath.split(path.sep).join('/').startsWith('artifacts/inbox-reply-handoff-results/')
  ) {
    return null;
  }

  return getInboxReplyHandoffResultArtifactByAbsolutePath(absolutePath);
}

export function markInboxReplyHandoffResultArtifactConsumed(input: {
  artifactPath: string;
  consumedAt: string;
  resolution: string | Record<string, unknown>;
}) {
  const artifactRootDir = resolveArtifactRootDir();
  const absolutePath = path.resolve(artifactRootDir, input.artifactPath);
  const artifact = readInboxReplyHandoffResultArtifact(absolutePath);
  if (!artifact) {
    return null;
  }

  const nextArtifact: InboxReplyHandoffResultArtifactRecord = {
    ...artifact,
    consumedAt: input.consumedAt,
    resolution: input.resolution,
  };

  fs.writeFileSync(absolutePath, JSON.stringify(nextArtifact, null, 2), 'utf8');
  return path.relative(artifactRootDir, absolutePath).split(path.sep).join('/');
}

export function clearInboxReplyHandoffResultArtifact(input: {
  platform: string;
  accountKey: string;
  itemId: string;
}) {
  const normalizedPlatform = normalizePlatform(input.platform);
  const artifactPath = buildArtifactPath(normalizedPlatform, input.accountKey, input.itemId);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  fs.rmSync(absolutePath, { force: true });
  return artifactPath;
}

function getInboxReplyHandoffResultArtifactByAbsolutePath(
  absolutePath: string,
): InboxReplyHandoffResultArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const artifact = readInboxReplyHandoffResultArtifact(absolutePath);
  if (!artifact) {
    return null;
  }

  return {
    type: artifact.type,
    handoffArtifactPath: artifact.handoffArtifactPath,
    ...(typeof artifact.channelAccountId === 'number'
      ? { channelAccountId: artifact.channelAccountId }
      : {}),
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    itemId: artifact.itemId,
    completedAt: artifact.completedAt,
    replyStatus: artifact.replyStatus,
    message: artifact.message,
    ...(artifact.deliveryUrl !== undefined ? { deliveryUrl: artifact.deliveryUrl } : {}),
    ...(artifact.externalId !== undefined ? { externalId: artifact.externalId } : {}),
    ...(artifact.deliveredAt !== undefined ? { deliveredAt: artifact.deliveredAt } : {}),
    artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
    consumedAt: artifact.consumedAt ?? null,
    ...(artifact.resolution !== undefined ? { resolution: artifact.resolution } : {}),
  };
}

function readInboxReplyHandoffResultArtifact(
  absolutePath: string,
): InboxReplyHandoffResultArtifactRecord | null {
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    const artifact = JSON.parse(
      fs.readFileSync(absolutePath, 'utf8'),
    ) as InboxReplyHandoffResultArtifactRecord;
    return artifact.type === 'browser_inbox_reply_handoff_result' ? artifact : null;
  } catch {
    return null;
  }
}

function buildArtifactPath(platform: InboxReplyHandoffPlatform, accountKey: string, itemId: string) {
  return path.join(
    'artifacts',
    'inbox-reply-handoff-results',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
    `${sanitizeSegment(platform)}-inbox-item-${sanitizeSegment(itemId)}.json`,
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

function normalizePlatform(platform: string): InboxReplyHandoffPlatform {
  return (platform === 'facebook-group' ? 'facebookGroup' : platform) as InboxReplyHandoffPlatform;
}
