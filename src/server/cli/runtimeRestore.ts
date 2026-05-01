import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RuntimeRestoreArgs {
  inputDir?: string;
  showHelp?: boolean;
  skipEnv?: boolean;
}

interface RuntimeRestoreDependencies {
  now?: () => Date;
  repoRootDir?: string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

type RuntimeItemKind = 'database' | 'browserSessions' | 'envFile';
type RuntimeItemType = 'file' | 'directory';

const RUNTIME_ITEM_KINDS: RuntimeItemKind[] = ['database', 'browserSessions', 'envFile'];
const RUNTIME_ITEM_TYPES: RuntimeItemType[] = ['file', 'directory'];

interface RuntimeBackupManifestItem {
  kind: RuntimeItemKind;
  type: RuntimeItemType;
  sourcePath: string;
  destinationPath: string;
}

interface RuntimeBackupManifest {
  ok?: boolean;
  copied?: RuntimeBackupManifestItem[];
  missing?: Array<{
    kind: RuntimeItemKind;
    type: RuntimeItemType;
    expectedPath: string;
  }>;
  outputDir?: string;
}

interface RuntimeRestoreSummaryItem {
  kind: RuntimeItemKind;
  type: RuntimeItemType;
  backupPath: string;
  targetPath: string;
}

interface RuntimeRestoreSkippedItem extends RuntimeRestoreSummaryItem {
  reason: 'skip-env';
}

interface RuntimeRestoreMissingItem {
  kind: RuntimeItemKind;
  type: RuntimeItemType;
  expectedPath: string;
  targetPath: string;
  reason: 'backup-missing' | 'backup-incomplete';
}

interface RuntimeRestoreBackupItem {
  kind: RuntimeItemKind;
  type: RuntimeItemType;
  originalPath: string;
  backupPath: string;
}

interface RuntimeRestoreSummary {
  ok: boolean;
  restoredAt: string;
  repoRoot: string;
  inputDir: string;
  manifestPath: string;
  restored: RuntimeRestoreSummaryItem[];
  skipped: RuntimeRestoreSkippedItem[];
  missing: RuntimeRestoreMissingItem[];
  backupsCreated: RuntimeRestoreBackupItem[];
}

interface RuntimeRestorePlanItem {
  item: RuntimeBackupManifestItem;
  backupPath: string;
  targetPath: string;
}

interface RuntimeRestoreAppliedItem {
  backup: RuntimeRestoreBackupItem | null;
  item: RuntimeBackupManifestItem;
  targetPath: string;
}

export function parseRuntimeRestoreArgs(argv: string[]): RuntimeRestoreArgs {
  const parsed: RuntimeRestoreArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (token === '--skip-env') {
      parsed.skipEnv = true;
      continue;
    }

    if (token === '--input-dir') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--input-dir requires a value');
      }

      parsed.inputDir = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getRuntimeRestoreHelpText() {
  return [
    'Usage: tsx src/server/cli/runtimeRestore.ts [options]',
    '',
    'Restore runtime data from a runtime:backup directory into the original runtime paths.',
    '',
    'Options:',
    '  --input-dir <path>   Read manifest.json and restore payloads from this backup directory',
    '  --skip-env           Skip restoring the .env backup entry',
    '  --help               Show this help text',
  ].join('\n');
}

export async function runRuntimeRestoreCli(
  argv: string[],
  dependencies: RuntimeRestoreDependencies = {},
) {
  const parsed = parseRuntimeRestoreArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;

  if (parsed.showHelp) {
    stdout.write(`${getRuntimeRestoreHelpText()}\n`);
    return null;
  }

  const inputDir = parsed.inputDir?.trim();
  if (!inputDir) {
    throw new Error('--input-dir is required');
  }

  const resolvedInputDir = path.resolve(inputDir);
  const manifestPath = path.join(resolvedInputDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found under ${resolvedInputDir}`);
  }

  const manifest = readRuntimeBackupManifest(manifestPath);
  const recordedOutputDir = resolveRecordedOutputDir(manifest, resolvedInputDir);
  const restoredAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const repoRootDir = path.resolve(dependencies.repoRootDir ?? resolveRepoRootDir());

  const summary: RuntimeRestoreSummary = {
    ok: true,
    restoredAt,
    repoRoot: repoRootDir,
    inputDir: resolvedInputDir,
    manifestPath,
    restored: [],
    skipped: [],
    missing: [],
    backupsCreated: [],
  };

  const incompleteManifestMissingItems = (manifest.missing ?? []).filter(
    (missingItem) => !(parsed.skipEnv && missingItem.kind === 'envFile'),
  );
  const shouldRefuseIncompleteManifest =
    incompleteManifestMissingItems.length > 0 ||
    (manifest.ok === false && (manifest.missing?.length ?? 0) === 0);

  if (shouldRefuseIncompleteManifest) {
    summary.ok = false;
    for (const missingItem of incompleteManifestMissingItems) {
      summary.missing.push({
        kind: missingItem.kind,
        type: missingItem.type,
        expectedPath: missingItem.expectedPath,
        targetPath: missingItem.expectedPath,
        reason: 'backup-incomplete',
      });
    }
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  const restorePlan: RuntimeRestorePlanItem[] = [];
  const restoreTargets = new Set<string>();
  for (const item of manifest.copied ?? []) {
    const backupPath = resolveBackupPath(item, {
      inputDir: resolvedInputDir,
      recordedOutputDir,
    });

    if (isRawFileUriPath(item.sourcePath)) {
      summary.missing.push({
        kind: item.kind,
        type: item.type,
        expectedPath: item.sourcePath,
        targetPath: item.sourcePath,
        reason: 'backup-incomplete',
      });
      continue;
    }

    if (!path.isAbsolute(item.sourcePath)) {
      summary.missing.push({
        kind: item.kind,
        type: item.type,
        expectedPath: item.sourcePath,
        targetPath: item.sourcePath,
        reason: 'backup-incomplete',
      });
      continue;
    }

    const targetPath = path.resolve(item.sourcePath);

    if (!isPathInside(resolvedInputDir, backupPath)) {
      summary.missing.push({
        kind: item.kind,
        type: item.type,
        expectedPath: backupPath,
        targetPath,
        reason: 'backup-incomplete',
      });
      continue;
    }

    if (!isPathInside(repoRootDir, targetPath)) {
      summary.missing.push({
        kind: item.kind,
        type: item.type,
        expectedPath: targetPath,
        targetPath,
        reason: 'backup-incomplete',
      });
      continue;
    }

    if (parsed.skipEnv && item.kind === 'envFile') {
      summary.skipped.push({
        kind: item.kind,
        type: item.type,
        backupPath,
        targetPath,
        reason: 'skip-env',
      });
      continue;
    }

    if (restoreTargets.has(targetPath)) {
      throw new Error(`duplicate manifest restore target: ${manifestPath}`);
    }

    if (!hasExpectedEntry(backupPath, item.type)) {
      summary.missing.push({
        kind: item.kind,
        type: item.type,
        expectedPath: backupPath,
        targetPath,
        reason: 'backup-missing',
      });
      continue;
    }

    restoreTargets.add(targetPath);
    restorePlan.push({
      item,
      backupPath,
      targetPath,
    });
  }

  if (summary.missing.length > 0) {
    summary.ok = false;
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  const appliedItems: RuntimeRestoreAppliedItem[] = [];
  try {
    for (const plannedItem of restorePlan) {
      const backup = maybeBackupExistingTarget(plannedItem.item, plannedItem.targetPath, restoredAt);
      appliedItems.push({
        backup,
        item: plannedItem.item,
        targetPath: plannedItem.targetPath,
      });

      restoreBackupItem(plannedItem.item, plannedItem.backupPath, plannedItem.targetPath);
      if (backup) {
        summary.backupsCreated.push(backup);
      }
      summary.restored.push({
        kind: plannedItem.item.kind,
        type: plannedItem.item.type,
        backupPath: plannedItem.backupPath,
        targetPath: plannedItem.targetPath,
      });
    }
  } catch (error) {
    rollbackAppliedRestoreItems(appliedItems);
    throw error;
  }

  summary.ok = summary.missing.length === 0;
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function applyRuntimeRestoreExitCode(summary: RuntimeRestoreSummary | null) {
  if (summary && !summary.ok) {
    process.exitCode = 1;
  }
}

function readRuntimeBackupManifest(manifestPath: string) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as RuntimeBackupManifest;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid manifest: ${manifestPath}`);
  }

  if (parsed.copied !== undefined && !Array.isArray(parsed.copied)) {
    throw new Error(`invalid manifest copied entries: ${manifestPath}`);
  }

  if (parsed.copied?.some((item) => !isValidRuntimeBackupManifestItem(item))) {
    throw new Error(`invalid manifest copied entries: ${manifestPath}`);
  }

  if (parsed.missing !== undefined && !Array.isArray(parsed.missing)) {
    throw new Error(`invalid manifest missing entries: ${manifestPath}`);
  }

  if (parsed.missing?.some((item) => !isValidRuntimeBackupManifestMissingItem(item))) {
    throw new Error(`invalid manifest missing entries: ${manifestPath}`);
  }

  if (parsed.outputDir !== undefined && typeof parsed.outputDir !== 'string') {
    throw new Error(`invalid manifest outputDir: ${manifestPath}`);
  }

  return parsed;
}

function isValidRuntimeBackupManifestItem(item: unknown): item is RuntimeBackupManifestItem {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }

  const candidate = item as Partial<RuntimeBackupManifestItem>;
  return (
    isRuntimeItemKind(candidate.kind) &&
    isRuntimeItemType(candidate.type) &&
    isNonEmptyString(candidate.sourcePath) &&
    isNonEmptyString(candidate.destinationPath)
  );
}

function isValidRuntimeBackupManifestMissingItem(
  item: unknown,
): item is NonNullable<RuntimeBackupManifest['missing']>[number] {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }

  const candidate = item as Partial<NonNullable<RuntimeBackupManifest['missing']>[number]>;
  return (
    isRuntimeItemKind(candidate.kind) &&
    isRuntimeItemType(candidate.type) &&
    isNonEmptyString(candidate.expectedPath)
  );
}

function isRuntimeItemKind(value: unknown): value is RuntimeItemKind {
  return typeof value === 'string' && RUNTIME_ITEM_KINDS.includes(value as RuntimeItemKind);
}

function isRuntimeItemType(value: unknown): value is RuntimeItemType {
  return typeof value === 'string' && RUNTIME_ITEM_TYPES.includes(value as RuntimeItemType);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRawFileUriPath(value: string) {
  try {
    return new URL(value).protocol === 'file:';
  } catch {
    return false;
  }
}

function resolveRecordedOutputDir(manifest: RuntimeBackupManifest, inputDir: string) {
  const outputDir = manifest.outputDir?.trim();
  if (!outputDir) {
    return inputDir;
  }

  return path.resolve(outputDir);
}

function resolveBackupPath(
  item: RuntimeBackupManifestItem,
  context: {
    inputDir: string;
    recordedOutputDir: string;
  },
) {
  const recordedDestinationPath = path.isAbsolute(item.destinationPath)
    ? path.normalize(item.destinationPath)
    : path.resolve(context.recordedOutputDir, item.destinationPath);

  if (isPathInside(context.recordedOutputDir, recordedDestinationPath)) {
    const relativePath = path.relative(context.recordedOutputDir, recordedDestinationPath);
    return relativePath ? path.join(context.inputDir, relativePath) : context.inputDir;
  }

  return recordedDestinationPath;
}

function isPathInside(parentPath: string, targetPath: string) {
  const relativePath = path.relative(parentPath, targetPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function hasExpectedEntry(entryPath: string, type: RuntimeItemType) {
  if (!fs.existsSync(entryPath)) {
    return false;
  }

  const stats = fs.statSync(entryPath);
  return (type === 'file' && stats.isFile()) || (type === 'directory' && stats.isDirectory());
}

function maybeBackupExistingTarget(
  item: RuntimeBackupManifestItem,
  targetPath: string,
  restoredAt: string,
) {
  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const backupPath = getUniquePreRestorePath(targetPath, restoredAt);
  fs.renameSync(targetPath, backupPath);
  return {
    kind: item.kind,
    type: item.type,
    originalPath: targetPath,
    backupPath,
  };
}

function rollbackAppliedRestoreItems(appliedItems: RuntimeRestoreAppliedItem[]) {
  for (let index = appliedItems.length - 1; index >= 0; index -= 1) {
    const appliedItem = appliedItems[index];
    removeRestoreTarget(appliedItem.targetPath);
    if (appliedItem.backup) {
      fs.mkdirSync(path.dirname(appliedItem.backup.originalPath), { recursive: true });
      fs.renameSync(appliedItem.backup.backupPath, appliedItem.backup.originalPath);
    }
  }
}

function removeRestoreTarget(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function getUniquePreRestorePath(targetPath: string, restoredAt: string) {
  const basePath = `${targetPath}.pre-restore-${sanitizeTimestamp(restoredAt)}`;
  if (!fs.existsSync(basePath)) {
    return basePath;
  }

  let suffix = 1;
  while (fs.existsSync(`${basePath}.${suffix}`)) {
    suffix += 1;
  }

  return `${basePath}.${suffix}`;
}

function restoreBackupItem(
  item: RuntimeBackupManifestItem,
  backupPath: string,
  targetPath: string,
) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (item.type === 'file') {
    fs.copyFileSync(backupPath, targetPath);
    return;
  }

  fs.cpSync(backupPath, targetPath, { recursive: true });
}

function sanitizeTimestamp(value: string) {
  return value.replace(/:/g, '-');
}

function resolveRepoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

async function main() {
  const summary = await runRuntimeRestoreCli(process.argv.slice(2));
  applyRuntimeRestoreExitCode(summary);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMainModule) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
