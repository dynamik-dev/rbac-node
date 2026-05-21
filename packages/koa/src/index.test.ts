import { InMemoryDriver, Rbac, type Subject } from '@rbac-ts/core';
import { describe, expect, it } from 'vitest';

import { factory } from './index.js';

type Lex = { permissions: 'articles.create' | 'articles.delete'; roles: 'admin' | 'editor' };

const subject: Subject = { type: 'User', key: 'u1' };

function makeRbac() {
  return new Rbac<Lex>({ driver: new InMemoryDriver() });
}

function makeCtx(): { request: unknown; status?: number; body?: unknown } {
  return { request: {} };
}

describe('@rbac-ts/koa factory', () => {
  it('calls next when subject has the role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).assignRole('admin');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.role('admin');

    let nextCalled = false;
    const ctx = makeCtx();
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.status).toBeUndefined();
  });

  it('sets ctx.status=403 and body=Forbidden when denied', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.role('admin');

    let nextCalled = false;
    const ctx = makeCtx();
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(403);
    expect(ctx.body).toBe('Forbidden');
  });

  it('denies when resolveSubject returns null', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, { resolveSubject: () => null });
    const middleware = auth.permission('articles.create');

    const ctx = makeCtx();
    await middleware(ctx, async () => {});
    expect(ctx.status).toBe(403);
  });

  it('honors custom onUnauthorized', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => null,
      onUnauthorized: (ctx) => {
        ctx.status = 401;
        ctx.body = { error: 'nope' };
      },
    });
    const middleware = auth.role('admin');

    const ctx = makeCtx();
    await middleware(ctx, async () => {});
    expect(ctx.status).toBe(401);
    expect(ctx.body).toEqual({ error: 'nope' });
  });

  it('roleOrPermission accepts permission match', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.delete' });
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).givePermission('articles.delete');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.roleOrPermission('admin', 'articles.delete');

    let nextCalled = false;
    const ctx = makeCtx();
    await middleware(ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('rethrows non-RBAC errors', async () => {
    const rbac = makeRbac();
    const boom = new Error('boom');
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => {
        throw boom;
      },
    });
    const middleware = auth.role('admin');

    const ctx = makeCtx();
    await expect(middleware(ctx, async () => {})).rejects.toBe(boom);
  });
});
