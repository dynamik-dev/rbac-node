# @rbac-node/d1

Cloudflare D1 driver for [`@rbac-node/core`](https://www.npmjs.com/package/@rbac-node/core).

Targets the Workers runtime — no ORM, no Node-only dependencies. Just the D1 binding API.

## Install

```sh
pnpm add @rbac-node/core @rbac-node/d1
```

## Apply the schema

This package ships a migration file at `migrations/0001_init.sql`. With Wrangler:

```sh
# Copy or symlink to your project's migrations dir
mkdir -p migrations
cp node_modules/@rbac-node/d1/migrations/0001_init.sql migrations/

wrangler d1 migrations apply <YOUR_DATABASE>
```

Or apply once at runtime with the bundled DDL:

```ts
import { SCHEMA_SQL } from '@rbac-node/d1/schema';
await env.DB.exec(SCHEMA_SQL);
```

## Quickstart

```ts
import { Rbac } from '@rbac-node/core';
import { D1Driver } from '@rbac-node/d1';

type Env = { DB: D1Database };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const rbac = new Rbac({ driver: new D1Driver(env.DB) });

    await rbac.permissions.create({ name: 'articles.create' });
    await rbac.roles.create({ name: 'editor', permissions: ['articles.create'] });

    const subject = { type: 'User', key: 'u1' };
    await rbac.for(subject).assignRole('editor');

    const can = await rbac.for(subject).hasPermission('articles.create'); // true
    return Response.json({ can });
  },
};
```

## Notes

- Atomic sync operations (`syncRolePermissions`, `syncSubjectRoles`, `syncSubjectPermissions`) use `db.batch([...])`, which D1 executes as a single transaction.
- Idempotent grants (`give*`, `assign*`) use `INSERT OR IGNORE`, leaning on the composite primary keys on the pivot tables.
- The driver does not import `@cloudflare/workers-types`. The `D1Database` parameter is structurally typed — any real D1 binding satisfies it.
- Wrangler's `--local` mode is supported transparently; the driver doesn't care which D1 implementation it's talking to.

## License

MIT
