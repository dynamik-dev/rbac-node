# rbac-ts

A type-safe, framework-agnostic, driver-pluggable role-based access control library for Node.js — roles, permissions, direct permissions, wildcards, caching — exposed through a typed, async API.

## Packages

| Package | Description |
|---|---|
| [`@rbac-ts/core`](./packages/core) | Types, `Rbac` facade, driver contract, in-memory driver, cache, wildcards, errors |
| [`@rbac-ts/prisma`](./packages/prisma) | Prisma driver and canonical schema fragment |
| [`@rbac-ts/drizzle`](./packages/drizzle) | Drizzle driver (Postgres, MySQL, SQLite schemas) |
| [`@rbac-ts/d1`](./packages/d1) | Cloudflare D1 driver (Workers runtime) |
| [`@rbac-ts/express`](./packages/express) | Express middleware adapter |
| [`@rbac-ts/fastify`](./packages/fastify) | Fastify `preHandler` adapter |
| [`@rbac-ts/hono`](./packages/hono) | Hono middleware adapter |
| [`@rbac-ts/koa`](./packages/koa) | Koa middleware adapter |

## Quickstart

```ts
import { Rbac } from '@rbac-ts/core';
import { PrismaDriver } from '@rbac-ts/prisma';
import { PrismaClient } from '@prisma/client';

type AppPerms = 'articles.create' | 'articles.edit' | 'articles.delete';
type AppRoles = 'admin' | 'editor' | 'viewer';

const rbac = new Rbac<{ permissions: AppPerms; roles: AppRoles }>({
  driver: new PrismaDriver(new PrismaClient()),
});

// Bulk + idempotent — safe to re-run on every boot.
await rbac.permissions.createMany(['articles.create', 'articles.edit', 'articles.delete']);
await rbac.roles.createMany(['admin', 'editor', 'viewer']);

await rbac.roles.givePermissions('editor', ['articles.create', 'articles.edit']);

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

## Publishing

Versioning is managed by [changesets](https://github.com/changesets/changesets). Two release paths:

**Normal flow (bot-driven)** — `.github/workflows/changesets.yml`
1. Record what changed: `pnpm changeset` (interactive). Commit the generated `.changeset/*.md` and push to `main`.
2. The Changesets bot opens (or updates) a `chore: version packages` PR with the proposed version bumps and changelog edits.
3. Merge the PR — the same workflow detects no pending changesets, publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements), and creates per-package tags (`@rbac-ts/<pkg>@<version>`).

**Manual flow (tag-driven)** — `.github/workflows/release.yml`
For off-cycle or hotfix publishes:

```bash
pnpm changeset             # record the change
pnpm version-packages      # apply bumps + CHANGELOGs
git commit -am "release: version packages"
git tag v$(node -p "require('./packages/core/package.json').version")
git push --follow-tags
```

Both workflows run `changeset publish`, which is idempotent — running twice on the same versions is a no-op.

Required GitHub secret: `NPM_TOKEN` (an npm **automation token** with publish access to the `@rbac-ts` scope).

## Design

See [`docs/superpowers/specs/2026-05-20-rbac-ts-design.md`](./docs/superpowers/specs/2026-05-20-rbac-ts-design.md).

## License

MIT
