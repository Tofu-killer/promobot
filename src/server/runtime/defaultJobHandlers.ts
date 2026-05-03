import type { JobHandler } from '../lib/jobs.js';
import {
  channelAccountSessionRequestJobType,
  channelAccountSessionRequestPollJobType,
  createChannelAccountSessionRequestJobHandler,
  createChannelAccountSessionRequestPollJobHandler,
} from '../services/browser/sessionRequestHandler.js';
import { createInboxFetchService } from '../services/inboxFetch.js';
import { createMonitorFetchService } from '../services/monitorFetch.js';
import { createPublishJobHandler } from '../services/publishQueue.js';
import {
  browserHandoffPollJobType,
  createBrowserHandoffPollJobHandler,
} from '../services/publishers/browserHandoffPollHandler.js';
import {
  createInboxReplyHandoffPollJobHandler,
  inboxReplyHandoffPollJobType,
} from '../services/inbox/replyHandoffPollHandler.js';
import { createReputationFetchService } from '../services/reputationFetch.js';
import { readRecurringSourceConfigIds } from './sourceConfigRecurringJobs.js';

interface ProjectScopedJobPayload {
  projectId?: unknown;
}

export interface DefaultJobHandlersDependencies {
  monitorFetchService?: Pick<ReturnType<typeof createMonitorFetchService>, 'fetchNow'>;
  inboxFetchService?: Pick<ReturnType<typeof createInboxFetchService>, 'fetchNow'>;
  reputationFetchService?: Pick<ReturnType<typeof createReputationFetchService>, 'fetchNow'>;
  channelAccountSessionRequestHandler?: JobHandler;
  channelAccountSessionRequestPollHandler?: JobHandler;
  browserHandoffPollHandler?: JobHandler;
  inboxReplyHandoffPollHandler?: JobHandler;
  publishJobHandler?: JobHandler;
}

export function createDefaultJobHandlers(
  dependencies: DefaultJobHandlersDependencies = {},
): Record<string, JobHandler> {
  const monitorFetchService = dependencies.monitorFetchService ?? createMonitorFetchService();
  const inboxFetchService = dependencies.inboxFetchService ?? createInboxFetchService();
  const reputationFetchService =
    dependencies.reputationFetchService ?? createReputationFetchService();
  const channelAccountSessionRequestHandler =
    dependencies.channelAccountSessionRequestHandler ??
    createChannelAccountSessionRequestJobHandler();
  const channelAccountSessionRequestPollHandler =
    dependencies.channelAccountSessionRequestPollHandler ??
    createChannelAccountSessionRequestPollJobHandler();
  const browserHandoffPollHandler =
    dependencies.browserHandoffPollHandler ?? createBrowserHandoffPollJobHandler();
  const inboxReplyHandoffPollHandler =
    dependencies.inboxReplyHandoffPollHandler ?? createInboxReplyHandoffPollJobHandler();
  const publishJobHandler = dependencies.publishJobHandler ?? createPublishJobHandler();

  return {
    inbox_fetch: async (payload) => {
      await inboxFetchService.fetchNow(readProjectId(payload), {
        sourceConfigIds: readRecurringSourceConfigIds(payload),
      });
    },
    monitor_fetch: async (payload) => {
      await monitorFetchService.fetchNow(readProjectId(payload), {
        sourceConfigIds: readRecurringSourceConfigIds(payload),
      });
    },
    [browserHandoffPollJobType]: browserHandoffPollHandler,
    [inboxReplyHandoffPollJobType]: inboxReplyHandoffPollHandler,
    [channelAccountSessionRequestJobType]: channelAccountSessionRequestHandler,
    [channelAccountSessionRequestPollJobType]: channelAccountSessionRequestPollHandler,
    publish: publishJobHandler,
    reputation_fetch: async (payload) => {
      await reputationFetchService.fetchNow(readProjectId(payload), {
        sourceConfigIds: readRecurringSourceConfigIds(payload),
      });
    },
  };
}

function readProjectId(payload: unknown): number | undefined {
  const normalizedPayload = isPlainObject(payload) ? (payload as ProjectScopedJobPayload) : {};
  const projectId = Number(normalizedPayload.projectId);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
