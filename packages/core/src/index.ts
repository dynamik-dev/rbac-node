// Facade

// ID branding (for driver authors)
export { toPermissionId, toRoleId } from './branding.js';
// Cache
export {
  createLruCache,
  createNoopCache,
  type RbacCache,
} from './cache/index.js';
export type { LruCacheOptions } from './cache/lru.js';
// Driver contract + reference impl
export type { RbacDriver } from './driver.js';
export { InMemoryDriver } from './drivers/memory.js';
// Errors
export {
  isRbacError,
  PermissionDoesNotExistError,
  RbacError,
  RoleDoesNotExistError,
  UnauthorizedError,
} from './errors.js';
// Sub-APIs
export { type CreatePermissionApiInput, PermissionApi } from './permission-api.js';
export {
  type CacheBuildOptions,
  type CacheOption,
  Rbac,
  type RbacOptions,
} from './rbac.js';
export { type CreateRoleApiInput, RoleApi } from './role-api.js';
export { type Binding, SubjectAuthorizer } from './subject-authorizer.js';
// Domain types
export type {
  Brand,
  CreatePermissionInput,
  CreateRoleInput,
  Permission,
  PermissionFilter,
  PermissionId,
  PermName,
  PermRef,
  RbacLexicon,
  Role,
  RoleFilter,
  RoleId,
  RoleName,
  RoleRef,
  Subject,
} from './types.js';

// Wildcards
export {
  DEFAULT_WILDCARD_CONFIG,
  matchesWildcard,
  type WildcardConfig,
} from './wildcard.js';
