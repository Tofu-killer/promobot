import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';
import { createChannelAccountStore } from '../../store/channelAccounts.js';
import { createSQLiteDraftStore } from '../../store/drafts.js';

const channelAccountStore = createChannelAccountStore();
const draftStore = createSQLiteDraftStore();

export interface BrowserLaneRequestHealthSummary {
  total: number;
  pending: number;
  resolved: number;
}

export interface BrowserHandoffHealthSummary {
  total: number;
  pending: number;
  resolved: number;
  obsolete: number;
  unmatched: number;
}

export interface BrowserArtifactHealthSummary {
  laneRequests: BrowserLaneRequestHealthSummary;
  handoffs: BrowserHandoffHealthSummary;
}

interface BrowserLaneRequestArtifactRecord {
  type: string;
  resolvedAt?: string;
}

interface BrowserHandoffArtifactRecord {
  type: string;
  channelAccountId?: number;
  platform?: string;
  draftId?: string;
  accountKey?: string;
  status?: string;
}

interface HealthChannelAccountRecord {
  id: number;
  projectId: number | null;
  platform: string;
  accountKey: string;
}

const BROWSER_ARTIFACT_HEALTH_CACHE_TTL_MS = 1000;

let cachedSummary:
  | {
      expiresAtMs: number;
      laneRootDir: string;
      handoffRootDir: string;
      summary: BrowserArtifactHealthSummary;
    }
  | null = null;

export function createBrowserArtifactHealthSummary(): BrowserArtifactHealthSummary {
  const laneRootDir = resolveBrowserArtifactRootDir();
  const handoffRootDir = resolveBrowserHandoffArtifactRootDir();
  const nowMs = Date.now();

  if (
    cachedSummary &&
    cachedSummary.expiresAtMs > nowMs &&
    cachedSummary.laneRootDir === laneRootDir &&
    cachedSummary.handoffRootDir === handoffRootDir
  ) {
    return cachedSummary.summary;
  }

  const summary = buildBrowserArtifactHealthSummary(laneRootDir, handoffRootDir);

  cachedSummary = {
    expiresAtMs: nowMs + BROWSER_ARTIFACT_HEALTH_CACHE_TTL_MS,
    laneRootDir,
    handoffRootDir,
    summary,
  };

  return summary;
}

export function resetBrowserArtifactHealthSummaryCache() {
  cachedSummary = null;
}

function buildBrowserArtifactHealthSummary(
  laneRootDir: string,
  handoffRootDir: string,
): BrowserArtifactHealthSummary {
  try {
    return {
      laneRequests: readBrowserLaneRequestHealthSummary(laneRootDir),
      handoffs: readBrowserHandoffHealthSummary(handoffRootDir),
    };
  } catch {
    return createEmptyBrowserArtifactHealthSummary();
  }
}

function readBrowserLaneRequestHealthSummary(rootDir: string): BrowserLaneRequestHealthSummary {
  const summary: BrowserLaneRequestHealthSummary = {
    total: 0,
    pending: 0,
    resolved: 0,
  };
  const requestsDir = path.join(rootDir, 'artifacts', 'browser-lane-requests');

  if (!fs.existsSync(requestsDir)) {
    return summary;
  }

  for (const absolutePath of walkJsonFiles(requestsDir)) {
    const artifact = readJsonFile<BrowserLaneRequestArtifactRecord>(absolutePath);
    if (!artifact || artifact.type !== 'browser_lane_request') {
      continue;
    }

    summary.total += 1;
    if (typeof artifact.resolvedAt === 'string') {
      summary.resolved += 1;
    } else {
      summary.pending += 1;
    }
  }

  return summary;
}

function readBrowserHandoffHealthSummary(rootDir: string): BrowserHandoffHealthSummary {
  const summary: BrowserHandoffHealthSummary = {
    total: 0,
    pending: 0,
    resolved: 0,
    obsolete: 0,
    unmatched: 0,
  };
  const handoffDir = path.join(rootDir, 'artifacts', 'browser-handoffs');

  if (!fs.existsSync(handoffDir)) {
    return summary;
  }

  const channelAccounts = channelAccountStore
    .list()
    .map(
      (channelAccount): HealthChannelAccountRecord => ({
        id: channelAccount.id,
        projectId: channelAccount.projectId,
        platform: channelAccount.platform,
        accountKey: channelAccount.accountKey,
      }),
    );
  const draftProjectIds = new Map<string, number>();
  for (const draft of draftStore.list(undefined, undefined)) {
    if (typeof draft.projectId === 'number') {
      draftProjectIds.set(String(draft.id), draft.projectId);
    }
  }

  for (const absolutePath of walkJsonFiles(handoffDir)) {
    const artifact = readJsonFile<BrowserHandoffArtifactRecord>(absolutePath);
    if (
      !artifact ||
      artifact.type !== 'browser_manual_handoff' ||
      typeof artifact.platform !== 'string' ||
      typeof artifact.accountKey !== 'string' ||
      typeof artifact.status !== 'string'
    ) {
      continue;
    }

    const normalizedArtifact = artifact as BrowserHandoffArtifactRecord &
      Required<Pick<BrowserHandoffArtifactRecord, 'platform' | 'accountKey' | 'status'>>;

    summary.total += 1;

    if (normalizedArtifact.status === 'pending') {
      summary.pending += 1;
    } else if (normalizedArtifact.status === 'resolved') {
      summary.resolved += 1;
    } else if (normalizedArtifact.status === 'obsolete') {
      summary.obsolete += 1;
    }

    if (isUnmatchedBrowserHandoffArtifact(normalizedArtifact, channelAccounts, draftProjectIds)) {
      summary.unmatched += 1;
    }
  }

  return summary;
}

function isUnmatchedBrowserHandoffArtifact(
  artifact: Required<Pick<BrowserHandoffArtifactRecord, 'platform' | 'accountKey' | 'status'>> &
    BrowserHandoffArtifactRecord,
  channelAccounts: HealthChannelAccountRecord[],
  draftProjectIds: Map<string, number>,
) {
  if (typeof artifact.channelAccountId === 'number') {
    const channelAccount = channelAccounts.find((account) => account.id === artifact.channelAccountId);
    if (channelAccount) {
      return false;
    }
  }

  const matchingChannelAccounts = channelAccounts.filter(
    (channelAccount) =>
      normalizeBrowserHandoffPlatform(channelAccount.platform) === artifact.platform &&
      channelAccount.accountKey === artifact.accountKey,
  );

  const draftProjectId = readDraftProjectId(artifact, draftProjectIds);
  if (typeof draftProjectId === 'number') {
    const projectMatches = matchingChannelAccounts.filter(
      (channelAccount) => channelAccount.projectId === draftProjectId,
    );

    if (projectMatches.length === 1) {
      return false;
    }

    if (projectMatches.length === 0) {
      return true;
    }
  }

  if (matchingChannelAccounts.length === 1) {
    return false;
  }

  const inferredChannelAccountId = inferChannelAccountIdFromDraft(
    artifact,
    channelAccounts,
    draftProjectIds,
  );

  return typeof inferredChannelAccountId !== 'number';
}

function inferChannelAccountIdFromDraft(
  artifact: Required<Pick<BrowserHandoffArtifactRecord, 'platform' | 'accountKey'>> &
    BrowserHandoffArtifactRecord,
  channelAccounts: HealthChannelAccountRecord[],
  draftProjectIds: Map<string, number>,
) {
  const draftProjectId = readDraftProjectId(artifact, draftProjectIds);
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

function readDraftProjectId(
  artifact: BrowserHandoffArtifactRecord,
  draftProjectIds: Map<string, number>,
) {
  if (typeof artifact.draftId !== 'string') {
    return undefined;
  }

  return draftProjectIds.get(artifact.draftId);
}

function normalizeBrowserHandoffPlatform(platform: string) {
  return platform === 'facebook-group' ? 'facebookGroup' : platform;
}

function walkJsonFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function readJsonFile<T>(absolutePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function createEmptyBrowserArtifactHealthSummary(): BrowserArtifactHealthSummary {
  return {
    laneRequests: {
      total: 0,
      pending: 0,
      resolved: 0,
    },
    handoffs: {
      total: 0,
      pending: 0,
      resolved: 0,
      obsolete: 0,
      unmatched: 0,
    },
  };
}

function resolveBrowserArtifactRootDir() {
  const databasePath = getDatabasePath();
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return process.cwd();
  }

  const databaseDir = path.dirname(databasePath);
  return path.basename(databaseDir) === 'data' ? path.dirname(databaseDir) : databaseDir;
}

function resolveBrowserHandoffArtifactRootDir() {
  const configured = process.env.BROWSER_HANDOFF_OUTPUT_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return resolveBrowserArtifactRootDir();
}
