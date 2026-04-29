import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import type { PublisherPlatform } from './types.js';

type BrowserHandoffPlatform = Extract<
  PublisherPlatform,
  'facebookGroup' | 'instagram' | 'tiktok' | 'xiaohongshu' | 'weibo'
>;

interface BrowserHandoffResultArtifactRecord {
  type: 'browser_manual_handoff_result';
  handoffArtifactPath: string;
  channelAccountId?: number;
  platform: BrowserHandoffPlatform;
  accountKey: string;
  draftId: string;
  completedAt: string;
  publishStatus: 'published' | 'failed';
  message: string;
  publishUrl?: string | null;
  externalId?: string | null;
  publishedAt?: string | null;
  consumedAt?: string;
  resolution?: string | Record<string, unknown>;
}

export interface BrowserHandoffResultArtifactInput {
  handoffArtifactPath: string;
  channelAccountId?: number;
  platform: BrowserHandoffPlatform;
  accountKey: string;
  draftId: string;
  completedAt: string;
  publishStatus: 'published' | 'failed';
  message: string;
  publishUrl?: string | null;
  externalId?: string | null;
  publishedAt?: string | null;
}

export interface BrowserHandoffResultArtifactSummary {
  handoffArtifactPath: string;
  channelAccountId?: number;
  platform: BrowserHandoffPlatform;
  accountKey: string;
  draftId: string;
  completedAt: string;
  publishStatus: 'published' | 'failed';
  message: string;
  publishUrl?: string | null;
  externalId?: string | null;
  publishedAt?: string | null;
  artifactPath: string;
  consumedAt: string | null;
  resolution?: string | Record<string, unknown>;
}

export function createBrowserHandoffResultArtifact(input: BrowserHandoffResultArtifactInput) {
  const artifactPath = buildArtifactPath(input.platform, input.accountKey, input.draftId);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_manual_handoff_result',
        handoffArtifactPath: input.handoffArtifactPath,
        ...(typeof input.channelAccountId === 'number' ? { channelAccountId: input.channelAccountId } : {}),
        platform: input.platform,
        accountKey: input.accountKey,
        draftId: input.draftId,
        completedAt: input.completedAt,
        publishStatus: input.publishStatus,
        message: input.message,
        ...(input.publishUrl !== undefined ? { publishUrl: input.publishUrl } : {}),
        ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
        ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

export function getBrowserHandoffResultArtifact(input: {
  platform: string;
  accountKey: string;
  draftId: string;
}): BrowserHandoffResultArtifactSummary | null {
  const normalizedPlatform = normalizePlatform(input.platform);
  const absolutePath = path.join(
    resolveArtifactRootDir(),
    buildArtifactPath(normalizedPlatform, input.accountKey, input.draftId),
  );

  return getBrowserHandoffResultArtifactByAbsolutePath(absolutePath);
}

export function getBrowserHandoffResultArtifactByPath(
  artifactPath: string,
): BrowserHandoffResultArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const normalizedPath = artifactPath.trim().replace(/\\/g, '/');
  const absolutePath = path.resolve(artifactRootDir, normalizedPath);
  const relativePath = path.relative(artifactRootDir, absolutePath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    !relativePath.split(path.sep).join('/').startsWith('artifacts/browser-handoff-results/')
  ) {
    return null;
  }

  return getBrowserHandoffResultArtifactByAbsolutePath(absolutePath);
}

export function markBrowserHandoffResultArtifactConsumed(input: {
  artifactPath: string;
  consumedAt: string;
  resolution: string | Record<string, unknown>;
}) {
  const artifactRootDir = resolveArtifactRootDir();
  const absolutePath = path.resolve(artifactRootDir, input.artifactPath);
  const artifact = readBrowserHandoffResultArtifact(absolutePath);
  if (!artifact) {
    return null;
  }

  const nextArtifact: BrowserHandoffResultArtifactRecord = {
    ...artifact,
    consumedAt: input.consumedAt,
    resolution: input.resolution,
  };

  fs.writeFileSync(absolutePath, JSON.stringify(nextArtifact, null, 2), 'utf8');
  return path.relative(artifactRootDir, absolutePath).split(path.sep).join('/');
}

export function clearBrowserHandoffResultArtifact(input: {
  platform: string;
  accountKey: string;
  draftId: string;
}) {
  const normalizedPlatform = normalizePlatform(input.platform);
  const artifactPath = buildArtifactPath(normalizedPlatform, input.accountKey, input.draftId);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  fs.rmSync(absolutePath, { force: true });
  return artifactPath;
}

function getBrowserHandoffResultArtifactByAbsolutePath(
  absolutePath: string,
): BrowserHandoffResultArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const artifact = readBrowserHandoffResultArtifact(absolutePath);
  if (!artifact) {
    return null;
  }

  return {
    handoffArtifactPath: artifact.handoffArtifactPath,
    ...(typeof artifact.channelAccountId === 'number'
      ? { channelAccountId: artifact.channelAccountId }
      : {}),
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    draftId: artifact.draftId,
    completedAt: artifact.completedAt,
    publishStatus: artifact.publishStatus,
    message: artifact.message,
    ...(artifact.publishUrl !== undefined ? { publishUrl: artifact.publishUrl } : {}),
    ...(artifact.externalId !== undefined ? { externalId: artifact.externalId } : {}),
    ...(artifact.publishedAt !== undefined ? { publishedAt: artifact.publishedAt } : {}),
    artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
    consumedAt: artifact.consumedAt ?? null,
    ...(artifact.resolution !== undefined ? { resolution: artifact.resolution } : {}),
  };
}

function readBrowserHandoffResultArtifact(
  absolutePath: string,
): BrowserHandoffResultArtifactRecord | null {
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    const artifact = JSON.parse(
      fs.readFileSync(absolutePath, 'utf8'),
    ) as BrowserHandoffResultArtifactRecord;
    return artifact.type === 'browser_manual_handoff_result' ? artifact : null;
  } catch {
    return null;
  }
}

function buildArtifactPath(platform: BrowserHandoffPlatform, accountKey: string, draftId: string) {
  return path.join(
    'artifacts',
    'browser-handoff-results',
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

function normalizePlatform(platform: string): BrowserHandoffPlatform {
  return (platform === 'facebook-group' ? 'facebookGroup' : platform) as BrowserHandoffPlatform;
}
