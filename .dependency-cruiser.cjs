/**
 * Architecture rules for the rbac-ts monorepo.
 *
 * Tiers:
 *   - `core`        — foundation, no workspace deps
 *   - drivers       — `prisma`, `drizzle`, `d1` (depend only on core)
 *   - adapters      — `express`, `fastify`, `hono`, `koa` (depend only on core)
 *
 * Run with: `pnpm lint:deps`.
 */

const packages = ['core', 'prisma', 'drizzle', 'd1', 'express', 'fastify', 'hono', 'koa'];

const packageBoundaryRules = packages.map((pkg) => {
  if (pkg === 'core') {
    return {
      name: 'core-is-foundation',
      severity: 'error',
      comment:
        '@rbac-ts/core is the foundation — it must not depend on other workspace packages.',
      from: { path: '^packages/core/src' },
      to: { path: '^packages/(?!core/)[^/]+/src' },
    };
  }
  return {
    name: `${pkg}-only-imports-core`,
    severity: 'error',
    comment: `@rbac-ts/${pkg} may only import from @rbac-ts/core. Drivers and adapters must not depend on each other.`,
    from: { path: `^packages/${pkg}/src` },
    to: { path: `^packages/(?!core/|${pkg}/)[^/]+/src` },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...packageBoundaryRules,
    {
      name: 'no-imports-into-core-internal',
      severity: 'error',
      comment:
        'packages/core/src/internal/** is a private implementation detail of @rbac-ts/core. Use the public exports.',
      from: { path: '^packages/(?!core/)' },
      to: { path: '^packages/core/src/internal/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies indicate a layering problem — break the cycle by extracting the shared piece.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-src-imports-tests',
      severity: 'error',
      comment:
        'Production source must not import test files. Test files import the code they exercise, not the other way around.',
      from: {
        path: '^packages/[^/]+/src/',
        pathNot: '\\.(test|spec)\\.[cm]?ts$',
      },
      to: { path: '\\.(test|spec)\\.[cm]?ts$' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan modules (no incoming dependencies) may be dead code or a missing wiring.',
      from: {
        orphan: true,
        pathNot: [
          '\\.(config|test|spec)\\.[cm]?[jt]sx?$',
          '(^|/)index\\.[cm]?[jt]sx?$',
          '\\.d\\.ts$',
          '^\\.dependency-cruiser\\.cjs$',
          '^biome\\.json$',
          // Sub-path public exports (e.g. @rbac-ts/drizzle/schema/postgres).
          // Dep-cruiser doesn't read package.json `exports`, so these look
          // orphan from the file graph but are intentional entry points.
          '^packages/[^/]+/src/schema/[^/]+\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: [
        '(^|/)node_modules/',
        '(^|/)dist/',
        '(^|/)\\.turbo/',
        '(^|/)coverage/',
        '(^|/)test-fixture/',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node'],
      mainFields: ['types', 'typings', 'main', 'module'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
