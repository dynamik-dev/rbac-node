import { describe, expect, it } from 'vitest';

import { InMemoryDriver } from './drivers/memory.js';
import { PermissionDoesNotExistError, RoleDoesNotExistError } from './errors.js';
import { Rbac } from './rbac.js';

type Perms = 'articles.create' | 'articles.edit' | 'articles.delete' | 'articles.*';
type Roles = 'admin' | 'editor' | 'viewer';

const makeRbac = (overrides: Partial<ConstructorParameters<typeof Rbac>[0]> = {}) =>
  new Rbac<{ permissions: Perms; roles: Roles }>({
    driver: new InMemoryDriver(),
    ...overrides,
  });

const user = (id: string) => ({ type: 'User', key: id });

describe('Rbac — permissions API', () => {
  it('creates a permission', async () => {
    const rbac = makeRbac();
    const p = await rbac.permissions.create({ name: 'articles.create' });
    expect(p.name).toBe('articles.create');
    expect(p.id).toBeTruthy();
  });

  it('rejects creating duplicates by name', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.create' });
    await expect(rbac.permissions.create({ name: 'articles.create' })).rejects.toBeTruthy();
  });
});

describe('Rbac — roles API', () => {
  it('creates a role with attached permissions', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.create' });
    await rbac.permissions.create({ name: 'articles.edit' });

    const role = await rbac.roles.create({
      name: 'editor',
      permissions: ['articles.create', 'articles.edit'],
    });

    const perms = await rbac.roles.getPermissions(role);
    expect(perms.map((p) => p.name).sort()).toEqual(['articles.create', 'articles.edit']);
  });

  it('throws when an unknown permission is referenced by name', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'editor' });
    await expect(rbac.roles.givePermissions('editor', ['articles.create'])).rejects.toBeInstanceOf(
      PermissionDoesNotExistError,
    );
  });
});

describe('Rbac — subject authorizer', () => {
  it('checks roles and permissions', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.create' });
    await rbac.roles.create({ name: 'editor', permissions: ['articles.create'] });

    const subject = user('1');
    await rbac.for(subject).assignRole('editor');

    expect(await rbac.for(subject).hasRole('editor')).toBe(true);
    expect(await rbac.for(subject).hasRole('admin')).toBe(false);
    expect(await rbac.for(subject).hasPermission('articles.create')).toBe(true);
    expect(await rbac.for(subject).hasPermission('articles.edit')).toBe(false);
  });

  it('hasAnyRole / hasAllRoles / hasExactRoles', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.roles.create({ name: 'editor' });
    await rbac.roles.create({ name: 'viewer' });

    const subject = user('1');
    await rbac.for(subject).assignRole(['admin', 'editor']);

    expect(await rbac.for(subject).hasAnyRole(['admin', 'viewer'])).toBe(true);
    expect(await rbac.for(subject).hasAllRoles(['admin', 'editor'])).toBe(true);
    expect(await rbac.for(subject).hasAllRoles(['admin', 'viewer'])).toBe(false);
    expect(await rbac.for(subject).hasExactRoles(['admin', 'editor'])).toBe(true);
    expect(await rbac.for(subject).hasExactRoles(['admin'])).toBe(false);
  });

  it('direct vs via-role permissions', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.create' });
    await rbac.permissions.create({ name: 'articles.edit' });
    await rbac.roles.create({ name: 'editor', permissions: ['articles.create'] });

    const subject = user('1');
    await rbac.for(subject).assignRole('editor');
    await rbac.for(subject).givePermission('articles.edit');

    expect(await rbac.for(subject).hasDirectPermission('articles.create')).toBe(false);
    expect(await rbac.for(subject).hasDirectPermission('articles.edit')).toBe(true);
    expect(await rbac.for(subject).hasPermission('articles.create')).toBe(true); // via role
    expect(await rbac.for(subject).hasPermission('articles.edit')).toBe(true); // direct

    const all = await rbac.for(subject).getPermissionNames();
    expect(all.sort()).toEqual(['articles.create', 'articles.edit']);
  });

  it('removeRole and syncRoles', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.roles.create({ name: 'editor' });

    const subject = user('1');
    await rbac.for(subject).assignRole(['admin', 'editor']);
    await rbac.for(subject).removeRole('admin');
    expect(await rbac.for(subject).getRoleNames()).toEqual(['editor']);

    await rbac.for(subject).syncRoles(['admin']);
    expect(await rbac.for(subject).getRoleNames()).toEqual(['admin']);
  });

  it('hasPermission returns false for an unknown permission name rather than throwing', async () => {
    const rbac = makeRbac();
    expect(await rbac.for(user('1')).hasPermission('articles.create')).toBe(false);
  });

  it('throws when assigning a role that does not exist', async () => {
    const rbac = makeRbac();
    await expect(rbac.for(user('1')).assignRole('admin')).rejects.toBeInstanceOf(
      RoleDoesNotExistError,
    );
  });
});

describe('Rbac — wildcards', () => {
  it('matches wildcard permissions stored on a subject', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.*' });

    const subject = user('1');
    await rbac.for(subject).givePermission('articles.*');

    expect(await rbac.for(subject).hasPermission('articles.create')).toBe(true);
    expect(await rbac.for(subject).hasPermission('articles.edit')).toBe(true);
    expect(await rbac.for(subject).hasPermission('articles.delete')).toBe(true);
  });
});

describe('Rbac — query scopes', () => {
  it('finds subjects with a role', async () => {
    const rbac = makeRbac();
    await rbac.roles.create({ name: 'admin' });
    await rbac.for(user('1')).assignRole('admin');
    await rbac.for(user('2')).assignRole('admin');
    // user 3 has no role

    const subjects = await rbac.findSubjectsWithRole('User', 'admin');
    expect(subjects.map((s) => s.key).sort()).toEqual(['1', '2']);
  });

  it('finds subjects with a permission (direct or via role)', async () => {
    const rbac = makeRbac();
    await rbac.permissions.create({ name: 'articles.create' });
    await rbac.roles.create({ name: 'admin', permissions: ['articles.create'] });

    await rbac.for(user('1')).assignRole('admin');
    await rbac.for(user('2')).givePermission('articles.create');

    const subjects = await rbac.findSubjectsWithPermission('User', 'articles.create');
    expect(subjects.map((s) => s.key).sort()).toEqual(['1', '2']);
  });
});
