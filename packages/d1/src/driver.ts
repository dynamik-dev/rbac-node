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

// ─── Structural D1 binding types ────────────────────────────────────────────
//
// We don't peer-depend on `@cloudflare/workers-types`. The shapes below match
// the runtime contract documented at
// https://developers.cloudflare.com/d1/worker-api/. Any real `D1Database`
// satisfies this surface.

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: unknown;
}

// ─── Row shapes ─────────────────────────────────────────────────────────────

type PermissionRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

type RoleRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

type SubjectRow = {
  model_type: string;
  model_key: string;
};

// ─── Driver options ──────────────────────────────────────────────────────────

export interface D1DriverOptions {
  /** Override the id generator for `permissions.id` and `roles.id`. Default: `crypto.randomUUID()`. */
  readonly idGen?: () => string;
}

// ─── Driver ──────────────────────────────────────────────────────────────────

/**
 * {@link RbacDriver} backed by Cloudflare D1. Targets the Workers runtime
 * (or anywhere a {@link D1Database} binding is available).
 *
 * The driver does not depend on any ORM — it issues raw SQL via D1's
 * prepared-statement API. Atomic multi-statement operations (`sync*`) use
 * `db.batch()`, which D1 executes as a single transaction.
 *
 * Schema:
 * - Apply at deploy time with `wrangler d1 migrations apply <db>` (see
 *   `migrations/0001_init.sql` in this package).
 * - Or apply at runtime once with `db.exec(SCHEMA_SQL)` (see `./schema`).
 */
export class D1Driver implements RbacDriver {
  private readonly idGen: () => string;

  constructor(
    private readonly db: D1Database,
    options?: D1DriverOptions,
  ) {
    this.idGen = options?.idGen ?? (() => randomUUID());
  }

  // ─── Permissions ────────────────────────────────────────────────────────────

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    const id = this.idGen();
    const now = Date.now();
    await this.db
      .prepare('INSERT INTO permissions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, input.name, now, now)
      .run();
    return {
      id: toPermissionId(id),
      name: input.name,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async createPermissions(names: ReadonlyArray<string>): Promise<Permission[]> {
    const unique = Array.from(new Set(names));
    if (unique.length === 0) return [];

    const placeholders = unique.map(() => '?').join(',');
    const existingResult = await this.db
      .prepare(
        `SELECT id, name, created_at, updated_at FROM permissions WHERE name IN (${placeholders})`,
      )
      .bind(...unique)
      .all<PermissionRow>();
    const existing = existingResult.results ?? [];
    const existingByName = new Map(existing.map((row) => [row.name, row]));

    const missing = unique.filter((name) => !existingByName.has(name));
    if (missing.length > 0) {
      const now = Date.now();
      const stmts = missing.map((name) =>
        this.db
          .prepare(
            'INSERT INTO permissions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING',
          )
          .bind(this.idGen(), name, now, now),
      );
      await this.db.batch(stmts);

      const insertedPlaceholders = missing.map(() => '?').join(',');
      const insertedResult = await this.db
        .prepare(
          `SELECT id, name, created_at, updated_at FROM permissions WHERE name IN (${insertedPlaceholders})`,
        )
        .bind(...missing)
        .all<PermissionRow>();
      for (const row of insertedResult.results ?? []) {
        existingByName.set(row.name, row);
      }
    }

    const out: Permission[] = [];
    for (const name of unique) {
      const row = existingByName.get(name);
      if (row) out.push(rowToPermission(row));
    }
    return out;
  }

  async findPermissionByName(name: string): Promise<Permission | null> {
    const row = await this.db
      .prepare('SELECT id, name, created_at, updated_at FROM permissions WHERE name = ?')
      .bind(name)
      .first<PermissionRow>();
    return row ? rowToPermission(row) : null;
  }

  async findPermissionById(id: PermissionId): Promise<Permission | null> {
    const row = await this.db
      .prepare('SELECT id, name, created_at, updated_at FROM permissions WHERE id = ?')
      .bind(id as string)
      .first<PermissionRow>();
    return row ? rowToPermission(row) : null;
  }

  async listPermissions(filter?: PermissionFilter): Promise<Permission[]> {
    if (filter?.names !== undefined) {
      if (filter.names.length === 0) return [];
      const placeholders = filter.names.map(() => '?').join(',');
      const result = await this.db
        .prepare(
          `SELECT id, name, created_at, updated_at FROM permissions WHERE name IN (${placeholders})`,
        )
        .bind(...filter.names)
        .all<PermissionRow>();
      return (result.results ?? []).map(rowToPermission);
    }
    const result = await this.db
      .prepare('SELECT id, name, created_at, updated_at FROM permissions')
      .all<PermissionRow>();
    return (result.results ?? []).map(rowToPermission);
  }

  async deletePermission(id: PermissionId): Promise<void> {
    await this.db
      .prepare('DELETE FROM permissions WHERE id = ?')
      .bind(id as string)
      .run();
  }

  // ─── Roles ──────────────────────────────────────────────────────────────────

  async createRole(input: CreateRoleInput): Promise<Role> {
    const id = this.idGen();
    const now = Date.now();
    await this.db
      .prepare('INSERT INTO roles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, input.name, now, now)
      .run();
    return {
      id: toRoleId(id),
      name: input.name,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async createRoles(names: ReadonlyArray<string>): Promise<Role[]> {
    const unique = Array.from(new Set(names));
    if (unique.length === 0) return [];

    const placeholders = unique.map(() => '?').join(',');
    const existingResult = await this.db
      .prepare(`SELECT id, name, created_at, updated_at FROM roles WHERE name IN (${placeholders})`)
      .bind(...unique)
      .all<RoleRow>();
    const existing = existingResult.results ?? [];
    const existingByName = new Map(existing.map((row) => [row.name, row]));

    const missing = unique.filter((name) => !existingByName.has(name));
    if (missing.length > 0) {
      const now = Date.now();
      const stmts = missing.map((name) =>
        this.db
          .prepare(
            'INSERT INTO roles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING',
          )
          .bind(this.idGen(), name, now, now),
      );
      await this.db.batch(stmts);

      const insertedPlaceholders = missing.map(() => '?').join(',');
      const insertedResult = await this.db
        .prepare(
          `SELECT id, name, created_at, updated_at FROM roles WHERE name IN (${insertedPlaceholders})`,
        )
        .bind(...missing)
        .all<RoleRow>();
      for (const row of insertedResult.results ?? []) {
        existingByName.set(row.name, row);
      }
    }

    const out: Role[] = [];
    for (const name of unique) {
      const row = existingByName.get(name);
      if (row) out.push(rowToRole(row));
    }
    return out;
  }

  async findRoleByName(name: string): Promise<Role | null> {
    const row = await this.db
      .prepare('SELECT id, name, created_at, updated_at FROM roles WHERE name = ?')
      .bind(name)
      .first<RoleRow>();
    return row ? rowToRole(row) : null;
  }

  async findRoleById(id: RoleId): Promise<Role | null> {
    const row = await this.db
      .prepare('SELECT id, name, created_at, updated_at FROM roles WHERE id = ?')
      .bind(id as string)
      .first<RoleRow>();
    return row ? rowToRole(row) : null;
  }

  async listRoles(filter?: RoleFilter): Promise<Role[]> {
    if (filter?.names !== undefined) {
      if (filter.names.length === 0) return [];
      const placeholders = filter.names.map(() => '?').join(',');
      const result = await this.db
        .prepare(
          `SELECT id, name, created_at, updated_at FROM roles WHERE name IN (${placeholders})`,
        )
        .bind(...filter.names)
        .all<RoleRow>();
      return (result.results ?? []).map(rowToRole);
    }
    const result = await this.db
      .prepare('SELECT id, name, created_at, updated_at FROM roles')
      .all<RoleRow>();
    return (result.results ?? []).map(rowToRole);
  }

  async deleteRole(id: RoleId): Promise<void> {
    await this.db
      .prepare('DELETE FROM roles WHERE id = ?')
      .bind(id as string)
      .run();
  }

  // ─── Role ↔ Permission ──────────────────────────────────────────────────────

  async giveRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const stmts = permissionIds.map((pid) =>
      this.db
        .prepare(
          'INSERT OR IGNORE INTO role_has_permissions (role_id, permission_id) VALUES (?, ?)',
        )
        .bind(roleId as string, pid as string),
    );
    await this.db.batch(stmts);
  }

  async revokeRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const placeholders = permissionIds.map(() => '?').join(',');
    await this.db
      .prepare(
        `DELETE FROM role_has_permissions WHERE role_id = ? AND permission_id IN (${placeholders})`,
      )
      .bind(roleId as string, ...permissionIds.map((p) => p as string))
      .run();
  }

  async syncRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const unique = Array.from(new Set(permissionIds.map((id) => id as string)));
    const stmts: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM role_has_permissions WHERE role_id = ?').bind(roleId as string),
    ];
    for (const pid of unique) {
      stmts.push(
        this.db
          .prepare('INSERT INTO role_has_permissions (role_id, permission_id) VALUES (?, ?)')
          .bind(roleId as string, pid),
      );
    }
    await this.db.batch(stmts);
  }

  async getRolePermissions(roleId: RoleId): Promise<Permission[]> {
    const result = await this.db
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.updated_at
         FROM permissions p
         JOIN role_has_permissions rhp ON rhp.permission_id = p.id
         WHERE rhp.role_id = ?`,
      )
      .bind(roleId as string)
      .all<PermissionRow>();
    return (result.results ?? []).map(rowToPermission);
  }

  // ─── Subject ↔ Role ─────────────────────────────────────────────────────────

  async assignSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    if (roleIds.length === 0) return;
    const stmts = roleIds.map((rid) =>
      this.db
        .prepare(
          'INSERT OR IGNORE INTO model_has_roles (role_id, model_type, model_key) VALUES (?, ?, ?)',
        )
        .bind(rid as string, subject.type, subject.key),
    );
    await this.db.batch(stmts);
  }

  async removeSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    if (roleIds.length === 0) return;
    const placeholders = roleIds.map(() => '?').join(',');
    await this.db
      .prepare(
        `DELETE FROM model_has_roles
         WHERE model_type = ? AND model_key = ? AND role_id IN (${placeholders})`,
      )
      .bind(subject.type, subject.key, ...roleIds.map((r) => r as string))
      .run();
  }

  async syncSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    const unique = Array.from(new Set(roleIds.map((id) => id as string)));
    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare('DELETE FROM model_has_roles WHERE model_type = ? AND model_key = ?')
        .bind(subject.type, subject.key),
    ];
    for (const rid of unique) {
      stmts.push(
        this.db
          .prepare('INSERT INTO model_has_roles (role_id, model_type, model_key) VALUES (?, ?, ?)')
          .bind(rid, subject.type, subject.key),
      );
    }
    await this.db.batch(stmts);
  }

  async getSubjectRoles(subject: Subject): Promise<Role[]> {
    const result = await this.db
      .prepare(
        `SELECT r.id, r.name, r.created_at, r.updated_at
         FROM roles r
         JOIN model_has_roles mhr ON mhr.role_id = r.id
         WHERE mhr.model_type = ? AND mhr.model_key = ?`,
      )
      .bind(subject.type, subject.key)
      .all<RoleRow>();
    return (result.results ?? []).map(rowToRole);
  }

  // ─── Subject ↔ Permission (direct) ──────────────────────────────────────────

  async giveSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const stmts = permissionIds.map((pid) =>
      this.db
        .prepare(
          'INSERT OR IGNORE INTO model_has_permissions (permission_id, model_type, model_key) VALUES (?, ?, ?)',
        )
        .bind(pid as string, subject.type, subject.key),
    );
    await this.db.batch(stmts);
  }

  async revokeSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    const placeholders = permissionIds.map(() => '?').join(',');
    await this.db
      .prepare(
        `DELETE FROM model_has_permissions
         WHERE model_type = ? AND model_key = ? AND permission_id IN (${placeholders})`,
      )
      .bind(subject.type, subject.key, ...permissionIds.map((p) => p as string))
      .run();
  }

  async syncSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const unique = Array.from(new Set(permissionIds.map((id) => id as string)));
    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare('DELETE FROM model_has_permissions WHERE model_type = ? AND model_key = ?')
        .bind(subject.type, subject.key),
    ];
    for (const pid of unique) {
      stmts.push(
        this.db
          .prepare(
            'INSERT INTO model_has_permissions (permission_id, model_type, model_key) VALUES (?, ?, ?)',
          )
          .bind(pid, subject.type, subject.key),
      );
    }
    await this.db.batch(stmts);
  }

  async getDirectSubjectPermissions(subject: Subject): Promise<Permission[]> {
    const result = await this.db
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.updated_at
         FROM permissions p
         JOIN model_has_permissions mhp ON mhp.permission_id = p.id
         WHERE mhp.model_type = ? AND mhp.model_key = ?`,
      )
      .bind(subject.type, subject.key)
      .all<PermissionRow>();
    return (result.results ?? []).map(rowToPermission);
  }

  // ─── Query scopes ───────────────────────────────────────────────────────────

  async findSubjectsWithAnyRole(type: string, roleIds: ReadonlyArray<RoleId>): Promise<Subject[]> {
    if (roleIds.length === 0) return [];
    const placeholders = roleIds.map(() => '?').join(',');
    const result = await this.db
      .prepare(
        `SELECT DISTINCT model_type, model_key FROM model_has_roles
         WHERE model_type = ? AND role_id IN (${placeholders})`,
      )
      .bind(type, ...roleIds.map((r) => r as string))
      .all<SubjectRow>();
    return (result.results ?? []).map((row) => ({ type: row.model_type, key: row.model_key }));
  }

  async findSubjectsWithPermission(type: string, permissionId: PermissionId): Promise<Subject[]> {
    // Single UNION query: direct holders ∪ via-role holders. DISTINCT applies
    // across the union so the result is already deduped.
    const result = await this.db
      .prepare(
        `SELECT DISTINCT model_type, model_key FROM (
           SELECT model_type, model_key FROM model_has_permissions
           WHERE model_type = ? AND permission_id = ?
           UNION
           SELECT mhr.model_type AS model_type, mhr.model_key AS model_key
           FROM model_has_roles mhr
           JOIN role_has_permissions rhp ON rhp.role_id = mhr.role_id
           WHERE mhr.model_type = ? AND rhp.permission_id = ?
         )`,
      )
      .bind(type, permissionId as string, type, permissionId as string)
      .all<SubjectRow>();
    return (result.results ?? []).map((row) => ({ type: row.model_type, key: row.model_key }));
  }
}

// ─── Row mappers ────────────────────────────────────────────────────────────

function rowToPermission(row: PermissionRow): Permission {
  return {
    id: toPermissionId(row.id),
    name: row.name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToRole(row: RoleRow): Role {
  return {
    id: toRoleId(row.id),
    name: row.name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
