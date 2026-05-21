import type {
  CreatePermissionInput,
  CreateRoleInput,
  Permission,
  PermissionFilter,
  PermissionId,
  Role,
  RoleFilter,
  RoleId,
  Subject,
} from './types.js';

/**
 * The storage boundary. A driver translates {@link Rbac} operations into
 * the persistence layer of choice (Prisma, Drizzle, Mongo, in-memory, …).
 *
 * Every method must be atomic — a driver may batch internally, but each
 * call observed from `core` resolves to a single logical change.
 *
 * Identity & uniqueness invariants:
 * - `permissions.name` is unique.
 * - `roles.name` is unique.
 * - Subject-role and subject-permission pivots are uniquely keyed by
 *   `(target_id, model_type, model_key)` and act as upserts.
 *
 * Cascading deletes:
 * - Deleting a permission removes related pivot rows.
 * - Deleting a role removes related pivot rows.
 */
export interface RbacDriver {
  // ─── Permissions ──────────────────────────────────────────────────────────

  createPermission(input: CreatePermissionInput): Promise<Permission>;

  /**
   * Bulk, idempotent permission creation. Input is deduplicated by name; any
   * names that already exist are returned unchanged alongside newly-created
   * rows. Drivers should resolve this in a single transaction.
   *
   * Returned order matches the deduplicated input order.
   */
  createPermissions(names: ReadonlyArray<string>): Promise<Permission[]>;

  findPermissionByName(name: string): Promise<Permission | null>;

  findPermissionById(id: PermissionId): Promise<Permission | null>;

  listPermissions(filter?: PermissionFilter): Promise<Permission[]>;

  deletePermission(id: PermissionId): Promise<void>;

  // ─── Roles ────────────────────────────────────────────────────────────────

  createRole(input: CreateRoleInput): Promise<Role>;

  /**
   * Bulk, idempotent role creation. Input is deduplicated by name; any
   * names that already exist are returned unchanged alongside newly-created
   * rows. Drivers should resolve this in a single transaction.
   *
   * Returned order matches the deduplicated input order.
   */
  createRoles(names: ReadonlyArray<string>): Promise<Role[]>;

  findRoleByName(name: string): Promise<Role | null>;

  findRoleById(id: RoleId): Promise<Role | null>;

  listRoles(filter?: RoleFilter): Promise<Role[]>;

  deleteRole(id: RoleId): Promise<void>;

  // ─── Role ↔ Permission ────────────────────────────────────────────────────

  giveRolePermissions(roleId: RoleId, permissionIds: ReadonlyArray<PermissionId>): Promise<void>;

  revokeRolePermissions(roleId: RoleId, permissionIds: ReadonlyArray<PermissionId>): Promise<void>;

  syncRolePermissions(roleId: RoleId, permissionIds: ReadonlyArray<PermissionId>): Promise<void>;

  getRolePermissions(roleId: RoleId): Promise<Permission[]>;

  // ─── Subject ↔ Role ───────────────────────────────────────────────────────

  assignSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void>;

  removeSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void>;

  syncSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void>;

  getSubjectRoles(subject: Subject): Promise<Role[]>;

  // ─── Subject ↔ Permission (direct) ────────────────────────────────────────

  giveSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void>;

  revokeSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void>;

  syncSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void>;

  getDirectSubjectPermissions(subject: Subject): Promise<Permission[]>;

  // ─── Query scopes ─────────────────────────────────────────────────────────

  /** Subjects of `type` that hold *any* of the given roles. */
  findSubjectsWithAnyRole(type: string, roleIds: ReadonlyArray<RoleId>): Promise<Subject[]>;

  /**
   * Subjects of `type` that hold the given permission — either directly or
   * transitively via a role. Driver should produce the union as a single
   * query when possible.
   */
  findSubjectsWithPermission(type: string, permissionId: PermissionId): Promise<Subject[]>;
}
