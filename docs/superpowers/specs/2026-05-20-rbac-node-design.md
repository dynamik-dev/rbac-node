# rbac-ts — Design

**Date:** 2026-05-20
**Author:** chris@arter.dev
**Status:** Approved (auto-mode greenfield)

A type-safe, framework-agnostic, driver-pluggable RBAC library for Node/TypeScript with feature parity to [spatie/laravel-permission](https://github.com/spatie/laravel-permission): roles, permissions, direct permissions, multiple guards, teams, wildcards, caching, and framework middleware.

## Goals

1. **Feature parity** with laravel-permission's public API (method names, semantics, schema column names) so docs and mental models port cleanly.
2. **Type safety** beyond what PHP can offer — permission and role identifiers are typed string unions.
3. **Driver-pluggable** persistence — Prisma, Drizzle, Mongo, custom — behind one `RbacDriver` interface.
4. **Framework-agnostic core** with thin adapters for Express, Fastify, Hono, Koa.
5. **Production hygiene** — request-scoped team context (no global mutable state), batched writes, opt-in caching with auto-invalidation, sane errors.

## Non-goals (v0)

- Mongo/document driver (designed-for but not built initially).
- GraphQL/REST resource layer.
- Hosted admin UI.

## Repository layout (pnpm workspaces)

```
rbac-ts/
├── packages/
│   ├── core/          # @rbac-ts/core
│   │   ├── src/
│   │   │   ├── index.ts                  # public exports
│   │   │   ├── types.ts                  # Subject, Permission, Role, IDs
│   │   │   ├── errors.ts                 # RbacError hierarchy
│   │   │   ├── rbac.ts                   # Rbac facade
│   │   │   ├── subject-authorizer.ts     # per-subject builder
│   │   │   ├── permission-api.ts         # rbac.permissions.*
│   │   │   ├── role-api.ts               # rbac.roles.*
│   │   │   ├── driver.ts                 # RbacDriver interface
│   │   │   ├── drivers/memory.ts         # InMemoryDriver
│   │   │   ├── cache/index.ts            # RbacCache interface
│   │   │   ├── cache/lru.ts              # default LRU impl
│   │   │   ├── wildcard.ts               # matcher
│   │   │   ├── teams.ts                  # AsyncLocalStorage + runWithTeam
│   │   │   ├── middleware/
│   │   │   │   ├── express.ts
│   │   │   │   ├── fastify.ts
│   │   │   │   ├── hono.ts
│   │   │   │   └── koa.ts
│   │   │   └── testing/
│   │   │       ├── conformance.ts        # driver test kit
│   │   │       └── factories.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   ├── prisma/        # @rbac-ts/prisma
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── driver.ts                 # PrismaDriver
│   │   │   └── cli.ts                    # `rbac-ts-prisma init`
│   │   ├── prisma/rbac.prisma            # canonical schema fragment
│   │   └── package.json
│   └── drizzle/       # @rbac-ts/drizzle
│       ├── src/
│       │   ├── index.ts
│       │   ├── driver.ts                 # DrizzleDriver
│       │   ├── schema/postgres.ts
│       │   ├── schema/mysql.ts
│       │   └── schema/sqlite.ts
│       └── package.json
├── examples/
│   ├── prisma-express/
│   └── drizzle-hono/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
└── README.md
```

Tooling: **pnpm** workspaces, **tsup** build (ESM+CJS), **vitest** test, **turborepo** for caching, **changesets** for versioning. `@prisma/client` and `drizzle-orm` declared as `peerDependencies`.

## Domain model

### Subject (replaces Laravel's polymorphic model)

```ts
type Subject = {
  type: string;   // stable name, e.g., "User", "ApiClient"
  key: string;    // stringified primary key — works for int/uuid/bigint
};
```

This maps 1:1 to Spatie's `model_type` / `model_morph_key` columns.

### Permission

```ts
type Permission = {
  id: string;             // generated id (uuid or driver-native)
  name: string;
  guardName: string;
  createdAt: Date;
  updatedAt: Date;
};
```

### Role

```ts
type Role = {
  id: string;
  name: string;
  guardName: string;
  teamId: string | null;  // present only when teams enabled
  createdAt: Date;
  updatedAt: Date;
};
```

## Public API

### Constructing Rbac (generic, typed)

```ts
import { Rbac } from '@rbac-ts/core';
import { PrismaDriver } from '@rbac-ts/prisma';

type AppPerms =
  | 'articles.create' | 'articles.edit' | 'articles.delete'
  | 'users.manage'   | 'articles.*';

type AppRoles = 'admin' | 'editor' | 'viewer';

const rbac = new Rbac<{ permissions: AppPerms; roles: AppRoles }>({
  driver: new PrismaDriver(prisma),
  defaultGuard: 'web',
  guards: ['web', 'api'],
  teams: { enabled: true },
  wildcards: { enabled: true, separator: '.' },
  cache: { ttlSeconds: 86_400 },
});
```

If you don't supply the generic, `permissions` and `roles` widen to `string`.

### Permission API

```ts
rbac.permissions.create({ name, guardName? }): Promise<Permission>
rbac.permissions.findByName(name, guard?): Promise<Permission | null>
rbac.permissions.findById(id): Promise<Permission | null>
rbac.permissions.list(filter?): Promise<Permission[]>
rbac.permissions.delete(id): Promise<void>
```

### Role API

```ts
rbac.roles.create({ name, guardName?, teamId?, permissions? }): Promise<Role>
rbac.roles.findByName(name, guard?, teamId?): Promise<Role | null>
rbac.roles.findById(id): Promise<Role | null>
rbac.roles.list(filter?): Promise<Role[]>
rbac.roles.delete(id): Promise<void>

rbac.roles.givePermissions(roleId, perms): Promise<void>
rbac.roles.revokePermissions(roleId, perms): Promise<void>
rbac.roles.syncPermissions(roleId, perms): Promise<void>
rbac.roles.getPermissions(roleId): Promise<Permission[]>
```

### Subject authorizer — `rbac.for(subject)`

Returns a builder bound to a subject. Full method set (mirrors Spatie 1:1):

**Roles**
- `assignRole(role | role[])`
- `removeRole(role | role[])`
- `syncRoles(role[])`
- `hasRole(role)`, `hasAnyRole(role[])`, `hasAllRoles(role[])`, `hasExactRoles(role[])`
- `getRoles(): Promise<Role[]>`, `getRoleNames(): Promise<string[]>`

**Permissions**
- `givePermission(perm | perm[])`
- `revokePermission(perm | perm[])`
- `syncPermissions(perm[])`
- `hasPermission(perm)` — direct **or** via role (wildcard-aware)
- `hasAnyPermission(perm[])`, `hasAllPermissions(perm[])`
- `hasDirectPermission(perm)`, `hasAnyDirectPermission(perm[])`, `hasAllDirectPermissions(perm[])`
- `can(perm)` — alias of `hasPermission` (Laravel `$user->can`)
- `canAny(perm[])`
- `getPermissions()` — direct ∪ via-roles
- `getDirectPermissions()`
- `getPermissionsViaRoles()`
- `getPermissionNames()`

Per-call options to override defaults:
```ts
rbac.for(subject, { guard: 'api', teamId: '42' }).hasRole('admin');
```

### Query scopes

```ts
rbac.findSubjectsWithRole({ type: 'User' }, 'admin'): Promise<Subject[]>
rbac.findSubjectsWithPermission({ type: 'User' }, 'articles.edit'): Promise<Subject[]>
rbac.findSubjectsWithoutRole(...): Promise<Subject[]>
rbac.findSubjectsWithoutPermission(...): Promise<Subject[]>
```

## Guards

`guardName` is a string column on `Role` and `Permission`. Default at the `Rbac` instance; overridable per call. Operations across guards do not interfere — two permissions named `"publish"` under different guards are independent rows.

Mismatched guard between a check and a stored permission throws `GuardDoesNotMatchError`.

## Teams

Enabled via `teams: { enabled: true }`. Adds nullable `team_id` to `roles`, `model_has_roles`, `model_has_permissions`. Composite uniqueness on roles becomes `(team_id, name, guard_name)`.

**Team context** uses Node's `AsyncLocalStorage`:

```ts
import { runWithTeam } from '@rbac-ts/core';

await runWithTeam(team.id, async () => {
  // Any rbac.for(...) call inside this scope automatically uses team.id
  await rbac.for(user).hasRole('admin');
});
```

Per-call `teamId` always wins. Explicit `null` means "global / unscoped".

This is the key deviation from Spatie's static mutable `setPermissionsTeamId` — request-isolated by default.

## Wildcards

Enabled via `wildcards: { enabled: true, separator: '.' }`. Stored permission names may contain `*`. At check time, the matcher tokenizes both stored and requested names by separator, then matches greedy:

- `articles.*` matches `articles.create`, `articles.edit`
- `*.delete` matches any `<x>.delete`
- `articles.**` (deep wildcard) matches `articles.posts.create`, etc.
- Multi-level: `users.posts.*`

A single matcher implementation in `core` — drivers never reimplement.

## Caching

`RbacCache` interface:
```ts
interface RbacCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  invalidate(prefix?: string): Promise<void>;
}
```

Default impl: `lru-cache` in-process. Redis adapter ships separately. Cache keys versioned with `v1` prefix so we can break safely.

**Cache contents** (per Spatie semantics):
- Subject's roles list: `rbac:v1:roles:{guard}:{team}:{type}:{key}`
- Subject's direct permissions: `rbac:v1:perms:direct:{guard}:{team}:{type}:{key}`
- Subject's role-derived permissions: `rbac:v1:perms:viaRoles:{guard}:{team}:{type}:{key}`
- Role→permissions: `rbac:v1:role-perms:{roleId}`

**Auto-invalidation** fires on every mutating method. `rbac.cache.invalidate({ subject? })` exposed for manual flush (e.g., after raw DB writes).

## Errors

```ts
class RbacError extends Error {}
class PermissionDoesNotExistError extends RbacError {}
class RoleDoesNotExistError extends RbacError {}
class GuardDoesNotMatchError extends RbacError {}
class UnauthorizedError extends RbacError {}
```

`UnauthorizedError` is what middleware throws on a failed check.

## Framework middleware

Side exports of `@rbac-ts/core/middleware/{express,fastify,hono,koa}`. Each adapter takes an `Rbac` instance and a `subject` resolver:

```ts
import { express as rbacExpress } from '@rbac-ts/core/middleware';

const auth = rbacExpress.factory(rbac, {
  resolveSubject: req => ({ type: 'User', key: String(req.user!.id) }),
  onUnauthorized: (req, res) => res.sendStatus(403),
});

app.get('/admin',      auth.role('admin'),                 h);
app.post('/articles',  auth.permission('articles.create'), h);
app.delete('/posts/:id', auth.roleOrPermission(['admin', 'articles.delete']), h);
```

Hono/Fastify/Koa equivalents have the same shape.

## Database schema (canonical column names — Spatie-compatible)

| Table | Columns |
|---|---|
| `permissions` | `id PK`, `name`, `guard_name`, `created_at`, `updated_at`; unique `(name, guard_name)` |
| `roles` | `id PK`, `name`, `guard_name`, `team_id?`, `created_at`, `updated_at`; unique `(team_id, name, guard_name)` when teams on, else `(name, guard_name)` |
| `model_has_permissions` | `permission_id FK CASCADE`, `model_type`, `model_key`, `team_id?`; PK composite over all non-null cols; idx `(model_type, model_key)` |
| `model_has_roles` | `role_id FK CASCADE`, `model_type`, `model_key`, `team_id?`; PK composite; idx `(model_type, model_key)` |
| `role_has_permissions` | `role_id FK CASCADE`, `permission_id FK CASCADE`; PK `(role_id, permission_id)` |

`model_key` is `varchar(255)` (MySQL/Postgres) or `text` (SQLite/Postgres) — accommodates int, bigint, uuid, ulid. IDs on `permissions`/`roles` are driver-determined (Prisma `cuid()`, Drizzle `uuid` or autoinc).

## Driver: `@rbac-ts/prisma`

Ships `prisma/rbac.prisma` with canonical models. Users either:
1. Run `npx @rbac-ts/prisma init` to copy/merge into their `schema.prisma`, **or**
2. Copy/paste the fragment manually.

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaDriver } from '@rbac-ts/prisma';
const driver = new PrismaDriver(new PrismaClient(), { teams: true });
```

Edge writes use `$transaction` for atomicity. Optional `tableNames` config to override defaults if users have collisions.

## Driver: `@rbac-ts/drizzle`

Ships `schema/{postgres,mysql,sqlite}.ts`. Users import and spread:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { defineRbacSchema } from '@rbac-ts/drizzle/schema/postgres';

const rbacTables = defineRbacSchema({ teams: true });
export const schema = { ...rbacTables, ...myTables };

import { DrizzleDriver } from '@rbac-ts/drizzle';
const db = drizzle(pool, { schema });
const driver = new DrizzleDriver(db, rbacTables);
```

Uses Drizzle's typed relational queries; no string SQL.

## Driver contract (`RbacDriver`)

22 atomic methods. Every driver must pass the conformance suite in `@rbac-ts/core/testing`. Sketch:

```ts
interface RbacDriver {
  // permissions
  createPermission(input): Promise<Permission>;
  findPermissionByName(name, guard?, teamId?): Promise<Permission | null>;
  findPermissionById(id): Promise<Permission | null>;
  listPermissions(filter?): Promise<Permission[]>;
  deletePermission(id): Promise<void>;

  // roles
  createRole(input): Promise<Role>;
  findRoleByName(name, guard?, teamId?): Promise<Role | null>;
  findRoleById(id): Promise<Role | null>;
  listRoles(filter?): Promise<Role[]>;
  deleteRole(id): Promise<void>;

  // role↔permission
  giveRolePermissions(roleId, permIds): Promise<void>;
  revokeRolePermissions(roleId, permIds): Promise<void>;
  syncRolePermissions(roleId, permIds): Promise<void>;
  getRolePermissions(roleId): Promise<Permission[]>;

  // subject↔role
  assignSubjectRoles(subject, roleIds, teamId?): Promise<void>;
  removeSubjectRoles(subject, roleIds, teamId?): Promise<void>;
  syncSubjectRoles(subject, roleIds, teamId?): Promise<void>;
  getSubjectRoles(subject, teamId?): Promise<Role[]>;

  // subject↔permission (direct)
  giveSubjectPermissions(subject, permIds, teamId?): Promise<void>;
  revokeSubjectPermissions(subject, permIds, teamId?): Promise<void>;
  syncSubjectPermissions(subject, permIds, teamId?): Promise<void>;
  getDirectSubjectPermissions(subject, teamId?): Promise<Permission[]>;

  // scopes
  findSubjectsWithRole(type, roleId | roleId[]): Promise<Subject[]>;
  findSubjectsWithPermission(type, permId): Promise<Subject[]>;
}
```

## Testing

- Each package uses `vitest`.
- `@rbac-ts/core/testing` exports `runConformanceSuite(driverFactory)` — every driver runs it.
- `core` runs it against its in-memory driver.
- `prisma` runs it against SQLite (file:test.db).
- `drizzle` runs it against `better-sqlite3` (fast) and `pglite` (Postgres semantics).
- Ephemeral state: each test gets a fresh database via factory cleanup.

## Differences from Spatie (deliberate)

1. **AsyncLocalStorage** for team context — request-isolated.
2. **Generic typed permission/role unions** for compile-time safety.
3. **Explicit `{type, key}` subjects** instead of reflection-based polymorphism.
4. **All ops async** for surface consistency.
5. **Single shared wildcard matcher** instead of per-driver implementations.
6. **Driver conformance kit** shipped with core.

## Build & release

- `tsup` produces ESM+CJS+`.d.ts` per package.
- `package.json` `exports` map for `/middleware/*`, `/testing` subpaths.
- `@prisma/client` and `drizzle-orm` are peer deps.
- `changesets` for versioned releases on push to `main`.
- Node 18+, TypeScript 5.4+.

## Implementation plan (waves)

**Wave 1** — Repo scaffold + `core` types & in-memory driver
**Wave 2** — `core` Rbac facade, SubjectAuthorizer, cache, wildcards, errors, teams
**Wave 3** — `core` framework middleware + conformance suite
**Wave 4** — `prisma` driver + schema fragment + CLI
**Wave 5** — `drizzle` driver + schemas
**Wave 6** — Examples (prisma-express, drizzle-hono) + README
