import { createChannelAccountStore, type ChannelAccountStore } from '../../store/channelAccounts.js';
import {
  getSessionRequestResultArtifactByPath,
  markSessionRequestResultArtifactConsumed,
  resolveSessionRequestArtifacts,
} from './sessionRequestArtifacts.js';
import { buildSessionSummary, createSessionStore } from './sessionStore.js';

export class SessionRequestResultImportError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface ImportSessionRequestResultArtifactDependencies {
  channelAccountStore?: Pick<ChannelAccountStore, 'getById' | 'update'>;
  sessionStore?: Pick<ReturnType<typeof createSessionStore>, 'saveSession'>;
}

export async function importSessionRequestResultArtifact(
  artifactPath: string,
  dependencies: ImportSessionRequestResultArtifactDependencies = {},
) {
  const channelAccountStore = dependencies.channelAccountStore ?? createChannelAccountStore();
  const sessionStore = dependencies.sessionStore ?? createSessionStore();
  const resultArtifact = getSessionRequestResultArtifactByPath(artifactPath);

  if (!resultArtifact) {
    throw new SessionRequestResultImportError('browser lane result artifact not found', 404);
  }

  const channelAccount = channelAccountStore.getById(resultArtifact.channelAccountId);
  if (!channelAccount) {
    throw new SessionRequestResultImportError('channel account not found', 404);
  }

  if (
    channelAccount.platform !== resultArtifact.platform ||
    channelAccount.accountKey !== resultArtifact.accountKey
  ) {
    throw new SessionRequestResultImportError('browser lane result artifact mismatches channel account', 409);
  }

  if (resultArtifact.consumedAt) {
    return {
      ok: true,
      imported: false,
      artifactPath: resultArtifact.artifactPath,
      session: channelAccount.metadata.session ?? null,
      channelAccount,
    };
  }

  let sessionMetadata;
  try {
    sessionMetadata = sessionStore.saveSession({
      platform: resultArtifact.platform,
      accountKey: resultArtifact.accountKey,
      storageState: resultArtifact.storageState,
      status: resultArtifact.sessionStatus ?? 'active',
      ...(resultArtifact.notes !== undefined ? { notes: resultArtifact.notes } : {}),
      ...(resultArtifact.validatedAt !== undefined
        ? { lastValidatedAt: resultArtifact.validatedAt }
        : {}),
    });
  } catch (error) {
    throw new SessionRequestResultImportError(
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'invalid browser lane result artifact',
      400,
    );
  }

  const session = buildSessionSummary(sessionMetadata);
  const resolution = {
    status: 'resolved',
    source: 'browser_lane_result',
    completedAt: resultArtifact.completedAt,
    session,
  };
  const updatedChannelAccount =
    channelAccountStore.update(channelAccount.id, {
      metadata: {
        ...channelAccount.metadata,
        session,
      },
    }) ?? channelAccount;

  resolveSessionRequestArtifacts({
    channelAccountId: channelAccount.id,
    platform: channelAccount.platform,
    accountKey: channelAccount.accountKey,
    resolvedAt: sessionMetadata.updatedAt,
    resolvedJobStatus: 'resolved',
    resolution,
    savedStorageStatePath: sessionMetadata.storageStatePath,
  });
  markSessionRequestResultArtifactConsumed({
    platform: resultArtifact.platform,
    accountKey: resultArtifact.accountKey,
    action: resultArtifact.action,
    requestJobId: resultArtifact.requestJobId,
    consumedAt: sessionMetadata.updatedAt,
    savedStorageStatePath: sessionMetadata.storageStatePath,
    resolution,
  });

  return {
    ok: true,
    imported: true,
    artifactPath: resultArtifact.artifactPath,
    session,
    channelAccount: {
      ...updatedChannelAccount,
      metadata: {
        ...updatedChannelAccount.metadata,
        session,
      },
    },
  };
}
