/**
 * D1 schema fragment. Applied at runtime via `db.exec(SCHEMA_SQL)` or at
 * deploy time via `wrangler d1 migrations apply` (the same DDL is shipped
 * as `migrations/0001_init.sql` in this package).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_idx ON permissions(name);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_idx ON roles(name);

CREATE TABLE IF NOT EXISTS model_has_permissions (
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  model_key TEXT NOT NULL,
  PRIMARY KEY (permission_id, model_type, model_key)
);
CREATE INDEX IF NOT EXISTS mhp_model_idx ON model_has_permissions(model_type, model_key);

CREATE TABLE IF NOT EXISTS model_has_roles (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  model_key TEXT NOT NULL,
  PRIMARY KEY (role_id, model_type, model_key)
);
CREATE INDEX IF NOT EXISTS mhr_model_idx ON model_has_roles(model_type, model_key);

CREATE TABLE IF NOT EXISTS role_has_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
`;
