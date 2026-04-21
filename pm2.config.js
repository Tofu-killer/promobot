import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(repoRoot, 'logs');

fs.mkdirSync(logDir, { recursive: true });

export default {
  apps: [
    {
      name: 'promobot',
      cwd: repoRoot,
      // Single process for both API routes and the built client when dist/client exists.
      script: './dist/server/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 5,
      exp_backoff_restart_delay: 200,
      kill_timeout: 5000,
      listen_timeout: 8000,
      merge_logs: true,
      time: true,
      out_file: path.join(logDir, 'promobot-out.log'),
      error_file: path.join(logDir, 'promobot-error.log'),
      env: {
        // The app inherits the current shell env, and the server bootstrap also auto-loads repo-root .env when present.
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        PORT: process.env.PORT ?? '3001',
      },
    },
  ],
};
