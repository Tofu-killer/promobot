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
  handoffAttempt: number;
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
  handoffAttempt?: number;
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
  handoffAttempt: number;
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
  const handoffAttempt = normalizeHandoffAttempt(input.handoffAttempt);
  const artifactPath = buildAttemptArtifactPath(
    input.platform,
    input.accountKey,
    input.draftId,
    handoffAttempt,
  );
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_manual_handoff_result',
        handoffArtifactPath: input.handoffArtifactPath,
        handoffAttempt,
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
  handoffAttempt?: number;
}): BrowserHandoffResultArtifactSummary | null {
  const normalizedPlatform = normalizePlatform(input.platform);
  const artifactRootDir = resolveArtifactRootDir();

  for (const artifactPath of buildLookupArtifactPaths({
    platform: normalizedPlatform,
    accountKey: input.accountKey,
    draftId: input.draftId,
    handoffAttempt: input.handoffAttempt,
  })) {
    const artifact = getBrowserHandoffResultArtifactByAbsolutePath(
      path.join(artifactRootDir, artifactPath),
    );
    if (artifact) {
      return artifact;
    }
  }

  return null;
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
  handoffAttempt?: number;
}) {
  const normalizedPlatform = normalizePlatform(input.platform);
  const artifactRootDir = resolveArtifactRootDir();
  let clearedArtifactPath: string | null = null;

  for (const artifactPath of buildClearArtifactPaths({
    platform: normalizedPlatform,
    accountKey: input.accountKey,
    draftId: input.draftId,
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
    handoffAttempt: artifact.handoffAttempt,
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
    return artifact.type === 'browser_manual_handoff_result'
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
  platform: BrowserHandoffPlatform,
  accountKey: string,
  draftId: string,
  handoffAttempt: number,
) {
  return path.join(
    'artifacts',
    'browser-handoff-results',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
    `${sanitizeSegment(platform)}-draft-${draftId}-attempt-${handoffAttempt}.json`,
  );
}

function buildLegacyArtifactPath(
  platform: BrowserHandoffPlatform,
  accountKey: string,
  draftId: string,
) {
  return path.join(
    'artifacts',
    'browser-handoff-results',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
    `${sanitizeSegment(platform)}-draft-${draftId}.json`,
  );
}

function buildLookupArtifactPaths(input: {
  platform: BrowserHandoffPlatform;
  accountKey: string;
  draftId: string;
  handoffAttempt?: number;
}) {
  const candidatePaths: string[] = [];
  const handoffAttempt = normalizeOptionalHandoffAttempt(input.handoffAttempt);

  if (handoffAttempt !== null) {
    candidatePaths.push(
      buildAttemptArtifactPath(input.platform, input.accountKey, input.draftId, handoffAttempt),
    );
  }

  if (handoffAttempt === null || handoffAttempt === 1) {
    candidatePaths.push(buildLegacyArtifactPath(input.platform, input.accountKey, input.draftId));
  }

  return candidatePaths;
}

function buildClearArtifactPaths(input: {
  platform: BrowserHandoffPlatform;
  accountKey: string;
  draftId: string;
  handoffAttempt?: number;
}) {
  const candidatePaths = new Set<string>();
  const handoffAttempt = normalizeOptionalHandoffAttempt(input.handoffAttempt);

  if (handoffAttempt !== null) {
    candidatePaths.add(
      buildAttemptArtifactPath(input.platform, input.accountKey, input.draftId, handoffAttempt),
    );
  }

  candidatePaths.add(buildLegacyArtifactPath(input.platform, input.accountKey, input.draftId));
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

function normalizePlatform(platform: string): BrowserHandoffPlatform {
  return (platform === 'facebook-group' ? 'facebookGroup' : platform) as BrowserHandoffPlatform;
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
