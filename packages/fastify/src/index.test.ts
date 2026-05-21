import { InMemoryDriver, Rbac, type Subject } from '@rbac-ts/core';
import { describe, expect, it } from 'vitest';

import { factory } from './index.js';

type Lex = { permissions: 'articles.create' | 'articles.delete'; roles: 'admin' | 'editor' };

const subject: Subject = { type: 'User', key: 'u1' };

function makeRbac() {
  return new Rbac<Lex>({ driver: new InMemoryDriver() });
}

function makeReply() {
  let lastCode: number | undefined;
  let sent = false;
  let payload: unknown;
  const reply = {
    code(statusCode: number) {
      lastCode = statusCode;
      return reply;
    },
    send(p?: unknown) {
      sent = true;
      payload = p;
    },
  };
  return {
    reply,
    snapshot: () => ({ lastCode, sent, payload }),
  };
}

describe('@rbac-ts/fastify factory', () => {
  it('resolves when subject has the role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).assignRole('admin');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const preHandler = auth.role('admin');

    const { reply, snapshot } = makeReply();
    await preHandler({}, reply);
    expect(snapshot().lastCode).toBeUndefined();
  });

  it('replies 403 when subject lacks role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const preHandler = auth.role('admin');

    const { reply, snapshot } = makeReply();
    await preHandler({}, reply);
    expect(snapshot().lastCode).toBe(403);
    expect(snapshot().sent).toBe(true);
  });

  it('replies 403 when resolveSubject returns null', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, { resolveSubject: () => null });
    const preHandler = auth.permission('articles.create');

    const { reply, snapshot } = makeReply();
    await preHandler({}, reply);
    expect(snapshot().lastCode).toBe(403);
  });

  it('honors custom onUnauthorized', async () => {
    const rbac = makeRbac();
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => null,
      onUnauthorized: (_req, reply) => {
        reply.code?.(401)?.send?.({ error: 'nope' });
      },
    });
    const preHandler = auth.role('admin');

    const { reply, snapshot } = makeReply();
    await preHandler({}, reply);
    expect(snapshot().lastCode).toBe(401);
    expect(snapshot().payload).toEqual({ error: 'nope' });
  });

  it('roleOrPermission accepts permission match', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.delete' });
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(subject).givePermission('articles.delete');

    const auth = factory<Lex>(rbac, { resolveSubject: () => subject });
    const preHandler = auth.roleOrPermission('admin', 'articles.delete');

    const { reply, snapshot } = makeReply();
    await preHandler({}, reply);
    expect(snapshot().lastCode).toBeUndefined();
  });

  it('rethrows non-RBAC errors', async () => {
    const rbac = makeRbac();
    const boom = new Error('boom');
    const auth = factory<Lex>(rbac, {
      resolveSubject: () => {
        throw boom;
      },
    });
    const preHandler = auth.role('admin');

    const { reply } = makeReply();
    await expect(preHandler({}, reply)).rejects.toBe(boom);
  });
});
