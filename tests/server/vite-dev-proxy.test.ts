import type { ConfigEnv, ProxyOptions, UserConfig, UserConfigExport } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_DEV_API_ORIGIN = process.env.PROMOBOT_DEV_API_ORIGIN;

describe('vite dev /api proxy config', () => {
  afterEach(() => {
    vi.resetModules();

    if (ORIGINAL_DEV_API_ORIGIN === undefined) {
      delete process.env.PROMOBOT_DEV_API_ORIGIN;
      return;
    }

    process.env.PROMOBOT_DEV_API_ORIGIN = ORIGINAL_DEV_API_ORIGIN;
  });

  it('uses 127.0.0.1:3001 as the default backend target', async () => {
    const config = await loadViteConfig();
    const proxy = getApiProxy(config);

    expect(proxy?.target).toBe('http://127.0.0.1:3001');
  });

  it('uses PROMOBOT_DEV_API_ORIGIN when provided', async () => {
    const config = await loadViteConfig('http://127.0.0.1:4001');
    const proxy = getApiProxy(config);

    expect(proxy?.target).toBe('http://127.0.0.1:4001');
  });
});

async function loadViteConfig(devApiOrigin?: string): Promise<UserConfig> {
  if (devApiOrigin === undefined) {
    delete process.env.PROMOBOT_DEV_API_ORIGIN;
  } else {
    process.env.PROMOBOT_DEV_API_ORIGIN = devApiOrigin;
  }

  vi.resetModules();
  const configModule = await import('../../vite.config');
  return resolveUserConfig(configModule.default);
}

function getApiProxy(config: UserConfig): ProxyOptions | undefined {
  const proxyConfig = config.server?.proxy;
  if (!proxyConfig || Array.isArray(proxyConfig)) {
    return undefined;
  }

  const apiProxy = proxyConfig['/api'];
  if (!apiProxy || typeof apiProxy === 'string') {
    return undefined;
  }

  return apiProxy;
}

async function resolveUserConfig(configExport: UserConfigExport): Promise<UserConfig> {
  const env: ConfigEnv = {
    command: 'serve',
    mode: 'development',
    isSsrBuild: false,
    isPreview: false,
  };

  const maybeConfig =
    typeof configExport === 'function'
      ? configExport(env)
      : configExport;

  const resolvedConfig = await maybeConfig;
  if (!resolvedConfig || Array.isArray(resolvedConfig)) {
    return {};
  }

  return resolvedConfig;
}
