import { randomUUID } from 'node:crypto';

import { toPermissionId, toRoleId } from '../branding.js';
import type { RbacDriver } from '../driver.js';
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
} from '../types.js';

/**
 * Reference {@link RbacDriver} implementation backed by `Map`s. Useful for
 * tests, scripts, and to validate the driver contract before reaching for a
 * persistence layer.
 *
 * Pivot key shapes:
 * - role/permission:    `${roleId}::${permissionId}`
 * - subject/role:       `${type}::${key}::${roleId}`
 * - subject/permission: `${type}::${key}::${permissionId}`
 */
export class InMemoryDriver implements RbacDriver {
  // Storage
  private readonly permissionsById = new Map<PermissionId, Permission>();
  private readonly rolesById = new Map<RoleId, Role>();
  private readonly rolePermissionPivot = new Set<string>();
  private readonly subjectRolePivot = new Set<string>();
  private readonly subjectPermissionPivot = new Set<string>();

  // ─── Permissions ──────────────────────────────────────────────────────────

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    const existing = await this.findPermissionByName(input.name);
    if (existing) {
      throw new Error(`Permission \`${input.name}\` already exists.`);
    }
    const now = new Date();
    const permission: Permission = {
      id: toPermissionId(randomUUID()),
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
    this.permissionsById.set(permission.id, permission);
    return permission;
  }

  async createPermissions(names: ReadonlyArray<string>): Promise<Permission[]> {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      if (!seen.has(n)) {
        seen.add(n);
        unique.push(n);
      }
    }
    const out: Permission[] = [];
    for (const name of unique) {
      const existing = await this.findPermissionByName(name);
      if (existing) {
        out.push(existing);
        continue;
      }
      const now = new Date();
      const permission: Permission = {
        id: toPermissionId(randomUUID()),
        name,
        createdAt: now,
        updatedAt: now,
      };
      this.permissionsById.set(permission.id, permission);
      out.push(permission);
    }
    return out;
  }

  async findPermissionByName(name: string): Promise<Permission | null> {
    for (const p of this.permissionsById.values()) {
      if (p.name === name) return p;
    }
    return null;
  }

  async findPermissionById(id: PermissionId): Promise<Permission | null> {
    return this.permissionsById.get(id) ?? null;
  }

  async listPermissions(filter?: PermissionFilter): Promise<Permission[]> {
    let out = Array.from(this.permissionsById.values());
    if (filter?.names !== undefined) {
      const wanted = new Set(filter.names);
      out = out.filter((p) => wanted.has(p.name));
    }
    return out;
  }

  async deletePermission(id: PermissionId): Promise<void> {
    if (!this.permissionsById.delete(id)) return;
    for (const key of [...this.rolePermissionPivot]) {
      if (key.endsWith(`::${id}`)) this.rolePermissionPivot.delete(key);
    }
    for (const key of [...this.subjectPermissionPivot]) {
      if (key.endsWith(`::${id}`)) this.subjectPermissionPivot.delete(key);
    }
  }

  // ─── Roles ────────────────────────────────────────────────────────────────

  async createRole(input: CreateRoleInput): Promise<Role> {
    const existing = await this.findRoleByName(input.name);
    if (existing) {
      throw new Error(`Role \`${input.name}\` already exists.`);
    }
    const now = new Date();
    const role: Role = {
      id: toRoleId(randomUUID()),
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
    this.rolesById.set(role.id, role);
    return role;
  }

  async createRoles(names: ReadonlyArray<string>): Promise<Role[]> {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      if (!seen.has(n)) {
        seen.add(n);
        unique.push(n);
      }
    }
    const out: Role[] = [];
    for (const name of unique) {
      const existing = await this.findRoleByName(name);
      if (existing) {
        out.push(existing);
        continue;
      }
      const now = new Date();
      const role: Role = {
        id: toRoleId(randomUUID()),
        name,
        createdAt: now,
        updatedAt: now,
      };
      this.rolesById.set(role.id, role);
      out.push(role);
    }
    return out;
  }

  async findRoleByName(name: string): Promise<Role | null> {
    for (const r of this.rolesById.values()) {
      if (r.name === name) return r;
    }
    return null;
  }

  async findRoleById(id: RoleId): Promise<Role | null> {
    return this.rolesById.get(id) ?? null;
  }

  async listRoles(filter?: RoleFilter): Promise<Role[]> {
    let out = Array.from(this.rolesById.values());
    if (filter?.names !== undefined) {
      const wanted = new Set(filter.names);
      out = out.filter((r) => wanted.has(r.name));
    }
    return out;
  }

  async deleteRole(id: RoleId): Promise<void> {
    if (!this.rolesById.delete(id)) return;
    for (const key of [...this.rolePermissionPivot]) {
      if (key.startsWith(`${id}::`)) this.rolePermissionPivot.delete(key);
    }
    for (const key of [...this.subjectRolePivot]) {
      if (key.endsWith(`::${id}`)) this.subjectRolePivot.delete(key);
    }
  }

  // ─── Role ↔ Permission ────────────────────────────────────────────────────

  async giveRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    for (const pid of permissionIds) {
      this.rolePermissionPivot.add(`${roleId}::${pid}`);
    }
  }

  async revokeRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    for (const pid of permissionIds) {
      this.rolePermissionPivot.delete(`${roleId}::${pid}`);
    }
  }

  async syncRolePermissions(
    roleId: RoleId,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    for (const key of [...this.rolePermissionPivot]) {
      if (key.startsWith(`${roleId}::`)) this.rolePermissionPivot.delete(key);
    }
    await this.giveRolePermissions(roleId, permissionIds);
  }

  async getRolePermissions(roleId: RoleId): Promise<Permission[]> {
    const out: Permission[] = [];
    for (const key of this.rolePermissionPivot) {
      const [r, p] = key.split('::');
      if (r === roleId && p !== undefined) {
        const perm = this.permissionsById.get(p as PermissionId);
        if (perm) out.push(perm);
      }
    }
    return out;
  }

  // ─── Subject ↔ Role ───────────────────────────────────────────────────────

  async assignSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    const prefix = this.subjectPrefix(subject);
    for (const rid of roleIds) {
      this.subjectRolePivot.add(`${prefix}::${rid}`);
    }
  }

  async removeSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    const prefix = this.subjectPrefix(subject);
    for (const rid of roleIds) {
      this.subjectRolePivot.delete(`${prefix}::${rid}`);
    }
  }

  async syncSubjectRoles(subject: Subject, roleIds: ReadonlyArray<RoleId>): Promise<void> {
    const prefix = this.subjectPrefix(subject);
    for (const key of [...this.subjectRolePivot]) {
      if (key.startsWith(`${prefix}::`)) this.subjectRolePivot.delete(key);
    }
    await this.assignSubjectRoles(subject, roleIds);
  }

  async getSubjectRoles(subject: Subject): Promise<Role[]> {
    const prefix = this.subjectPrefix(subject);
    const out: Role[] = [];
    for (const key of this.subjectRolePivot) {
      if (!key.startsWith(`${prefix}::`)) continue;
      const rid = key.slice(prefix.length + 2) as RoleId;
      const role = this.rolesById.get(rid);
      if (role) out.push(role);
    }
    return out;
  }

  // ─── Subject ↔ Permission (direct) ────────────────────────────────────────

  async giveSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const prefix = this.subjectPrefix(subject);
    for (const pid of permissionIds) {
      this.subjectPermissionPivot.add(`${prefix}::${pid}`);
    }
  }

  async revokeSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const prefix = this.subjectPrefix(subject);
    for (const pid of permissionIds) {
      this.subjectPermissionPivot.delete(`${prefix}::${pid}`);
    }
  }

  async syncSubjectPermissions(
    subject: Subject,
    permissionIds: ReadonlyArray<PermissionId>,
  ): Promise<void> {
    const prefix = this.subjectPrefix(subject);
    for (const key of [...this.subjectPermissionPivot]) {
      if (key.startsWith(`${prefix}::`)) this.subjectPermissionPivot.delete(key);
    }
    await this.giveSubjectPermissions(subject, permissionIds);
  }

  async getDirectSubjectPermissions(subject: Subject): Promise<Permission[]> {
    const prefix = this.subjectPrefix(subject);
    const out: Permission[] = [];
    for (const key of this.subjectPermissionPivot) {
      if (!key.startsWith(`${prefix}::`)) continue;
      const pid = key.slice(prefix.length + 2) as PermissionId;
      const perm = this.permissionsById.get(pid);
      if (perm) out.push(perm);
    }
    return out;
  }

  // ─── Query scopes ─────────────────────────────────────────────────────────

  async findSubjectsWithAnyRole(type: string, roleIds: ReadonlyArray<RoleId>): Promise<Subject[]> {
    const wanted = new Set(roleIds);
    const seen = new Set<string>();
    const out: Subject[] = [];
    for (const key of this.subjectRolePivot) {
      const parts = key.split('::');
      if (parts.length !== 3) continue;
      const [keyType, keyId, keyRid] = parts;
      if (keyType !== type) continue;
      if (!wanted.has(keyRid as RoleId)) continue;
      const id = `${keyType}::${keyId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: keyType as string, key: keyId as string });
    }
    return out;
  }

  async findSubjectsWithPermission(type: string, permissionId: PermissionId): Promise<Subject[]> {
    const seen = new Set<string>();
    const out: Subject[] = [];

    // Direct permission holders.
    for (const key of this.subjectPermissionPivot) {
      const parts = key.split('::');
      if (parts.length !== 3) continue;
      const [keyType, keyId, keyPid] = parts;
      if (keyType !== type) continue;
      if (keyPid !== permissionId) continue;
      const id = `${keyType}::${keyId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: keyType as string, key: keyId as string });
    }

    // Via roles.
    const rolesWithPermission = new Set<string>();
    for (const key of this.rolePermissionPivot) {
      const [rid, pid] = key.split('::');
      if (pid === permissionId && rid !== undefined) rolesWithPermission.add(rid);
    }
    for (const key of this.subjectRolePivot) {
      const parts = key.split('::');
      if (parts.length !== 3) continue;
      const [keyType, keyId, keyRid] = parts;
      if (keyType !== type) continue;
      if (keyRid === undefined || !rolesWithPermission.has(keyRid)) continue;
      const id = `${keyType}::${keyId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: keyType as string, key: keyId as string });
    }
    return out;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private subjectPrefix(subject: Subject): string {
    return `${subject.type}::${subject.key}`;
  }
}
