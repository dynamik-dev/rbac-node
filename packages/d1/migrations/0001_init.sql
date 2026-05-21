-- @rbac-node/d1 initial schema.
-- Apply with: wrangler d1 migrations apply <DATABASE_NAME>

CREATE TABLE permissions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX permissions_name_idx ON permissions(name);

CREATE TABLE roles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX roles_name_idx ON roles(name);

CREATE TABLE model_has_permissions (
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  model_key TEXT NOT NULL,
  PRIMARY KEY (permission_id, model_type, model_key)
);
CREATE INDEX mhp_model_idx ON model_has_permissions(model_type, model_key);

CREATE TABLE model_has_roles (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  model_key TEXT NOT NULL,
  PRIMARY KEY (role_id, model_type, model_key)
);
CREATE INDEX mhr_model_idx ON model_has_roles(model_type, model_key);

CREATE TABLE role_has_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
