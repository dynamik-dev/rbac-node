/**
 * Brand a primitive so two ids that share the same shape don't accidentally cross.
 * Zero runtime cost — the compiler enforces nominal identity.
 */
export type Brand<T, B> = T & { readonly __brand: B };

export type PermissionId = Brand<string, 'PermissionId'>;
export type RoleId = Brand<string, 'RoleId'>;

/**
 * A reference to any model that can hold roles or permissions.
 * Matches Spatie's polymorphic columns `model_type` + `model_morph_key`.
 *
 * `key` is the stringified primary key so int, bigint, uuid, and ulid all work.
 */
export type Subject = {
  readonly type: string;
  readonly key: string;
};

export type Permission = {
  readonly id: PermissionId;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type Role = {
  readonly id: RoleId;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CreatePermissionInput = {
  readonly name: string;
};

export type CreateRoleInput = {
  readonly name: string;
};

export type PermissionFilter = {
  readonly names?: ReadonlyArray<string>;
};

export type RoleFilter = {
  readonly names?: ReadonlyArray<string>;
};

/**
 * Lexicon — the typed string unions a consumer brings to constrain
 * permission and role names. If omitted, names widen to `string`.
 */
export type RbacLexicon = {
  readonly permissions?: string;
  readonly roles?: string;
};

export type PermName<L extends RbacLexicon> = L['permissions'] extends string
  ? L['permissions']
  : string;

export type RoleName<L extends RbacLexicon> = L['roles'] extends string ? L['roles'] : string;

/**
 * Acceptable ways to reference a permission in surface API calls — by name or by object.
 */
export type PermRef<L extends RbacLexicon> = PermName<L> | Permission;

/**
 * Acceptable ways to reference a role in surface API calls — by name or by object.
 */
export type RoleRef<L extends RbacLexicon> = RoleName<L> | Role;
