import {
  isRbacError,
  type PermName,
  type Rbac,
  type RbacLexicon,
  type RoleName,
  type Subject,
} from '@rbac-node/core';

type Awaitable<T> = T | Promise<T>;

type KoaLikeContext = {
  request: unknown;
  status?: number;
  body?: unknown;
};
type KoaNext = () => Promise<unknown>;
export type KoaMiddleware = (ctx: KoaLikeContext, next: KoaNext) => Promise<void>;

export type KoaAdapterOptions = {
  resolveSubject: (ctx: KoaLikeContext) => Awaitable<Subject | null | undefined>;
  onUnauthorized?: (ctx: KoaLikeContext) => Awaitable<void>;
};

export function factory<L extends RbacLexicon>(rbac: Rbac<L>, opts: KoaAdapterOptions) {
  const onUnauthorized = opts.onUnauthorized ?? defaultUnauthorized;

  const runCheck = async (
    ctx: KoaLikeContext,
    next: KoaNext,
    check: (subject: Subject) => Promise<boolean>,
  ): Promise<void> => {
    try {
      const subject = await opts.resolveSubject(ctx);
      if (!subject) return void (await onUnauthorized(ctx));
      if (!(await check(subject))) return void (await onUnauthorized(ctx));
      await next();
    } catch (err) {
      if (isRbacError(err)) return void (await onUnauthorized(ctx));
      throw err;
    }
  };

  return {
    role(...roleNames: ReadonlyArray<RoleName<L>>): KoaMiddleware {
      return (ctx, next) =>
        runCheck(ctx, next, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyRole(roleNames);
        });
    },

    permission(...permNames: ReadonlyArray<PermName<L>>): KoaMiddleware {
      return (ctx, next) =>
        runCheck(ctx, next, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyPermission(permNames);
        });
    },

    roleOrPermission(...names: ReadonlyArray<RoleName<L> | PermName<L>>): KoaMiddleware {
      return (ctx, next) =>
        runCheck(ctx, next, async (subject) => {
          const authz = rbac.for(subject);
          const asRoles = names as ReadonlyArray<RoleName<L>>;
          const asPerms = names as ReadonlyArray<PermName<L>>;
          if (await authz.hasAnyRole(asRoles)) return true;
          return authz.hasAnyPermission(asPerms);
        });
    },

    guard(
      check: (authz: ReturnType<Rbac<L>['for']>, ctx: KoaLikeContext) => Awaitable<boolean>,
    ): KoaMiddleware {
      return (ctx, next) =>
        runCheck(ctx, next, async (subject) => {
          const authz = rbac.for(subject);
          return check(authz, ctx);
        });
    },
  };
}

function defaultUnauthorized(ctx: KoaLikeContext): void {
  ctx.status = 403;
  ctx.body = 'Forbidden';
}
