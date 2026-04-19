import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

type QueryParams = unknown[] | Record<string, unknown>;
type QueryRow = Record<string, unknown>;

export interface DatabaseStatement {
  all(params?: QueryParams): QueryRow[];
  get(params?: QueryParams): QueryRow | undefined;
  run(params?: QueryParams): { changes: number; lastInsertRowid: number };
}

export interface DatabaseConnection {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): DatabaseStatement;
}

function resolveSchemaPath() {
  return path.resolve(process.cwd(), 'database/schema.sql');
}

function normalizeParams(params: QueryParams = []) {
  return params;
}

export function initDb(filename: string): DatabaseConnection {
  const db = new Database(filename);
  const schema = fs.readFileSync(resolveSchemaPath(), 'utf8');

  db.exec(schema);

  return {
    close() {
      db.close();
    },
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): DatabaseStatement {
      const statement = db.prepare(sql);

      return {
        all(params: QueryParams = []) {
          return statement.all(normalizeParams(params)) as QueryRow[];
        },
        get(params: QueryParams = []) {
          return statement.get(normalizeParams(params)) as QueryRow | undefined;
        },
        run(params: QueryParams = []) {
          const result = statement.run(normalizeParams(params));
          return {
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
      };
    },
  };
}
