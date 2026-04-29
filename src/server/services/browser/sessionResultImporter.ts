import { createChannelAccountStore, type ChannelAccountStore } from '../../store/channelAccounts.js';
import {
  createSessionRequestResultArtifact,
  getSessionRequestArtifactByPath,
  getSessionRequestResultArtifactByPath,
  markSessionRequestResultArtifactConsumed,
  resolveSessionRequestArtifacts,
} from './sessionRequestArtifacts.js';
import { resumeBlockedBrowserPublishesForChannelAccount } from './resumeBlockedBrowserPublishes.js';
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
  now?: () => Date;
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
    action: resultArtifact.action,
    jobId: resultArtifact.requestJobId,
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
  resumeBlockedBrowserPublishesForChannelAccount(updatedChannelAccount, session);

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

export async function importInlineSessionRequestResult(
  input: {
    requestArtifactPath: string;
    storageState: Record<string, unknown>;
    sessionStatus?: 'active' | 'expired' | 'missing';
    validatedAt?: string | null;
    notes?: string;
    completedAt?: string;
  },
  dependencies: ImportSessionRequestResultArtifactDependencies = {},
) {
  const requestArtifact = getSessionRequestArtifactByPath(input.requestArtifactPath);
  if (!requestArtifact) {
    throw new SessionRequestResultImportError('browser lane request artifact not found', 404);
  }

  if (requestArtifact.resolvedAt) {
    throw new SessionRequestResultImportError('browser lane request artifact already resolved', 409);
  }

  const resultArtifactPath = createSessionRequestResultArtifact({
    channelAccountId: requestArtifact.channelAccountId,
    platform: requestArtifact.platform,
    accountKey: requestArtifact.accountKey,
    action: requestArtifact.action,
    requestJobId: requestArtifact.jobId,
    completedAt: input.completedAt ?? (dependencies.now ?? (() => new Date()))().toISOString(),
    storageState: input.storageState,
    sessionStatus: input.sessionStatus ?? 'active',
    ...(input.validatedAt !== undefined ? { validatedAt: input.validatedAt } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });

  return importSessionRequestResultArtifact(resultArtifactPath, dependencies);
}
