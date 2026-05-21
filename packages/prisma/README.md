# @rbac-ts/prisma

Prisma driver for [`@rbac-ts/core`](../core). Spatie-compatible RBAC tables
(snake_case storage, camelCase Prisma client API), atomic syncs, idempotent
grants.

## Install

```sh
pnpm add @rbac-ts/core @rbac-ts/prisma
# or
npm install @rbac-ts/core @rbac-ts/prisma
```

`@prisma/client` is a peer dependency — bring your own.

## Quickstart

### 1. Drop in the schema fragment

```sh
npx rbac-ts-prisma init
```

This writes `prisma/rbac.prisma` to your project. Open it, copy the model
blocks into your `schema.prisma` (keep your existing `datasource` and
`generator`), then migrate:

```sh
pnpm prisma migrate dev --name rbac
# or for prototyping
pnpm prisma db push
```

Finish with `pnpm prisma generate` so the Prisma client picks up the new
models.

### 2. Wire up the driver

```ts
import { PrismaClient } from '@prisma/client';
import { Rbac } from '@rbac-ts/core';
import { PrismaDriver } from '@rbac-ts/prisma';

const prisma = new PrismaClient();
const rbac = new Rbac({
  driver: new PrismaDriver(prisma),
  defaultGuard: 'web',
});
```

The driver accepts any Prisma-shaped client — including the result of
`prisma.$extends(...)` — because it types the constructor argument
structurally.

### 3. Use it

```ts
await rbac.permissions.create({ name: 'articles.create' });
await rbac.roles.create({ name: 'editor', permissions: ['articles.create'] });

const user = { type: 'User', key: '42' };
await rbac.for(user).assignRole('editor');

if (await rbac.for(user).hasPermission('articles.create')) {
  // …
}
```

## Schema

The fragment defines five tables:

| Table | Purpose |
| --- | --- |
| `permissions` | Permission catalogue (`name`, `guard_name`) |
| `roles` | Role catalogue (`name`, `guard_name`, optional `team_id`) |
| `role_has_permissions` | Many-to-many between roles and permissions |
| `model_has_permissions` | Direct subject → permission grants |
| `model_has_roles` | Subject → role assignments |

`team_id` is always nullable. If you don't use multi-tenant teams, pass
`teamId: null` everywhere and ignore the column.

`onDelete: Cascade` on the pivots means deleting a permission or role
cleans up its grants automatically.

## Notes & tradeoffs

- **Idempotent grants without `skipDuplicates`.** `createMany({
  skipDuplicates: true })` is fast on Postgres/MySQL but Prisma rejects it
  on SQLite. To keep behaviour consistent across drivers the driver uses
  per-row `upsert` (or `findFirst` + `create` where the unique constraint
  includes a nullable `team_id`). For pivot writes that run at admin
  frequency the extra round-trip is negligible.

- **`null` team uniqueness.** Postgres and SQLite both treat `NULL` as
  distinct in unique indexes, which would let two roles named `admin` exist
  with `team_id = NULL`. The driver compensates with a Spatie-style
  pre-check in `createRole` — concurrent races on the no-team case still
  fall through to whatever your DB does, but the common case (single
  writer) reports a friendly error.

- **`findSubjectsWithPermission` is two queries.** A single SQL `UNION`
  via `$queryRawUnsafe` would be one round trip, but it ties the driver to
  a specific dialect. Two Prisma queries + an in-memory dedupe stay
  database-agnostic and run at policy-evaluation rates rather than per
  request.

## License

MIT.
