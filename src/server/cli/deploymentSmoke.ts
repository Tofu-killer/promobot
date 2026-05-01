import { loadServerEnvFromRoot } from '../env.js';

interface RunDeploymentSmokeCheckInput {
  baseUrl: string;
  adminPassword: string;
}

interface RunDeploymentSmokeCheckDependencies {
  fetchImpl?: typeof fetch;
}

export async function runDeploymentSmokeCheck(
  input: RunDeploymentSmokeCheckInput,
  dependencies: RunDeploymentSmokeCheckDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for deployment smoke checks');
  }

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  const adminPassword =
    input.adminPassword.trim() ||
    process.env.PROMOBOT_ADMIN_PASSWORD?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    '';

  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }

  if (!adminPassword) {
    throw new Error('adminPassword is required');
  }

  const healthResponse = await fetchImpl(`${baseUrl}/api/system/health`);
  const healthBody = await healthResponse.json();
  if (!healthResponse.ok) {
    throw new Error(`health check failed: ${healthResponse.status}`);
  }

  const loginResponse = await fetchImpl(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password: adminPassword,
      remember: false,
    }),
  });
  if (!loginResponse.ok) {
    throw new Error(`login failed: ${loginResponse.status}`);
  }

  const cookieHeader = loginResponse.headers.get('set-cookie') ?? '';
  const cookie = readSetCookieValue(cookieHeader, 'promobot_admin_session');
  if (!cookie) {
    throw new Error('login did not return an admin session cookie');
  }

  const authHeaders = {
    cookie,
  };

  const settingsResponse = await fetchImpl(`${baseUrl}/api/settings`, {
    headers: authHeaders,
  });
  const settingsBody = await settingsResponse.json();
  if (!settingsResponse.ok) {
    throw new Error(`settings probe failed: ${settingsResponse.status}`);
  }

  const browserLaneResponse = await fetchImpl(`${baseUrl}/api/system/browser-lane-requests?limit=1`, {
    headers: authHeaders,
  });
  const browserLaneBody = await browserLaneResponse.json();
  if (!browserLaneResponse.ok) {
    throw new Error(`browser lane probe failed: ${browserLaneResponse.status}`);
  }

  const browserHandoffResponse = await fetchImpl(`${baseUrl}/api/system/browser-handoffs?limit=1`, {
    headers: authHeaders,
  });
  const browserHandoffBody = await browserHandoffResponse.json();
  if (!browserHandoffResponse.ok) {
    throw new Error(`browser handoff probe failed: ${browserHandoffResponse.status}`);
  }

  const inboxReplyHandoffResponse = await fetchImpl(
    `${baseUrl}/api/system/inbox-reply-handoffs?limit=1`,
    {
      headers: authHeaders,
    },
  );
  const inboxReplyHandoffBody = await inboxReplyHandoffResponse.json();
  if (!inboxReplyHandoffResponse.ok) {
    throw new Error(`inbox reply handoff probe failed: ${inboxReplyHandoffResponse.status}`);
  }

  const logoutResponse = await fetchImpl(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!logoutResponse.ok) {
    throw new Error(`logout failed: ${logoutResponse.status}`);
  }

  return {
    ok: true,
    baseUrl,
    checks: {
      health: healthBody,
      settings: settingsBody,
      browserLaneRequests: browserLaneBody,
      browserHandoffs: browserHandoffBody,
      inboxReplyHandoffs: inboxReplyHandoffBody,
    },
  };
}

export function parseDeploymentSmokeArgs(argv: string[]) {
  const parsed: {
    baseUrl: string;
    adminPassword: string;
    showHelp?: boolean;
  } = {
    baseUrl: '',
    adminPassword: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (token === '--base-url') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--base-url requires a value');
      }
      parsed.baseUrl = nextValue ?? '';
      index += 1;
      continue;
    }

    if (token === '--admin-password') {
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--admin-password requires a value');
      }
      parsed.adminPassword = nextValue ?? '';
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

export function getDeploymentSmokeHelpText() {
  return [
    'Usage: tsx src/server/cli/deploymentSmoke.ts --base-url <origin> [--admin-password <secret>]',
    '',
    'The admin password may also come from PROMOBOT_ADMIN_PASSWORD or ADMIN_PASSWORD,',
    'including values loaded from the repo-root .env file.',
    '',
    'Checks:',
    '  1. GET /api/system/health',
    '  2. POST /api/auth/login',
    '  3. GET /api/settings with the returned cookie session',
    '  4. GET /api/system/browser-lane-requests?limit=1',
    '  5. GET /api/system/browser-handoffs?limit=1',
    '  6. GET /api/system/inbox-reply-handoffs?limit=1',
    '  7. POST /api/auth/logout',
  ].join('\n');
}

function readSetCookieValue(setCookieHeader: string, cookieName: string) {
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  return match ? `${cookieName}=${match[1]}` : null;
}

async function main() {
  loadServerEnvFromRoot();
  const input = parseDeploymentSmokeArgs(process.argv.slice(2));
  if (input.showHelp) {
    process.stdout.write(`${getDeploymentSmokeHelpText()}\n`);
    return;
  }

  const result = await runDeploymentSmokeCheck({
    baseUrl: input.baseUrl,
    adminPassword: input.adminPassword,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMainModule) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
