import { InMemoryDriver, Rbac, type Subject } from '@rbac-node/core';
import { describe, expect, it } from 'vitest';

import { factory } from './index.js';

type Lex = { permissions: 'articles.create' | 'articles.delete'; roles: 'admin' | 'editor' };

const subject: Subject = { type: 'User', key: 'u1' };

function makeRbac() {
  return new Rbac<Lex>({ driver: new InMemoryDriver() });
}

function makeResponse() {
  let sentStatus: number | undefined;
  let lastStatus: number | undefined;
  let ended = false;
  let json: unknown;
  const res = {
    status(code: number) {
      lastStatus = code;
      return res;
    },
    end() {
      ended = true;
    },
    sendStatus(code: number) {
      sentStatus = code;
    },
    json(body: unknown) {
      json = body;
    },
  };
  return {
    res,
    snapshot: () => ({ sentStatus, lastStatus, ended, json }),
  };
}

describe('@rbac-node/express factory', () => {
  it('calls next when subject has the role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).assignRole('admin');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.role('admin');

    let nextCalledWith: unknown = 'unset';
    const { res } = makeResponse();
    await middleware({}, res, (err?: unknown) => {
      nextCalledWith = err;
    });

    expect(nextCalledWith).toBeUndefined();
  });

  it('responds 403 via sendStatus when subject lacks role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.role('admin');

    let nextCalled = false;
    const { res, snapshot } = makeResponse();
    await middleware({}, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(snapshot().sentStatus).toBe(403);
  });

  it('responds 403 when subject is null', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, { resolveSubject: () => null });
    const middleware = auth.role('admin');

    const { res, snapshot } = makeResponse();
    await middleware({}, res, () => {});
    expect(snapshot().sentStatus).toBe(403);
  });

  it('honors custom onUnauthorized', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => null,
      onUnauthorized: (_req, res) => {
        res.status?.(401);
        res.json?.({ error: 'nope' });
      },
    });
    const middleware = auth.permission('articles.create');

    const { res, snapshot } = makeResponse();
    await middleware({}, res, () => {});
    expect(snapshot().lastStatus).toBe(401);
    expect(snapshot().json).toEqual({ error: 'nope' });
  });

  it('roleOrPermission accepts permission match', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.delete' });
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).givePermission('articles.delete');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const middleware = auth.roleOrPermission('admin', 'articles.delete');

    let nextCalled = false;
    const { res } = makeResponse();
    await middleware({}, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('forwards non-RBAC errors to next', async () => {
    const rbac = makeRbac();
    const boom = new Error('boom');
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => {
        throw boom;
      },
    });
    const middleware = auth.role('admin');

    let nextErr: unknown;
    const { res } = makeResponse();
    await middleware({}, res, (err?: unknown) => {
      nextErr = err;
    });
    expect(nextErr).toBe(boom);
  });
});
