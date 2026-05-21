import {
  datetime,
  index,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * MySQL schema bundle for `@rbac-node/drizzle`.
 *
 * Tables follow Spatie's `laravel-permission` column naming so a Laravel-side
 * data migration is straightforward.
 *
 * @remarks
 * All string columns are `varchar(255)`. MySQL InnoDB indexes have a key-length
 * limit that makes composite primary keys on `text` columns impractical.
 */
export function defineRbacSchema() {
  const permissions = mysqlTable(
    'permissions',
    {
      id: varchar('id', { length: 64 }).primaryKey().notNull(),
      name: varchar('name', { length: 255 }).notNull(),
      createdAt: datetime('created_at', { fsp: 3 }).notNull(),
      updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    },
    (t) => [uniqueIndex('permissions_name_idx').on(t.name)],
  );

  const roles = mysqlTable(
    'roles',
    {
      id: varchar('id', { length: 64 }).primaryKey().notNull(),
      name: varchar('name', { length: 255 }).notNull(),
      createdAt: datetime('created_at', { fsp: 3 }).notNull(),
      updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    },
    (t) => [uniqueIndex('roles_name_idx').on(t.name)],
  );

  const modelHasPermissions = mysqlTable(
    'model_has_permissions',
    {
      permissionId: varchar('permission_id', { length: 64 })
        .notNull()
        .references(() => permissions.id, { onDelete: 'cascade' }),
      modelType: varchar('model_type', { length: 255 }).notNull(),
      modelKey: varchar('model_key', { length: 255 }).notNull(),
    },
    (t) => [
      primaryKey({
        columns: [t.permissionId, t.modelType, t.modelKey],
      }),
      index('mhp_model_idx').on(t.modelType, t.modelKey),
    ],
  );

  const modelHasRoles = mysqlTable(
    'model_has_roles',
    {
      roleId: varchar('role_id', { length: 64 })
        .notNull()
        .references(() => roles.id, { onDelete: 'cascade' }),
      modelType: varchar('model_type', { length: 255 }).notNull(),
      modelKey: varchar('model_key', { length: 255 }).notNull(),
    },
    (t) => [
      primaryKey({
        columns: [t.roleId, t.modelType, t.modelKey],
      }),
      index('mhr_model_idx').on(t.modelType, t.modelKey),
    ],
  );

  const roleHasPermissions = mysqlTable(
    'role_has_permissions',
    {
      roleId: varchar('role_id', { length: 64 })
        .notNull()
        .references(() => roles.id, { onDelete: 'cascade' }),
      permissionId: varchar('permission_id', { length: 64 })
        .notNull()
        .references(() => permissions.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
  );

  return {
    permissions,
    roles,
    modelHasPermissions,
    modelHasRoles,
    roleHasPermissions,
  };
}

export type RbacTables = ReturnType<typeof defineRbacSchema>;
