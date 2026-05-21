import { InMemoryDriver, Rbac, type Subject } from '@rbac-ts/core';
import { describe, expect, it } from 'vitest';

import { factory } from './index.js';

type Lex = { permissions: 'articles.create' | 'articles.delete'; roles: 'admin' | 'editor' };

const subject: Subject = { type: 'User', key: 'u1' };

function makeRbac() {
  return new Rbac<Lex>({ driver: new InMemoryDriver() });
}

type Call<T> = { body: T; status: number | undefined };

function makeContext() {
  let textCall: Call<string> | undefined;
  let jsonCall: Call<unknown> | undefined;
  const c = {
    req: {},
    text(body: string, status?: number) {
      textCall = { body, status };
      return textCall;
    },
    json(body: unknown, status?: number) {
      jsonCall = { body, status };
      return jsonCall;
    },
  };
  return {
    c,
    getText: () => textCall,
    getJson: () => jsonCall,
  };
}

describe('@rbac-ts/hono factory', () => {
  it('calls next when subject has the required role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).assignRole('admin');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.role('admin');

    let nextCalled = false;
    const { c } = makeContext();
    await middleware(c, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it('returns 403 via c.text when subject lacks the role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.role('admin');

    let nextCalled = false;
    const { c, getText } = makeContext();
    await middleware(c, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(getText()).toEqual({ body: 'Forbidden', status: 403 });
  });

  it('returns 403 when resolveSubject yields null', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });

    const auth = factory<Lex>(rbac, { resolveSubject: () => null });
    const middleware = auth.role('admin');

    const { c, getText } = makeContext();
    await middleware(c, async () => {});

    expect(getText()).toEqual({ body: 'Forbidden', status: 403 });
  });

  it('honors a custom onUnauthorized handler', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => null,
      onUnauthorized: (c) => c.json?.({ error: 'nope' }, 401),
    });
    const middleware = auth.permission('articles.create');

    const { c, getJson } = makeContext();
    await middleware(c, async () => {});

    expect(getJson()).toEqual({ body: { error: 'nope' }, status: 401 });
  });

  it('permission middleware accepts when subject has the permission', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.create' });
    await rbac.for(subject).givePermission('articles.create');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.permission('articles.create');

    let nextCalled = false;
    const { c } = makeContext();
    await middleware(c, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it('roleOrPermission accepts when subject has only the permission', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.delete' });
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).givePermission('articles.delete');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.roleOrPermission('admin', 'articles.delete');

    let nextCalled = false;
    const { c } = makeContext();
    await middleware(c, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it('guard runs the supplied check against the authorizer', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'editor' });
    await rbac.for(subject).assignRole('editor');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.guard(async (authz) => authz.hasRole('editor'));

    let nextCalled = false;
    const { c } = makeContext();
    await middleware(c, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});
