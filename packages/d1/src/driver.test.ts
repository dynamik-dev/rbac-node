import { runConformanceSuite } from '@rbac-node/core/testing';
import Database from 'better-sqlite3';

import { type D1Database, D1Driver, type D1PreparedStatement, type D1Result } from './driver.js';
import { SCHEMA_SQL } from './schema.js';

/**
 * Thin shim that satisfies the {@link D1Database} contract on top of
 * `better-sqlite3`. We test the driver's SQL and contract behavior against
 * real SQLite — D1's wire protocol is SQLite semantics under the hood, so
 * any divergence we hit here would also surface against D1.
 *
 * Trade-off vs. miniflare: this skips workerd's runtime sandbox in exchange
 * for not pulling a multi-MB native binary into the test deps. The driver
 * code path under test is the same (`prepare → bind → first/all/run`,
 * `batch`, `exec`).
 */
class ShimD1 implements D1Database {
  constructor(private readonly db: Database.Database) {}

  prepare(query: string): D1PreparedStatement {
    return new ShimStmt(this.db, query, []);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const exec = this.db.transaction(() => statements.map((s) => (s as ShimStmt).execute<T>()));
    return exec();
  }

  async exec(query: string): Promise<unknown> {
    this.db.exec(query);
    return {};
  }
}

class ShimStmt implements D1PreparedStatement {
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
    private readonly params: unknown[],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new ShimStmt(this.db, this.sql, values);
  }

  async first<T = unknown>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...(this.params as unknown[])) as T | undefined;
    return row ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...(this.params as unknown[])) as T[];
    return { results, success: true };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  execute<T = unknown>(): D1Result<T> {
    const stmt = this.db.prepare(this.sql);
    // SELECTs land in `all()` paths, but `db.batch` may receive any kind of
    // statement — sniff the leading verb to pick the right better-sqlite3
    // method.
    if (/^\s*select/i.test(this.sql)) {
      const results = stmt.all(...(this.params as unknown[])) as T[];
      return { results, success: true };
    }
    stmt.run(...(this.params as unknown[]));
    return { results: [], success: true };
  }
}

runConformanceSuite({
  name: 'D1Driver',
  createDriver: () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON'); // D1 enforces FKs by default; mirror that.
    sqlite.exec(SCHEMA_SQL);
    const driver = new D1Driver(new ShimD1(sqlite));
    return {
      driver,
      teardown: () => {
        sqlite.close();
      },
    };
  },
});
