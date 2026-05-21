# rbac-node

A type-safe, framework-agnostic, driver-pluggable role-based access control library for Node.js — roles, permissions, direct permissions, wildcards, caching — exposed through a typed, async API.

## Packages

| Package | Description |
|---|---|
| [`@rbac-node/core`](./packages/core) | Types, `Rbac` facade, driver contract, in-memory driver, cache, wildcards, errors |
| [`@rbac-node/prisma`](./packages/prisma) | Prisma driver and canonical schema fragment |
| [`@rbac-node/drizzle`](./packages/drizzle) | Drizzle driver (Postgres, MySQL, SQLite schemas) |
| [`@rbac-node/d1`](./packages/d1) | Cloudflare D1 driver (Workers runtime) |
| [`@rbac-node/express`](./packages/express) | Express middleware adapter |
| [`@rbac-node/fastify`](./packages/fastify) | Fastify `preHandler` adapter |
| [`@rbac-node/hono`](./packages/hono) | Hono middleware adapter |
| [`@rbac-node/koa`](./packages/koa) | Koa middleware adapter |

## Quickstart

```ts
import { Rbac } from '@rbac-node/core';
import { PrismaDriver } from '@rbac-node/prisma';
import { PrismaClient } from '@prisma/client';

type AppPerms = 'articles.create' | 'articles.edit' | 'articles.delete';
type AppRoles = 'admin' | 'editor' | 'viewer';

const rbac = new Rbac<{ permissions: AppPerms; roles: AppRoles }>({
  driver: new PrismaDriver(new PrismaClient()),
});

await rbac.permissions.create({ name: 'articles.create' });
await rbac.roles.create({ name: 'editor', permissions: ['articles.create'] });

const subject = { type: 'User', key: String(userId) };
await rbac.for(subject).assignRole('editor');
await rbac.for(subject).hasPermission('articles.create'); // true
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Design

See [`docs/superpowers/specs/2026-05-20-rbac-node-design.md`](./docs/superpowers/specs/2026-05-20-rbac-node-design.md).

## License

MIT
