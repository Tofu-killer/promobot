import { createInboxStore } from '../../store/inbox.js';
import {
  getInboxReplyHandoffArtifactByPath,
  resolveInboxReplyHandoffArtifact,
} from './replyHandoffArtifacts.js';

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
