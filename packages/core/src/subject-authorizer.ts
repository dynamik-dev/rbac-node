import { PermissionDoesNotExistError, RoleDoesNotExistError } from './errors.js';
import {
  getCachedRolePermissions,
  getCachedSubjectDirectPermissions,
  getCachedSubjectRoles,
  invalidateSubjectDirectPermissions,
  invalidateSubjectRoles,
  type RbacContext,
} from './internal/context.js';
import type {
  Permission,
  PermissionId,
  PermName,
  RbacLexicon,
  Role,
  RoleId,
  RoleName,
  Subject,
} from './types.js';
import { dedupeBy, toArray } from './util.js';
import { matchesWildcard } from './wildcard.js';

/**
 * Resolved binding for a single subject.
 */
export type Binding = {
  readonly subject: Subject;
};

/**
 * Per-subject authorization surface. Mirrors Spatie's `HasRoles` + `HasPermissions`
 * traits. Methods accept names (typed via the lexicon) or full `Role` / `Permission`
 * objects interchangeably.
 */
export class SubjectAuthorizer<L extends RbacLexicon = RbacLexicon> {
  constructor(
    private readonly ctx: RbacContext,
    public readonly binding: Binding,
  ) {}

  // ─── Roles ────────────────────────────────────────────────────────────────

  async assignRole(role: RoleName<L> | Role | ReadonlyArray<RoleName<L> | Role>): Promise<void> {
    const roleIds = await this.resolveRoleIds(toArray(role));
    if (roleIds.length === 0) return;
    await this.ctx.driver.assignSubjectRoles(this.binding.subject, roleIds);
    await this.invalidateRoles();
  }

  async removeRole(role: RoleName<L> | Role | ReadonlyArray<RoleName<L> | Role>): Promise<void> {
    const roleIds = await this.resolveRoleIds(toArray(role));
    if (roleIds.length === 0) return;
    await this.ctx.driver.removeSubjectRoles(this.binding.subject, roleIds);
    await this.invalidateRoles();
  }

  async syncRoles(roles: ReadonlyArray<RoleName<L> | Role>): Promise<void> {
    const roleIds = await this.resolveRoleIds([...roles]);
    await this.ctx.driver.syncSubjectRoles(this.binding.subject, roleIds);
    await this.invalidateRoles();
  }

  async hasRole(role: RoleName<L> | Role): Promise<boolean> {
    const want = await this.resolveRoleSafe(role);
    if (!want) return false;
    const have = await this.getRoles();
    return have.some((r) => r.id === want.id);
  }

  async hasAnyRole(roles: ReadonlyArray<RoleName<L> | Role>): Promise<boolean> {
    const have = await this.getRoles();
    const haveIds = new Set(have.map((r) => r.id));
    for (const r of roles) {
      const resolved = await this.resolveRoleSafe(r);
      if (resolved && haveIds.has(resolved.id)) return true;
    }
    return false;
  }

  async hasAllRoles(roles: ReadonlyArray<RoleName<L> | Role>): Promise<boolean> {
    const have = await this.getRoles();
    const haveIds = new Set(have.map((r) => r.id));
    for (const r of roles) {
      const resolved = await this.resolveRoleSafe(r);
      if (!resolved || !haveIds.has(resolved.id)) return false;
    }
    return true;
  }

  async hasExactRoles(roles: ReadonlyArray<RoleName<L> | Role>): Promise<boolean> {
    const have = await this.getRoles();
    const wanted: Role[] = [];
    for (const r of roles) {
      const resolved = await this.resolveRoleSafe(r);
      if (!resolved) return false;
      wanted.push(resolved);
    }
    if (have.length !== wanted.length) return false;
    const haveIds = new Set(have.map((r) => r.id));
    return wanted.every((r) => haveIds.has(r.id));
  }

  async getRoles(): Promise<Role[]> {
    return getCachedSubjectRoles(this.ctx, this.binding.subject);
  }

  async getRoleNames(): Promise<string[]> {
    const roles = await this.getRoles();
    return roles.map((r) => r.name);
  }

  // ─── Permissions ──────────────────────────────────────────────────────────

  async givePermission(
    permission: PermName<L> | Permission | ReadonlyArray<PermName<L> | Permission>,
  ): Promise<void> {
    const permIds = await this.resolvePermissionIds(toArray(permission));
    if (permIds.length === 0) return;
    await this.ctx.driver.giveSubjectPermissions(this.binding.subject, permIds);
    await this.invalidateDirectPermissions();
  }

  async revokePermission(
    permission: PermName<L> | Permission | ReadonlyArray<PermName<L> | Permission>,
  ): Promise<void> {
    const permIds = await this.resolvePermissionIds(toArray(permission));
    if (permIds.length === 0) return;
    await this.ctx.driver.revokeSubjectPermissions(this.binding.subject, permIds);
    await this.invalidateDirectPermissions();
  }

  async syncPermissions(permissions: ReadonlyArray<PermName<L> | Permission>): Promise<void> {
    const permIds = await this.resolvePermissionIds([...permissions]);
    await this.ctx.driver.syncSubjectPermissions(this.binding.subject, permIds);
    await this.invalidateDirectPermissions();
  }

  async hasPermission(permission: PermName<L> | Permission): Promise<boolean> {
    const requested = typeof permission === 'string' ? permission : permission.name;
    const effective = await this.getPermissions();
    return effective.some((p) => matchesWildcard(p.name, requested, this.ctx.wildcards));
  }

  async hasAnyPermission(permissions: ReadonlyArray<PermName<L> | Permission>): Promise<boolean> {
    const effective = await this.getPermissions();
    return permissions.some((p) => {
      const requested = typeof p === 'string' ? p : p.name;
      return effective.some((e) => matchesWildcard(e.name, requested, this.ctx.wildcards));
    });
  }

  async hasAllPermissions(permissions: ReadonlyArray<PermName<L> | Permission>): Promise<boolean> {
    const effective = await this.getPermissions();
    return permissions.every((p) => {
      const requested = typeof p === 'string' ? p : p.name;
      return effective.some((e) => matchesWildcard(e.name, requested, this.ctx.wildcards));
    });
  }

  async hasDirectPermission(permission: PermName<L> | Permission): Promise<boolean> {
    const requested = typeof permission === 'string' ? permission : permission.name;
    const direct = await this.getDirectPermissions();
    return direct.some((p) => matchesWildcard(p.name, requested, this.ctx.wildcards));
  }

  async hasAnyDirectPermission(
    permissions: ReadonlyArray<PermName<L> | Permission>,
  ): Promise<boolean> {
    const direct = await this.getDirectPermissions();
    return permissions.some((p) => {
      const requested = typeof p === 'string' ? p : p.name;
      return direct.some((e) => matchesWildcard(e.name, requested, this.ctx.wildcards));
    });
  }

  async hasAllDirectPermissions(
    permissions: ReadonlyArray<PermName<L> | Permission>,
  ): Promise<boolean> {
    const direct = await this.getDirectPermissions();
    return permissions.every((p) => {
      const requested = typeof p === 'string' ? p : p.name;
      return direct.some((e) => matchesWildcard(e.name, requested, this.ctx.wildcards));
    });
  }

  // Aliases — Laravel-symmetric.
  can(permission: PermName<L> | Permission): Promise<boolean> {
    return this.hasPermission(permission);
  }

  canAny(permissions: ReadonlyArray<PermName<L> | Permission>): Promise<boolean> {
    return this.hasAnyPermission(permissions);
  }

  async getPermissions(): Promise<Permission[]> {
    const [direct, viaRoles] = await Promise.all([
      this.getDirectPermissions(),
      this.getPermissionsViaRoles(),
    ]);
    return dedupeBy([...direct, ...viaRoles], (p) => p.id);
  }

  async getDirectPermissions(): Promise<Permission[]> {
    return getCachedSubjectDirectPermissions(this.ctx, this.binding.subject);
  }

  async getPermissionsViaRoles(): Promise<Permission[]> {
    const roles = await this.getRoles();
    if (roles.length === 0) return [];
    const sets = await Promise.all(roles.map((r) => getCachedRolePermissions(this.ctx, r.id)));
    return dedupeBy(sets.flat(), (p) => p.id);
  }

  async getPermissionNames(): Promise<string[]> {
    const perms = await this.getPermissions();
    return perms.map((p) => p.name);
  }

  // ─── Internal resolvers ──────────────────────────────────────────────────

  private async resolveRoleIds(refs: ReadonlyArray<RoleName<L> | Role>): Promise<RoleId[]> {
    const out: RoleId[] = [];
    for (const ref of refs) {
      const resolved = await this.resolveRoleOrThrow(ref);
      out.push(resolved.id);
    }
    return out;
  }

  private async resolveRoleOrThrow(ref: RoleName<L> | Role): Promise<Role> {
    if (typeof ref !== 'string') return ref;
    const found = await this.ctx.driver.findRoleByName(ref);
    if (!found) throw new RoleDoesNotExistError(ref);
    return found;
  }

  /**
   * Resolve a role ref to a {@link Role}, returning `null` if the name doesn't exist.
   * Used by `hasRole` / `hasAnyRole` / `hasAllRoles` — checks against missing roles
   * should answer "no", not throw.
   */
  private async resolveRoleSafe(ref: RoleName<L> | Role): Promise<Role | null> {
    if (typeof ref !== 'string') return ref;
    return this.ctx.driver.findRoleByName(ref);
  }

  private async resolvePermissionIds(
    refs: ReadonlyArray<PermName<L> | Permission>,
  ): Promise<PermissionId[]> {
    const out: PermissionId[] = [];
    for (const ref of refs) {
      if (typeof ref !== 'string') {
        out.push(ref.id);
        continue;
      }
      const found = await this.ctx.driver.findPermissionByName(ref);
      if (!found) throw new PermissionDoesNotExistError(ref);
      out.push(found.id);
    }
    return out;
  }

  private async invalidateRoles(): Promise<void> {
    await invalidateSubjectRoles(this.ctx, this.binding.subject);
  }

  private async invalidateDirectPermissions(): Promise<void> {
    await invalidateSubjectDirectPermissions(this.ctx, this.binding.subject);
  }
}
