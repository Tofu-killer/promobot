import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/server/config';

describe('loadConfig', () => {
  it('uses safe local defaults outside production', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
      }),
    ).toEqual({
      allowedIps: ['127.0.0.1', '::1'],
      adminPassword: 'change-me',
    });
  });

  it('loads explicit production config when admin password is set', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        ALLOWED_IPS: '10.0.0.10,10.0.0.0/24',
        ADMIN_PASSWORD: 'super-secret',
      }),
    ).toEqual({
      allowedIps: ['10.0.0.10', '10.0.0.0/24'],
      adminPassword: 'super-secret',
    });
  });

  it('throws when ALLOWED_IPS contains malformed entries', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'super-secret',
        ALLOWED_IPS: '10.0.0.0/33',
      }),
    ).toThrow('ALLOWED_IPS must contain IPs, CIDR subnets, or *');

    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'super-secret',
        ALLOWED_IPS: 'not-an-ip',
      }),
    ).toThrow('ALLOWED_IPS must contain IPs, CIDR subnets, or *');
  });

  it('throws in production when admin password is left at the default value', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
      }),
    ).toThrow('ADMIN_PASSWORD must be set to a non-default value in production');

    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'change-me',
      }),
    ).toThrow('ADMIN_PASSWORD must be set to a non-default value in production');
  });
});
