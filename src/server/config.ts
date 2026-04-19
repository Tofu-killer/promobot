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

  return {
    allowedIps: allowedIps.length > 0 ? allowedIps : DEFAULT_ALLOWED_IPS,
    adminPassword: env.ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD,
  };
}
