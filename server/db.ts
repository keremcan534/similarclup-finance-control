import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, any>;
type Params = SQLInputValue[] | [Record<string, SQLInputValue>];

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export class Db {
  raw: DatabaseSync;
  private depth = 0;
  private stmts = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  }

  private prep(sql: string) {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  all<T = Row>(sql: string, ...p: Params): T[] {
    return this.prep(sql).all(...(p as SQLInputValue[])) as T[];
  }
  get<T = Row>(sql: string, ...p: Params): T | undefined {
    return this.prep(sql).get(...(p as SQLInputValue[])) as T | undefined;
  }
  run(sql: string, ...p: Params): { changes: number; id: number } {
    const r = this.prep(sql).run(...(p as SQLInputValue[]));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
  /** Scalar helper: first column of first row. */
  value<T = any>(sql: string, ...p: Params): T | undefined {
    const r = this.get(sql, ...p);
    return r ? (Object.values(r)[0] as T) : undefined;
  }

  /** Runs fn atomically. Nested calls use savepoints, so inner failures roll back only their part. */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return out;
    } catch (e) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  migrate(): string[] {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = new Set(this.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
    const applied: string[] = [];
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      this.tx(() => {
        this.raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
        this.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', f, new Date().toISOString());
      });
      applied.push(f);
    }
    return applied;
  }

  close() {
    this.stmts.clear();
    this.raw.close();
  }
}

export function openDb(path: string): Db {
  const db = new Db(path);
  db.migrate();
  return db;
}
