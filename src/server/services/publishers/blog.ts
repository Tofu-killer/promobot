import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PublishRequest, PublishResult, Publisher } from './types.js';
import {
  FetchRetryError,
  type PublisherErrorDetails,
  type RetryStageDetails,
  classifyHttpError,
  createInvalidResponseError,
  createTransientError,
  fetchWithRetry,
  readResponseSnippet,
  sanitizeSnippet,
} from './http.js';

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'data/blog-posts');
const DEFAULT_DRIVER = 'file';
const PUBLISH_STAGE = 'publish';

export const publishToBlog: Publisher = async (
  request: PublishRequest,
): Promise<PublishResult> => {
  const driver = resolveBlogPublishDriver();

  if (driver === 'file') {
    return publishToLocalFile(request);
  }

  if (driver === 'wordpress') {
    return publishToWordPress(request);
  }

  if (driver === 'ghost') {
    return publishToGhost(request);
  }

  return createFailedPublishResult(request, driver, {
    message: `unsupported blog publish driver: ${driver}`,
    retry: {
      publish: createPublishRetryDetails(0, 0),
    },
    error: {
      category: 'validation',
      retriable: false,
      stage: PUBLISH_STAGE,
      bodySnippet: sanitizeSnippet(driver),
    },
  });
};

function resolveOutputDir() {
  const configured = process.env.BLOG_PUBLISH_OUTPUT_DIR?.trim();
  return configured ? path.resolve(configured) : DEFAULT_OUTPUT_DIR;
}

function resolveBlogPublishDriver(): string {
  return process.env.BLOG_PUBLISH_DRIVER?.trim().toLowerCase() || DEFAULT_DRIVER;
}

function resolveWordPressSiteUrl(): string | null {
  const configured = process.env.BLOG_WORDPRESS_SITE_URL?.trim();
  if (!configured) {
    return null;
  }

  return configured.replace(/\/+$/u, '');
}

function resolveGhostAdminUrl(): string | null {
  const configured = process.env.BLOG_GHOST_ADMIN_URL?.trim();
  if (!configured) {
    return null;
  }

  const trimmed = configured.replace(/\/+$/u, '');
  return trimmed.endsWith('/ghost') ? trimmed : `${trimmed}/ghost`;
}

export function isValidGhostAdminApiKey(apiKey: string | null | undefined): boolean {
  if (typeof apiKey !== 'string') {
    return false;
  }

  const [keyId, secretHex, ...rest] = apiKey.trim().split(':');
  if (rest.length > 0 || !keyId || !secretHex) {
    return false;
  }

  return /^[0-9a-f]+$/iu.test(secretHex) && secretHex.length % 2 === 0;
}

function publishToLocalFile(request: PublishRequest): PublishResult {
  const publishedAt = new Date().toISOString();
  const draftId = String(request.draftId);
  const slug = buildSlug(draftId, request.title);
  const outputDir = resolveOutputDir();
  const outputPath = path.join(outputDir, `${slug}.md`);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, buildMarkdownDocument(request, publishedAt), 'utf8');

  return {
    platform: 'blog',
    mode: 'api',
    status: 'published',
    success: true,
    publishUrl: `file://${outputPath}`,
    externalId: slug,
    message: `blog publisher wrote draft ${draftId} to ${outputPath}`,
    publishedAt,
    details: {
      provider: 'file',
      ...(request.target ? { target: request.target } : {}),
      outputPath,
    },
  };
}

async function publishToWordPress(request: PublishRequest): Promise<PublishResult> {
  const siteUrl = resolveWordPressSiteUrl();
  const username = process.env.BLOG_WORDPRESS_USERNAME?.trim();
  const appPassword = process.env.BLOG_WORDPRESS_APP_PASSWORD?.trim();

  if (!siteUrl || !username || !appPassword) {
    return createFailedPublishResult(request, 'wordpress', {
      message:
        'missing wordpress blog credentials: configure BLOG_WORDPRESS_SITE_URL, BLOG_WORDPRESS_USERNAME, and BLOG_WORDPRESS_APP_PASSWORD',
      retry: {
        publish: createPublishRetryDetails(0, 0),
      },
      error: {
        category: 'auth',
        retriable: false,
        stage: PUBLISH_STAGE,
      },
    });
  }

  let publishRequest;
  try {
    publishRequest = await fetchWithRetry(
      `${siteUrl}/wp-json/wp/v2/posts`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          title: request.title ?? 'Untitled',
          content: request.content,
          status: 'publish',
        }),
      },
      {
        stage: PUBLISH_STAGE,
      },
    );
  } catch (error) {
    return createFailedPublishResult(
      request,
      'wordpress',
      error instanceof FetchRetryError
        ? {
            message: `wordpress publish request failed: ${error.message}`,
            retry: {
              publish: error.retry,
            },
            error: createTransientError(PUBLISH_STAGE, sanitizeSnippet(error.message)),
            extraDetails: {
              siteUrl,
            },
          }
        : {
            message: 'wordpress publish request failed',
            retry: {
              publish: createPublishRetryDetails(1, 3),
            },
            error: createTransientError(
              PUBLISH_STAGE,
              sanitizeSnippet(error instanceof Error ? error.message : String(error)),
            ),
            extraDetails: {
              siteUrl,
            },
          },
    );
  }

  const { response, retry } = publishRequest;
  if (!response.ok) {
    return createFailedPublishResult(request, 'wordpress', {
      message: `wordpress publish request failed with status ${response.status}`,
      retry: {
        publish: retry,
      },
      error: classifyHttpError(response.status, PUBLISH_STAGE, await readResponseSnippet(response)),
      extraDetails: {
        siteUrl,
      },
    });
  }

  let data: WordPressPublishResponse;
  try {
    data = (await response.json()) as WordPressPublishResponse;
  } catch (error) {
    return createFailedPublishResult(request, 'wordpress', {
      message: 'wordpress publish response was not valid JSON',
      retry: {
        publish: retry,
      },
      error: createInvalidResponseError(
        PUBLISH_STAGE,
        sanitizeSnippet(error instanceof Error ? error.message : String(error)),
      ),
      extraDetails: {
        siteUrl,
      },
    });
  }

  const externalId = normalizeRemoteId(data.id);
  const publishUrl = data.link?.trim() || null;
  const remoteStatus = data.status?.trim();
  const slug = data.slug?.trim();
  if (!externalId || !publishUrl || !remoteStatus) {
    return createFailedPublishResult(request, 'wordpress', {
      message: 'wordpress publish response missing required fields',
      retry: {
        publish: retry,
      },
      error: createInvalidResponseError(PUBLISH_STAGE, sanitizeSnippet(JSON.stringify(data))),
      extraDetails: {
        siteUrl,
      },
    });
  }

  return {
    platform: 'blog',
    mode: 'api',
    status: 'published',
    success: true,
    publishUrl,
    externalId,
    message: `blog wordpress published draft ${String(request.draftId)}`,
    publishedAt: new Date().toISOString(),
    details: {
      provider: 'wordpress',
      ...(request.target ? { target: request.target } : {}),
      siteUrl,
      remoteStatus,
      ...(slug ? { slug } : {}),
      retry: {
        publish: retry,
      },
    },
  };
}

async function publishToGhost(request: PublishRequest): Promise<PublishResult> {
  const adminUrl = resolveGhostAdminUrl();
  const apiKey = process.env.BLOG_GHOST_ADMIN_API_KEY?.trim();

  if (!adminUrl || !apiKey) {
    return createFailedPublishResult(request, 'ghost', {
      message:
        'missing ghost blog credentials: configure BLOG_GHOST_ADMIN_URL and BLOG_GHOST_ADMIN_API_KEY',
      retry: {
        publish: createPublishRetryDetails(0, 0),
      },
      error: {
        category: 'auth',
        retriable: false,
        stage: PUBLISH_STAGE,
      },
    });
  }

  let authorization: string;
  try {
    authorization = `Ghost ${createGhostAdminToken(apiKey)}`;
  } catch (error) {
    return createFailedPublishResult(request, 'ghost', {
      message: 'ghost admin api key is invalid',
      retry: {
        publish: createPublishRetryDetails(0, 0),
      },
      error: {
        category: 'auth',
        retriable: false,
        stage: PUBLISH_STAGE,
        bodySnippet: sanitizeSnippet(error instanceof Error ? error.message : String(error)),
      },
      extraDetails: {
        adminUrl,
      },
    });
  }

  let publishRequest;
  try {
    publishRequest = await fetchWithRetry(
      `${adminUrl}/api/admin/posts/?source=html`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization,
        },
        body: JSON.stringify({
          posts: [
            {
              title: request.title ?? 'Untitled',
              html: request.content,
              status: 'published',
            },
          ],
        }),
      },
      {
        stage: PUBLISH_STAGE,
      },
    );
  } catch (error) {
    return createFailedPublishResult(
      request,
      'ghost',
      error instanceof FetchRetryError
        ? {
            message: `ghost publish request failed: ${error.message}`,
            retry: {
              publish: error.retry,
            },
            error: createTransientError(PUBLISH_STAGE, sanitizeSnippet(error.message)),
            extraDetails: {
              adminUrl,
            },
          }
        : {
            message: 'ghost publish request failed',
            retry: {
              publish: createPublishRetryDetails(1, 3),
            },
            error: createTransientError(
              PUBLISH_STAGE,
              sanitizeSnippet(error instanceof Error ? error.message : String(error)),
            ),
            extraDetails: {
              adminUrl,
            },
          },
    );
  }

  const { response, retry } = publishRequest;
  if (!response.ok) {
    return createFailedPublishResult(request, 'ghost', {
      message: `ghost publish request failed with status ${response.status}`,
      retry: {
        publish: retry,
      },
      error: classifyHttpError(response.status, PUBLISH_STAGE, await readResponseSnippet(response)),
      extraDetails: {
        adminUrl,
      },
    });
  }

  let data: GhostPublishResponse;
  try {
    data = (await response.json()) as GhostPublishResponse;
  } catch (error) {
    return createFailedPublishResult(request, 'ghost', {
      message: 'ghost publish response was not valid JSON',
      retry: {
        publish: retry,
      },
      error: createInvalidResponseError(
        PUBLISH_STAGE,
        sanitizeSnippet(error instanceof Error ? error.message : String(error)),
      ),
      extraDetails: {
        adminUrl,
      },
    });
  }

  const post = data.posts?.[0];
  const externalId = post?.id?.trim() || null;
  const publishUrl = post?.url?.trim() || null;
  const remoteStatus = post?.status?.trim();
  const slug = post?.slug?.trim();
  if (!externalId || !publishUrl || !remoteStatus) {
    return createFailedPublishResult(request, 'ghost', {
      message: 'ghost publish response missing required fields',
      retry: {
        publish: retry,
      },
      error: createInvalidResponseError(PUBLISH_STAGE, sanitizeSnippet(JSON.stringify(data))),
      extraDetails: {
        adminUrl,
      },
    });
  }

  return {
    platform: 'blog',
    mode: 'api',
    status: 'published',
    success: true,
    publishUrl,
    externalId,
    message: `blog ghost published draft ${String(request.draftId)}`,
    publishedAt: new Date().toISOString(),
    details: {
      provider: 'ghost',
      ...(request.target ? { target: request.target } : {}),
      adminUrl,
      remoteStatus,
      ...(slug ? { slug } : {}),
      retry: {
        publish: retry,
      },
    },
  };
}

function buildSlug(draftId: string, title?: string) {
  const titleSlug = (title ?? 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return `blog-${draftId}-${titleSlug || 'untitled'}`;
}

function buildMarkdownDocument(request: PublishRequest, publishedAt: string) {
  const lines = [
    '---',
    `draftId: "${String(request.draftId)}"`,
    `title: "${escapeYamlString(request.title ?? 'Untitled')}"`,
  ];

  if (request.target) {
    lines.push(`target: "${escapeYamlString(request.target)}"`);
  }

  lines.push(`publishedAt: "${publishedAt}"`);
  lines.push('---', '', request.content, '');

  return lines.join('\n');
}

function escapeYamlString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface WordPressPublishResponse {
  id?: number | string;
  link?: string;
  status?: string;
  slug?: string;
}

interface GhostPublishResponse {
  posts?: Array<{
    id?: string;
    url?: string;
    status?: string;
    slug?: string;
  }>;
}

function createFailedPublishResult(
  request: PublishRequest,
  provider: string,
  input: {
    message: string;
    retry: {
      publish: RetryStageDetails;
    };
    error: PublisherErrorDetails;
    extraDetails?: Record<string, unknown>;
  },
): PublishResult {
  return {
    platform: 'blog',
    mode: 'api',
    status: 'failed',
    success: false,
    publishUrl: null,
    externalId: null,
    message: input.message,
    publishedAt: null,
    details: {
      provider,
      ...(request.target ? { target: request.target } : {}),
      ...(input.extraDetails ?? {}),
      retry: input.retry,
      error: input.error,
    },
  };
}

function normalizeRemoteId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function createPublishRetryDetails(
  attempts: number,
  maxAttempts: number,
  lastHttpStatus?: number,
  retryAfterMs?: number,
): RetryStageDetails {
  return {
    attempts,
    maxAttempts,
    stage: PUBLISH_STAGE,
    ...(typeof lastHttpStatus === 'number' ? { lastHttpStatus } : {}),
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
  };
}

function createGhostAdminToken(apiKey: string): string {
  const [keyId, secretHex] = apiKey.split(':', 2);
  if (!isValidGhostAdminApiKey(apiKey) || !keyId?.trim() || !secretHex?.trim()) {
    throw new Error('ghost admin api key must be formatted as <id>:<secret>');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    kid: keyId,
    typ: 'JWT',
  };
  const payload = {
    iat: issuedAt,
    exp: issuedAt + 300,
    aud: '/admin/',
  };
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(content)
    .digest('base64url');

  return `${content}.${signature}`;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}
