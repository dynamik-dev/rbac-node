# @rbac-ts/hono

Hono middleware adapter for [`@rbac-ts/core`](https://www.npmjs.com/package/@rbac-ts/core).

## Install

```sh
pnpm add @rbac-ts/core @rbac-ts/hono
```

`hono` itself is your dependency — the adapter works against any `Context`.

## Quickstart

```ts
import { Hono } from 'hono';
import { Rbac } from '@rbac-ts/core';
import { factory } from '@rbac-ts/hono';

const rbac = new Rbac({ /* driver, defaultGuard */ });

const auth = factory(rbac, {
  resolveSubject: (c) => {
    const user = c.get('user'); // however your app loads the user
    return user ? { type: 'User', key: String(user.id) } : null;
  },
});

const app = new Hono();

app.get('/admin', auth.role('admin'), (c) => c.text('hi admin'));
app.post('/articles', auth.permission('articles.create'), handler);
app.delete(
  '/articles/:id',
  auth.roleOrPermission('admin', 'articles.delete'),
  handler,
);
app.get('/dashboard', auth.guard(async (authz) => authz.hasAllRoles(['editor', 'reviewer'])), handler);
```

The default `onUnauthorized` returns `Forbidden` with status 403. Override
via `factory(rbac, { onUnauthorized: (c) => c.json({ error: 'nope' }, 403) })`.

## License

MIT
