import type { RbacCache } from './types.js';

/**
 * A cache that doesn't cache. Useful in tests, or when you want to disable
 * caching while keeping the surface API uniform.
 */
export function createNoopCache(): RbacCache {
  return {
    async get() {
      return null;
    },
    async set() {
      /* noop */
    },
    async delete() {
      /* noop */
    },
    async invalidate() {
      /* noop */
    },
  };
}
