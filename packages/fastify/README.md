# @rbac-ts/fastify

Fastify `preHandler` adapter for [`@rbac-ts/core`](https://www.npmjs.com/package/@rbac-ts/core).

## Install

```sh
pnpm add @rbac-ts/core @rbac-ts/fastify
```

## Quickstart

```ts
import Fastify from 'fastify';
import { Rbac } from '@rbac-ts/core';
import { factory } from '@rbac-ts/fastify';

const rbac = new Rbac({ /* driver, defaultGuard */ });

const auth = factory(rbac, {
  resolveSubject: (req) => {
    const user = (req as { user?: { id: string } }).user;
    return user ? { type: 'User', key: user.id } : null;
  },
});

const app = Fastify();

app.get('/admin', { preHandler: auth.role('admin') }, handler);
app.post('/articles', { preHandler: auth.permission('articles.create') }, handler);
app.delete(
  '/articles/:id',
  { preHandler: auth.roleOrPermission('admin', 'articles.delete') },
  handler,
);
app.get(
  '/dashboard',
  { preHandler: auth.guard((authz) => authz.hasAllRoles(['editor', 'reviewer'])) },
  handler,
);
```

## License

MIT
