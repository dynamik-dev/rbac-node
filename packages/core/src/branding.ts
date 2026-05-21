import type { PermissionId, RoleId } from './types.js';

/**
 * Stamp a raw string as a {@link PermissionId}. Use only at the storage boundary —
 * when reading rows out of a driver or generating a fresh id.
 */
export function toPermissionId(value: string): PermissionId {
  return value as PermissionId;
}

/**
 * Stamp a raw string as a {@link RoleId}. Use only at the storage boundary.
 */
export function toRoleId(value: string): RoleId {
  return value as RoleId;
}
