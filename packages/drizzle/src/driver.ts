import { randomUUID } from 'node:crypto';

import {
  type CreatePermissionInput,
  type CreateRoleInput,
  type Permission,
  type PermissionFilter,
  type PermissionId,
  type RbacDriver,
  type Role,
  type RoleFilter,
  type RoleId,
  type Subject,
  toPermissionId,
  toRoleId,
} from '@rbac-ts/core';
import { and, type Column, eq, inArray, type SQL, sql, type Table } from 'drizzle-orm';

// ─── Structural types ─────────────────────────────────────────────────────────

/**
 * Tables required by {@link DrizzleDriver}. Returned by `defineRbacSchema` from
 * any of `@rbac-ts/drizzle/schema/{postgres,mysql,sqlite}` — those three
 * helpers all yield this same shape (dialect-branded at the column level).
 *
 * The column types are intentionally widened to the cross-dialect base
 * (`Column`, `Table`) so a single driver class accepts any dialect's bundle.
 */
export interface RbacTablesShape {
  readonly permissions: PermissionsTable;
  readonly roles: RolesTable;
  readonly modelHasPermissions: ModelHasPermissionsTable;
  readonly modelHasRoles: ModelHasRolesTable;
  readonly roleHasPermissions: RoleHasPermissionsTable;
}

export type PermissionsTable = Table & {
  readonly id: Column;
  readonly name: Column;
  readonly createdAt: Column;
  readonly updatedAt: Column;
};

export type RolesTable = Table & {
  readonly id: Column;
  readonly name: Column;
  readonly createdAt: Column;
  readonly updatedAt: Column;
};

export type ModelHasPermissionsTable = Table & {
  readonly permissionId: Column;
  readonly modelType: Column;
  readonly modelKey: Column;
};

export type ModelHasRolesTable = Table & {
  readonly roleId: Column;
  readonly modelType: Column;
  readonly modelKey: Column;
};

export type RoleHasPermissionsTable = Table & {
  readonly roleId: Column;
  readonly permissionId: Column;
};

/**
 * Structural shape of a Drizzle database (`BetterSQLite3Database`,
 * `NodePgDatabase`, `MySql2Database`, `LibSQLDatabase`, …).
 *
 * Modeled loosely — Drizzle's chain builders are dialect-branded, so we accept
 * `unknown` and rely on the runtime contract being the same across dialects
 * (`.select().from(t).where(...)`, `.insert(t).values(...)`, etc.). The
 * constructor casts inputs into the methods used below, and the type
 * arguments stay clean for callers.
 */
export interface DrizzleDb {
  select(): DrizzleSelectBuilder;
  select(fields: Record<string, Column | SQL>): DrizzleSelectBuilder;
  insert(table: Table): DrizzleInsertBuilder;
  delete(table: Table): DrizzleDeleteBuilder;
  update(table: Table): DrizzleUpdateBuilder;
}

interface DrizzleSelectBuilder {
  from(table: Table): DrizzleSelectFromBuilder;
}

interface DrizzleSelectFromBuilder extends PromiseLike<Array<Record<string, unknown>>> {
  where(condition: SQL): DrizzleSelectFromBuilder;
}

interface DrizzleInsertBuilder {
  values(
    values: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
  ): DrizzleInsertChain;
}

interface DrizzleInsertChain extends Promise<unknown> {
  onConflictDoNothing(config?: { target?: Column | Column[] }): Promise<unknown>;
  onDuplicateKeyUpdate(config: { set: Record<string, unknown> }): Promise<unknown>;
}

interface DrizzleDeleteBuilder extends Promise<unknown> {
  where(condition: SQL): Promise<unknown>;
}

interface DrizzleUpdateBuilder {
  set(values: Record<string, unknown>): DrizzleUpdateWhereBuilder;
}

interface DrizzleUpdateWhereBuilder extends Promise<unknown> {
  where(condition: SQL): Promise<unknown>;
}

// ─── Driver options ──────────────────────────────────────────────────────────

export interface DrizzleDriverOptions {
  /**
   * Override the id generator for `permissions.id` and `roles.id`.
   * Defaults to `crypto.randomUUID()`.
   */
  readonly idGen?: () => string;
}

// ─── Driver ───────────────────────────────────────────────────────────────────

/**
 * Drizzle-backed {@link RbacDriver}.
 *
 * Pass a Drizzle database (any dialect) and the table bundle returned by
 * `defineRbacSchema` (from `@rbac-ts/drizzle/schema/{postgres,mysql,sqlite}`).
 *
 * Storage notes:
 * - `permissions.id` / `roles.id` are generated with `crypto.randomUUID()` by
 *   default — override via {@link DrizzleDriverOptions.idGen}.
 */
export class DrizzleDriver implements RbacDriver {
  private readonly db: DrizzleDb;
  private readonly tables: RbacTablesShape;
  private readonly idGen: () => string;

  constructor(db: unknown, tables: RbacTablesShape, options?: DrizzleDriverOptions) {
    this.db = db as DrizzleDb;
    this.tables = tables;
    this.idGen = options?.idGen ?? (() => randomUUID());
  }

  // ─── Permissions ────────────────────────────────────────────────────────────

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    const now = new Date();
    const id = this.idGen();
    const insertRow = {
      id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    } as const;
    await this.db.insert(this.tables.permissions).values(insertRow);
    return {
      id: toPermissionId(id),
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
  }

  async createPermissions(names: ReadonlyArray<string>): Promise<Permission[]> {
    if (names.length === 0) return [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      deduped.push(n);
    }
    const t = this.tables.permissions;
    // See `syncRolePermissions` — we avoid `db.transaction` for cross-dialect
    // portability. The fetch + `onConflictDoNothing` insert is safe to interleave:
    // a racing writer can only insert rows we'd also see on the post-fetch read.
    const existingRows = (await this.db.select().from(t).where(inArray(t.name, deduped))) as Array<
      Record<string, unknown>
    >;
    const existingByName = new Map<string, Permission>();
    for (const row of existingRows) {
      const p = this.permissionFromRow(row);
      existingByName.set(p.name, p);
    }
    const missing = deduped.filter((n) => !existingByName.has(n));
    const insertedByName = new Map<string, Permission>();
    if (missing.length > 0) {
      const now = new Date();
      const insertRows = missing.map((name) => ({
        id: this.idGen(),
        name,
        createdAt: now,
        updatedAt: now,
      }));
      await this.db.insert(t).values(insertRows).onConflictDoNothing();
      const insertedRows = (await this.db
        .select()
        .from(t)
        .where(inArray(t.name, missing))) as Array<Record<string, unknown>>;
      for (const row of insertedRows) {
        const p = this.permissionFromRow(row);
        insertedByName.set(p.name, p);
      }
    }
    return deduped.map((n) => {
      const found = existingByName.get(n) ?? insertedByName.get(n);
      if (!found) throw new Error(`createPermissions: row for "${n}" not found after insert`);
      return found;
    });
  }

  async findPermissionByName(name: string): Promise<Permission | null> {
    const t = this.tables.permissions;
    const rows = (await this.db.select().from(t).where(eq(t.name, name))) as Array<
      Record<string, unknown>
    >;
    const row = rows[0];
    return row ? this.permissionFromRow(row) : null;
  }

  async findPermissionById(id: PermissionId): Promise<Permission | null> {
    const t = this.tables.permissions;
    const rows = (await this.db
      .select()
      .from(t)
      .where(eq(t.id, id as unknown as string))) as Array<Record<string, unknown>>;
    const row = rows[0];
    return row ? this.permissionFromRow(row) : null;
  }

  async listPermissions(filter?: PermissionFilter): Promise<Permission[]> {
    const t = this.tables.permissions;
    const conds: SQL[] = [];
    if (filter?.names !== undefined && filter.names.length > 0) {
      conds.push(inArray(t.name, [...filter.names]));
    }
    const where =
      conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : (and(...conds) as SQL);
    let query = this.db.select().from(t);
    if (where !== undefined) query = query.where(where);
    const rows = (await query) as Array<Record<string, unknown>>;
    if (filter?.names !== undefined && filter.names.length === 0) return [];
    return rows.map((r) => this.permissionFromRow(r));
  }

  async deletePermission(id: PermissionId): Promise<void> {
    const t = this.tables.permissions;
    await this.db.delete(t).where(eq(t.id, id as unknown as string));
  }

  // ─── Roles ──────────────────────────────────────────────────────────────────

  async createRole(input: CreateRoleInput): Promise<Role> {
    const now = new Date();
    const id = this.idGen();
    const insertRow = {
      id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(this.tables.roles).values(insertRow);
    return {
      id: toRoleId(id),
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
  }

  async createRoles(names: ReadonlyArray<string>): Promise<Role[]> {
    if (names.length === 0) return [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      deduped.push(n);
    }
    const t = this.tables.roles;
    // See `syncRolePermissions` — we avoid `db.transaction` for cross-dialect
    // portability. The fetch + `onConflictDoNothing` insert is safe to interleave:
    // a racing writer can only insert rows we'd also see on the post-fetch read.
    const existingRows = (await this.db.select().from(t).where(inArray(t.name, deduped))) as Array<
      Record<string, unknown>
    >;
    const existingByName = new Map<string, Role>();
    for (const row of existingRows) {
      const r = this.roleFromRow(row);
      existingByName.set(r.name, r);
    }
    const missing = deduped.filter((n) => !existingByName.has(n));
    const insertedByName = new Map<string, Role>();
    if (missing.length > 0) {
      const now = new Date();
      const insertRows = missing.map((name) => ({
        id: this.idGen(),
        name,
        createdAt: now,
        updatedAt: now,
      }));
      await this.db.insert(t).values(insertRows).onConflictDoNothing();
      const insertedRows = (await this.db
        .select()
        .from(t)
        .where(inArray(t.name, missing))) as Array<Record<string, unknown>>;
      for (const row of insertedRows) {
        const r = this.roleFromRow(row);
        insertedByName.set(r.name, r);
      }
    }
    return deduped.map((n) => {
      const found = existingByName.get(n) ?? insertedByName.get(n);
      if (!found) throw new Error(`createRoles: row for "${n}" not found after insert`);
      return found;
    });
  }

  async findRoleByName(name: string): Promise<Role | null> {
    const t = this.tables.roles;
    const rows = (await this.db.select().from(t).where(eq(t.name, name))) as Array<
      Record<string, unknown>
    >;
    const row = rows[0];
    return row ? this.roleFromRow(row) : null;
  }

  async findRoleById(id: RoleId): Promise<Role | null> {
    const t = this.tables.roles;
    const rows = (await this.db
      .select()
      .from(t)
      .where(eq(t.id, id as unknown as string))) as Array<Record<string, unknown>>;
    const row = rows[0];
    return row ? this.roleFromRow(row) : null;
  }

  async listRoles(filter?: RoleFilter): Promise<Role[]> {
    const t = this.tables.roles;
    const conds: SQL[] = [];
    if (filter?.names !== undefined && filter.names.length > 0) {
      conds.push(inArray(t.name, [...filter.names]));
    }
    const where =
      conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : (and(...conds) as SQL);
    let query = this.db.select().from(t);
    if (where !== undefined) query = query.where(where);
    const rows = (await query) as Array<Record<string, unknown>>;
    if (filter?.names !== undefined && filter.names.length === 0) return [];
    return rows.map((r) => this.roleFromRow(r));
  }

  async deleteRole(id: RoleId): Promise<void> {
    const t = this.tables.roles;
    await this.db.delete(t).where(eq(t.id, id as unknown as string));
  }

  // ─── Role ↔ Permission ──────────────────────────────────────────────────────

  async giveRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const rid = roleId as unknown as string;
    const values = permissionIds.map((pid) => ({
      roleId: rid,
      permissionId: pid as unknown as string,
    }));
    await this.db.insert(this.tables.roleHasPermissions).values(values).onConflictDoNothing();
  }

  async revokeRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const t = this.tables.roleHasPermissions;
    await this.db.delete(t).where(
      and(
        eq(t.roleId, roleId as unknown as string),
        inArray(
          t.permissionId,
          permissionIds.map((p) => p as unknown as string),
        ),
      ) as SQL,
    );
  }

  async syncRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const t = this.tables.roleHasPermissions;
    const rid = roleId as unknown as string;
    // Sequential delete-then-insert. We deliberately avoid `db.transaction` so
    // the driver stays portable across `better-sqlite3` (sync-only callbacks)
    // and Postgres/MySQL (async). The two writes are independent — worst case
    // on partial failure is a temporary empty set, recoverable by re-running.
    await this.db.delete(t).where(eq(t.roleId, rid));
    if (permissionIds.length > 0) {
      const values = permissionIds.map((pid) => ({
        roleId: rid,
        permissionId: pid as unknown as string,
      }));
      await this.db.insert(t).values(values).onConflictDoNothing();
    }
  }

  async getRolePermissions(roleId: RoleId): Promise<Permission[]> {
    const rhp = this.tables.roleHasPermissions;
    const p = this.tables.permissions;
    const rows = (await this.db
      .select({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        // join condition lives in `where` below — typed select with join is verbose;
        // instead, fetch via subquery / two queries pattern.
      })
      .from(p)
      .where(
        inArray(
          p.id,
          sql`(select ${rhp.permissionId} from ${rhp} where ${rhp.roleId} = ${roleId as unknown as string})`,
        ) as SQL,
      )) as Array<Record<string, unknown>>;
    return rows.map((r) => this.permissionFromRow(r));
  }

  // ─── Subject ↔ Role ─────────────────────────────────────────────────────────

  async assignSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    if (roleIds.length === 0) return;
    const values = roleIds.map((rid) => ({
      roleId: rid as unknown as string,
      modelType: subject.type,
      modelKey: subject.key,
    }));
    await this.db.insert(this.tables.modelHasRoles).values(values).onConflictDoNothing();
  }

  async removeSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    if (roleIds.length === 0) return;
    const t = this.tables.modelHasRoles;
    await this.db.delete(t).where(
      and(
        eq(t.modelType, subject.type),
        eq(t.modelKey, subject.key),
        inArray(
          t.roleId,
          roleIds.map((r) => r as unknown as string),
        ),
      ) as SQL,
    );
  }

  async syncSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    const t = this.tables.modelHasRoles;
    // See `syncRolePermissions` — sequential to stay portable across dialects.
    await this.db
      .delete(t)
      .where(and(eq(t.modelType, subject.type), eq(t.modelKey, subject.key)) as SQL);
    if (roleIds.length > 0) {
      const values = roleIds.map((rid) => ({
        roleId: rid as unknown as string,
        modelType: subject.type,
        modelKey: subject.key,
      }));
      await this.db.insert(t).values(values).onConflictDoNothing();
    }
  }

  async getSubjectRoles(subject: Subject): Promise<Role[]> {
    const mhr = this.tables.modelHasRoles;
    const r = this.tables.roles;
    const rows = (await this.db
      .select()
      .from(r)
      .where(
        inArray(
          r.id,
          sql`(select ${mhr.roleId} from ${mhr} where ${mhr.modelType} = ${subject.type} and ${mhr.modelKey} = ${subject.key})`,
        ) as SQL,
      )) as Array<Record<string, unknown>>;
    return rows.map((row) => this.roleFromRow(row));
  }

  // ─── Subject ↔ Permission (direct) ──────────────────────────────────────────

  async giveSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const values = permissionIds.map((pid) => ({
      permissionId: pid as unknown as string,
      modelType: subject.type,
      modelKey: subject.key,
    }));
    await this.db.insert(this.tables.modelHasPermissions).values(values).onConflictDoNothing();
  }

  async revokeSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const t = this.tables.modelHasPermissions;
    await this.db.delete(t).where(
      and(
        eq(t.modelType, subject.type),
        eq(t.modelKey, subject.key),
        inArray(
          t.permissionId,
          permissionIds.map((p) => p as unknown as string),
        ),
      ) as SQL,
    );
  }

  async syncSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const t = this.tables.modelHasPermissions;
    // See `syncRolePermissions` — sequential to stay portable across dialects.
    await this.db
      .delete(t)
      .where(and(eq(t.modelType, subject.type), eq(t.modelKey, subject.key)) as SQL);
    if (permissionIds.length > 0) {
      const values = permissionIds.map((pid) => ({
        permissionId: pid as unknown as string,
        modelType: subject.type,
        modelKey: subject.key,
      }));
      await this.db.insert(t).values(values).onConflictDoNothing();
    }
  }

  async getDirectSubjectPermissions(subject: Subject): Promise<Permission[]> {
    const mhp = this.tables.modelHasPermissions;
    const p = this.tables.permissions;
    const rows = (await this.db
      .select()
      .from(p)
      .where(
        inArray(
          p.id,
          sql`(select ${mhp.permissionId} from ${mhp} where ${mhp.modelType} = ${subject.type} and ${mhp.modelKey} = ${subject.key})`,
        ) as SQL,
      )) as Array<Record<string, unknown>>;
    return rows.map((row) => this.permissionFromRow(row));
  }

  // ─── Query scopes ───────────────────────────────────────────────────────────

  async findSubjectsWithAnyRole(type: string, roleIds: ReadonlyArray<RoleId>): Promise<Subject[]> {
    if (roleIds.length === 0) return [];
    const t = this.tables.modelHasRoles;
    const rows = (await this.db
      .select({ modelKey: t.modelKey })
      .from(t)
      .where(
        and(
          eq(t.modelType, type),
          inArray(
            t.roleId,
            roleIds.map((r) => r as unknown as string),
          ),
        ) as SQL,
      )) as Array<Record<string, unknown>>;
    const seen = new Set<string>();
    const out: Subject[] = [];
    for (const row of rows) {
      const key = String(row['modelKey'] ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, key });
    }
    return out;
  }

  async findSubjectsWithPermission(type: string, permissionId: PermissionId): Promise<Subject[]> {
    const pid = permissionId as unknown as string;
    const mhp = this.tables.modelHasPermissions;
    const mhr = this.tables.modelHasRoles;
    const rhp = this.tables.roleHasPermissions;

    // Direct holders.
    const directRows = (await this.db
      .select({ modelKey: mhp.modelKey })
      .from(mhp)
      .where(and(eq(mhp.modelType, type), eq(mhp.permissionId, pid)) as SQL)) as Array<
      Record<string, unknown>
    >;

    // Via-role holders — subjects whose roles grant `pid`.
    const viaRoleRows = (await this.db
      .select({ modelKey: mhr.modelKey })
      .from(mhr)
      .where(
        and(
          eq(mhr.modelType, type),
          inArray(
            mhr.roleId,
            sql`(select ${rhp.roleId} from ${rhp} where ${rhp.permissionId} = ${pid})`,
          ),
        ) as SQL,
      )) as Array<Record<string, unknown>>;

    const seen = new Set<string>();
    const out: Subject[] = [];
    for (const row of [...directRows, ...viaRoleRows]) {
      const key = String(row['modelKey'] ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, key });
    }
    return out;
  }

  // ─── Row mappers ────────────────────────────────────────────────────────────

  private permissionFromRow(row: Record<string, unknown>): Permission {
    return {
      id: toPermissionId(String(row['id'] ?? '')),
      name: String(row['name'] ?? ''),
      createdAt: coerceDate(row['createdAt'] ?? row['created_at']),
      updatedAt: coerceDate(row['updatedAt'] ?? row['updated_at']),
    };
  }

  private roleFromRow(row: Record<string, unknown>): Role {
    return {
      id: toRoleId(String(row['id'] ?? '')),
      name: String(row['name'] ?? ''),
      createdAt: coerceDate(row['createdAt'] ?? row['created_at']),
      updatedAt: coerceDate(row['updatedAt'] ?? row['updated_at']),
    };
  }
}

function coerceDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  return new Date(0);
}
