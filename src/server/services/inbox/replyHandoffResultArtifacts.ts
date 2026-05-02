import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import type { InboxReplyHandoffPlatform } from './replyHandoffArtifacts.js';

interface InboxReplyHandoffResultArtifactRecord {
  type: 'browser_inbox_reply_handoff_result';
  handoffArtifactPath: string;
  handoffAttempt: number;
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
  handoffAttempt?: number;
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
  handoffAttempt: number;
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
  const handoffAttempt = normalizeHandoffAttempt(input.handoffAttempt);
  const artifactPath = buildAttemptArtifactPath(
    input.platform,
    input.accountKey,
    input.itemId,
    handoffAttempt,
  );
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_inbox_reply_handoff_result',
        handoffArtifactPath: input.handoffArtifactPath,
        handoffAttempt,
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
  handoffAttempt?: number;
}): InboxReplyHandoffResultArtifactSummary | null {
  const normalizedPlatform = normalizePlatform(input.platform);
  const artifactRootDir = resolveArtifactRootDir();

  for (const artifactPath of buildLookupArtifactPaths({
    platform: normalizedPlatform,
    accountKey: input.accountKey,
    itemId: input.itemId,
    handoffAttempt: input.handoffAttempt,
  })) {
    const artifact = getInboxReplyHandoffResultArtifactByAbsolutePath(
      path.join(artifactRootDir, artifactPath),
    );
    if (artifact) {
      return artifact;
    }
  }

  return null;
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
  handoffAttempt?: number;
}) {
  const normalizedPlatform = normalizePlatform(input.platform);
  const artifactRootDir = resolveArtifactRootDir();
  let clearedArtifactPath: string | null = null;

  for (const artifactPath of buildClearArtifactPaths({
    platform: normalizedPlatform,
    accountKey: input.accountKey,
    itemId: input.itemId,
    handoffAttempt: input.handoffAttempt,
  })) {
    const absolutePath = path.join(artifactRootDir, artifactPath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    fs.rmSync(absolutePath, { force: true });
    clearedArtifactPath ??= artifactPath;
  }

  return clearedArtifactPath;
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
    handoffAttempt: artifact.handoffAttempt,
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
    return artifact.type === 'browser_inbox_reply_handoff_result'
      ? {
          ...artifact,
          handoffAttempt: normalizeHandoffAttempt(artifact.handoffAttempt),
        }
      : null;
  } catch {
    return null;
  }
}

function buildAttemptArtifactPath(
  platform: InboxReplyHandoffPlatform,
  accountKey: string,
  itemId: string,
  handoffAttempt: number,
) {
  return path.join(
    'artifacts',
    'inbox-reply-handoff-results',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
    `${sanitizeSegment(platform)}-inbox-item-${sanitizeSegment(itemId)}-attempt-${handoffAttempt}.json`,
  );
}

function buildLegacyArtifactPath(
  platform: InboxReplyHandoffPlatform,
  accountKey: string,
  itemId: string,
) {
  return path.join(
    'artifacts',
    'inbox-reply-handoff-results',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
    `${sanitizeSegment(platform)}-inbox-item-${sanitizeSegment(itemId)}.json`,
  );
}

function buildLookupArtifactPaths(input: {
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  itemId: string;
  handoffAttempt?: number;
}) {
  const candidatePaths: string[] = [];
  const handoffAttempt = normalizeOptionalHandoffAttempt(input.handoffAttempt);

  if (handoffAttempt !== null) {
    candidatePaths.push(
      buildAttemptArtifactPath(input.platform, input.accountKey, input.itemId, handoffAttempt),
    );
  }

  if (handoffAttempt === null || handoffAttempt === 1) {
    candidatePaths.push(buildLegacyArtifactPath(input.platform, input.accountKey, input.itemId));
  }

  return candidatePaths;
}

function buildClearArtifactPaths(input: {
  platform: InboxReplyHandoffPlatform;
  accountKey: string;
  itemId: string;
  handoffAttempt?: number;
}) {
  const candidatePaths = new Set<string>();
  const handoffAttempt = normalizeOptionalHandoffAttempt(input.handoffAttempt);

  if (handoffAttempt !== null) {
    candidatePaths.add(
      buildAttemptArtifactPath(input.platform, input.accountKey, input.itemId, handoffAttempt),
    );
  }

  candidatePaths.add(buildLegacyArtifactPath(input.platform, input.accountKey, input.itemId));
  return [...candidatePaths];
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

function normalizeHandoffAttempt(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizeOptionalHandoffAttempt(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeHandoffAttempt(value);
}
