# @rbac-node/drizzle

Drizzle ORM driver for [`@rbac-node/core`](https://www.npmjs.com/package/@rbac-node/core).

Ships dialect-specific schemas for **Postgres**, **MySQL**, and **SQLite**. A single
`DrizzleDriver` class implements the `RbacDriver` contract against any of them.

## Install

```sh
pnpm add @rbac-node/core @rbac-node/drizzle drizzle-orm
```

You also need a Drizzle-compatible client for your dialect (e.g. `pg`,
`mysql2`, `better-sqlite3`, `@libsql/client`).

## Quickstart

### Postgres

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Rbac } from '@rbac-node/core';
import { DrizzleDriver } from '@rbac-node/drizzle';
import { defineRbacSchema } from '@rbac-node/drizzle/schema/postgres';

// 1. Compose the RBAC tables into your own schema.
const rbac = defineRbacSchema();
export const schema = { ...rbac, /* ...myAppTables */ };

// 2. Wire up Drizzle.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// 3. Construct the driver and the RBAC facade.
const driver = new DrizzleDriver(db, rbac);
const rbacApi = new Rbac({ driver, defaultGuard: 'web' });
```

### MySQL

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { DrizzleDriver } from '@rbac-node/drizzle';
import { defineRbacSchema } from '@rbac-node/drizzle/schema/mysql';

const rbac = defineRbacSchema();
const connection = await mysql.createConnection(process.env.DATABASE_URL!);
const db = drizzle(connection, { schema: rbac, mode: 'default' });

const driver = new DrizzleDriver(db, rbac);
```

> **MySQL caveat.** Pivot-table upserts (`give*`, batched `assignRole`, etc.) rely
> on `INSERT ... ON CONFLICT DO NOTHING`. On `mysql2`, Drizzle emits
> `onDuplicateKeyUpdate`-style SQL. The composite primary keys on
> `model_has_*` tables make those upserts safe. If you observe key-length
> errors, ensure your tables use the default `utf8mb4` charset and InnoDB
> with `innodb_large_prefix=ON` (MySQL 5.7+ and MariaDB ship this by default).

### SQLite (`better-sqlite3`)

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DrizzleDriver } from '@rbac-node/drizzle';
import { defineRbacSchema } from '@rbac-node/drizzle/schema/sqlite';

const sqlite = new Database('app.db');
sqlite.pragma('foreign_keys = ON'); // required for cascading deletes
const rbac = defineRbacSchema();
const db = drizzle(sqlite, { schema: rbac });

const driver = new DrizzleDriver(db, rbac);
```

## Schema notes

The schemas mirror Spatie's `laravel-permission` column names, so a Laravel
data migration is straightforward.

| Table | Columns |
|---|---|
| `permissions` | `id`, `name`, `guard_name`, `created_at`, `updated_at` — unique `(name, guard_name)` |
| `roles` | `id`, `name`, `guard_name`, `team_id`, `created_at`, `updated_at` — unique `(team_id, name, guard_name)` |
| `model_has_permissions` | `permission_id` FK CASCADE, `model_type`, `model_key`, `team_id` — composite PK over all four; index on `(model_type, model_key)` |
| `model_has_roles` | `role_id` FK CASCADE, `model_type`, `model_key`, `team_id` — composite PK over all four; index on `(model_type, model_key)` |
| `role_has_permissions` | `role_id` FK CASCADE, `permission_id` FK CASCADE — PK `(role_id, permission_id)` |

### `team_id` as a non-null sentinel

`team_id` is stored as a **non-null string** at the storage layer. The driver
translates `teamId: null` (in the public API) to `''` when reading and writing.

This matters because Postgres and SQLite treat `NULL`s as distinct in unique
constraints — storing a real `NULL` in a composite primary key would break
`give*` idempotence (every `INSERT ... ON CONFLICT DO NOTHING` for the same
"no team" subject would create a new row) and break role uniqueness on
`(team_id, name, guard_name)` for the global team. Whether teams are enabled
or not, one schema works for both.

### Composite primary key on pivot tables

`model_has_permissions` and `model_has_roles` use a four-column composite
primary key:

```
PRIMARY KEY (permission_id /* or role_id */, model_type, model_key, team_id)
```

This is what makes `INSERT … ON CONFLICT DO NOTHING` a true upsert and lets
`give*` be idempotent. We considered a surrogate id + unique index, but the
composite PK is simpler, faster on read, and well-supported by all three
dialects once `team_id` is non-null.

## ID generation

`permissions.id` and `roles.id` default to `crypto.randomUUID()`. Override
with the `idGen` option:

```ts
import { ulid } from 'ulid';

const driver = new DrizzleDriver(db, rbac, { idGen: () => ulid() });
```

## Migrations

The schemas are vanilla Drizzle tables — run `drizzle-kit generate` against
your composed schema as usual:

```sh
drizzle-kit generate --schema ./src/schema.ts --dialect postgresql
drizzle-kit migrate
```

## Testing

`@rbac-node/drizzle` ships a `better-sqlite3` conformance suite as part of its
own test runner — see `src/driver.test.ts`. It re-uses
`runConformanceSuite` from `@rbac-node/core/testing`, so it's the same suite
every driver in the ecosystem runs against. 20/20 tests pass.

## License

MIT
