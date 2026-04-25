import {
  InboxReplyHandoffImportError,
  importInboxReplyHandoffResult,
} from './replyHandoffResultImporter.js';

export class InboxReplyHandoffCompletionSubmitError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface SubmitInboxReplyHandoffCompletionInput {
  artifactPath: string;
  replyStatus: 'sent' | 'failed';
  message?: string;
  deliveryUrl?: string;
  externalId?: string;
  deliveredAt?: string;
  importBaseUrl?: string;
  adminPassword?: string;
}

export interface SubmitInboxReplyHandoffCompletionDependencies {
  fetchImpl?: typeof fetch;
}

export async function submitInboxReplyHandoffCompletion(
  input: SubmitInboxReplyHandoffCompletionInput,
  dependencies: SubmitInboxReplyHandoffCompletionDependencies = {},
) {
  const artifactPath = input.artifactPath.trim();
  if (!artifactPath) {
    throw new InboxReplyHandoffCompletionSubmitError('artifactPath is required', 400);
  }

  const message =
    input.message?.trim() ||
    (input.replyStatus === 'sent'
      ? 'inbox reply handoff marked sent'
      : 'inbox reply handoff marked failed');

  const normalizedInput = {
    artifactPath,
    replyStatus: input.replyStatus,
    message,
    ...(input.deliveryUrl?.trim() ? { deliveryUrl: input.deliveryUrl.trim() } : {}),
    ...(input.externalId?.trim() ? { externalId: input.externalId.trim() } : {}),
    ...(input.deliveredAt?.trim() ? { deliveredAt: input.deliveredAt.trim() } : {}),
  } as const;

  const shouldImportRemotely = input.importBaseUrl !== undefined || input.adminPassword !== undefined;
  if (!shouldImportRemotely) {
    try {
      return await importInboxReplyHandoffResult(normalizedInput);
    } catch (error) {
      if (error instanceof InboxReplyHandoffImportError) {
        throw new InboxReplyHandoffCompletionSubmitError(error.message, error.statusCode);
      }

      throw error;
    }
  }

  const baseUrl = input.importBaseUrl?.trim() ?? '';
  const adminPassword = input.adminPassword?.trim() ?? '';
  if (!baseUrl || !adminPassword) {
    throw new InboxReplyHandoffCompletionSubmitError(
      'baseUrl and adminPassword are required to import the inbox reply handoff result',
      400,
    );
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new InboxReplyHandoffCompletionSubmitError(
      'fetch is unavailable for inbox reply handoff import',
      500,
    );
  }

  const response = await fetchImpl(
    `${baseUrl.replace(/\/+$/, '')}/api/system/inbox-reply-handoffs/import`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword,
      },
      body: JSON.stringify(normalizedInput),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof payload.error === 'string' && payload.error.trim().length > 0
        ? payload.error
        : `inbox reply handoff import failed with status ${response.status}`;
    throw new InboxReplyHandoffCompletionSubmitError(error, response.status);
  }

  return payload;
}
