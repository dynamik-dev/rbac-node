import { PermissionDoesNotExistError } from './errors.js';
import type { RbacContext } from './internal/context.js';
import type { CreatePermissionInput, Permission, PermissionFilter, PermissionId } from './types.js';

export type CreatePermissionApiInput<P extends string> = {
  readonly name: P;
};

export class PermissionApi<P extends string = string> {
  constructor(private readonly ctx: RbacContext) {}

  async create(input: CreatePermissionApiInput<P>): Promise<Permission> {
    const fullInput: CreatePermissionInput = { name: input.name };
    return this.ctx.driver.createPermission(fullInput);
  }

  async findByName(name: P): Promise<Permission | null> {
    return this.ctx.driver.findPermissionByName(name);
  }

  async findById(id: PermissionId): Promise<Permission | null> {
    return this.ctx.driver.findPermissionById(id);
  }

  async list(filter?: PermissionFilter): Promise<Permission[]> {
    return this.ctx.driver.listPermissions(filter);
  }

  async delete(target: PermissionId | Permission): Promise<void> {
    const id = typeof target === 'string' ? target : target.id;
    await this.ctx.driver.deletePermission(id);
    // Conservative: deleting a permission may affect any role's permission set.
    await this.ctx.cache.invalidate('rbac:v1:');
  }

  /** Resolve a name to an id, throwing if it doesn't exist. */
  async resolveIdOrThrow(name: P): Promise<PermissionId> {
    const found = await this.ctx.driver.findPermissionByName(name);
    if (!found) throw new PermissionDoesNotExistError(name);
    return found.id;
  }
}
