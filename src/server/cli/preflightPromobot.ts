import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PreflightPromobotArgs {
  repoRoot?: string;
  requireEnv?: string[];
  showHelp?: boolean;
}

interface RunPreflightOptions {
  repoRoot: string;
  requiredEnvKeys: string[];
}

interface RunPreflightDependencies {
  env?: Record<string, string | undefined>;
}

type PreflightCheck =
  | {
      kind: 'file';
      name: string;
      required: boolean;
      ok: boolean;
      target: string;
    }
  | {
      kind: 'env';
      name: string;
      required: boolean;
      ok: boolean;
      target: string;
      source?: 'process' | '.env';
    };

interface PreflightSummary {
  ok: boolean;
  repoRoot: string;
  checks: PreflightCheck[];
  missing: Array<{
    kind: 'file' | 'env';
    name: string;
    target: string;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    target: string;
  }>;
}

export function parsePreflightPromobotArgs(argv: string[]): PreflightPromobotArgs {
  const parsed: PreflightPromobotArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (token === '--repo-root') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--repo-root requires a value');
      }
      parsed.repoRoot = nextValue;
      index += 1;
      continue;
    }

    if (token === '--require-env') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--require-env requires a value');
      }
      parsed.requireEnv = normalizeRequiredEnvKeys(nextValue);
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getPreflightPromobotHelpText() {
  return [
    'Usage: tsx src/server/cli/preflightPromobot.ts [options]',
    '',
    'Run static production preflight checks and print a JSON summary.',
    '',
    'Options:',
    '  --repo-root <path>               Override the repo root to inspect',
    '  --require-env <comma-separated keys>',
    '                                  Required env keys to validate from process/.env',
    '  --help                          Show this help text',
  ].join('\n');
}

export function runPreflightPromobot(
  options: RunPreflightOptions,
  dependencies: RunPreflightDependencies = {},
): PreflightSummary {
  const repoRoot = path.resolve(options.repoRoot);
  const env = dependencies.env ?? process.env;
  const envFilePath = path.join(repoRoot, '.env');
  const envFileEntries = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath) : {};

  const checks: PreflightCheck[] = [];
  const missing: PreflightSummary['missing'] = [];
  const warnings: PreflightSummary['warnings'] = [];

  for (const relativePath of ['package.json', 'pm2.config.js', 'dist/server/index.js', 'dist/client/index.html']) {
    const target = path.join(repoRoot, relativePath);
    const ok = fs.existsSync(target);
    checks.push({
      kind: 'file',
      name: relativePath,
      required: true,
      ok,
      target,
    });
    if (!ok) {
      missing.push({
        kind: 'file',
        name: relativePath,
        target,
      });
    }
  }

  const envFileExists = fs.existsSync(envFilePath);
  checks.push({
    kind: 'file',
    name: '.env',
    required: false,
    ok: envFileExists,
    target: envFilePath,
  });
  if (!envFileExists) {
    warnings.push({
      code: 'optional-env-missing',
      message: 'Optional .env file is missing',
      target: envFilePath,
    });
  }

  for (const requiredEnvKey of options.requiredEnvKeys) {
    const processValue = env[requiredEnvKey]?.trim();
    if (processValue) {
      checks.push({
        kind: 'env',
        name: requiredEnvKey,
        required: true,
        ok: true,
        target: requiredEnvKey,
        source: 'process',
      });
      continue;
    }

    const envFileValue = envFileEntries[requiredEnvKey]?.trim();
    if (envFileValue) {
      checks.push({
        kind: 'env',
        name: requiredEnvKey,
        required: true,
        ok: true,
        target: requiredEnvKey,
        source: '.env',
      });
      continue;
    }

    checks.push({
      kind: 'env',
      name: requiredEnvKey,
      required: true,
      ok: false,
      target: requiredEnvKey,
    });
    missing.push({
      kind: 'env',
      name: requiredEnvKey,
      target: requiredEnvKey,
    });
  }

  return {
    ok: missing.length === 0,
    repoRoot,
    checks,
    missing,
    warnings,
  };
}

function normalizeRequiredEnvKeys(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
}

function parseEnvFile(envFilePath: string) {
  const entries: Record<string, string> = {};
  const content = fs.readFileSync(envFilePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = normalized.slice(equalsIndex + 1).trim();
    entries[key] = unquoteValue(rawValue);
  }

  return entries;
}

function unquoteValue(value: string) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function resolveRepoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

async function main() {
  const parsed = parsePreflightPromobotArgs(process.argv.slice(2));
  if (parsed.showHelp) {
    process.stdout.write(`${getPreflightPromobotHelpText()}\n`);
    return;
  }

  const summary = runPreflightPromobot({
    repoRoot: parsed.repoRoot ?? resolveRepoRootDir(),
    requiredEnvKeys: parsed.requireEnv ?? [],
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
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
