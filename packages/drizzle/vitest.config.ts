import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Resolve `@rbac-ts/core` (and its sub-exports) to the workspace source rather
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
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      thresholds: {
        autoUpdate: true,
        lines: 72.19,
        statements: 72.19,
        functions: 77.5,
        branches: 70.73,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@rbac-ts\/core\/testing$/,
        replacement: `${coreSrc}/testing/index.ts`,
      },
      {
        find: /^@rbac-ts\/core$/,
        replacement: `${coreSrc}/index.ts`,
      },
    ],
  },
});
