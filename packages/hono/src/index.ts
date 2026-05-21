import {
  isRbacError,
  type PermName,
  type Rbac,
  type RbacLexicon,
  type RoleName,
  type Subject,
  UnauthorizedError,
} from '@rbac-node/core';

type Awaitable<T> = T | Promise<T>;

// Hono's `Context` is heavy; we keep it structural so this package does not
// need to peer-depend on `hono`. Any real `Context` satisfies this shape.
type HonoLikeContext = {
  req: unknown;
  status?: (code: number) => unknown;
  json?: (body: unknown, status?: number) => unknown;
  text?: (body: string, status?: number) => unknown;
};
type HonoNext = () => Promise<void>;
export type HonoMiddleware = (c: HonoLikeContext, next: HonoNext) => Promise<unknown>;

export type HonoAdapterOptions = {
  resolveSubject: (c: HonoLikeContext) => Awaitable<Subject | null | undefined>;
  onUnauthorized?: (c: HonoLikeContext) => Awaitable<unknown>;
};

export function factory<L extends RbacLexicon>(rbac: Rbac<L>, opts: HonoAdapterOptions) {
  const onUnauthorized = opts.onUnauthorized ?? defaultUnauthorized;

  const runCheck = async (
    c: HonoLikeContext,
    next: HonoNext,
    check: (subject: Subject) => Promise<boolean>,
  ): Promise<unknown> => {
    try {
      const subject = await opts.resolveSubject(c);
      if (!subject) return onUnauthorized(c);
      if (!(await check(subject))) return onUnauthorized(c);
      await next();
      return undefined;
    } catch (err) {
      if (isRbacError(err)) return onUnauthorized(c);
      throw err;
    }
  };

  return {
    role(...roleNames: ReadonlyArray<RoleName<L>>): HonoMiddleware {
      return (c, next) =>
        runCheck(c, next, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyRole(roleNames);
        });
    },

    permission(...permNames: ReadonlyArray<PermName<L>>): HonoMiddleware {
      return (c, next) =>
        runCheck(c, next, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyPermission(permNames);
        });
    },

    roleOrPermission(...names: ReadonlyArray<RoleName<L> | PermName<L>>): HonoMiddleware {
      return (c, next) =>
        runCheck(c, next, async (subject) => {
          const authz = rbac.for(subject);
          const asRoles = names as ReadonlyArray<RoleName<L>>;
          const asPerms = names as ReadonlyArray<PermName<L>>;
          if (await authz.hasAnyRole(asRoles)) return true;
          return authz.hasAnyPermission(asPerms);
        });
    },

    guard(
      check: (authz: ReturnType<Rbac<L>['for']>, c: HonoLikeContext) => Awaitable<boolean>,
    ): HonoMiddleware {
      return (c, next) =>
        runCheck(c, next, async (subject) => {
          const authz = rbac.for(subject);
          return check(authz, c);
        });
    },
  };
}

function defaultUnauthorized(c: HonoLikeContext): unknown {
  if (typeof c.text === 'function') return c.text('Forbidden', 403);
  if (typeof c.json === 'function') return c.json({ error: 'Forbidden' }, 403);
  throw new UnauthorizedError();
}
