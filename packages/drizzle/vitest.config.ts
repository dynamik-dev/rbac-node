import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Resolve `@rbac-node/core` (and its sub-exports) to the workspace source rather
// than the built `dist/`. The published dist bundles vitest, which would
// register `describe`/`it` against a frozen module instance that the current
// vitest runner does not control — leaving the conformance suite invisible.
// Pointing at the source restores live test registration.
const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: [
      {
        find: /^@rbac-node\/core\/testing$/,
        replacement: `${coreSrc}/testing/index.ts`,
      },
      {
        find: /^@rbac-node\/core$/,
        replacement: `${coreSrc}/index.ts`,
      },
    ],
  },
});
