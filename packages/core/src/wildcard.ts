export type WildcardConfig = {
  readonly enabled: boolean;
  readonly separator: string;
};

export const DEFAULT_WILDCARD_CONFIG: WildcardConfig = {
  enabled: true,
  separator: '.',
};

/**
 * Match a stored permission name (which may contain wildcards) against a
 * requested concrete name. Semantics:
 *
 *   stored "articles.*"    matches requested "articles.create" but not "articles.create.draft"
 *   stored "*.delete"      matches requested "articles.delete", "users.delete", ...
 *   stored "articles.**"   matches any name starting with "articles." (deep wildcard)
 *   stored "articles.edit" matches only "articles.edit" exactly
 *
 * When the config is disabled, this collapses to strict equality.
 */
export function matchesWildcard(
  stored: string,
  requested: string,
  config: WildcardConfig = DEFAULT_WILDCARD_CONFIG,
): boolean {
  if (!config.enabled) return stored === requested;
  if (stored === requested) return true;

  const sep = config.separator;
  const storedParts = stored.split(sep);
  const requestedParts = requested.split(sep);

  for (let i = 0; i < storedParts.length; i++) {
    const sPart = storedParts[i];

    if (sPart === '**') {
      // Deep wildcard must consume at least one remaining requested segment.
      return i < requestedParts.length;
    }

    if (i >= requestedParts.length) return false;
    const rPart = requestedParts[i];

    if (sPart === '*') continue;
    if (sPart !== rPart) return false;
  }

  return storedParts.length === requestedParts.length;
}
