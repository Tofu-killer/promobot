import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devApiOrigin = process.env.PROMOBOT_DEV_API_ORIGIN ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client'
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: devApiOrigin,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
