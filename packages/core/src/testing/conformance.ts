import { beforeEach, describe, expect, it } from 'vitest';

import type { RbacDriver } from '../driver.js';
import { Rbac } from '../rbac.js';
import type { Subject } from '../types.js';

/**
 * A driver-conformance suite. Pass a factory that returns a fresh driver per test
 * (clean state — see {@link DriverFactory}). The suite asserts the contract that
 * every {@link RbacDriver} must satisfy: uniqueness, cascading cleanup, sync vs
 * upsert semantics, and query scopes.
 *
 * Usage from a driver package:
 *
 * ```ts
 * import { runConformanceSuite } from '@rbac-ts/core/testing';
 * import { MyDriver } from '../src/driver.js';
 *
 * runConformanceSuite({
 *   name: 'MyDriver',
 *   createDriver: async () => ({ driver: new MyDriver(), teardown: async () => {} }),
 * });
 * ```
 */
export type DriverFactoryResult = {
  driver: RbacDriver;
  teardown?: () => Promise<void> | void;
};

export type DriverFactory = () => Promise<DriverFactoryResult> | DriverFactoryResult;

export type RunConformanceOptions = {
  name: string;
  createDriver: DriverFactory;
};

export function runConformanceSuite(options: RunConformanceOptions): void {
  describe(`[conformance] ${options.name}`, () => {
    let driver: RbacDriver;
    let teardown: (() => Promise<void> | void) | undefined;

    beforeEach(async () => {
      const result = await options.createDriver();
      driver = result.driver;
      teardown = result.teardown;
      return async () => {
        if (teardown) await teardown();
      };
    });

    const userSubject = (key: string): Subject => ({ type: 'User', key });

    describe('permissions', () => {
      it('creates and finds a permission by name', async () => {
        const p = await driver.createPermission({ name: 'articles.create' });
        expect(p.id).toBeTruthy();
        expect(p.name).toBe('articles.create');

        const found = await driver.findPermissionByName('articles.create');
        expect(found?.id).toBe(p.id);
      });

      it('is unique on name', async () => {
        await driver.createPermission({ name: 'articles.create' });
        await expect(driver.createPermission({ name: 'articles.create' })).rejects.toBeTruthy();
      });

      it('lists with a names filter', async () => {
        await driver.createPermission({ name: 'a' });
        await driver.createPermission({ name: 'b' });
        await driver.createPermission({ name: 'c' });

        expect((await driver.listPermissions()).length).toBe(3);
        const filtered = await driver.listPermissions({ names: ['a', 'c'] });
        expect(filtered.map((p) => p.name).sort()).toEqual(['a', 'c']);
      });

      it('cascades pivot rows on delete', async () => {
        const p = await driver.createPermission({ name: 'x' });
        const r = await driver.createRole({ name: 'admin' });
        await driver.giveRolePermissions(r.id, [p.id]);
        await driver.giveSubjectPermissions(userSubject('1'), [p.id]);

        await driver.deletePermission(p.id);

        expect(await driver.getRolePermissions(r.id)).toEqual([]);
        expect(await driver.getDirectSubjectPermissions(userSubject('1'))).toEqual([]);
      });

      describe('createPermissions (bulk)', () => {
        it('creates all when none exist', async () => {
          const result = await driver.createPermissions(['a', 'b', 'c']);
          expect(result.map((p) => p.name)).toEqual(['a', 'b', 'c']);
          expect((await driver.listPermissions()).length).toBe(3);
        });

        it('is idempotent: existing names are returned, not recreated', async () => {
          const first = await driver.createPermissions(['a', 'b']);
          const second = await driver.createPermissions(['a', 'b', 'c']);
          expect(second.map((p) => p.name)).toEqual(['a', 'b', 'c']);
          // 'a' and 'b' keep their original ids
          const aId = first.find((p) => p.name === 'a')?.id;
          const bId = first.find((p) => p.name === 'b')?.id;
          expect(second.find((p) => p.name === 'a')?.id).toBe(aId);
          expect(second.find((p) => p.name === 'b')?.id).toBe(bId);
          expect((await driver.listPermissions()).length).toBe(3);
        });

        it('deduplicates input', async () => {
          const result = await driver.createPermissions(['a', 'a', 'b', 'a']);
          expect(result.map((p) => p.name)).toEqual(['a', 'b']);
          expect((await driver.listPermissions()).length).toBe(2);
        });

        it('returns empty array for empty input', async () => {
          expect(await driver.createPermissions([])).toEqual([]);
        });
      });
    });

    describe('roles', () => {
      it('creates and finds a role by name', async () => {
        const r = await driver.createRole({ name: 'admin' });
        const found = await driver.findRoleByName('admin');
        expect(found?.id).toBe(r.id);
      });

      it('is unique on name', async () => {
        await driver.createRole({ name: 'admin' });
        await expect(driver.createRole({ name: 'admin' })).rejects.toBeTruthy();
      });

      it('cascades pivot rows on delete', async () => {
        const r = await driver.createRole({ name: 'admin' });
        const p = await driver.createPermission({ name: 'x' });
        await driver.giveRolePermissions(r.id, [p.id]);
        await driver.assignSubjectRoles(userSubject('1'), [r.id]);

        await driver.deleteRole(r.id);

        expect(await driver.getSubjectRoles(userSubject('1'))).toEqual([]);
        // role itself is gone
        expect(await driver.findRoleById(r.id)).toBeNull();
      });

      describe('createRoles (bulk)', () => {
        it('creates all when none exist', async () => {
          const result = await driver.createRoles(['admin', 'editor', 'viewer']);
          expect(result.map((r) => r.name)).toEqual(['admin', 'editor', 'viewer']);
          expect((await driver.listRoles()).length).toBe(3);
        });

        it('is idempotent: existing names are returned, not recreated', async () => {
          const first = await driver.createRoles(['admin', 'editor']);
          const second = await driver.createRoles(['admin', 'editor', 'viewer']);
          expect(second.map((r) => r.name)).toEqual(['admin', 'editor', 'viewer']);
          const adminId = first.find((r) => r.name === 'admin')?.id;
          expect(second.find((r) => r.name === 'admin')?.id).toBe(adminId);
          expect((await driver.listRoles()).length).toBe(3);
        });

        it('deduplicates input', async () => {
          const result = await driver.createRoles(['admin', 'admin', 'editor']);
          expect(result.map((r) => r.name)).toEqual(['admin', 'editor']);
          expect((await driver.listRoles()).length).toBe(2);
        });

        it('returns empty array for empty input', async () => {
          expect(await driver.createRoles([])).toEqual([]);
        });
      });
    });

    describe('role permissions', () => {
      it('give is idempotent (upsert)', async () => {
        const r = await driver.createRole({ name: 'admin' });
        const p = await driver.createPermission({ name: 'x' });
        await driver.giveRolePermissions(r.id, [p.id]);
        await driver.giveRolePermissions(r.id, [p.id]);
        expect((await driver.getRolePermissions(r.id)).length).toBe(1);
      });

      it('revoke removes the link', async () => {
        const r = await driver.createRole({ name: 'admin' });
        const p = await driver.createPermission({ name: 'x' });
        await driver.giveRolePermissions(r.id, [p.id]);
        await driver.revokeRolePermissions(r.id, [p.id]);
        expect(await driver.getRolePermissions(r.id)).toEqual([]);
      });

      it('sync replaces the entire set', async () => {
        const r = await driver.createRole({ name: 'admin' });
        const a = await driver.createPermission({ name: 'a' });
        const b = await driver.createPermission({ name: 'b' });
        const c = await driver.createPermission({ name: 'c' });
        await driver.giveRolePermissions(r.id, [a.id, b.id]);
        await driver.syncRolePermissions(r.id, [b.id, c.id]);
        const perms = await driver.getRolePermissions(r.id);
        expect(perms.map((p) => p.name).sort()).toEqual(['b', 'c']);
      });
    });

    describe('subject roles', () => {
      it('assign + read', async () => {
        const r = await driver.createRole({ name: 'admin' });
        await driver.assignSubjectRoles(userSubject('1'), [r.id]);
        const roles = await driver.getSubjectRoles(userSubject('1'));
        expect(roles.map((x) => x.id)).toEqual([r.id]);
      });

      it('sync replaces', async () => {
        const a = await driver.createRole({ name: 'a' });
        const b = await driver.createRole({ name: 'b' });
        await driver.assignSubjectRoles(userSubject('1'), [a.id]);
        await driver.syncSubjectRoles(userSubject('1'), [b.id]);
        const roles = await driver.getSubjectRoles(userSubject('1'));
        expect(roles.map((x) => x.name)).toEqual(['b']);
      });
    });

    describe('subject direct permissions', () => {
      it('give + read + revoke', async () => {
        const p = await driver.createPermission({ name: 'x' });
        await driver.giveSubjectPermissions(userSubject('1'), [p.id]);
        expect((await driver.getDirectSubjectPermissions(userSubject('1'))).length).toBe(1);
        await driver.revokeSubjectPermissions(userSubject('1'), [p.id]);
        expect((await driver.getDirectSubjectPermissions(userSubject('1'))).length).toBe(0);
      });

      it('sync replaces', async () => {
        const a = await driver.createPermission({ name: 'a' });
        const b = await driver.createPermission({ name: 'b' });
        await driver.giveSubjectPermissions(userSubject('1'), [a.id]);
        await driver.syncSubjectPermissions(userSubject('1'), [b.id]);
        const perms = await driver.getDirectSubjectPermissions(userSubject('1'));
        expect(perms.map((p) => p.name)).toEqual(['b']);
      });
    });

    describe('query scopes', () => {
      it('findSubjectsWithAnyRole returns subjects that hold any of the given roles', async () => {
        const a = await driver.createRole({ name: 'a' });
        const b = await driver.createRole({ name: 'b' });
        await driver.assignSubjectRoles(userSubject('1'), [a.id]);
        await driver.assignSubjectRoles(userSubject('2'), [b.id]);
        await driver.assignSubjectRoles(userSubject('3'), [a.id, b.id]);

        const result = await driver.findSubjectsWithAnyRole('User', [a.id]);
        expect(result.map((s) => s.key).sort()).toEqual(['1', '3']);

        const both = await driver.findSubjectsWithAnyRole('User', [a.id, b.id]);
        expect(both.map((s) => s.key).sort()).toEqual(['1', '2', '3']);
      });

      it('findSubjectsWithPermission returns direct + via-role holders, deduped', async () => {
        const p = await driver.createPermission({ name: 'x' });
        const r = await driver.createRole({ name: 'admin' });
        await driver.giveRolePermissions(r.id, [p.id]);

        // Subject 1 holds permission via role
        await driver.assignSubjectRoles(userSubject('1'), [r.id]);
        // Subject 2 holds permission directly
        await driver.giveSubjectPermissions(userSubject('2'), [p.id]);
        // Subject 3 holds both — should appear once
        await driver.assignSubjectRoles(userSubject('3'), [r.id]);
        await driver.giveSubjectPermissions(userSubject('3'), [p.id]);

        const result = await driver.findSubjectsWithPermission('User', p.id);
        expect(result.map((s) => s.key).sort()).toEqual(['1', '2', '3']);
      });
    });

    describe('integration through Rbac facade', () => {
      it('hasPermission unions direct + via-role permissions', async () => {
        const rbac = new Rbac({ driver });

        await rbac.permissions.create({ name: 'a' });
        const b = await rbac.permissions.create({ name: 'b' });
        const role = await rbac.roles.create({ name: 'editor', permissions: ['a'] });

        const subject = userSubject('1');
        await rbac.for(subject).assignRole('editor');
        await rbac.for(subject).givePermission(b);

        expect(await rbac.for(subject).hasPermission('a')).toBe(true);
        expect(await rbac.for(subject).hasPermission('b')).toBe(true);
        expect(await rbac.for(subject).hasDirectPermission('a')).toBe(false);
        expect(await rbac.for(subject).hasDirectPermission('b')).toBe(true);
        expect(await rbac.for(subject).hasRole('editor')).toBe(true);
        expect((await rbac.for(subject).getPermissionNames()).sort()).toEqual(['a', 'b']);
        expect(role.id).toBeTruthy();
      });

      it('permissions.createMany + roles.createMany are bulk and idempotent', async () => {
        const rbac = new Rbac({ driver });

        const perms = await rbac.permissions.createMany(['a', 'b', 'c']);
        expect(perms.map((p) => p.name)).toEqual(['a', 'b', 'c']);

        const reAdded = await rbac.permissions.createMany(['b', 'c', 'd']);
        expect(reAdded.map((p) => p.name)).toEqual(['b', 'c', 'd']);
        expect((await rbac.permissions.list()).length).toBe(4);

        // empty input is a no-op
        expect(await rbac.permissions.createMany([])).toEqual([]);

        const roles = await rbac.roles.createMany(['admin', 'editor']);
        expect(roles.map((r) => r.name)).toEqual(['admin', 'editor']);
        const reAddedRoles = await rbac.roles.createMany(['editor', 'viewer']);
        expect(reAddedRoles.map((r) => r.name)).toEqual(['editor', 'viewer']);
        expect((await rbac.roles.list()).length).toBe(3);
        expect(await rbac.roles.createMany([])).toEqual([]);
      });

      it('wildcard permissions match', async () => {
        const rbac = new Rbac({
          driver,
          wildcards: { enabled: true, separator: '.' },
        });
        await rbac.permissions.create({ name: 'articles.*' });
        const subject = userSubject('1');
        await rbac.for(subject).givePermission('articles.*');
        expect(await rbac.for(subject).hasPermission('articles.create')).toBe(true);
        expect(await rbac.for(subject).hasPermission('articles.edit')).toBe(true);
        expect(await rbac.for(subject).hasPermission('users.create')).toBe(false);
      });
    });
  });
}
