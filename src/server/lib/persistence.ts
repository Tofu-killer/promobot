import fs from 'node:fs';
import path from 'node:path';
import { initDb, type DatabaseConnection } from '../db.js';

const DEFAULT_DATABASE_PATH = path.resolve(process.cwd(), 'data/promobot.sqlite');

let configuredDatabasePath: string | undefined;
let cachedDatabasePath: string | undefined;
let cachedDatabase: DatabaseConnection | undefined;

export function setDatabasePath(databasePath: string) {
  configuredDatabasePath = databasePath;
  if (cachedDatabase && cachedDatabasePath !== databasePath) {
    cachedDatabase.close();
    cachedDatabase = undefined;
    cachedDatabasePath = undefined;
  }
}

export function resetDatabasePath() {
  configuredDatabasePath = undefined;
  if (cachedDatabase) {
    cachedDatabase.close();
    cachedDatabase = undefined;
    cachedDatabasePath = undefined;
  }
}

export function getDatabasePath() {
  return configuredDatabasePath ?? process.env.PROMOBOT_DB_PATH?.trim() ?? DEFAULT_DATABASE_PATH;
}

export function getDatabase(): DatabaseConnection {
  const databasePath = getDatabasePath();
  if (cachedDatabase && cachedDatabasePath === databasePath) {
    return cachedDatabase;
  }

  if (cachedDatabase) {
    cachedDatabase.close();
  }

  ensureDatabaseDirectory(databasePath);
  cachedDatabase = initDb(databasePath);
  cachedDatabasePath = databasePath;

  return cachedDatabase;
}

export function withDatabase<T>(handler: (database: DatabaseConnection) => T): T {
  return handler(getDatabase());
}

function ensureDatabaseDirectory(databasePath: string) {
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}
