import fs from 'node:fs';

import {
  createSessionRequestResultArtifact,
  getSessionRequestArtifactByPath,
} from './sessionRequestArtifacts.js';
import {
  buildManagedStorageStatePath,
  resolveManagedStorageStateAbsolutePath,
} from './sessionStore.js';

export class SessionRequestResultSubmitError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface SubmitSessionRequestResultInput {
  requestArtifactPath: string;
  storageStateFilePath: string;
  sessionStatus?: 'active' | 'expired' | 'missing';
  validatedAt?: string | null;
  notes?: string;
  completedAt?: string;
  importBaseUrl?: string;
  adminPassword?: string;
}

export interface SubmitSessionRequestResultDependencies {
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export async function submitSessionRequestResult(
  input: SubmitSessionRequestResultInput,
  dependencies: SubmitSessionRequestResultDependencies = {},
) {
  const requestArtifact = getSessionRequestArtifactByPath(input.requestArtifactPath);
  if (!requestArtifact) {
    throw new SessionRequestResultSubmitError('browser lane request artifact not found', 404);
  }

  if (requestArtifact.resolvedAt) {
    throw new SessionRequestResultSubmitError('browser lane request artifact already resolved', 409);
  }

  const managedStorageStatePath =
    requestArtifact.managedStorageStatePath ??
    buildManagedStorageStatePath(requestArtifact.platform, requestArtifact.accountKey);
  const storageState = readStorageStateFile(
    resolveStorageStateFilePath(input.storageStateFilePath, managedStorageStatePath),
  );
  const completedAt = input.completedAt ?? (dependencies.now ?? (() => new Date()))().toISOString();
  const resultArtifactPath = createSessionRequestResultArtifact({
    channelAccountId: requestArtifact.channelAccountId,
    platform: requestArtifact.platform,
    accountKey: requestArtifact.accountKey,
    action: requestArtifact.action,
    requestJobId: requestArtifact.jobId,
    completedAt,
    storageState,
    sessionStatus: input.sessionStatus ?? 'active',
    ...(input.validatedAt !== undefined ? { validatedAt: input.validatedAt } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });

  const shouldImport = input.importBaseUrl !== undefined || input.adminPassword !== undefined;
  if (!shouldImport) {
    return {
      ok: true,
      imported: false,
      requestArtifactPath: requestArtifact.artifactPath,
      resultArtifactPath,
    };
  }

  const baseUrl = input.importBaseUrl?.trim() ?? '';
  const adminPassword = input.adminPassword?.trim() ?? '';
  if (!baseUrl || !adminPassword) {
    throw new SessionRequestResultSubmitError(
      'baseUrl and adminPassword are required to import the browser lane result',
      400,
    );
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new SessionRequestResultSubmitError('fetch is unavailable for browser lane import', 500);
  }

  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/system/browser-lane-requests/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': adminPassword,
    },
    body: JSON.stringify({
      requestArtifactPath: requestArtifact.artifactPath,
      storageState,
      sessionStatus: input.sessionStatus ?? 'active',
      ...(input.validatedAt !== undefined ? { validatedAt: input.validatedAt } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      completedAt,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof payload.error === 'string' && payload.error.trim().length > 0
        ? payload.error
        : `browser lane import failed with status ${response.status}`;
    throw new SessionRequestResultSubmitError(error, response.status);
  }

  return {
    ok: true,
    imported: true,
    requestArtifactPath: requestArtifact.artifactPath,
    resultArtifactPath,
    importResult: payload,
  };
}

function readStorageStateFile(storageStateFilePath: string) {
  const normalizedPath = storageStateFilePath.trim();
  if (!normalizedPath) {
    throw new SessionRequestResultSubmitError('storage state file path is required', 400);
  }

  let raw = '';
  try {
    raw = fs.readFileSync(normalizedPath, 'utf8');
  } catch (error) {
    throw new SessionRequestResultSubmitError(
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'unable to read storage state file',
      400,
    );
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('storage state file must contain a JSON object');
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new SessionRequestResultSubmitError(
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'storage state file is invalid JSON',
      400,
    );
  }
}

function resolveStorageStateFilePath(
  storageStateFilePath: string,
  managedStorageStatePath: string,
) {
  const normalizedPath = storageStateFilePath.trim();
  if (!normalizedPath) {
    return normalizedPath;
  }

  return normalizedPath === managedStorageStatePath
    ? resolveManagedStorageStateAbsolutePath(managedStorageStatePath)
    : normalizedPath;
}
