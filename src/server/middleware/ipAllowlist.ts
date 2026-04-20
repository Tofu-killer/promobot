import { isIP } from 'node:net';
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
  const normalized = normalizeIp(value);
  return normalized === '*' || isIP(normalized) !== 0;
}

export function ipAllowlist(allowedIps: string[]) {
  const normalizedIps = new Set(allowedIps.map(normalizeIp));

  return (request: Request, response: Response, next: NextFunction) => {
    if (normalizedIps.has('*') || normalizedIps.has(getRequestIp(request))) {
      next();
      return;
    }

    response.status(403).json({ error: 'forbidden' });
  };
}
