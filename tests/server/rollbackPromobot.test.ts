import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve(process.cwd(), 'ops/rollback-promobot.sh');

function runRollbackScript(args: string[]) {
  return spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
  });
}

describe('rollback-promobot.sh', () => {
  it('shows help and documents skip-env', () => {
    const result = runRollbackScript(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: ops/rollback-promobot.sh --backup-dir <path> [options]');
    expect(result.stdout).toContain('--skip-env');
  });

  it('requires --backup-dir', () => {
    const result = runRollbackScript(['--skip-smoke']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--backup-dir is required');
  });

  it('rejects empty values for --base-url and --admin-password', () => {
    const emptyBaseUrl = runRollbackScript(['--backup-dir=/tmp/missing', '--base-url=']);
    const emptyAdminPassword = runRollbackScript(['--backup-dir=/tmp/missing', '--admin-password=']);

    expect(emptyBaseUrl.status).toBe(1);
    expect(emptyBaseUrl.stderr).toContain('--base-url requires a value');
    expect(emptyAdminPassword.status).toBe(1);
    expect(emptyAdminPassword.stderr).toContain('--admin-password requires a value');
  });
});
