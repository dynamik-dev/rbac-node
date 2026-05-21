export type RbacCache = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Remove every entry whose key starts with `prefix`. With no prefix, clears the cache.
   */
  invalidate(prefix?: string): Promise<void>;
};
