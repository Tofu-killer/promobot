import {
  BrowserHandoffImportError,
  importBrowserHandoffResult,
} from './browserHandoffResultImporter.js';
import { getBrowserHandoffArtifactByPath } from './browserHandoffArtifacts.js';
import { createBrowserHandoffResultArtifact } from './browserHandoffResultArtifacts.js';

export class BrowserHandoffCompletionSubmitError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface SubmitBrowserHandoffCompletionInput {
  artifactPath: string;
  handoffAttempt?: number;
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
  externalId?: string;
  publishedAt?: string;
  queueResult?: boolean;
  importBaseUrl?: string;
  adminPassword?: string;
}

export interface SubmitBrowserHandoffCompletionDependencies {
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export async function submitBrowserHandoffCompletion(
  input: SubmitBrowserHandoffCompletionInput,
  dependencies: SubmitBrowserHandoffCompletionDependencies = {},
) {
  const artifactPath = input.artifactPath.trim();
  if (!artifactPath) {
    throw new BrowserHandoffCompletionSubmitError('artifactPath is required', 400);
  }

  const message =
    input.message?.trim() ||
    (input.publishStatus === 'published'
      ? 'browser handoff marked published'
      : 'browser handoff marked failed');
  const explicitHandoffAttempt = normalizeOptionalPositiveHandoffAttempt(input.handoffAttempt);
  const resolvedHandoffAttempt =
    explicitHandoffAttempt ?? getRequiredBrowserHandoffArtifact(artifactPath).handoffAttempt;

  const normalizedInput = {
    artifactPath,
    publishStatus: input.publishStatus,
    message,
    handoffAttempt: resolvedHandoffAttempt,
    ...(input.publishUrl?.trim() ? { publishUrl: input.publishUrl.trim() } : {}),
    ...(input.externalId?.trim() ? { externalId: input.externalId.trim() } : {}),
    ...(input.publishedAt?.trim() ? { publishedAt: input.publishedAt.trim() } : {}),
  } as const;

  const shouldImportRemotely = input.importBaseUrl !== undefined || input.adminPassword !== undefined;
  if (input.queueResult) {
    if (shouldImportRemotely) {
      throw new BrowserHandoffCompletionSubmitError(
        'queueResult cannot be combined with remote browser handoff import',
        400,
      );
    }

    const handoffArtifact = getRequiredBrowserHandoffArtifact(artifactPath);

    if (handoffArtifact.status !== 'pending') {
      throw new BrowserHandoffCompletionSubmitError(
        'browser handoff artifact already resolved',
        409,
      );
    }

    if (handoffArtifact.readiness === 'blocked') {
      throw new BrowserHandoffCompletionSubmitError(
        'browser handoff artifact is still waiting for session restoration',
        409,
      );
    }

    if (resolvedHandoffAttempt !== handoffArtifact.handoffAttempt) {
      throw new BrowserHandoffCompletionSubmitError(
        'browser handoff artifact has been superseded by a newer handoff attempt',
        409,
      );
    }

    const completedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const resultArtifactPath = createBrowserHandoffResultArtifact({
      handoffArtifactPath: artifactPath,
      handoffAttempt: handoffArtifact.handoffAttempt,
      ...(typeof handoffArtifact.channelAccountId === 'number'
        ? { channelAccountId: handoffArtifact.channelAccountId }
        : {}),
      platform: handoffArtifact.platform,
      accountKey: handoffArtifact.accountKey,
      draftId: handoffArtifact.draftId,
      completedAt,
      publishStatus: input.publishStatus,
      message,
      ...(input.publishUrl?.trim() ? { publishUrl: input.publishUrl.trim() } : {}),
      ...(input.externalId?.trim() ? { externalId: input.externalId.trim() } : {}),
      ...(input.publishedAt?.trim() ? { publishedAt: input.publishedAt.trim() } : {}),
    });

    return {
      ok: true,
      imported: false,
      artifactPath,
      resultArtifactPath,
    };
  }

  if (!shouldImportRemotely) {
    try {
      return await importBrowserHandoffResult(normalizedInput);
    } catch (error) {
      if (error instanceof BrowserHandoffImportError) {
        throw new BrowserHandoffCompletionSubmitError(error.message, error.statusCode);
      }

      throw error;
    }
  }

  const baseUrl = input.importBaseUrl?.trim() ?? '';
  const adminPassword = input.adminPassword?.trim() ?? '';
  if (!baseUrl || !adminPassword) {
    throw new BrowserHandoffCompletionSubmitError(
      'baseUrl and adminPassword are required to import the browser handoff result',
      400,
    );
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new BrowserHandoffCompletionSubmitError('fetch is unavailable for browser handoff import', 500);
  }

  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/system/browser-handoffs/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': adminPassword,
    },
    body: JSON.stringify(normalizedInput),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof payload.error === 'string' && payload.error.trim().length > 0
        ? payload.error
        : `browser handoff import failed with status ${response.status}`;
    throw new BrowserHandoffCompletionSubmitError(error, response.status);
  }

  return payload;
}

function getRequiredBrowserHandoffArtifact(artifactPath: string) {
  const handoffArtifact = getBrowserHandoffArtifactByPath(artifactPath);
  if (!handoffArtifact) {
    throw new BrowserHandoffCompletionSubmitError('browser handoff artifact not found', 404);
  }

  return handoffArtifact;
}

function normalizeOptionalPositiveHandoffAttempt(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BrowserHandoffCompletionSubmitError(
      'handoffAttempt must be a positive integer',
      400,
    );
  }

  return value;
}
