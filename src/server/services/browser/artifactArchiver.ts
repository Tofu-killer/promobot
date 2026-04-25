import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '../../lib/persistence.js';

type ArchiveCategory =
  | 'browserLaneRequests'
  | 'browserLaneResults'
  | 'browserHandoffs'
  | 'inboxReplyHandoffs';
type ArchiveKind =
  | 'browser_lane_request'
  | 'browser_lane_result'
  | 'browser_handoff'
  | 'inbox_reply_handoff';
type ArchiveItemStatus = 'would_archive' | 'archived' | 'skipped' | 'error';

interface BrowserLaneRequestArtifactRecord {
  type: 'browser_lane_request';
  resolvedAt?: string;
}

interface BrowserLaneResultArtifactRecord {
  type: 'browser_lane_result';
  consumedAt?: string;
}

interface BrowserHandoffArtifactRecord {
  type: 'browser_manual_handoff';
  status: string;
  resolvedAt: string | null;
}

interface InboxReplyHandoffArtifactRecord {
  type: 'browser_inbox_reply_handoff';
  status: string;
  resolvedAt: string | null;
}

export interface ArchiveBrowserArtifactsOptions {
  apply?: boolean;
  includeResults?: boolean;
  olderThanHours?: number;
  now?: () => Date;
}

export interface ArchiveBrowserArtifactsSummaryItem {
  kind: ArchiveKind;
  category: ArchiveCategory;
  sourcePath: string;
  archivePath: string;
  status: ArchiveItemStatus;
  ageReference: string;
  ageHours: number;
}

export interface ArchiveBrowserArtifactsSummaryError {
  category: ArchiveCategory;
  sourcePath: string;
  message: string;
}

export interface ArchiveBrowserArtifactsSummary {
  ok: true;
  dryRun: boolean;
  apply: boolean;
  includeResults: boolean;
  olderThanHours: number;
  cutoff: string;
  totals: {
    scanned: number;
    eligible: number;
    archived: number;
    skipped: number;
    errors: number;
  };
  categories: {
    browserLaneRequests: {
      scanned: number;
      eligible: number;
      archived: number;
    };
    browserLaneResults: {
      scanned: number;
      eligible: number;
      archived: number;
      included: boolean;
    };
    browserHandoffs: {
      scanned: number;
      eligible: number;
      archived: number;
    };
    inboxReplyHandoffs: {
      scanned: number;
      eligible: number;
      archived: number;
    };
  };
  items: ArchiveBrowserArtifactsSummaryItem[];
  errors: ArchiveBrowserArtifactsSummaryError[];
}

interface CandidateArtifact {
  category: ArchiveCategory;
  kind: ArchiveKind;
  rootDir: string;
  sourcePath: string;
  archivePath: string;
  ageReference: string;
  ageHours: number;
}

export function archiveBrowserArtifacts(
  options: ArchiveBrowserArtifactsOptions = {},
): ArchiveBrowserArtifactsSummary {
  const now = (options.now ?? (() => new Date()))();
  const olderThanHours = Number.isFinite(options.olderThanHours)
    ? Number(options.olderThanHours)
    : 24;

  if (!Number.isFinite(olderThanHours) || olderThanHours <= 0) {
    throw new Error('olderThanHours must be a positive number');
  }

  const apply = options.apply === true;
  const includeResults = options.includeResults === true;
  const cutoffMs = now.getTime() - olderThanHours * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const summary: ArchiveBrowserArtifactsSummary = {
    ok: true,
    dryRun: !apply,
    apply,
    includeResults,
    olderThanHours,
    cutoff,
    totals: {
      scanned: 0,
      eligible: 0,
      archived: 0,
      skipped: 0,
      errors: 0,
    },
    categories: {
      browserLaneRequests: {
        scanned: 0,
        eligible: 0,
        archived: 0,
      },
      browserLaneResults: {
        scanned: 0,
        eligible: 0,
        archived: 0,
        included: includeResults,
      },
      browserHandoffs: {
        scanned: 0,
        eligible: 0,
        archived: 0,
      },
      inboxReplyHandoffs: {
        scanned: 0,
        eligible: 0,
        archived: 0,
      },
    },
    items: [],
    errors: [],
  };

  collectBrowserLaneArtifacts({
    includeResults,
    cutoffMs,
    nowMs: now.getTime(),
    summary,
  });
  collectBrowserHandoffArtifacts({
    cutoffMs,
    nowMs: now.getTime(),
    summary,
  });
  collectInboxReplyHandoffArtifacts({
    cutoffMs,
    nowMs: now.getTime(),
    summary,
  });

  summary.items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  if (!apply) {
    return summary;
  }

  for (const item of summary.items) {
    const sourceAbsolutePath = path.join(resolveRootDirForCategory(item.category), item.sourcePath);
    const archiveAbsolutePath = path.join(resolveRootDirForCategory(item.category), item.archivePath);

    try {
      if (fs.existsSync(archiveAbsolutePath)) {
        item.status = 'skipped';
        summary.totals.skipped += 1;
        continue;
      }

      fs.mkdirSync(path.dirname(archiveAbsolutePath), { recursive: true });
      fs.renameSync(sourceAbsolutePath, archiveAbsolutePath);

      item.status = 'archived';
      summary.totals.archived += 1;
      summary.categories[item.category].archived += 1;
    } catch (error) {
      item.status = 'error';
      summary.totals.errors += 1;
      summary.errors.push({
        category: item.category,
        sourcePath: item.sourcePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

function collectBrowserLaneArtifacts(input: {
  includeResults: boolean;
  cutoffMs: number;
  nowMs: number;
  summary: ArchiveBrowserArtifactsSummary;
}) {
  const rootDir = resolveBrowserLaneArtifactRootDir();
  const laneDir = path.join(rootDir, 'artifacts', 'browser-lane-requests');

  if (!fs.existsSync(laneDir)) {
    return;
  }

  for (const absolutePath of walkJsonFiles(laneDir)) {
    const artifact = readJsonArtifact(absolutePath);
    const sourcePath = toRelativePath(rootDir, absolutePath);

    if (!artifact || typeof artifact.type !== 'string') {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'browserLaneRequests',
        sourcePath,
        message: 'invalid browser lane artifact JSON',
      });
      continue;
    }

    if (artifact.type === 'browser_lane_request') {
      input.summary.totals.scanned += 1;
      input.summary.categories.browserLaneRequests.scanned += 1;

      const resolvedAt = typeof artifact.resolvedAt === 'string' ? artifact.resolvedAt : undefined;
      if (!resolvedAt) {
        continue;
      }

      pushCandidateIfOldEnough({
        category: 'browserLaneRequests',
        kind: 'browser_lane_request',
        rootDir,
        sourcePath,
        ageReference: resolvedAt,
        cutoffMs: input.cutoffMs,
        nowMs: input.nowMs,
        summary: input.summary,
      });
      continue;
    }

    if (artifact.type === 'browser_lane_result') {
      input.summary.totals.scanned += 1;
      input.summary.categories.browserLaneResults.scanned += 1;

      if (!input.includeResults) {
        continue;
      }

      const consumedAt = typeof artifact.consumedAt === 'string' ? artifact.consumedAt : undefined;
      if (!consumedAt) {
        continue;
      }

      pushCandidateIfOldEnough({
        category: 'browserLaneResults',
        kind: 'browser_lane_result',
        rootDir,
        sourcePath,
        ageReference: consumedAt,
        cutoffMs: input.cutoffMs,
        nowMs: input.nowMs,
        summary: input.summary,
      });
    }
  }
}

function collectBrowserHandoffArtifacts(input: {
  cutoffMs: number;
  nowMs: number;
  summary: ArchiveBrowserArtifactsSummary;
}) {
  const rootDir = resolveBrowserHandoffArtifactRootDir();
  const handoffDir = path.join(rootDir, 'artifacts', 'browser-handoffs');

  if (!fs.existsSync(handoffDir)) {
    return;
  }

  for (const absolutePath of walkJsonFiles(handoffDir)) {
    input.summary.totals.scanned += 1;
    input.summary.categories.browserHandoffs.scanned += 1;

    const artifact = readJsonArtifact(absolutePath);
    const sourcePath = toRelativePath(rootDir, absolutePath);

    if (!artifact || artifact.type !== 'browser_manual_handoff') {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'browserHandoffs',
        sourcePath,
        message: 'invalid browser handoff artifact JSON',
      });
      continue;
    }

    if (artifact.status === 'pending') {
      continue;
    }

    if (artifact.status !== 'resolved' && artifact.status !== 'obsolete') {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'browserHandoffs',
        sourcePath,
        message: `unsupported browser handoff status: ${artifact.status}`,
      });
      continue;
    }

    if (!artifact.resolvedAt) {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'browserHandoffs',
        sourcePath,
        message: 'browser handoff artifact is missing resolvedAt',
      });
      continue;
    }

    pushCandidateIfOldEnough({
      category: 'browserHandoffs',
      kind: 'browser_handoff',
      rootDir,
      sourcePath,
      ageReference: artifact.resolvedAt,
      cutoffMs: input.cutoffMs,
      nowMs: input.nowMs,
      summary: input.summary,
    });
  }
}

function collectInboxReplyHandoffArtifacts(input: {
  cutoffMs: number;
  nowMs: number;
  summary: ArchiveBrowserArtifactsSummary;
}) {
  const rootDir = resolveBrowserHandoffArtifactRootDir();
  const handoffDir = path.join(rootDir, 'artifacts', 'inbox-reply-handoffs');

  if (!fs.existsSync(handoffDir)) {
    return;
  }

  for (const absolutePath of walkJsonFiles(handoffDir)) {
    input.summary.totals.scanned += 1;
    input.summary.categories.inboxReplyHandoffs.scanned += 1;

    const artifact = readJsonArtifact(absolutePath);
    const sourcePath = toRelativePath(rootDir, absolutePath);

    if (!artifact || artifact.type !== 'browser_inbox_reply_handoff') {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'inboxReplyHandoffs',
        sourcePath,
        message: 'invalid inbox reply handoff artifact JSON',
      });
      continue;
    }

    if (artifact.status === 'pending') {
      continue;
    }

    if (artifact.status !== 'resolved' && artifact.status !== 'obsolete') {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'inboxReplyHandoffs',
        sourcePath,
        message: `unsupported inbox reply handoff status: ${artifact.status}`,
      });
      continue;
    }

    if (!artifact.resolvedAt) {
      input.summary.totals.errors += 1;
      input.summary.errors.push({
        category: 'inboxReplyHandoffs',
        sourcePath,
        message: 'inbox reply handoff artifact is missing resolvedAt',
      });
      continue;
    }

    pushCandidateIfOldEnough({
      category: 'inboxReplyHandoffs',
      kind: 'inbox_reply_handoff',
      rootDir,
      sourcePath,
      ageReference: artifact.resolvedAt,
      cutoffMs: input.cutoffMs,
      nowMs: input.nowMs,
      summary: input.summary,
    });
  }
}

function pushCandidateIfOldEnough(input: {
  category: ArchiveCategory;
  kind: ArchiveKind;
  rootDir: string;
  sourcePath: string;
  ageReference: string;
  cutoffMs: number;
  nowMs: number;
  summary: ArchiveBrowserArtifactsSummary;
}) {
  const referenceMs = Date.parse(input.ageReference);
  if (!Number.isFinite(referenceMs)) {
    input.summary.totals.errors += 1;
    input.summary.errors.push({
      category: input.category,
      sourcePath: input.sourcePath,
      message: `invalid archive age reference: ${input.ageReference}`,
    });
    return;
  }

  if (referenceMs > input.cutoffMs) {
    return;
  }

  const archivePath = buildArchivePath(input.sourcePath);
  const candidate: CandidateArtifact = {
    category: input.category,
    kind: input.kind,
    rootDir: input.rootDir,
    sourcePath: input.sourcePath,
    archivePath,
    ageReference: input.ageReference,
    ageHours: roundToTwoDecimals((input.nowMs - referenceMs) / (60 * 60 * 1000)),
  };

  input.summary.totals.eligible += 1;
  input.summary.categories[input.category].eligible += 1;
  input.summary.items.push({
    kind: candidate.kind,
    category: candidate.category,
    sourcePath: candidate.sourcePath,
    archivePath: candidate.archivePath,
    status: 'would_archive',
    ageReference: candidate.ageReference,
    ageHours: candidate.ageHours,
  });
}

function buildArchivePath(sourcePath: string) {
  const normalized = sourcePath.replace(/\\/g, '/');

  if (normalized.startsWith('artifacts/browser-lane-requests/')) {
    return normalized.replace(
      'artifacts/browser-lane-requests/',
      'artifacts/archive/browser-lane-requests/',
    );
  }

  if (normalized.startsWith('artifacts/browser-handoffs/')) {
    return normalized.replace(
      'artifacts/browser-handoffs/',
      'artifacts/archive/browser-handoffs/',
    );
  }

  if (normalized.startsWith('artifacts/inbox-reply-handoffs/')) {
    return normalized.replace(
      'artifacts/inbox-reply-handoffs/',
      'artifacts/archive/inbox-reply-handoffs/',
    );
  }

  throw new Error(`unsupported archive source path: ${sourcePath}`);
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

function readJsonArtifact(
  absolutePath: string,
):
  | BrowserLaneRequestArtifactRecord
  | BrowserLaneResultArtifactRecord
  | BrowserHandoffArtifactRecord
  | InboxReplyHandoffArtifactRecord
  | null {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as
      | BrowserLaneRequestArtifactRecord
      | BrowserLaneResultArtifactRecord
      | BrowserHandoffArtifactRecord
      | InboxReplyHandoffArtifactRecord;
  } catch {
    return null;
  }
}

function resolveRootDirForCategory(category: ArchiveCategory) {
  return category === 'browserHandoffs' || category === 'inboxReplyHandoffs'
    ? resolveBrowserHandoffArtifactRootDir()
    : resolveBrowserLaneArtifactRootDir();
}

function resolveBrowserLaneArtifactRootDir() {
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

  return resolveBrowserLaneArtifactRootDir();
}

function toRelativePath(rootDir: string, absolutePath: string) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}
