import type {
  CreatePermissionInput,
  CreateRoleInput,
  Permission,
  PermissionFilter,
  PermissionId,
  RbacDriver,
  Role,
  RoleFilter,
  RoleId,
  Subject,
} from '@rbac-node/core';
import { toPermissionId, toRoleId } from '@rbac-node/core';

// ─── Structural client typing ───────────────────────────────────────────────
//
// We type the constructor argument as a *structural* Prisma-shaped object
// rather than importing `PrismaClient` from `@prisma/client`. That keeps the
// driver compatible with extended clients (`prisma.$extends(...)`) and avoids
// a hard build-time dependency on a generated client — the user's generated
// client always satisfies this shape at runtime because it carries every
// model delegate plus `$transaction` / `$queryRawUnsafe`.
//
// The `unknown` parameter/return types on individual delegate methods are
// intentional: Prisma's generated typings are too complex to mirror by hand,
// and we're hitting the storage boundary anyway. We constrain inputs via the
// `PermissionRow` / `RoleRow` shapes we read out, and we cast results
// narrowly inside each method.

type Delegate = {
  findFirst(args: unknown): Promise<unknown>;
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  createMany(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
};

export interface PrismaRbacClient {
  readonly permission: Delegate;
  readonly role: Delegate;
  readonly modelHasPermission: Delegate;
  readonly modelHasRole: Delegate;
  readonly roleHasPermission: Delegate;
  $transaction<T>(fn: (tx: PrismaRbacClient) => Promise<T>): Promise<T>;
  $transaction<T>(operations: ReadonlyArray<Promise<T>>): Promise<T[]>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
}

// ─── Raw row shapes ─────────────────────────────────────────────────────────

type PermissionRow = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

type RoleRow = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

type ModelHasRoleRow = {
  modelType: string;
  modelKey: string;
};

// ─── Mappers ────────────────────────────────────────────────────────────────

function rowToPermission(row: PermissionRow): Permission {
  return {
    id: toPermissionId(row.id),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToRole(row: RoleRow): Role {
  return {
    id: toRoleId(row.id),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Driver ─────────────────────────────────────────────────────────────────

/**
 * {@link RbacDriver} backed by Prisma. Works with the schema fragment
 * shipped at `prisma/rbac.prisma` in this package.
 *
 * The constructor accepts any Prisma-shaped client — a vanilla
 * `PrismaClient`, an `.$extends(...)` extended client, or a transaction
 * client passed in by a wrapper. Identity (id) values are branded at the
 * storage boundary; all read paths produce the public `Permission` / `Role`
 * shapes.
 */
export class PrismaDriver implements RbacDriver {
  constructor(private readonly db: PrismaRbacClient) {}

  // ─── Permissions ────────────────────────────────────────────────────────

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    const row = (await this.db.permission.create({
      data: { name: input.name },
    })) as PermissionRow;
    return rowToPermission(row);
  }

  async findPermissionByName(name: string): Promise<Permission | null> {
    const row = (await this.db.permission.findFirst({
      where: { name },
    })) as PermissionRow | null;
    return row ? rowToPermission(row) : null;
  }

  async findPermissionById(id: PermissionId): Promise<Permission | null> {
    const row = (await this.db.permission.findUnique({
      where: { id: id as string },
    })) as PermissionRow | null;
    return row ? rowToPermission(row) : null;
  }

  async listPermissions(filter?: PermissionFilter): Promise<Permission[]> {
    const where: Record<string, unknown> = {};
    if (filter?.names !== undefined) where['name'] = { in: [...filter.names] };
    const rows = (await this.db.permission.findMany({ where })) as PermissionRow[];
    return rows.map(rowToPermission);
  }

  async deletePermission(id: PermissionId): Promise<void> {
    // ON DELETE CASCADE on the FK pivots takes care of role/subject links.
    await this.db.permission.delete({ where: { id: id as string } });
  }

  // ─── Roles ──────────────────────────────────────────────────────────────

  async createRole(input: CreateRoleInput): Promise<Role> {
    // The DB unique on `name` enforces uniqueness — Prisma will raise on
    // collision, which is the contract callers expect.
    const row = (await this.db.role.create({
      data: { name: input.name },
    })) as RoleRow;
    return rowToRole(row);
  }

  async findRoleByName(name: string): Promise<Role | null> {
    const row = (await this.db.role.findFirst({
      where: { name },
    })) as RoleRow | null;
    return row ? rowToRole(row) : null;
  }

  async findRoleById(id: RoleId): Promise<Role | null> {
    const row = (await this.db.role.findUnique({
      where: { id: id as string },
    })) as RoleRow | null;
    return row ? rowToRole(row) : null;
  }

  async listRoles(filter?: RoleFilter): Promise<Role[]> {
    const where: Record<string, unknown> = {};
    if (filter?.names !== undefined) where['name'] = { in: [...filter.names] };
    const rows = (await this.db.role.findMany({ where })) as RoleRow[];
    return rows.map(rowToRole);
  }

  async deleteRole(id: RoleId): Promise<void> {
    await this.db.role.delete({ where: { id: id as string } });
  }

  // ─── Role ↔ Permission ──────────────────────────────────────────────────

  async giveRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    // Per-row upsert via the compound unique constraint gives Spatie-style
    // idempotent semantics on every Prisma-supported database. We previously
    // tried `createMany({ skipDuplicates: true })` — it's faster on Postgres
    // but Prisma rejects the flag on SQLite, and consistency across drivers
    // matters more than a few µs on a write that runs at admin frequency.
    await this.db.$transaction(async (tx) => {
      for (const permissionId of permissionIds) {
        await tx.roleHasPermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: roleId as string,
              permissionId: permissionId as string,
            },
          },
          create: {
            roleId: roleId as string,
            permissionId: permissionId as string,
          },
          update: {},
        });
      }
    });
  }

  async revokeRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    await this.db.roleHasPermission.deleteMany({
      where: {
        roleId: roleId as string,
        permissionId: { in: permissionIds.map((id) => id as string) },
      },
    });
  }

  async syncRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    // Atomic replace: nuke + insert in one transaction so a concurrent reader
    // never sees an empty set followed by a partial repopulation. After the
    // deleteMany the inserts can't collide, so plain `create` (not upsert)
    // is enough — and we de-dupe the input first as a guard against caller
    // sloppiness.
    const unique = Array.from(new Set(permissionIds.map((id) => id as string)));
    await this.db.$transaction(async (tx) => {
      await tx.roleHasPermission.deleteMany({
        where: { roleId: roleId as string },
      });
      for (const permissionId of unique) {
        await tx.roleHasPermission.create({
          data: { roleId: roleId as string, permissionId },
        });
      }
    });
  }

  async getRolePermissions(roleId: RoleId): Promise<Permission[]> {
    const rows = (await this.db.roleHasPermission.findMany({
      where: { roleId: roleId as string },
      include: { permission: true },
    })) as ReadonlyArray<{ permission: PermissionRow }>;
    return rows.map((row) => rowToPermission(row.permission));
  }

  // ─── Subject ↔ Role ─────────────────────────────────────────────────────

  async assignSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    if (roleIds.length === 0) return;
    // Idempotent assignment via the compound unique on
    // `(roleId, modelType, modelKey)`. Each row gets its own upsert so the
    // operation is safe to retry and survives partial-overlap inputs.
    await this.db.$transaction(async (tx) => {
      for (const roleId of roleIds) {
        await tx.modelHasRole.upsert({
          where: {
            roleId_modelType_modelKey: {
              roleId: roleId as string,
              modelType: subject.type,
              modelKey: subject.key,
            },
          },
          create: {
            roleId: roleId as string,
            modelType: subject.type,
            modelKey: subject.key,
          },
          update: {},
        });
      }
    });
  }

  async removeSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    if (roleIds.length === 0) return;
    await this.db.modelHasRole.deleteMany({
      where: {
        modelType: subject.type,
        modelKey: subject.key,
        roleId: { in: roleIds.map((id) => id as string) },
      },
    });
  }

  async syncSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    const unique = Array.from(new Set(roleIds.map((id) => id as string)));
    await this.db.$transaction(async (tx) => {
      await tx.modelHasRole.deleteMany({
        where: { modelType: subject.type, modelKey: subject.key },
      });
      for (const roleId of unique) {
        await tx.modelHasRole.create({
          data: {
            roleId,
            modelType: subject.type,
            modelKey: subject.key,
          },
        });
      }
    });
  }

  async getSubjectRoles(subject: Subject): Promise<Role[]> {
    const rows = (await this.db.modelHasRole.findMany({
      where: { modelType: subject.type, modelKey: subject.key },
      include: { role: true },
    })) as ReadonlyArray<{ role: RoleRow }>;
    return rows.map((row) => rowToRole(row.role));
  }

  // ─── Subject ↔ Permission (direct) ──────────────────────────────────────

  async giveSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    // Idempotent assignment via the compound unique on
    // `(permissionId, modelType, modelKey)`.
    await this.db.$transaction(async (tx) => {
      for (const permissionId of permissionIds) {
        await tx.modelHasPermission.upsert({
          where: {
            permissionId_modelType_modelKey: {
              permissionId: permissionId as string,
              modelType: subject.type,
              modelKey: subject.key,
            },
          },
          create: {
            permissionId: permissionId as string,
            modelType: subject.type,
            modelKey: subject.key,
          },
          update: {},
        });
      }
    });
  }

  async revokeSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    await this.db.modelHasPermission.deleteMany({
      where: {
        modelType: subject.type,
        modelKey: subject.key,
        permissionId: { in: permissionIds.map((id) => id as string) },
      },
    });
  }

  async syncSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const unique = Array.from(new Set(permissionIds.map((id) => id as string)));
    await this.db.$transaction(async (tx) => {
      await tx.modelHasPermission.deleteMany({
        where: { modelType: subject.type, modelKey: subject.key },
      });
      for (const permissionId of unique) {
        await tx.modelHasPermission.create({
          data: {
            permissionId,
            modelType: subject.type,
            modelKey: subject.key,
          },
        });
      }
    });
  }

  async getDirectSubjectPermissions(subject: Subject): Promise<Permission[]> {
    const rows = (await this.db.modelHasPermission.findMany({
      where: { modelType: subject.type, modelKey: subject.key },
      include: { permission: true },
    })) as ReadonlyArray<{ permission: PermissionRow }>;
    return rows.map((row) => rowToPermission(row.permission));
  }

  // ─── Query scopes ───────────────────────────────────────────────────────

  async findSubjectsWithAnyRole(type: string, roleIds: ReadonlyArray<RoleId>): Promise<Subject[]> {
    if (roleIds.length === 0) return [];
    const rows = (await this.db.modelHasRole.findMany({
      where: {
        modelType: type,
        roleId: { in: roleIds.map((id) => id as string) },
      },
      select: { modelType: true, modelKey: true },
      distinct: ['modelType', 'modelKey'],
    })) as ModelHasRoleRow[];
    return rows.map((row) => ({ type: row.modelType, key: row.modelKey }));
  }

  async findSubjectsWithPermission(type: string, permissionId: PermissionId): Promise<Subject[]> {
    // Two-query union + in-memory dedupe. We could do a single SQL UNION via
    // `$queryRawUnsafe`, but the column names embed Prisma's snake_case
    // mapping which differs across databases (and SQLite tests don't have a
    // good way to escape identifiers portably). The two-query path stays
    // dialect-agnostic at the cost of one extra round trip, which is the
    // right tradeoff for a query that runs at policy-evaluation rates rather
    // than per-request rates.
    const [directRows, roleRows] = await Promise.all([
      this.db.modelHasPermission.findMany({
        where: { modelType: type, permissionId: permissionId as string },
        select: { modelType: true, modelKey: true },
      }) as Promise<ModelHasRoleRow[]>,
      this.db.modelHasRole.findMany({
        where: {
          modelType: type,
          role: { permissions: { some: { permissionId: permissionId as string } } },
        },
        select: { modelType: true, modelKey: true },
      }) as Promise<ModelHasRoleRow[]>,
    ]);

    const seen = new Set<string>();
    const out: Subject[] = [];
    for (const row of [...directRows, ...roleRows]) {
      const id = `${row.modelType}::${row.modelKey}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: row.modelType, key: row.modelKey });
    }
    return out;
  }
}
