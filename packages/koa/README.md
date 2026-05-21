# @rbac-node/koa

Koa middleware adapter for [`@rbac-node/core`](https://www.npmjs.com/package/@rbac-node/core).

## Install

```sh
pnpm add @rbac-node/core @rbac-node/koa
```

## Quickstart

```ts
import Koa from 'koa';
import Router from '@koa/router';
import { Rbac } from '@rbac-node/core';
import { factory } from '@rbac-node/koa';

const rbac = new Rbac({ /* driver, defaultGuard */ });

const auth = factory(rbac, {
  resolveSubject: (ctx) => {
    const user = (ctx.request as { user?: { id: string } }).user;
    return user ? { type: 'User', key: user.id } : null;
  },
});

const app = new Koa();
const router = new Router();

router.get('/admin', auth.role('admin'), handler);
router.post('/articles', auth.permission('articles.create'), handler);
router.delete(
  '/articles/:id',
  auth.roleOrPermission('admin', 'articles.delete'),
  handler,
);
router.get('/dashboard', auth.guard((authz) => authz.hasAllRoles(['editor', 'reviewer'])), handler);

app.use(router.routes());
```

The default `onUnauthorized` sets `ctx.status = 403; ctx.body = 'Forbidden'`. Override via `factory(rbac, { onUnauthorized: (ctx) => { ctx.status = 401; ctx.body = { error: 'nope' }; } })`.

## License

MIT
