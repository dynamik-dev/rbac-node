import type { RbacCache } from './cache/index.js';
import { createLruCache } from './cache/lru.js';
import type { RbacDriver } from './driver.js';
import { PermissionDoesNotExistError, RoleDoesNotExistError } from './errors.js';
import { createContext, type RbacContext } from './internal/context.js';
import { PermissionApi } from './permission-api.js';
import { RoleApi } from './role-api.js';
import { type Binding, SubjectAuthorizer } from './subject-authorizer.js';
import type {
  Permission,
  PermName,
  RbacLexicon,
  Role,
  RoleId,
  RoleName,
  Subject,
} from './types.js';
import { DEFAULT_WILDCARD_CONFIG, type WildcardConfig } from './wildcard.js';

export type CacheBuildOptions = {
  readonly ttlSeconds?: number;
  readonly max?: number;
};

export type CacheOption = RbacCache | CacheBuildOptions;

export type RbacOptions = {
  readonly driver: RbacDriver;
  readonly wildcards?: Partial<WildcardConfig>;
  readonly cache?: CacheOption;
  /** Override the TTL used for cached entries written by core, in seconds. */
  readonly cacheTtlSeconds?: number;
};

/**
 * Entry point for the rbac-ts API.
 *
 * `L` is an optional lexicon — typed string unions for your application's
 * permission and role names. When provided, method inputs are statically
 * constrained to your vocabulary.
 *
 * ```ts
 * type Perms = 'articles.create' | 'articles.edit';
 * type Roles = 'admin' | 'editor';
 * const rbac = new Rbac<{ permissions: Perms; roles: Roles }>({ driver });
 * ```
 */
export class Rbac<L extends RbacLexicon = RbacLexicon> {
  readonly permissions: PermissionApi<PermName<L>>;
  readonly roles: RoleApi<RoleName<L>, PermName<L>>;

  /** Shared cache — exposed so callers can manually invalidate. */
  readonly cache: RbacCache;

  private readonly ctx: RbacContext;

  constructor(options: RbacOptions) {
    const wildcards: WildcardConfig = {
      enabled: options.wildcards?.enabled ?? DEFAULT_WILDCARD_CONFIG.enabled,
      separator: options.wildcards?.separator ?? DEFAULT_WILDCARD_CONFIG.separator,
    };

    const cacheInput = options.cache;
    const cache: RbacCache = isCacheInstance(cacheInput)
      ? cacheInput
      : createLruCache({
          ttlSeconds: cacheInput?.ttlSeconds,
          max: cacheInput?.max,
        });

    const cacheTtlSeconds =
      options.cacheTtlSeconds ??
      (!isCacheInstance(cacheInput) ? cacheInput?.ttlSeconds : undefined);

    this.cache = cache;

    this.ctx = createContext({
      driver: options.driver,
      cache,
      cacheTtlSeconds,
      wildcards,
    });

    this.permissions = new PermissionApi<PermName<L>>(this.ctx);
    this.roles = new RoleApi<RoleName<L>, PermName<L>>(this.ctx);
  }

  /** Bind operations to a specific subject. */
  for(subject: Subject): SubjectAuthorizer<L> {
    const binding: Binding = { subject };
    return new SubjectAuthorizer<L>(this.ctx, binding);
  }

  // ─── Query scopes ─────────────────────────────────────────────────────────

  async findSubjectsWithRole(type: string, role: RoleName<L> | Role): Promise<Subject[]> {
    const resolved = await this.resolveRoleStrict(role);
    return this.ctx.driver.findSubjectsWithAnyRole(type, [resolved.id]);
  }

  async findSubjectsWithAnyRole(
    type: string,
    roles: ReadonlyArray<RoleName<L> | Role>,
  ): Promise<Subject[]> {
    const ids: RoleId[] = [];
    for (const r of roles) {
      const resolved = await this.resolveRoleStrict(r);
      ids.push(resolved.id);
    }
    return this.ctx.driver.findSubjectsWithAnyRole(type, ids);
  }

  async findSubjectsWithPermission(
    type: string,
    permission: PermName<L> | Permission,
  ): Promise<Subject[]> {
    const perm = await this.resolvePermissionStrict(permission);
    return this.ctx.driver.findSubjectsWithPermission(type, perm.id);
  }

  // ─── Internal resolvers ───────────────────────────────────────────────────

  private async resolveRoleStrict(ref: RoleName<L> | Role): Promise<Role> {
    if (typeof ref !== 'string') return ref;
    const found = await this.ctx.driver.findRoleByName(ref);
    if (!found) throw new RoleDoesNotExistError(ref);
    return found;
  }

  private async resolvePermissionStrict(ref: PermName<L> | Permission): Promise<Permission> {
    if (typeof ref !== 'string') return ref;
    const found = await this.ctx.driver.findPermissionByName(ref);
    if (!found) throw new PermissionDoesNotExistError(ref);
    return found;
  }
}

function isCacheInstance(value: CacheOption | undefined): value is RbacCache {
  return value !== undefined && 'get' in value && typeof (value as RbacCache).get === 'function';
}
