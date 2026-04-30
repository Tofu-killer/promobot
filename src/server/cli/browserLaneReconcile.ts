import { loadServerEnvFromRoot } from '../env.js';
import {
  runBrowserLaneReconcile,
  type BrowserLaneReconcileKind,
} from '../services/browser/browserLaneReconcile.js';
import type { BrowserLaneDispatch } from '../services/browser/browserLaneDispatch.js';
import type { JobQueueStore } from '../store/jobQueue.js';

interface BrowserLaneReconcileCliDependencies {
  now?: () => Date;
  browserLaneDispatch?: BrowserLaneDispatch;
  jobQueueStore?: Pick<JobQueueStore, 'enqueue' | 'list'>;
}

export function parseBrowserLaneReconcileArgs(argv: string[]) {
  let apply = false;
  let kind: BrowserLaneReconcileKind = 'all';
  let showHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      continue;
    }

    if (token === '--apply') {
      apply = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      showHelp = true;
      continue;
    }

    if (token === '--kind') {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new Error('--kind requires a value');
      }

      kind = parseBrowserLaneReconcileKind(nextToken);
      index += 1;
      continue;
    }

    if (token.startsWith('--kind=')) {
      kind = parseBrowserLaneReconcileKind(token.slice('--kind='.length));
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return {
    apply,
    kind,
    showHelp,
  };
}

export async function runBrowserLaneReconcileCli(
  input: ReturnType<typeof parseBrowserLaneReconcileArgs>,
  dependencies: BrowserLaneReconcileCliDependencies = {},
) {
  return await runBrowserLaneReconcile(
    {
      apply: input.apply,
      kind: input.kind,
    },
    {
      browserLaneDispatch: dependencies.browserLaneDispatch,
      jobQueueStore: dependencies.jobQueueStore,
      now: dependencies.now,
    },
  );
}

export function getBrowserLaneReconcileHelpText() {
  return [
    'Usage:',
    '  pnpm browser:lane:reconcile',
    '  pnpm browser:lane:reconcile -- --apply',
    '  pnpm browser:lane:reconcile -- --kind publish_handoff',
    '  node dist/server/cli/browserLaneReconcile.js --apply --kind all',
    '',
    'The command defaults to dry-run mode and only reports what would be replayed.',
    'Use --apply to re-dispatch stranded browser lane artifacts and backfill missing poll jobs.',
    '',
    'Kinds:',
    '  all',
    '  session_request',
    '  publish_handoff',
    '  inbox_reply_handoff',
    '',
    'Flags:',
    '  --apply',
    '  --kind <kind>',
    '  --help',
  ].join('\n');
}

function parseBrowserLaneReconcileKind(value: string): BrowserLaneReconcileKind {
  const normalized = value.trim();
  if (
    normalized === 'all' ||
    normalized === 'session_request' ||
    normalized === 'publish_handoff' ||
    normalized === 'inbox_reply_handoff'
  ) {
    return normalized;
  }

  throw new Error(`invalid reconcile kind: ${value}`);
}

async function main() {
  const parsed = parseBrowserLaneReconcileArgs(process.argv.slice(2));
  if (parsed.showHelp) {
    process.stdout.write(`${getBrowserLaneReconcileHelpText()}\n`);
    return;
  }

  loadServerEnvFromRoot();
  const result = await runBrowserLaneReconcileCli(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
