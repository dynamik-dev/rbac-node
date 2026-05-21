import { PermissionDoesNotExistError, RoleDoesNotExistError } from './errors.js';
import {
  getCachedRolePermissions,
  invalidateRolePermissions,
  type RbacContext,
} from './internal/context.js';
import type {
  CreateRoleInput,
  Permission,
  PermissionId,
  Role,
  RoleFilter,
  RoleId,
} from './types.js';
import { toArray } from './util.js';

export type CreateRoleApiInput<R extends string, P extends string> = {
  readonly name: R;
  readonly permissions?: ReadonlyArray<P | Permission>;
};

export class RoleApi<R extends string = string, P extends string = string> {
  constructor(private readonly ctx: RbacContext) {}

  async create(input: CreateRoleApiInput<R, P>): Promise<Role> {
    const fullInput: CreateRoleInput = { name: input.name };
    const role = await this.ctx.driver.createRole(fullInput);

    if (input.permissions && input.permissions.length > 0) {
      const permissionIds = await this.resolvePermissionIds(input.permissions);
      await this.ctx.driver.giveRolePermissions(role.id, permissionIds);
      await invalidateRolePermissions(this.ctx, role.id);
    }
    return role;
  }

  /**
   * Bulk, idempotent role creation. Returns one role per unique input name,
   * creating missing ones in a single round trip. Does not attach permissions
   * — use {@link RoleApi.givePermissions} or {@link RoleApi.syncPermissions}
   * afterwards if you need to wire them up.
   */
  async createMany(names: ReadonlyArray<R>): Promise<Role[]> {
    if (names.length === 0) return [];
    return this.ctx.driver.createRoles(names);
  }

  async findByName(name: R): Promise<Role | null> {
    return this.ctx.driver.findRoleByName(name);
  }

  async findById(id: RoleId): Promise<Role | null> {
    return this.ctx.driver.findRoleById(id);
  }

  async list(filter?: RoleFilter): Promise<Role[]> {
    return this.ctx.driver.listRoles(filter);
  }

  async delete(target: RoleId | Role): Promise<void> {
    const id = typeof target === 'string' ? target : target.id;
    await this.ctx.driver.deleteRole(id);
    await this.ctx.cache.invalidate('rbac:v1:');
  }

  async givePermissions(role: R | Role, permissions: ReadonlyArray<P | Permission>): Promise<void> {
    const resolved = await this.resolveRole(role);
    const permIds = await this.resolvePermissionIds(permissions);
    await this.ctx.driver.giveRolePermissions(resolved.id, permIds);
    await invalidateRolePermissions(this.ctx, resolved.id);
  }

  async revokePermissions(
    role: R | Role,
    permissions: ReadonlyArray<P | Permission>,
  ): Promise<void> {
    const resolved = await this.resolveRole(role);
    const permIds = await this.resolvePermissionIds(permissions);
    await this.ctx.driver.revokeRolePermissions(resolved.id, permIds);
    await invalidateRolePermissions(this.ctx, resolved.id);
  }

  async syncPermissions(role: R | Role, permissions: ReadonlyArray<P | Permission>): Promise<void> {
    const resolved = await this.resolveRole(role);
    const permIds = await this.resolvePermissionIds(permissions);
    await this.ctx.driver.syncRolePermissions(resolved.id, permIds);
    await invalidateRolePermissions(this.ctx, resolved.id);
  }

  async getPermissions(role: R | Role): Promise<Permission[]> {
    const resolved = await this.resolveRole(role);
    return getCachedRolePermissions(this.ctx, resolved.id);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /** @internal */
  async resolveRole(role: R | Role): Promise<Role> {
    if (typeof role !== 'string') return role;
    const found = await this.ctx.driver.findRoleByName(role);
    if (!found) throw new RoleDoesNotExistError(role);
    return found;
  }

  /** @internal */
  async resolveRoles(roles: ReadonlyArray<R | Role>): Promise<Role[]> {
    return Promise.all(toArray(roles).map((r) => this.resolveRole(r)));
  }

  /** @internal */
  private async resolvePermissionIds(
    permissions: ReadonlyArray<P | Permission>,
  ): Promise<PermissionId[]> {
    const out: PermissionId[] = [];
    for (const p of permissions) {
      if (typeof p !== 'string') {
        out.push(p.id);
        continue;
      }
      const found = await this.ctx.driver.findPermissionByName(p);
      if (!found) throw new PermissionDoesNotExistError(p);
      out.push(found.id);
    }
    return out;
  }
}
