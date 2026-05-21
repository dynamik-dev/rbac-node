export class RbacError extends Error {
  override name = 'RbacError';
  readonly kind: string = 'RbacError';
}

export class PermissionDoesNotExistError extends RbacError {
  override name = 'PermissionDoesNotExistError';
  override readonly kind = 'PermissionDoesNotExist' as const;

  constructor(readonly permissionName: string) {
    super(`Permission \`${permissionName}\` does not exist.`);
  }
}

export class RoleDoesNotExistError extends RbacError {
  override name = 'RoleDoesNotExistError';
  override readonly kind = 'RoleDoesNotExist' as const;

  constructor(readonly roleName: string) {
    super(`Role \`${roleName}\` does not exist.`);
  }
}

export class UnauthorizedError extends RbacError {
  override name = 'UnauthorizedError';
  override readonly kind = 'Unauthorized' as const;

  constructor(message = 'Unauthorized.') {
    super(message);
  }
}

export function isRbacError(value: unknown): value is RbacError {
  return value instanceof RbacError;
}
