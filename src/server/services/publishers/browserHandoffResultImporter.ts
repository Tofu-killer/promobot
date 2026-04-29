import { createSQLiteDraftStore } from '../../store/drafts.js';
import { createSQLitePublishLogStore } from '../../store/publishLogs.js';
import {
  getBrowserHandoffArtifactByPath,
  resolveBrowserHandoffArtifact,
} from './browserHandoffArtifacts.js';
import {
  getBrowserHandoffResultArtifactByPath,
  markBrowserHandoffResultArtifactConsumed,
} from './browserHandoffResultArtifacts.js';

export class BrowserHandoffImportError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function importBrowserHandoffResult(input: {
  artifactPath: string;
  publishStatus: 'published' | 'failed';
  message: string;
  publishUrl?: string | null;
  externalId?: string | null;
  publishedAt?: string | null;
}) {
  const artifact = getBrowserHandoffArtifactByPath(input.artifactPath);
  if (!artifact) {
    throw new BrowserHandoffImportError('browser handoff artifact not found', 404);
  }

  if (artifact.status !== 'pending') {
    throw new BrowserHandoffImportError('browser handoff artifact already resolved', 409);
  }

  const draftId = Number(artifact.draftId);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    throw new BrowserHandoffImportError('browser handoff artifact has an invalid draft id', 409);
  }

  const draftStore = createSQLiteDraftStore();
  const publishLogStore = createSQLitePublishLogStore();
  const draft = draftStore.getById(draftId);
  if (!draft) {
    throw new BrowserHandoffImportError('draft not found', 404);
  }

  const draftStatus = input.publishStatus === 'published' ? 'published' : 'failed';
  const publishUrl =
    typeof input.publishUrl === 'string' && input.publishUrl.trim().length > 0
      ? input.publishUrl
      : null;
  const externalId =
    typeof input.externalId === 'string' && input.externalId.trim().length > 0
      ? input.externalId
      : null;
  const publishedAt =
    input.publishStatus === 'published'
      ? typeof input.publishedAt === 'string' && input.publishedAt.trim().length > 0
        ? input.publishedAt
        : new Date().toISOString()
      : null;

  publishLogStore.create({
    draftId,
    projectId: draft.projectId,
    status: input.publishStatus,
    publishUrl,
    message: input.message,
  });

  draftStore.update(draftId, {
    status: draftStatus,
    scheduledAt: null,
    publishedAt,
  });

  resolveBrowserHandoffArtifact({
    platform: artifact.platform,
    accountKey: artifact.accountKey,
    draftId: artifact.draftId,
    publishStatus: input.publishStatus,
    draftStatus,
    publishUrl,
    externalId,
    message: input.message,
    publishedAt,
  });

  return {
    ok: true,
    imported: true,
    artifactPath: artifact.artifactPath,
    draftId,
    draftStatus,
    platform: artifact.platform,
    mode: 'browser' as const,
    status: input.publishStatus,
    success: input.publishStatus === 'published',
    publishUrl,
    externalId,
    message: input.message,
    publishedAt,
  };
}

export async function importBrowserHandoffResultArtifact(
  artifactPath: string,
  dependencies: {
    now?: () => Date;
  } = {},
) {
  const resultArtifact = getBrowserHandoffResultArtifactByPath(artifactPath);
  if (!resultArtifact) {
    throw new BrowserHandoffImportError('browser handoff result artifact not found', 404);
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
    const importResult = await importBrowserHandoffResult({
      artifactPath: resultArtifact.handoffArtifactPath,
      publishStatus: resultArtifact.publishStatus,
      message: resultArtifact.message,
      ...(resultArtifact.publishUrl !== undefined ? { publishUrl: resultArtifact.publishUrl } : {}),
      ...(resultArtifact.externalId !== undefined ? { externalId: resultArtifact.externalId } : {}),
      ...(resultArtifact.publishedAt !== undefined ? { publishedAt: resultArtifact.publishedAt } : {}),
    });

    markBrowserHandoffResultArtifactConsumed({
      artifactPath: resultArtifact.artifactPath,
      consumedAt,
      resolution: {
        status: 'imported',
        handoffArtifactPath: resultArtifact.handoffArtifactPath,
        completedAt: resultArtifact.completedAt,
        draftId: importResult.draftId,
        draftStatus: importResult.draftStatus,
        publishStatus: importResult.status,
        publishUrl: importResult.publishUrl,
        externalId: importResult.externalId,
        message: importResult.message,
        publishedAt: importResult.publishedAt,
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
      error instanceof BrowserHandoffImportError &&
      error.statusCode === 409 &&
      error.message === 'browser handoff artifact already resolved'
    ) {
      markBrowserHandoffResultArtifactConsumed({
        artifactPath: resultArtifact.artifactPath,
        consumedAt,
        resolution: {
          status: 'ignored',
          reason: 'browser_handoff_artifact_already_resolved',
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
