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
  return path.join(
    buildArtifactDir(input.platform, input.accountKey),
    `${input.action === 'request_session' ? 'request-session' : 'relogin'}-job-${input.jobId}.json`,
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

function resolveArtifactRootDir() {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return process.cwd();
  }

  const databaseDir = path.dirname(databasePath);
  return path.basename(databaseDir) === 'data' ? path.dirname(databaseDir) : databaseDir;
}
