import express from 'express';
import { loadConfig, type AppConfig } from './config';
import { ipAllowlist } from './middleware/ipAllowlist';

export function createApp(config: AppConfig = loadConfig()) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(ipAllowlist(config.allowedIps));

  app.get('/api/system/health', (_request, response) => {
    response.json({ ok: true });
  });

  return app;
}
