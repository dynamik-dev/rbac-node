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

// Structural request/response so this package doesn't peer-depend on `express`.
type ExpressLikeRequest = Record<string, unknown>;
type ExpressLikeResponse = {
  status?: (code: number) => ExpressLikeResponse;
  json?: (body: unknown) => unknown;
  sendStatus?: (code: number) => unknown;
  end?: () => unknown;
};
type ExpressLikeNext = (err?: unknown) => void;
export type ExpressMiddleware = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: ExpressLikeNext,
) => void | Promise<void>;

export type ExpressAdapterOptions = {
  resolveSubject: (req: ExpressLikeRequest) => Awaitable<Subject | null | undefined>;
  /** Override the response sent when authorization fails. Default: 403. */
  onUnauthorized?: (req: ExpressLikeRequest, res: ExpressLikeResponse) => Awaitable<void>;
};

export function factory<L extends RbacLexicon>(rbac: Rbac<L>, opts: ExpressAdapterOptions) {
  const onUnauthorized = opts.onUnauthorized ?? defaultUnauthorized;

  const runCheck = async (
    req: ExpressLikeRequest,
    res: ExpressLikeResponse,
    next: ExpressLikeNext,
    check: (subject: Subject) => Promise<boolean>,
  ): Promise<void> => {
    try {
      const subject = await opts.resolveSubject(req);
      if (!subject) {
        await onUnauthorized(req, res);
        return;
      }
      if (!(await check(subject))) {
        await onUnauthorized(req, res);
        return;
      }
      next();
    } catch (err) {
      if (isRbacError(err)) {
        await onUnauthorized(req, res);
        return;
      }
      next(err);
    }
  };

  return {
    role(...roleNames: ReadonlyArray<RoleName<L>>): ExpressMiddleware {
      return (req, res, next) =>
        runCheck(req, res, next, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyRole(roleNames);
        });
    },

    permission(...permNames: ReadonlyArray<PermName<L>>): ExpressMiddleware {
      return (req, res, next) =>
        runCheck(req, res, next, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyPermission(permNames);
        });
    },

    roleOrPermission(...names: ReadonlyArray<RoleName<L> | PermName<L>>): ExpressMiddleware {
      return (req, res, next) =>
        runCheck(req, res, next, async (subject) => {
          const authz = rbac.for(subject);
          const asRoles = names as ReadonlyArray<RoleName<L>>;
          const asPerms = names as ReadonlyArray<PermName<L>>;
          if (await authz.hasAnyRole(asRoles)) return true;
          return authz.hasAnyPermission(asPerms);
        });
    },

    guard(
      check: (authz: ReturnType<Rbac<L>['for']>, req: ExpressLikeRequest) => Awaitable<boolean>,
    ): ExpressMiddleware {
      return (req, res, next) =>
        runCheck(req, res, next, async (subject) => {
          const authz = rbac.for(subject);
          return check(authz, req);
        });
    },
  };
}

function defaultUnauthorized(_req: ExpressLikeRequest, res: ExpressLikeResponse): void {
  if (typeof res.sendStatus === 'function') {
    res.sendStatus(403);
    return;
  }
  if (typeof res.status === 'function' && typeof res.end === 'function') {
    res.status(403);
    res.end();
    return;
  }
  throw new UnauthorizedError();
}
