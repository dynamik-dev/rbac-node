import {
  isRbacError,
  type PermName,
  type Rbac,
  type RbacLexicon,
  type RoleName,
  type Subject,
  UnauthorizedError,
} from '@rbac-ts/core';

type Awaitable<T> = T | Promise<T>;

type FastifyLikeRequest = Record<string, unknown>;
type FastifyLikeReply = {
  code?: (statusCode: number) => FastifyLikeReply;
  send?: (payload?: unknown) => unknown;
};
export type FastifyPreHandler = (req: FastifyLikeRequest, reply: FastifyLikeReply) => Promise<void>;

export type FastifyAdapterOptions = {
  resolveSubject: (req: FastifyLikeRequest) => Awaitable<Subject | null | undefined>;
  onUnauthorized?: (req: FastifyLikeRequest, reply: FastifyLikeReply) => Awaitable<void>;
};

export function factory<L extends RbacLexicon>(rbac: Rbac<L>, opts: FastifyAdapterOptions) {
  const onUnauthorized = opts.onUnauthorized ?? defaultUnauthorized;

  const runCheck = async (
    req: FastifyLikeRequest,
    reply: FastifyLikeReply,
    check: (subject: Subject) => Promise<boolean>,
  ): Promise<void> => {
    try {
      const subject = await opts.resolveSubject(req);
      if (!subject) return onUnauthorized(req, reply);
      if (!(await check(subject))) return onUnauthorized(req, reply);
    } catch (err) {
      if (isRbacError(err)) return onUnauthorized(req, reply);
      throw err;
    }
  };

  return {
    role(...roleNames: ReadonlyArray<RoleName<L>>): FastifyPreHandler {
      return (req, reply) =>
        runCheck(req, reply, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyRole(roleNames);
        });
    },

    permission(...permNames: ReadonlyArray<PermName<L>>): FastifyPreHandler {
      return (req, reply) =>
        runCheck(req, reply, async (subject) => {
          const authz = rbac.for(subject);
          return authz.hasAnyPermission(permNames);
        });
    },

    roleOrPermission(...names: ReadonlyArray<RoleName<L> | PermName<L>>): FastifyPreHandler {
      return (req, reply) =>
        runCheck(req, reply, async (subject) => {
          const authz = rbac.for(subject);
          const asRoles = names as ReadonlyArray<RoleName<L>>;
          const asPerms = names as ReadonlyArray<PermName<L>>;
          if (await authz.hasAnyRole(asRoles)) return true;
          return authz.hasAnyPermission(asPerms);
        });
    },

    guard(
      check: (authz: ReturnType<Rbac<L>['for']>, req: FastifyLikeRequest) => Awaitable<boolean>,
    ): FastifyPreHandler {
      return (req, reply) =>
        runCheck(req, reply, async (subject) => {
          const authz = rbac.for(subject);
          return check(authz, req);
        });
    },
  };
}

function defaultUnauthorized(_req: FastifyLikeRequest, reply: FastifyLikeReply): void {
  if (typeof reply.code === 'function') {
    reply.code(403);
    if (typeof reply.send === 'function') reply.send();
    return;
  }
  throw new UnauthorizedError();
}
