import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type LoadServerEnvFromRootOptions = {
  repoRootDir?: string;
  loadEnvFile?: (path: string) => void;
};

export function loadServerEnvFromRoot(options: LoadServerEnvFromRootOptions = {}) {
  const repoRootDir = options.repoRootDir ?? resolveRepoRootDir();
  const envFilePath = path.join(repoRootDir, '.env');
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const loadEnvFile =
    options.loadEnvFile ??
    (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.bind(process);

  if (loadEnvFile) {
    loadEnvFile(envFilePath);
    return;
  }

  loadEnvFileFallback(envFilePath);
}

function resolveRepoRootDir(moduleUrl: string = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../..');
}

function loadEnvFileFallback(envFilePath: string) {
  const content = fs.readFileSync(envFilePath, 'utf8');
  const entries = parseFallbackEnvContent(content);

  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseFallbackEnvContent(content: string) {
  const entries: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
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
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
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
