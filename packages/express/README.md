# @rbac-node/express

Express middleware adapter for [`@rbac-node/core`](https://www.npmjs.com/package/@rbac-node/core).

## Install

```sh
pnpm add @rbac-node/core @rbac-node/express
```

## Quickstart

```ts
import express from 'express';
import { Rbac } from '@rbac-node/core';
import { factory } from '@rbac-node/express';

const rbac = new Rbac({ /* driver, defaultGuard */ });

const auth = factory(rbac, {
  resolveSubject: (req) => {
    const user = (req as { user?: { id: string } }).user;
    return user ? { type: 'User', key: user.id } : null;
  },
});

const app = express();

app.get('/admin', auth.role('admin'), handler);
app.post('/articles', auth.permission('articles.create'), handler);
app.delete(
  '/articles/:id',
  auth.roleOrPermission('admin', 'articles.delete'),
  handler,
);
app.get('/dashboard', auth.guard((authz) => authz.hasAllRoles(['editor', 'reviewer'])), handler);
```

Override the default 403 with `factory(rbac, { onUnauthorized: (req, res) => res.status?.(401).json?.({ error: 'nope' }) })`.

## License

MIT
