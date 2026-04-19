import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

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
      env: {
        // The app inherits the current shell env. It does not parse .env files by itself.
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        PORT: process.env.PORT ?? '3001',
      },
    },
  ],
};
