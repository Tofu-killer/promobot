import { createApp } from './app';
import { loadConfig } from './config';
import { createPublishJobHandler } from './services/publishQueue';
import { createSchedulerRuntime } from './runtime/schedulerRuntime';

const schedulerRuntime = createSchedulerRuntime({
  handlers: {
    publish: createPublishJobHandler(),
  },
});
schedulerRuntime.reload();

const app = createApp(loadConfig(), { schedulerRuntime });
const port = Number(process.env.PORT ?? '3001');

app.listen(port, () => {
  console.log(`PromoBot server listening on ${port}`);
});
