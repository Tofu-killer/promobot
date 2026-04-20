import { createApp } from './app';
import { loadConfig } from './config';
import { createInboxFetchService } from './services/inboxFetch';
import { createMonitorFetchService } from './services/monitorFetch';
import {
  createChannelAccountSessionRequestJobHandler,
  channelAccountSessionRequestJobType,
} from './services/browser/sessionRequestHandler';
import { createPublishJobHandler } from './services/publishQueue';
import { createReputationFetchService } from './services/reputationFetch';
import { createSchedulerRuntime } from './runtime/schedulerRuntime';

const monitorFetchService = createMonitorFetchService();
const inboxFetchService = createInboxFetchService();
const reputationFetchService = createReputationFetchService();

const schedulerRuntime = createSchedulerRuntime({
  handlers: {
    inbox_fetch: async () => {
      inboxFetchService.fetchNow();
    },
    monitor_fetch: async () => {
      await monitorFetchService.fetchNow();
    },
    [channelAccountSessionRequestJobType]: createChannelAccountSessionRequestJobHandler(),
    publish: createPublishJobHandler(),
    reputation_fetch: async () => {
      reputationFetchService.fetchNow();
    },
  },
});
schedulerRuntime.reload();

const app = createApp(loadConfig(), { schedulerRuntime });
const port = Number(process.env.PORT ?? '3001');

app.listen(port, () => {
  console.log(`PromoBot server listening on ${port}`);
});
