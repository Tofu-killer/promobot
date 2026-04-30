import { createInboxStore } from '../../store/inbox.js';
import {
  getInboxReplyHandoffArtifactByPath,
  promoteInboxReplyHandoffArtifactToReady,
  resolveInboxReplyHandoffArtifact,
} from './replyHandoffArtifacts.js';
import {
  getInboxReplyHandoffResultArtifactByPath,
  markInboxReplyHandoffResultArtifactConsumed,
} from './replyHandoffResultArtifacts.js';

export class InboxReplyHandoffImportError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function importInboxReplyHandoffResult(input: {
  artifactPath: string;
  replyStatus: 'sent' | 'failed';
  message: string;
  deliveryUrl?: string | null;
  externalId?: string | null;
  deliveredAt?: string | null;
}) {
  const artifact = getInboxReplyHandoffArtifactByPath(input.artifactPath);
  if (!artifact) {
    throw new InboxReplyHandoffImportError('inbox reply handoff artifact not found', 404);
  }

  if (artifact.status !== 'pending') {
    throw new InboxReplyHandoffImportError('inbox reply handoff artifact already resolved', 409);
  }

  if (artifact.readiness === 'blocked') {
    throw new InboxReplyHandoffImportError(
      'inbox reply handoff artifact is still waiting for session restoration',
      409,
    );
  }

  const itemId = Number(artifact.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new InboxReplyHandoffImportError('inbox reply handoff artifact has an invalid item id', 409);
  }

  const inboxStore = createInboxStore();
  const item = inboxStore.list().find((entry) => entry.id === itemId);
  if (!item) {
    throw new InboxReplyHandoffImportError('inbox item not found', 404);
  }

  const deliveryUrl =
    typeof input.deliveryUrl === 'string' && input.deliveryUrl.trim().length > 0
      ? input.deliveryUrl
      : null;
  const externalId =
    typeof input.externalId === 'string' && input.externalId.trim().length > 0
      ? input.externalId
      : null;
  const deliveredAt =
    input.replyStatus === 'sent'
      ? typeof input.deliveredAt === 'string' && input.deliveredAt.trim().length > 0
        ? input.deliveredAt
        : new Date().toISOString()
      : null;

  let itemStatus = item.status;
  if (input.replyStatus === 'sent') {
    const handledItem = inboxStore.updateStatus(itemId, 'handled');
    itemStatus = handledItem?.status ?? item.status;
  }

  const resolvedArtifact = resolveInboxReplyHandoffArtifact({
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    itemId: artifact.itemId,
    replyStatus: input.replyStatus,
    itemStatus,
    deliveryUrl,
    externalId,
    message: input.message,
    deliveredAt,
  });
  if (!resolvedArtifact) {
    throw new InboxReplyHandoffImportError('inbox reply handoff artifact update failed', 500);
  }

  return {
    ok: true,
    imported: true,
    artifactPath: artifact.artifactPath,
    itemId,
    itemStatus,
    platform: artifact.platform,
    mode: 'browser' as const,
    status: input.replyStatus,
    success: input.replyStatus === 'sent',
    deliveryUrl,
    externalId,
    message: input.message,
    deliveredAt,
  };
}

export async function importInboxReplyHandoffResultArtifact(
  artifactPath: string,
  dependencies: {
    now?: () => Date;
  } = {},
) {
  const resultArtifact = getInboxReplyHandoffResultArtifactByPath(artifactPath);
  if (!resultArtifact) {
    throw new InboxReplyHandoffImportError('inbox reply handoff result artifact not found', 404);
  }

  if (resultArtifact.consumedAt) {
    return {
      ok: true,
      imported: false,
      artifactPath: resultArtifact.artifactPath,
      handoffArtifactPath: resultArtifact.handoffArtifactPath,
    };
  }

  const consumedAt = (dependencies.now ?? (() => new Date()))().toISOString();

  try {
    const handoffArtifact = getInboxReplyHandoffArtifactByPath(resultArtifact.handoffArtifactPath);
    if (handoffArtifact?.status === 'pending' && handoffArtifact.readiness === 'blocked') {
      promoteInboxReplyHandoffArtifactToReady({
        artifactPath: resultArtifact.handoffArtifactPath,
      });
    }

    const importResult = await importInboxReplyHandoffResult({
      artifactPath: resultArtifact.handoffArtifactPath,
      replyStatus: resultArtifact.replyStatus,
      message: resultArtifact.message,
      ...(resultArtifact.deliveryUrl !== undefined ? { deliveryUrl: resultArtifact.deliveryUrl } : {}),
      ...(resultArtifact.externalId !== undefined ? { externalId: resultArtifact.externalId } : {}),
      ...(resultArtifact.deliveredAt !== undefined ? { deliveredAt: resultArtifact.deliveredAt } : {}),
    });

    markInboxReplyHandoffResultArtifactConsumed({
      artifactPath: resultArtifact.artifactPath,
      consumedAt,
      resolution: {
        status: 'imported',
        handoffArtifactPath: resultArtifact.handoffArtifactPath,
        completedAt: resultArtifact.completedAt,
        itemId: importResult.itemId,
        itemStatus: importResult.itemStatus,
        replyStatus: importResult.status,
        deliveryUrl: importResult.deliveryUrl,
        externalId: importResult.externalId,
        message: importResult.message,
        deliveredAt: importResult.deliveredAt,
      },
    });

    return {
      ok: true,
      imported: true,
      artifactPath: resultArtifact.artifactPath,
      handoffArtifactPath: resultArtifact.handoffArtifactPath,
      importResult,
    };
  } catch (error) {
    if (
      error instanceof InboxReplyHandoffImportError &&
      error.statusCode === 409 &&
      error.message === 'inbox reply handoff artifact already resolved'
    ) {
      markInboxReplyHandoffResultArtifactConsumed({
        artifactPath: resultArtifact.artifactPath,
        consumedAt,
        resolution: {
          status: 'ignored',
          reason: 'inbox_reply_handoff_artifact_already_resolved',
          handoffArtifactPath: resultArtifact.handoffArtifactPath,
          completedAt: resultArtifact.completedAt,
        },
      });

      return {
        ok: true,
        imported: false,
        artifactPath: resultArtifact.artifactPath,
        handoffArtifactPath: resultArtifact.handoffArtifactPath,
      };
    }

    throw error;
  }
}
