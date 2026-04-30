import { createChannelAccountStore, type ChannelAccountRecord } from '../store/channelAccounts.js';
import type { InboxItemRecord } from '../store/inbox.js';
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
} from './publishers/http.js';
import {
  createSessionStore,
  resolveManagedBrowserSession,
  type BrowserSessionAction,
  type SessionSummary,
} from './browser/sessionStore.js';
import {
  markInboxReplyHandoffArtifactsObsoleteForAccount,
  writeInboxReplyHandoffArtifact,
  type InboxReplyHandoffPlatform,
} from './inbox/replyHandoffArtifacts.js';
import { clearInboxReplyHandoffResultArtifact } from './inbox/replyHandoffResultArtifacts.js';
import {
  defaultInboxReplyHandoffPollDelayMs,
  defaultInboxReplyHandoffPollMaxAttempts,
  hasOutstandingInboxReplyHandoffPollJob,
  inboxReplyHandoffPollJobType,
} from './inbox/replyHandoffPollHandler.js';
import { getChannelAccountPublishReadiness, type PlatformReadiness } from './platformReadiness.js';
import { createJobQueueStore, type JobQueueStore } from '../store/jobQueue.js';

const X_REPLY_ENDPOINT = 'https://api.twitter.com/2/tweets';
const REDDIT_TOKEN_ENDPOINT = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_COMMENT_ENDPOINT = 'https://oauth.reddit.com/api/comment';

type InboxReplyMode = 'api' | 'browser' | 'manual';
type InboxReplyStatus = 'sent' | 'manual_required' | 'failed';
type ReplyPlatform =
  | 'x'
  | 'reddit'
  | 'facebookGroup'
  | 'instagram'
  | 'tiktok'
  | 'xiaohongshu'
  | 'weibo'
  | 'v2ex'
  | 'manual';
type ReplySelectionSource = 'channelAccountId' | 'accountKey' | 'projectPlatform' | 'environment';

export interface InboxReplyDelivery {
  success: boolean;
  status: InboxReplyStatus;
  mode: InboxReplyMode;
  message: string;
  reply: string;
  deliveryUrl?: string | null;
  externalId?: string | null;
  details?: Record<string, unknown>;
}

export interface InboxReplyService {
  deliver(input: { item: InboxItemRecord; reply: string }): Promise<InboxReplyDelivery>;
}

interface ReplyExecutionContext {
  selection: ReplySelectionSource;
  channelAccount?: ChannelAccountRecord;
  readiness?: PlatformReadiness;
}

interface BrowserReplyHandoffDetails {
  platform: InboxReplyHandoffPlatform;
  channelAccountId?: number;
  accountKey: string;
  readiness: 'ready' | 'blocked';
  session: SessionSummary;
  sessionAction: BrowserSessionAction | null;
  artifactPath?: string;
}

interface ManualReplyAssistantDetails {
  platform: 'v2ex';
  label: string;
  copyText: string;
  sourceUrl?: string;
  openUrl?: string;
  title?: string;
}

interface ReplyContextFailure {
  message: string;
  mode: InboxReplyMode;
  context?: ReplyExecutionContext;
  lookup?: Record<string, unknown>;
}

type ReplyContextResolution =
  | {
      context?: ReplyExecutionContext;
    }
  | {
      failure: ReplyContextFailure;
    };

interface XReplyResponse {
  data?: {
    id?: string;
  };
}

interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

interface RedditAccessTokenResponse {
  access_token?: string;
}

interface RedditCommentResponse {
  json?: {
    data?: {
      things?: Array<{
        data?: {
          id?: string;
          name?: string;
          permalink?: string;
        };
      }>;
    };
  };
}

type RedditAccessTokenResult =
  | {
      accessToken: string;
      retry: RetryStageDetails;
    }
  | {
      failure: {
        message: string;
        retry: {
          oauth: RetryStageDetails;
        };
        error: PublisherErrorDetails;
      };
    };

export function createInboxReplyService(): InboxReplyService {
  const channelAccountStore = createChannelAccountStore();
  const jobQueueStore = createJobQueueStore();

  return {
    async deliver({ item, reply }) {
      const platform = normalizeReplyPlatform(item.source);
      const resolution = resolveReplyContext(channelAccountStore.list(), item, platform);
      const manualReplyAssistant = buildManualReplyAssistant({ item, reply, platform });

      if ('failure' in resolution) {
        return createAccountResolutionFailure(reply, resolution.failure);
      }

      const context = resolution.context;

      if (context?.channelAccount) {
        context.readiness = context.readiness ?? getChannelAccountPublishReadiness(context.channelAccount);
      } else if (context?.selection === 'environment' && isApiReplyPlatform(platform)) {
        context.readiness = getChannelAccountPublishReadiness({
          platform,
          accountKey: 'environment',
          authType: 'api',
        });
      }

      if (context?.readiness && context.readiness.mode !== 'api') {
        const browserReplyHandoff = buildBrowserReplyHandoff({
          item,
          reply,
          platform,
          context,
        });
        maybeEnqueueInboxReplyHandoffPollJob(browserReplyHandoff?.details, jobQueueStore);

        return createManualRequiredDelivery({
          reply,
          mode: context.readiness.mode,
          message:
            browserReplyHandoff?.message ??
            buildManualReplyAssistantMessage(manualReplyAssistant) ??
            buildManualRequiredMessage(platform, context),
          details: buildReplyDetails({
            context,
            browserReplyHandoff: browserReplyHandoff?.details,
            manualReplyAssistant,
          }),
        });
      }

      if (platform === 'x') {
        return await sendXReply({ item, reply, context });
      }

      if (platform === 'reddit') {
        return await sendRedditReply({ item, reply, context });
      }

      return createManualRequiredDelivery({
        reply,
        mode: 'manual',
        message: buildManualReplyAssistantMessage(manualReplyAssistant) ?? 'Reply requires manual delivery.',
        details: buildReplyDetails({
          context,
          manualReplyAssistant,
        }),
      });
    },
  };
}

function resolveReplyContext(
  channelAccounts: ChannelAccountRecord[],
  item: InboxItemRecord,
  platform: ReplyPlatform,
): ReplyContextResolution {
  const metadata = readInboxMetadata(item);
  const explicitChannelAccountId = readInboxMetadataInteger(metadata, ['channelAccountId'], ['channelAccount', 'id']);

  if (explicitChannelAccountId !== undefined) {
    const account = channelAccounts.find((candidate) => candidate.id === explicitChannelAccountId);
    if (!account) {
      return {
        failure: {
          message: `channelAccountId ${explicitChannelAccountId} did not resolve to a channel account.`,
          mode: defaultReplyMode(platform),
          lookup: {
            channelAccountId: explicitChannelAccountId,
            projectId: item.projectId,
            platform,
          },
        },
      };
    }

    const context = createReplyExecutionContext('channelAccountId', account);
    if (normalizeReplyPlatform(account.platform) !== platform) {
      return {
        failure: {
          message: `channelAccountId ${explicitChannelAccountId} did not match ${formatReplyPlatformLabel(platform)} for this inbox item.`,
          mode: defaultReplyMode(platform),
          context,
          lookup: {
            channelAccountId: explicitChannelAccountId,
            projectId: item.projectId,
            platform,
          },
        },
      };
    }

    if (!matchesExplicitProjectScope(account.projectId, item.projectId)) {
      return {
        failure: {
          message: `channelAccountId ${explicitChannelAccountId} did not match the inbox item project scope.`,
          mode: defaultReplyMode(platform),
          context,
          lookup: {
            channelAccountId: explicitChannelAccountId,
            projectId: item.projectId,
            platform,
          },
        },
      };
    }

    return {
      context,
    };
  }

  const platformAccounts = channelAccounts.filter(
    (account) => normalizeReplyPlatform(account.platform) === platform,
  );
  const accountKey = readInboxAccountKey(metadata);

  if (accountKey) {
    const scopedMatches = selectScopedChannelAccounts(
      platformAccounts.filter((account) => account.accountKey === accountKey),
      item.projectId,
    );

    if (scopedMatches.length === 1) {
      return {
        context: createReplyExecutionContext('accountKey', scopedMatches[0]),
      };
    }

    if (scopedMatches.length > 1) {
      return {
        failure: {
          message: `Multiple ${formatReplyPlatformLabel(platform)} channel accounts matched accountKey "${accountKey}" in ${describeScope(item.projectId)}.`,
          mode: defaultReplyMode(platform),
          lookup: {
            accountKey,
            projectId: item.projectId,
            platform,
          },
        },
      };
    }

    return {
      failure: {
        message: `No ${formatReplyPlatformLabel(platform)} channel account matched accountKey "${accountKey}" in ${describeScope(item.projectId)}.`,
        mode: defaultReplyMode(platform),
        lookup: {
          accountKey,
          projectId: item.projectId,
          platform,
        },
      },
    };
  }

  if (platformAccounts.length === 0) {
    return isApiReplyPlatform(platform)
      ? {
          context: createEnvironmentReplyContext(platform),
        }
      : {};
  }

  const scopedMatches = selectScopedChannelAccounts(platformAccounts, item.projectId);
  if (scopedMatches.length === 1) {
    return {
      context: createReplyExecutionContext('projectPlatform', scopedMatches[0]),
    };
  }

  if (scopedMatches.length > 1) {
    return {
      failure: {
        message: `Multiple ${formatReplyPlatformLabel(platform)} channel accounts matched ${describeScope(item.projectId)}. Add channelAccountId or accountKey to inbox metadata.`,
        mode: defaultReplyMode(platform),
        lookup: {
          projectId: item.projectId,
          platform,
        },
      },
    };
  }

  return {
    failure: {
      message: `No ${formatReplyPlatformLabel(platform)} channel account matched ${describeScope(item.projectId)}. Add channelAccountId or accountKey to inbox metadata.`,
      mode: defaultReplyMode(platform),
      lookup: {
        projectId: item.projectId,
        platform,
      },
    },
  };
}

async function sendXReply(input: {
  item: InboxItemRecord;
  reply: string;
  context?: ReplyExecutionContext;
}): Promise<InboxReplyDelivery> {
  const replyTargetId = resolveXReplyTargetId(input.item);
  if (!replyTargetId) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'missing x reply target: configure inbox metadata.replyTargetId or metadata.sourceUrl',
      details: buildReplyDetails({
        replyTo: null,
        context: input.context,
        error: createValidationError('publish'),
      }),
    });
  }

  const accessToken = getXAccessToken();
  if (!accessToken) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'missing x credentials: configure X_ACCESS_TOKEN or X_BEARER_TOKEN',
      details: buildReplyDetails({
        replyTo: replyTargetId,
        retry: {
          publish: {
            attempts: 0,
            maxAttempts: 0,
            stage: 'publish',
          },
        },
        context: input.context,
        error: {
          category: 'auth',
          retriable: false,
          stage: 'publish',
        },
      }),
    });
  }

  let publishRequest;
  try {
    publishRequest = await fetchWithRetry(
      X_REPLY_ENDPOINT,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: input.reply,
          reply: {
            in_reply_to_tweet_id: replyTargetId,
          },
        }),
      },
      {
        stage: 'publish',
      },
    );
  } catch (error) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: error instanceof FetchRetryError ? `x publish request failed: ${error.message}` : 'x publish request failed',
      details: buildReplyDetails({
        replyTo: replyTargetId,
        retry: {
          publish:
            error instanceof FetchRetryError
              ? error.retry
              : {
                  attempts: 1,
                  maxAttempts: 3,
                  stage: 'publish',
                },
        },
        context: input.context,
        error: createTransientError('publish', sanitizeSnippet(error instanceof Error ? error.message : String(error))),
      }),
    });
  }

  const { response, retry } = publishRequest;
  if (!response.ok) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: `X publish request failed with status ${response.status}`,
      details: buildReplyDetails({
        replyTo: replyTargetId,
        retry: {
          publish: retry,
        },
        context: input.context,
        error: classifyHttpError(response.status, 'publish', await readResponseSnippet(response)),
      }),
    });
  }

  let data: XReplyResponse;
  try {
    data = (await response.json()) as XReplyResponse;
  } catch (error) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'x publish response was not valid JSON',
      details: buildReplyDetails({
        replyTo: replyTargetId,
        retry: {
          publish: retry,
        },
        context: input.context,
        error: createInvalidResponseError('publish', sanitizeSnippet(error instanceof Error ? error.message : String(error))),
      }),
    });
  }

  const externalId = data.data?.id?.trim();
  if (!externalId) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'x publish response missing tweet id',
      details: buildReplyDetails({
        replyTo: replyTargetId,
        retry: {
          publish: retry,
        },
        context: input.context,
        error: createInvalidResponseError('publish', sanitizeSnippet(JSON.stringify(data))),
      }),
    });
  }

  return {
    success: true,
    status: 'sent',
    mode: 'api',
    message: `X reply sent to ${resolveReplyTargetLabel(input.item, 'X', replyTargetId)}.`,
    reply: input.reply,
    deliveryUrl: `https://x.com/i/web/status/${externalId}`,
    externalId,
    details: buildReplyDetails({
      replyTo: replyTargetId,
      retry: {
        publish: retry,
      },
      context: input.context,
    }),
  };
}

async function sendRedditReply(input: {
  item: InboxItemRecord;
  reply: string;
  context?: ReplyExecutionContext;
}): Promise<InboxReplyDelivery> {
  const thingFullname = resolveRedditReplyTarget(input.item);
  if (!thingFullname) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'missing reddit reply target: configure inbox metadata.replyThingFullname or metadata.replyTargetId',
      details: buildReplyDetails({
        replyTo: null,
        context: input.context,
        error: createValidationError('submit'),
      }),
    });
  }

  const config = readRedditConfig();
  if (!config) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message:
        'missing reddit credentials: configure REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD',
      details: buildReplyDetails({
        replyTo: thingFullname,
        retry: {
          oauth: {
            attempts: 0,
            maxAttempts: 0,
            stage: 'oauth',
          },
        },
        context: input.context,
        error: {
          category: 'auth',
          retriable: false,
          stage: 'oauth',
        },
      }),
    });
  }

  const accessTokenResult = await getRedditAccessToken(config);
  if ('failure' in accessTokenResult) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: accessTokenResult.failure.message,
      details: buildReplyDetails({
        replyTo: thingFullname,
        retry: accessTokenResult.failure.retry,
        context: input.context,
        error: accessTokenResult.failure.error,
      }),
    });
  }

  let submitRequest;
  try {
    submitRequest = await fetchWithRetry(
      REDDIT_COMMENT_ENDPOINT,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessTokenResult.accessToken}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': config.userAgent,
        },
        body: new URLSearchParams({
          api_type: 'json',
          thing_id: thingFullname,
          text: input.reply,
        }).toString(),
      },
      {
        stage: 'submit',
      },
    );
  } catch (error) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message:
        error instanceof FetchRetryError
          ? `reddit comment request failed: ${error.message}`
          : 'reddit comment request failed',
      details: buildReplyDetails({
        replyTo: thingFullname,
        retry: {
          oauth: accessTokenResult.retry,
          submit:
            error instanceof FetchRetryError
              ? error.retry
              : {
                  attempts: 1,
                  maxAttempts: 3,
                  stage: 'submit',
                },
        },
        context: input.context,
        error: createTransientError('submit', sanitizeSnippet(error instanceof Error ? error.message : String(error))),
      }),
    });
  }

  const { response, retry } = submitRequest;
  if (!response.ok) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: `reddit comment failed with status ${response.status}`,
      details: buildReplyDetails({
        replyTo: thingFullname,
        retry: {
          oauth: accessTokenResult.retry,
          submit: retry,
        },
        context: input.context,
        error: classifyHttpError(response.status, 'submit', await readResponseSnippet(response)),
      }),
    });
  }

  let data: RedditCommentResponse;
  try {
    data = (await response.json()) as RedditCommentResponse;
  } catch (error) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'reddit comment response was not valid JSON',
      details: buildReplyDetails({
        replyTo: thingFullname,
        retry: {
          oauth: accessTokenResult.retry,
          submit: retry,
        },
        context: input.context,
        error: createInvalidResponseError('submit', sanitizeSnippet(error instanceof Error ? error.message : String(error))),
      }),
    });
  }

  const replyData = data.json?.data?.things?.[0]?.data;
  const externalId = readString(replyData?.id) ?? parseRedditCommentExternalId(readString(replyData?.name));
  if (!externalId) {
    return createFailedDelivery({
      reply: input.reply,
      mode: 'api',
      message: 'reddit comment response missing reply id',
      details: buildReplyDetails({
        replyTo: thingFullname,
        retry: {
          oauth: accessTokenResult.retry,
          submit: retry,
        },
        context: input.context,
        error: createInvalidResponseError('submit', sanitizeSnippet(JSON.stringify(data))),
      }),
    });
  }

  return {
    success: true,
    status: 'sent',
    mode: 'api',
    message: `Reddit reply sent to ${resolveReplyTargetLabel(input.item, 'Reddit', thingFullname)}.`,
    reply: input.reply,
    deliveryUrl: normalizeRedditPermalink(readString(replyData?.permalink)) ?? null,
    externalId,
    details: buildReplyDetails({
      replyTo: thingFullname,
      retry: {
        oauth: accessTokenResult.retry,
        submit: retry,
      },
      context: input.context,
    }),
  };
}

function getRedditAccessToken(config: RedditConfig): Promise<RedditAccessTokenResult> {
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  return fetchRedditAccessToken(config, basicAuth);
}

async function fetchRedditAccessToken(
  config: RedditConfig,
  basicAuth: string,
): Promise<RedditAccessTokenResult> {
  let tokenRequest;
  try {
    tokenRequest = await fetchWithRetry(
      REDDIT_TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${basicAuth}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': config.userAgent,
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: config.username,
          password: config.password,
        }).toString(),
      },
      {
        stage: 'oauth',
      },
    );
  } catch (error) {
    return {
      failure: {
        message:
          error instanceof FetchRetryError
            ? `reddit oauth request failed: ${error.message}`
            : 'reddit oauth request failed',
        retry: {
          oauth:
            error instanceof FetchRetryError
              ? error.retry
              : {
                  attempts: 1,
                  maxAttempts: 3,
                  stage: 'oauth',
                },
        },
        error: createTransientError('oauth', sanitizeSnippet(error instanceof Error ? error.message : String(error))),
      },
    };
  }

  const { response, retry } = tokenRequest;
  if (!response.ok) {
    return {
      failure: {
        message: `reddit oauth failed with status ${response.status}`,
        retry: {
          oauth: retry,
        },
        error: classifyHttpError(response.status, 'oauth', await readResponseSnippet(response)),
      },
    };
  }

  let data: RedditAccessTokenResponse;
  try {
    data = (await response.json()) as RedditAccessTokenResponse;
  } catch (error) {
    return {
      failure: {
        message: 'reddit oauth response was not valid JSON',
        retry: {
          oauth: retry,
        },
        error: createInvalidResponseError('oauth', sanitizeSnippet(error instanceof Error ? error.message : String(error))),
      },
    };
  }

  const accessToken = data.access_token?.trim();
  if (!accessToken) {
    return {
      failure: {
        message: 'reddit oauth response missing access token',
        retry: {
          oauth: retry,
        },
        error: createInvalidResponseError('oauth', sanitizeSnippet(JSON.stringify(data))),
      },
    };
  }

  return {
    accessToken,
    retry,
  };
}

function buildReplyDetails(input: {
  replyTo?: string | null;
  retry?: Record<string, unknown>;
  context?: ReplyExecutionContext;
  error?: PublisherErrorDetails;
  browserReplyHandoff?: BrowserReplyHandoffDetails;
  manualReplyAssistant?: ManualReplyAssistantDetails | null;
}): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};

  if (input.replyTo !== undefined) {
    details.replyTo = input.replyTo;
  }

  if (input.retry) {
    details.retry = input.retry;
  }

  const executionContext = buildExecutionContextDetails(input.context);
  if (executionContext) {
    details.context = executionContext;
  }

  if (input.error) {
    details.error = input.error;
  }

  if (input.browserReplyHandoff) {
    details.browserReplyHandoff = input.browserReplyHandoff;
  }

  if (input.manualReplyAssistant) {
    details.manualReplyAssistant = input.manualReplyAssistant;
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function buildExecutionContextDetails(context: ReplyExecutionContext | undefined) {
  if (!context) {
    return undefined;
  }

  return {
    selection: context.selection,
    ...(context.channelAccount ? { channelAccount: summarizeChannelAccount(context.channelAccount) } : {}),
    ...(context.readiness ? { readiness: context.readiness } : {}),
  };
}

function summarizeChannelAccount(account: ChannelAccountRecord) {
  return {
    id: account.id,
    projectId: account.projectId,
    platform: normalizeReplyPlatform(account.platform),
    accountKey: account.accountKey,
    displayName: account.displayName,
    authType: account.authType,
    status: account.status,
  };
}

function createReplyExecutionContext(
  selection: ReplySelectionSource,
  channelAccount: ChannelAccountRecord,
): ReplyExecutionContext {
  return {
    selection,
    channelAccount,
    readiness: getChannelAccountPublishReadiness(channelAccount),
  };
}

function createEnvironmentReplyContext(platform: Extract<ReplyPlatform, 'x' | 'reddit'>): ReplyExecutionContext {
  return {
    selection: 'environment',
    readiness: getChannelAccountPublishReadiness({
      platform,
      accountKey: 'environment',
      authType: 'api',
    }),
  };
}

function createAccountResolutionFailure(
  reply: string,
  failure: ReplyContextFailure,
): InboxReplyDelivery {
  const details = buildReplyDetails({
    context: failure.context,
    error: createValidationError('account_resolution'),
  });

  return createFailedDelivery({
    reply,
    mode: failure.mode,
    message: failure.message,
    details: {
      ...(details ?? {}),
      ...(failure.lookup ? { lookup: failure.lookup } : {}),
    },
  });
}

function createManualRequiredDelivery(input: {
  reply: string;
  mode: InboxReplyMode;
  message: string;
  details?: Record<string, unknown>;
}): InboxReplyDelivery {
  return {
    success: false,
    status: 'manual_required',
    mode: input.mode,
    message: input.message,
    reply: input.reply,
    deliveryUrl: null,
    externalId: null,
    ...(input.details ? { details: input.details } : {}),
  };
}

function createFailedDelivery(input: {
  reply: string;
  mode?: InboxReplyMode;
  message: string;
  details?: Record<string, unknown>;
}): InboxReplyDelivery {
  return {
    success: false,
    status: 'failed',
    mode: input.mode ?? 'api',
    message: input.message,
    reply: input.reply,
    deliveryUrl: null,
    externalId: null,
    ...(input.details ? { details: input.details } : {}),
  };
}

function buildManualRequiredMessage(platform: ReplyPlatform, context: ReplyExecutionContext) {
  const label = formatReplyPlatformLabel(platform);
  const readiness = context.readiness;

  if (!readiness) {
    return 'Reply requires manual delivery.';
  }

  if (readiness.mode === 'browser') {
    if (readiness.status === 'needs_session') {
      return `${label} reply requires a saved browser session before delivery.`;
    }

    if (readiness.status === 'needs_relogin') {
      return `${label} reply requires the browser session to be refreshed before delivery.`;
    }

    return `${label} reply requires browser delivery with the configured channel account.`;
  }

  return `${label} reply requires manual delivery.`;
}

function buildManualReplyAssistant(input: {
  item: InboxItemRecord;
  reply: string;
  platform: ReplyPlatform;
}): ManualReplyAssistantDetails | null {
  if (input.platform !== 'v2ex') {
    return null;
  }

  const sourceUrl = resolveSourceUrl(input.item);

  return {
    platform: 'v2ex',
    label: 'V2EX',
    copyText: input.reply,
    ...(sourceUrl ? { sourceUrl, openUrl: sourceUrl } : {}),
    ...(input.item.title.trim().length > 0 ? { title: input.item.title } : {}),
  };
}

function buildManualReplyAssistantMessage(assistant: ManualReplyAssistantDetails | null) {
  if (!assistant) {
    return null;
  }

  return `${assistant.label} reply is ready for assisted manual delivery. Copy the reply and open the topic.`;
}

function buildBrowserReplyHandoff(input: {
  item: InboxItemRecord;
  reply: string;
  platform: ReplyPlatform;
  context: ReplyExecutionContext;
}): { message: string; details: BrowserReplyHandoffDetails } | null {
  if (input.context.readiness?.mode !== 'browser') {
    return null;
  }

  const handoffPlatform = toInboxReplyHandoffPlatform(input.platform);
  if (!handoffPlatform) {
    return null;
  }

  const metadata = readInboxMetadata(input.item);
  const accountKey =
    input.context.channelAccount?.accountKey ??
    readInboxAccountKey(metadata);
  if (!accountKey) {
    return null;
  }

  const sessionResolution = resolveBrowserReplySessionResolution(handoffPlatform, accountKey);

  if (input.context.channelAccount) {
    input.context.readiness = getChannelAccountPublishReadiness(input.context.channelAccount);
  }

  if (sessionResolution.sessionAction) {
    markInboxReplyHandoffArtifactsObsoleteForAccount({
      platform: handoffPlatform,
      accountKey,
      reason: sessionResolution.sessionAction,
    });
  }

  const handoffArtifact = writeInboxReplyHandoffArtifact({
    ...(typeof input.context.channelAccount?.id === 'number'
      ? { channelAccountId: input.context.channelAccount.id }
      : {}),
    platform: handoffPlatform,
    accountKey,
    item: input.item,
    reply: input.reply,
    sourceUrl: resolveSourceUrl(input.item),
    session: sessionResolution.session,
    sessionAction: sessionResolution.sessionAction,
  });
  clearInboxReplyHandoffResultArtifact({
    platform: handoffPlatform,
    accountKey,
    itemId: String(input.item.id),
  });

  return {
    message: buildBrowserReplyHandoffMessage(input.platform, sessionResolution.sessionAction),
    details: {
      platform: handoffPlatform,
      ...(typeof input.context.channelAccount?.id === 'number'
        ? { channelAccountId: input.context.channelAccount.id }
        : {}),
      accountKey,
      readiness: sessionResolution.sessionAction ? 'blocked' : 'ready',
      session: sessionResolution.session,
      sessionAction: sessionResolution.sessionAction,
      artifactPath: handoffArtifact.artifactPath,
    },
  };
}

function resolveBrowserReplySessionResolution(
  platform: ReplyPlatform,
  accountKey: string,
) {
  const sessionStore = createSessionStore();
  return resolveManagedBrowserSession(sessionStore, platform, accountKey).resolution;
}

function buildBrowserReplyHandoffMessage(
  platform: ReplyPlatform,
  sessionAction: BrowserSessionAction | null,
) {
  const label = formatReplyPlatformLabel(platform);

  if (sessionAction === 'request_session') {
    return `${label} reply requires a saved browser session before manual handoff.`;
  }

  if (sessionAction === 'relogin') {
    return `${label} reply requires the browser session to be refreshed before manual handoff.`;
  }

  return `${label} reply is ready for manual browser handoff with the saved session.`;
}

function maybeEnqueueInboxReplyHandoffPollJob(
  details: BrowserReplyHandoffDetails | undefined,
  jobQueueStore: Pick<JobQueueStore, 'enqueue' | 'list'>,
) {
  if (!details || details.readiness !== 'ready' || !details.artifactPath) {
    return;
  }

  if (
    hasOutstandingInboxReplyHandoffPollJob(jobQueueStore, {
      artifactPath: details.artifactPath,
      currentJobId: undefined,
    })
  ) {
    return;
  }

  jobQueueStore.enqueue({
    type: inboxReplyHandoffPollJobType,
    payload: {
      artifactPath: details.artifactPath,
      attempt: 0,
      maxAttempts: defaultInboxReplyHandoffPollMaxAttempts,
      pollDelayMs: defaultInboxReplyHandoffPollDelayMs,
    },
    runAt: new Date(Date.now() + defaultInboxReplyHandoffPollDelayMs).toISOString(),
  });
}

function resolveXReplyTargetId(item: InboxItemRecord) {
  const metadata = readInboxMetadata(item);
  return readString(metadata.replyTargetId) ?? parseXStatusId(resolveSourceUrl(item));
}

function resolveRedditReplyTarget(item: InboxItemRecord) {
  const metadata = readInboxMetadata(item);
  const thingFullname =
    normalizeThingFullname(metadata.replyThingFullname) ?? normalizeThingFullname(metadata.replyTargetId);
  if (thingFullname) {
    return thingFullname;
  }

  const sourceUrl = resolveSourceUrl(item);
  const replyTargetType = readRedditReplyTargetType(metadata);

  if (replyTargetType === 'reddit_comment') {
    const commentId = readString(metadata.replyTargetId) ?? parseRedditCommentId(sourceUrl);
    return commentId ? `t1_${commentId}` : null;
  }

  const submissionId = readString(metadata.replyTargetId) ?? parseRedditSubmissionId(sourceUrl);
  return submissionId ? `t3_${submissionId}` : null;
}

function normalizeThingFullname(value: unknown) {
  const candidate = readString(value);
  if (!candidate) {
    return null;
  }

  const match = candidate.match(/^(t1|t3)_([A-Za-z0-9_]+)$/i);
  if (!match) {
    return null;
  }

  return `${match[1]?.toLowerCase()}_${match[2]}`;
}

function parseRedditCommentExternalId(value: string | null) {
  const match = value?.match(/^t1_([A-Za-z0-9_]+)$/i);
  return match?.[1] ?? null;
}

function normalizeRedditPermalink(value: string | null) {
  if (!value) {
    return null;
  }

  return value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `https://www.reddit.com${value.startsWith('/') ? value : `/${value}`}`;
}

function resolveReplyTargetLabel(item: InboxItemRecord, platformLabel: string, fallbackTargetId: string) {
  return resolveSourceUrl(item) ?? `${platformLabel.toLowerCase()} target ${fallbackTargetId}`;
}

function resolveSourceUrl(item: InboxItemRecord) {
  const metadata = readInboxMetadata(item);
  const metadataUrl = readString(metadata.sourceUrl);
  if (metadataUrl) {
    return metadataUrl;
  }

  const matches = item.excerpt.match(/https?:\/\/\S+/g);
  const candidate = matches?.[matches.length - 1]?.trim();
  return candidate && candidate.length > 0 ? candidate : null;
}

function selectScopedChannelAccounts(channelAccounts: ChannelAccountRecord[], projectId?: number) {
  if (projectId !== undefined) {
    const projectMatches = channelAccounts.filter((account) => account.projectId === projectId);
    if (projectMatches.length > 0) {
      return projectMatches;
    }

    return channelAccounts.filter((account) => account.projectId === null);
  }

  const globalMatches = channelAccounts.filter((account) => account.projectId === null);
  return globalMatches.length > 0 ? globalMatches : channelAccounts;
}

function matchesExplicitProjectScope(accountProjectId: number | null, itemProjectId: number | undefined) {
  if (accountProjectId === null) {
    return true;
  }

  return itemProjectId !== undefined && accountProjectId === itemProjectId;
}

function readInboxMetadata(item: InboxItemRecord) {
  return isPlainObject(item.metadata) ? item.metadata : {};
}

function readInboxAccountKey(metadata: Record<string, unknown>) {
  return (
    readString(metadata.accountKey) ??
    readString(metadata.channelAccountKey) ??
    readNestedString(metadata, ['channelAccount', 'accountKey']) ??
    readNestedString(metadata, ['browserSession', 'accountKey'])
  );
}

function readInboxMetadataInteger(metadata: Record<string, unknown>, ...paths: string[][]) {
  for (const path of paths) {
    const value = path.length === 1 ? metadata[path[0] ?? ''] : readNestedValue(metadata, path);
    const parsed = readPositiveInteger(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readRedditReplyTargetType(metadata: Record<string, unknown>) {
  const value = readString(metadata.replyTargetType)?.toLowerCase();

  if (value === 'reddit_comment' || value === 'comment') {
    return 'reddit_comment';
  }

  if (value === 'reddit_submission' || value === 'submission') {
    return 'reddit_submission';
  }

  return undefined;
}

function readNestedString(value: Record<string, unknown>, path: string[]) {
  return readString(readNestedValue(value, path));
}

function readNestedValue(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;

  for (const segment of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function readRedditConfig(): RedditConfig | null {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim() ?? '';
  const username = process.env.REDDIT_USERNAME?.trim() ?? '';
  const password = process.env.REDDIT_PASSWORD?.trim() ?? '';

  if (!clientId || !clientSecret || !username || !password) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    username,
    password,
    userAgent: process.env.REDDIT_USER_AGENT?.trim() || 'promobot/0.1',
  };
}

function getXAccessToken() {
  const accessToken = process.env.X_ACCESS_TOKEN?.trim();
  if (accessToken) {
    return accessToken;
  }

  const bearerToken = process.env.X_BEARER_TOKEN?.trim();
  return bearerToken && bearerToken.length > 0 ? bearerToken : null;
}

function normalizeReplyPlatform(platform: string): ReplyPlatform {
  const normalized = platform.trim().toLowerCase();

  if (normalized === 'x / twitter' || normalized === 'twitter' || normalized === 'x') {
    return 'x';
  }

  if (normalized === 'reddit') {
    return 'reddit';
  }

  if (normalized === 'facebook-group' || normalized === 'facebook group' || normalized === 'facebookgroup') {
    return 'facebookGroup';
  }

  if (normalized === 'instagram') {
    return 'instagram';
  }

  if (normalized === 'tiktok') {
    return 'tiktok';
  }

  if (normalized === 'xiaohongshu') {
    return 'xiaohongshu';
  }

  if (normalized === 'weibo') {
    return 'weibo';
  }

  if (normalized === 'v2ex') {
    return 'v2ex';
  }

  return 'manual';
}

function toInboxReplyHandoffPlatform(platform: ReplyPlatform): InboxReplyHandoffPlatform | null {
  return platform === 'manual' || platform === 'v2ex' ? null : platform;
}

function formatReplyPlatformLabel(platform: ReplyPlatform) {
  if (platform === 'x') {
    return 'X';
  }

  if (platform === 'reddit') {
    return 'Reddit';
  }

  if (platform === 'facebookGroup') {
    return 'Facebook Group';
  }

  if (platform === 'instagram') {
    return 'Instagram';
  }

  if (platform === 'tiktok') {
    return 'TikTok';
  }

  if (platform === 'xiaohongshu') {
    return '小红书';
  }

  if (platform === 'weibo') {
    return '微博';
  }

  if (platform === 'v2ex') {
    return 'V2EX';
  }

  return 'Reply';
}

function describeScope(projectId: number | undefined) {
  return projectId === undefined ? 'global scope' : `project ${projectId}`;
}

function defaultReplyMode(platform: ReplyPlatform): InboxReplyMode {
  if (isApiReplyPlatform(platform)) {
    return 'api';
  }

  if (isBrowserReplyPlatform(platform)) {
    return 'browser';
  }

  return 'manual';
}

function isApiReplyPlatform(platform: ReplyPlatform): platform is Extract<ReplyPlatform, 'x' | 'reddit'> {
  return platform === 'x' || platform === 'reddit';
}

function isBrowserReplyPlatform(
  platform: ReplyPlatform,
): platform is Extract<ReplyPlatform, 'facebookGroup' | 'instagram' | 'tiktok' | 'xiaohongshu' | 'weibo'> {
  return (
    platform === 'facebookGroup' ||
    platform === 'instagram' ||
    platform === 'tiktok' ||
    platform === 'xiaohongshu' ||
    platform === 'weibo'
  );
}

function createValidationError(stage: string): PublisherErrorDetails {
  return {
    category: 'validation',
    retriable: false,
    stage,
  };
}

function parseXStatusId(url: string | null) {
  const match = url?.match(/\/status\/([A-Za-z0-9_-]+)/i);
  return match?.[1]?.trim() || null;
}

function parseRedditSubmissionId(url: string | null) {
  const match = url?.match(/\/comments\/([A-Za-z0-9_]+)\//i);
  return match?.[1]?.trim() || null;
}

function parseRedditCommentId(url: string | null) {
  const match = url?.match(/\/comments\/[A-Za-z0-9_]+\/[^/]+\/([A-Za-z0-9_]+)(?:\/|$|\?|#)/i);
  return match?.[1]?.trim() || null;
}

function readPositiveInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
