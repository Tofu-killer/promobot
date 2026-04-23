import {
  BrowserHandoffImportError,
  importBrowserHandoffResult,
} from './browserHandoffResultImporter.js';

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
  publishStatus: 'published' | 'failed';
  message?: string;
  publishUrl?: string;
  externalId?: string;
  publishedAt?: string;
  importBaseUrl?: string;
  adminPassword?: string;
}

export interface SubmitBrowserHandoffCompletionDependencies {
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

  const normalizedInput = {
    artifactPath,
    publishStatus: input.publishStatus,
    message,
    ...(input.publishUrl?.trim() ? { publishUrl: input.publishUrl.trim() } : {}),
    ...(input.externalId?.trim() ? { externalId: input.externalId.trim() } : {}),
    ...(input.publishedAt?.trim() ? { publishedAt: input.publishedAt.trim() } : {}),
  } as const;

  const shouldImportRemotely = input.importBaseUrl !== undefined || input.adminPassword !== undefined;
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
