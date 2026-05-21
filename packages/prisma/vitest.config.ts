import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = path.resolve(here, '..', 'core', 'src');

export default defineConfig({
  // Resolve `@rbac-node/core` and `@rbac-node/core/testing` to the source
  // tree, not the dist bundle. The dist bundle for `testing/` inlines
  // `vitest` (tsup doesn't externalize it by default), which gives us a
  // *second* vitest instance whose suite registrations never reach the
  // host runner — `describe(...)` ends up writing to a private Suite
  // manager and the test file reports "no test suite found". Pulling
  // from source means vitest transpiles the file in-process and uses the
  // host's `describe` / `it` / `expect`, so the conformance suite's
  // registrations land where the runner can see them.
  resolve: {
    alias: [
      {
        find: /^@rbac-node\/core\/testing$/,
        replacement: path.join(coreSrc, 'testing', 'index.ts'),
      },
      {
        find: /^@rbac-node\/core$/,
        replacement: path.join(coreSrc, 'index.ts'),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
