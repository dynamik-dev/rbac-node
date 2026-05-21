import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

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
        lines: 93.05,
        statements: 93.05,
        functions: 90.62,
        branches: 73.46,
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
