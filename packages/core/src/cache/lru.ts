import { LRUCache } from 'lru-cache';
import type { RbacCache } from './types.js';

export type LruCacheOptions = {
  /** Maximum number of entries held in memory. Default: 5000. */
  max?: number | undefined;
  /** Default TTL for entries in seconds. Omit for no expiry. */
  ttlSeconds?: number | undefined;
};

// lru-cache's value type must extend `{}` (non-nullish). All rbac-node cache
// entries are arrays or objects, so `object` is the right constraint here.
type LruValue = object;

export function createLruCache(options: LruCacheOptions = {}): RbacCache {
  const max = options.max ?? 5000;
  const lru =
    options.ttlSeconds !== undefined
      ? new LRUCache<string, LruValue>({
          max,
          ttl: options.ttlSeconds * 1000,
          ttlAutopurge: true,
        })
      : new LRUCache<string, LruValue>({ max });

  return {
    async get<T>(key: string): Promise<T | null> {
      const value = lru.get(key);
      if (value === undefined) return null;
      return value as T;
    },

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      const stored = value as unknown as LruValue;
      if (ttlSeconds !== undefined) {
        lru.set(key, stored, { ttl: ttlSeconds * 1000 });
      } else {
        lru.set(key, stored);
      }
    },

    async delete(key: string): Promise<void> {
      lru.delete(key);
    },

    async invalidate(prefix?: string): Promise<void> {
      if (prefix === undefined) {
        lru.clear();
        return;
      }
      for (const key of lru.keys()) {
        if (key.startsWith(prefix)) lru.delete(key);
      }
    },
  };
}
