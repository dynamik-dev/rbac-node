import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Postgres schema bundle for `@rbac-node/drizzle`.
 *
 * Tables follow Spatie's `laravel-permission` column naming so a Laravel-side
 * data migration is straightforward.
 */
export function defineRbacSchema() {
  const permissions = pgTable(
    'permissions',
    {
      id: text('id').primaryKey().notNull(),
      name: text('name').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    },
    (t) => [uniqueIndex('permissions_name_idx').on(t.name)],
  );

  const roles = pgTable(
    'roles',
    {
      id: text('id').primaryKey().notNull(),
      name: text('name').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    },
    (t) => [uniqueIndex('roles_name_idx').on(t.name)],
  );

  const modelHasPermissions = pgTable(
    'model_has_permissions',
    {
      permissionId: text('permission_id')
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

  const modelHasRoles = pgTable(
    'model_has_roles',
    {
      roleId: text('role_id')
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

  const roleHasPermissions = pgTable(
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
