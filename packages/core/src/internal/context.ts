import type { RbacCache } from '../cache/index.js';
import type { RbacDriver } from '../driver.js';
import type { Permission, Role, RoleId, Subject } from '../types.js';
import type { WildcardConfig } from '../wildcard.js';

export type RbacContext = {
  readonly driver: RbacDriver;
  readonly cache: RbacCache;
  readonly cacheTtlSeconds: number | undefined;
  readonly wildcards: WildcardConfig;
};

export type CreateContextInput = {
  readonly driver: RbacDriver;
  readonly cache: RbacCache;
  readonly cacheTtlSeconds: number | undefined;
  readonly wildcards: WildcardConfig;
};

export function createContext(input: CreateContextInput): RbacContext {
  return {
    driver: input.driver,
    cache: input.cache,
    cacheTtlSeconds: input.cacheTtlSeconds,
    wildcards: input.wildcards,
  };
}

// ─── Cache key helpers ──────────────────────────────────────────────────────

export function subjectRolesKey(type: string, key: string): string {
  return `rbac:v1:subject-roles:${type}:${key}`;
}

export function subjectDirectPermsKey(type: string, key: string): string {
  return `rbac:v1:subject-direct-perms:${type}:${key}`;
}

export function rolePermsKey(roleId: string): string {
  return `rbac:v1:role-perms:${roleId}`;
}

// ─── Cached reads ───────────────────────────────────────────────────────────

export async function getCachedRolePermissions(
  ctx: RbacContext,
  roleId: RoleId,
): Promise<Permission[]> {
  const key = rolePermsKey(roleId);
  const cached = await ctx.cache.get<Permission[]>(key);
  if (cached) return cached;
  const fresh = await ctx.driver.getRolePermissions(roleId);
  await ctx.cache.set(key, fresh, ctx.cacheTtlSeconds);
  return fresh;
}

export async function getCachedSubjectRoles(ctx: RbacContext, subject: Subject): Promise<Role[]> {
  const key = subjectRolesKey(subject.type, subject.key);
  const cached = await ctx.cache.get<Role[]>(key);
  if (cached) return cached;
  const fresh = await ctx.driver.getSubjectRoles(subject);
  await ctx.cache.set(key, fresh, ctx.cacheTtlSeconds);
  return fresh;
}

export async function getCachedSubjectDirectPermissions(
  ctx: RbacContext,
  subject: Subject,
): Promise<Permission[]> {
  const key = subjectDirectPermsKey(subject.type, subject.key);
  const cached = await ctx.cache.get<Permission[]>(key);
  if (cached) return cached;
  const fresh = await ctx.driver.getDirectSubjectPermissions(subject);
  await ctx.cache.set(key, fresh, ctx.cacheTtlSeconds);
  return fresh;
}

// ─── Invalidation ───────────────────────────────────────────────────────────

export async function invalidateRolePermissions(ctx: RbacContext, roleId: RoleId): Promise<void> {
  await ctx.cache.delete(rolePermsKey(roleId));
}

export async function invalidateSubjectRoles(ctx: RbacContext, subject: Subject): Promise<void> {
  await ctx.cache.delete(subjectRolesKey(subject.type, subject.key));
}

export async function invalidateSubjectDirectPermissions(
  ctx: RbacContext,
  subject: Subject,
): Promise<void> {
  await ctx.cache.delete(subjectDirectPermsKey(subject.type, subject.key));
}
