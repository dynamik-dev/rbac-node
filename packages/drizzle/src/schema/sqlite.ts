import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema bundle for `@rbac-node/drizzle`.
 *
 * Tables follow Spatie's `laravel-permission` column naming so a Laravel-side
 * data migration is straightforward.
 */
export function defineRbacSchema() {
  const permissions = sqliteTable(
    'permissions',
    {
      id: text('id').primaryKey().notNull(),
      name: text('name').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    },
    (t) => [uniqueIndex('permissions_name_idx').on(t.name)],
  );

  const roles = sqliteTable(
    'roles',
    {
      id: text('id').primaryKey().notNull(),
      name: text('name').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    },
    (t) => [uniqueIndex('roles_name_idx').on(t.name)],
  );

  const modelHasPermissions = sqliteTable(
    'model_has_permissions',
    {
      permissionId: text('permission_id')
        .notNull()
        .references(() => permissions.id, { onDelete: 'cascade' }),
      modelType: text('model_type').notNull(),
      modelKey: text('model_key').notNull(),
    },
    (t) => [
      primaryKey({
        columns: [t.permissionId, t.modelType, t.modelKey],
      }),
      index('mhp_model_idx').on(t.modelType, t.modelKey),
    ],
  );

  const modelHasRoles = sqliteTable(
    'model_has_roles',
    {
      roleId: text('role_id')
        .notNull()
        .references(() => roles.id, { onDelete: 'cascade' }),
      modelType: text('model_type').notNull(),
      modelKey: text('model_key').notNull(),
    },
    (t) => [
      primaryKey({
        columns: [t.roleId, t.modelType, t.modelKey],
      }),
      index('mhr_model_idx').on(t.modelType, t.modelKey),
    ],
  );

  const roleHasPermissions = sqliteTable(
    'role_has_permissions',
    {
      roleId: text('role_id')
        .notNull()
        .references(() => roles.id, { onDelete: 'cascade' }),
      permissionId: text('permission_id')
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
