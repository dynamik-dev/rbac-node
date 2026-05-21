# @rbac-node/hono

Hono middleware adapter for [`@rbac-node/core`](https://www.npmjs.com/package/@rbac-node/core).

## Install

```sh
pnpm add @rbac-node/core @rbac-node/hono
```

`hono` itself is your dependency — the adapter works against any `Context`.

## Quickstart

```ts
import { Hono } from 'hono';
import { Rbac } from '@rbac-node/core';
import { factory } from '@rbac-node/hono';

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
