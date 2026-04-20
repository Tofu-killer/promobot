import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDefaultJobHandlers } from './runtime/defaultJobHandlers.js';
import { createSchedulerRuntime } from './runtime/schedulerRuntime.js';

const schedulerRuntime = createSchedulerRuntime({
  handlers: createDefaultJobHandlers(),
});
schedulerRuntime.reload();

const app = createApp(loadConfig(), { schedulerRuntime });
const port = Number(process.env.PORT ?? '3001');

app.listen(port, () => {
  console.log(`PromoBot server listening on ${port}`);
});
