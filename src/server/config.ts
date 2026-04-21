import { isSupportedAllowlistEntry } from './middleware/ipAllowlist.js';

export type AppConfig = {
  allowedIps: string[];
  adminPassword: string;
};

const DEFAULT_ALLOWED_IPS = ['127.0.0.1', '::1'];
const DEFAULT_ADMIN_PASSWORD = 'change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const allowedIps = (env.ALLOWED_IPS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const adminPassword = env.ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD;

  if (allowedIps.some((value) => !isSupportedAllowlistValue(value))) {
    throw new Error('ALLOWED_IPS must contain IPs, CIDR subnets, or *');
  }

  if (env.NODE_ENV === 'production' && adminPassword === DEFAULT_ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD must be set to a non-default value in production');
  }

  return {
    allowedIps: allowedIps.length > 0 ? allowedIps : DEFAULT_ALLOWED_IPS,
    adminPassword,
  };
}

function isSupportedAllowlistValue(value: string) {
  return isSupportedAllowlistEntry(value);
}
