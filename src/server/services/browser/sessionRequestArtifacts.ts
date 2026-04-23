import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import type { BrowserSessionAction } from './sessionStore.js';

export interface SessionRequestArtifactInput {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestedAt: string;
  jobId: number;
  jobStatus: string;
  nextStep: string;
}

export interface ResolveSessionRequestArtifactsInput {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  resolvedAt: string;
  resolution: string | Record<string, unknown>;
  resolvedJobStatus?: string;
  savedStorageStatePath: string;
}

interface SessionRequestArtifactRecord {
  type: string;
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestedAt: string;
  jobId: number;
  jobStatus: string;
  nextStep: string;
  resolvedAt?: string;
  resolution?: string | Record<string, unknown>;
  savedStorageStatePath?: string;
}

export interface SessionRequestResultArtifactInput {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestJobId: number;
  completedAt: string;
  storageState: Record<string, unknown>;
  sessionStatus?: 'active' | 'expired' | 'missing';
  validatedAt?: string | null;
  notes?: string;
}

interface SessionRequestResultArtifactRecord {
  type: string;
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestJobId: number;
  completedAt: string;
  storageState: Record<string, unknown>;
  sessionStatus?: 'active' | 'expired' | 'missing';
  validatedAt?: string | null;
  notes?: string;
  consumedAt?: string;
  savedStorageStatePath?: string;
  resolution?: string | Record<string, unknown>;
}

export interface SessionRequestArtifactSummary {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  jobStatus: string;
  requestedAt: string;
  artifactPath: string;
  resolvedAt: string | null;
  resolution?: string | Record<string, unknown>;
}

export interface SessionRequestArtifactLookupInput {
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  jobId: number;
}

export interface SessionRequestResultArtifactLookupInput {
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestJobId: number;
}

export interface SessionRequestResultArtifactSummary {
  channelAccountId: number;
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestJobId: number;
  completedAt: string;
  storageState: Record<string, unknown>;
  sessionStatus?: 'active' | 'expired' | 'missing';
  validatedAt?: string | null;
  notes?: string;
  artifactPath: string;
  consumedAt: string | null;
  savedStorageStatePath?: string;
  resolution?: string | Record<string, unknown>;
}

export function createSessionRequestArtifact(input: SessionRequestArtifactInput) {
  const artifactPath = buildArtifactPath(input);
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_lane_request',
        channelAccountId: input.channelAccountId,
        platform: input.platform,
        accountKey: input.accountKey,
        action: input.action,
        requestedAt: input.requestedAt,
        jobId: input.jobId,
        jobStatus: input.jobStatus,
        nextStep: input.nextStep,
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

export function createSessionRequestResultArtifact(input: SessionRequestResultArtifactInput) {
  const artifactPath = buildResultArtifactPath({
    platform: input.platform,
    accountKey: input.accountKey,
    action: input.action,
    requestJobId: input.requestJobId,
  });
  const absolutePath = path.join(resolveArtifactRootDir(), artifactPath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        type: 'browser_lane_result',
        channelAccountId: input.channelAccountId,
        platform: input.platform,
        accountKey: input.accountKey,
        action: input.action,
        requestJobId: input.requestJobId,
        completedAt: input.completedAt,
        storageState: input.storageState,
        sessionStatus: input.sessionStatus ?? 'active',
        ...(input.validatedAt !== undefined ? { validatedAt: input.validatedAt } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );

  return artifactPath;
}

export function resolveSessionRequestArtifacts(input: ResolveSessionRequestArtifactsInput) {
  const artifactRootDir = resolveArtifactRootDir();
  const artifactDir = path.join(
    artifactRootDir,
    buildArtifactDir(input.platform, input.accountKey),
  );

  if (!fs.existsSync(artifactDir)) {
    return [];
  }

  const resolvedPaths: string[] = [];

  for (const entry of fs.readdirSync(artifactDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const absolutePath = path.join(artifactDir, entry.name);
    const artifact = readSessionRequestArtifact(absolutePath);
    if (
      artifact === null ||
      artifact.type !== 'browser_lane_request' ||
      artifact.channelAccountId !== input.channelAccountId ||
      artifact.platform !== input.platform ||
      artifact.accountKey !== input.accountKey ||
      artifact.resolvedAt !== undefined ||
      artifact.resolution !== undefined
    ) {
      continue;
    }

    fs.writeFileSync(
      absolutePath,
      JSON.stringify(
        {
          ...artifact,
          jobStatus: input.resolvedJobStatus ?? artifact.jobStatus,
          resolvedAt: input.resolvedAt,
          resolution: input.resolution,
          savedStorageStatePath: input.savedStorageStatePath,
        },
        null,
        2,
      ),
      'utf8',
    );
    resolvedPaths.push(path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'));
  }

  return resolvedPaths;
}

export function getLatestSessionRequestArtifact(
  input: {
    channelAccountId: number;
    platform: string;
    accountKey: string;
  },
): SessionRequestArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const artifactDir = path.join(
    artifactRootDir,
    buildArtifactDir(input.platform, input.accountKey),
  );

  if (!fs.existsSync(artifactDir)) {
    return null;
  }

  const artifacts = fs
    .readdirSync(artifactDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const absolutePath = path.join(artifactDir, entry.name);
      const artifact = readSessionRequestArtifact(absolutePath);
      if (
        !artifact ||
        artifact.type !== 'browser_lane_request' ||
        artifact.channelAccountId !== input.channelAccountId ||
        artifact.platform !== input.platform ||
        artifact.accountKey !== input.accountKey
      ) {
        return null;
      }

      return {
        artifact,
        artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
      };
    })
    .filter(
      (
        value,
      ): value is {
        artifact: SessionRequestArtifactRecord;
        artifactPath: string;
      } => value !== null,
    )
    .sort((left, right) => {
      const requestedAtComparison = right.artifact.requestedAt.localeCompare(
        left.artifact.requestedAt,
      );
      if (requestedAtComparison !== 0) {
        return requestedAtComparison;
      }

      const jobIdComparison = right.artifact.jobId - left.artifact.jobId;
      if (jobIdComparison !== 0) {
        return jobIdComparison;
      }

      return right.artifactPath.localeCompare(left.artifactPath);
    });

  const latest = artifacts[0];
  if (!latest) {
    return null;
  }

  return {
    channelAccountId: latest.artifact.channelAccountId,
    platform: latest.artifact.platform,
    accountKey: latest.artifact.accountKey,
    action: latest.artifact.action,
    jobStatus: latest.artifact.jobStatus,
    requestedAt: latest.artifact.requestedAt,
    artifactPath: latest.artifactPath,
    resolvedAt: latest.artifact.resolvedAt ?? null,
    ...(latest.artifact.resolution !== undefined ? { resolution: latest.artifact.resolution } : {}),
  };
}

export function getSessionRequestArtifact(
  input: SessionRequestArtifactLookupInput,
): SessionRequestArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const absolutePath = path.join(
    artifactRootDir,
    buildRequestArtifactPath({
      platform: input.platform,
      accountKey: input.accountKey,
      action: input.action,
      jobId: input.jobId,
    }),
  );
  const artifact = readSessionRequestArtifact(absolutePath);

  if (
    !artifact ||
    artifact.type !== 'browser_lane_request' ||
    artifact.platform !== input.platform ||
    artifact.accountKey !== input.accountKey ||
    artifact.action !== input.action ||
    artifact.jobId !== input.jobId
  ) {
    return null;
  }

  return {
    channelAccountId: artifact.channelAccountId,
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    action: artifact.action,
    jobStatus: artifact.jobStatus,
    requestedAt: artifact.requestedAt,
    artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
    resolvedAt: artifact.resolvedAt ?? null,
    ...(artifact.resolution !== undefined ? { resolution: artifact.resolution } : {}),
  };
}

export function getSessionRequestResultArtifact(
  input: SessionRequestResultArtifactLookupInput,
): SessionRequestResultArtifactSummary | null {
  const absolutePath = path.join(
    resolveArtifactRootDir(),
    buildResultArtifactPath({
      platform: input.platform,
      accountKey: input.accountKey,
      action: input.action,
      requestJobId: input.requestJobId,
    }),
  );
  return getSessionRequestResultArtifactByAbsolutePath(absolutePath);
}

export function getSessionRequestResultArtifactByPath(
  artifactPath: string,
): SessionRequestResultArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const normalizedPath = artifactPath.trim().replace(/\\/g, '/');
  const absolutePath = path.resolve(artifactRootDir, normalizedPath);
  const relativePath = path.relative(artifactRootDir, absolutePath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    !relativePath.split(path.sep).join('/').startsWith('artifacts/browser-lane-requests/')
  ) {
    return null;
  }

  return getSessionRequestResultArtifactByAbsolutePath(absolutePath);
}

function getSessionRequestResultArtifactByAbsolutePath(
  absolutePath: string,
): SessionRequestResultArtifactSummary | null {
  const artifactRootDir = resolveArtifactRootDir();
  const artifact = readSessionRequestResultArtifact(absolutePath);

  if (
    !artifact ||
    artifact.type !== 'browser_lane_result'
  ) {
    return null;
  }

  return {
    channelAccountId: artifact.channelAccountId,
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    action: artifact.action,
    requestJobId: artifact.requestJobId,
    completedAt: artifact.completedAt,
    storageState: artifact.storageState,
    ...(artifact.sessionStatus !== undefined ? { sessionStatus: artifact.sessionStatus } : {}),
    ...(artifact.validatedAt !== undefined ? { validatedAt: artifact.validatedAt } : {}),
    ...(artifact.notes !== undefined ? { notes: artifact.notes } : {}),
    artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
    consumedAt: artifact.consumedAt ?? null,
    ...(artifact.savedStorageStatePath !== undefined
      ? { savedStorageStatePath: artifact.savedStorageStatePath }
      : {}),
    ...(artifact.resolution !== undefined ? { resolution: artifact.resolution } : {}),
  };
}

export function markSessionRequestResultArtifactConsumed(input: {
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestJobId: number;
  consumedAt: string;
  savedStorageStatePath: string;
  resolution: string | Record<string, unknown>;
}) {
  const artifactRootDir = resolveArtifactRootDir();
  const absolutePath = path.join(
    artifactRootDir,
    buildResultArtifactPath({
      platform: input.platform,
      accountKey: input.accountKey,
      action: input.action,
      requestJobId: input.requestJobId,
    }),
  );
  const artifact = readSessionRequestResultArtifact(absolutePath);

  if (!artifact || artifact.type !== 'browser_lane_result') {
    return null;
  }

  const nextArtifact: SessionRequestResultArtifactRecord = {
    ...artifact,
    consumedAt: input.consumedAt,
    savedStorageStatePath: input.savedStorageStatePath,
    resolution: input.resolution,
  };

  fs.writeFileSync(absolutePath, JSON.stringify(nextArtifact, null, 2), 'utf8');

  return path.relative(artifactRootDir, absolutePath).split(path.sep).join('/');
}

export function listSessionRequestArtifacts(limit?: number) {
  const artifactRootDir = resolveArtifactRootDir();
  const requestsRoot = path.join(artifactRootDir, 'artifacts', 'browser-lane-requests');

  if (!fs.existsSync(requestsRoot)) {
    return [] as SessionRequestArtifactSummary[];
  }

  const summaries: SessionRequestArtifactSummary[] = [];

  for (const platformEntry of fs.readdirSync(requestsRoot, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) {
      continue;
    }

    const platformDir = path.join(requestsRoot, platformEntry.name);
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
        const artifact = readSessionRequestArtifact(absolutePath);
        if (!artifact || artifact.type !== 'browser_lane_request') {
          continue;
        }

        summaries.push({
          channelAccountId: artifact.channelAccountId,
          platform: artifact.platform,
          accountKey: artifact.accountKey,
          action: artifact.action,
          jobStatus: artifact.jobStatus,
          requestedAt: artifact.requestedAt,
          artifactPath: path.relative(artifactRootDir, absolutePath).split(path.sep).join('/'),
          resolvedAt: artifact.resolvedAt ?? null,
          ...(artifact.resolution !== undefined ? { resolution: artifact.resolution } : {}),
        });
      }
    }
  }

  const sorted = summaries.sort((left, right) => {
    const requestedAtComparison = right.requestedAt.localeCompare(left.requestedAt);
    if (requestedAtComparison !== 0) {
      return requestedAtComparison;
    }

    return right.artifactPath.localeCompare(left.artifactPath);
  });

  return typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
}

function buildArtifactPath(input: SessionRequestArtifactInput) {
  return buildRequestArtifactPath({
    platform: input.platform,
    accountKey: input.accountKey,
    action: input.action,
    jobId: input.jobId,
  });
}

function buildRequestArtifactPath(input: {
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  jobId: number;
}) {
  return path.join(
    buildArtifactDir(input.platform, input.accountKey),
    `${input.action === 'request_session' ? 'request-session' : 'relogin'}-job-${input.jobId}.json`,
  );
}

function buildResultArtifactPath(input: {
  platform: string;
  accountKey: string;
  action: BrowserSessionAction;
  requestJobId: number;
}) {
  return path.join(
    buildArtifactDir(input.platform, input.accountKey),
    `${input.action === 'request_session' ? 'request-session' : 'relogin'}-job-${input.requestJobId}.result.json`,
  );
}

function buildArtifactDir(platform: string, accountKey: string) {
  return path.join(
    'artifacts',
    'browser-lane-requests',
    sanitizeSegment(platform),
    sanitizeSegment(accountKey),
  );
}

function sanitizeSegment(value: string) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'default';
}

function readSessionRequestArtifact(absolutePath: string): SessionRequestArtifactRecord | null {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as SessionRequestArtifactRecord;
  } catch {
    return null;
  }
}

function readSessionRequestResultArtifact(
  absolutePath: string,
): SessionRequestResultArtifactRecord | null {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as SessionRequestResultArtifactRecord;
  } catch {
    return null;
  }
}

function resolveArtifactRootDir() {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return process.cwd();
  }

  const databaseDir = path.dirname(databasePath);
  return path.basename(databaseDir) === 'data' ? path.dirname(databaseDir) : databaseDir;
}
