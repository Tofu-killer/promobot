import { BlockList, isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();

  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length);
  }

  return trimmed;
}

export function getRequestIp(request: Request): string {
  return normalizeIp(request.socket.remoteAddress || request.ip || '');
}

export function isSupportedAllowlistEntry(value: string): boolean {
  const normalized = value.trim();
  if (normalized === '*') {
    return true;
  }

  const cidr = parseCidrEntry(normalized);
  if (!cidr) {
    return isIpAddress(normalized);
  }

  try {
    const matcher = new BlockList();
    matcher.addSubnet(cidr.address, cidr.prefix, cidr.family);
    return true;
  } catch {
    return false;
  }
}

export function ipAllowlist(allowedIps: string[] | (() => string[])) {
  const readAllowedIps = typeof allowedIps === 'function' ? allowedIps : () => allowedIps;

  return (request: Request, response: Response, next: NextFunction) => {
    if (isAllowlistedRequest(getRequestIp(request), readAllowedIps())) {
      next();
      return;
    }

    response.status(403).json({ error: 'forbidden' });
  };
}

function isAllowlistedRequest(requestIp: string, allowedIps: string[]) {
  const normalizedRequestIp = normalizeIp(requestIp);
  const family = getIpFamily(normalizedRequestIp);
  if (!family) {
    return allowedIps.includes('*');
  }

  const matcher = new BlockList();
  for (const allowedIp of allowedIps) {
    const normalizedAllowedIp = allowedIp.trim();
    if (normalizedAllowedIp === '*') {
      return true;
    }

    const cidr = parseCidrEntry(normalizedAllowedIp);
    try {
      if (cidr) {
        matcher.addSubnet(cidr.address, cidr.prefix, cidr.family);
      } else {
        const allowedFamily = getIpFamily(normalizedAllowedIp);
        if (!allowedFamily) {
          continue;
        }
        matcher.addAddress(normalizeIp(normalizedAllowedIp), allowedFamily);
      }
    } catch {
      continue;
    }
  }

  return matcher.check(normalizedRequestIp, family);
}

function parseCidrEntry(value: string) {
  const slashIndex = value.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }

  const address = normalizeIp(value.slice(0, slashIndex).trim());
  const prefixText = value.slice(slashIndex + 1).trim();
  if (!address || !prefixText || prefixText.includes('/')) {
    return null;
  }

  if (!/^\d+$/.test(prefixText)) {
    return null;
  }

  const family = getIpFamily(address);
  if (!family) {
    return null;
  }

  return {
    address,
    prefix: Number(prefixText),
    family,
  } as const;
}

function getIpFamily(value: string) {
  const normalized = normalizeIp(value);
  const version = isIP(normalized);
  if (version === 4) {
    return 'ipv4' as const;
  }
  if (version === 6) {
    return 'ipv6' as const;
  }
  return null;
}

function isIpAddress(value: string) {
  return getIpFamily(value) !== null;
}
