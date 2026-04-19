import type { NextFunction, Request, Response } from 'express';

export function hasValidAdminPassword(request: Request, adminPassword: string): boolean {
  if (!adminPassword) {
    return true;
  }

  return request.header('x-admin-password') === adminPassword;
}

export function requireAdminPassword(adminPassword: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (hasValidAdminPassword(request, adminPassword)) {
      next();
      return;
    }

    response.status(401).json({ error: 'unauthorized' });
  };
}
