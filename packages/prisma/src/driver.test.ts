/**
 * Conformance suite for {@link PrismaDriver}.
 *
 * Test-DB strategy:
 * - At module init we ensure a Prisma client is generated against our schema
 *   fragment. The generated client lives at `<package>/test-fixture/generated/`
 *   and is created lazily if missing (so a fresh checkout works without a
 *   manual prep step).
 * - Per test, we create a fresh SQLite database in `os.tmpdir()`, run
 *   `prisma db push` against it to install the schema, then instantiate a
 *   `PrismaClient` pointed at that file via `datasourceUrl`.
 * - Teardown disconnects the client and unlinks the DB file.
 *
 * Why not raw `CREATE TABLE` via `$executeRawUnsafe`? Going through
 * `prisma db push` exercises the same migration path real users will run,
 * which catches schema-fragment mistakes (column name typos, broken FKs)
 * that a hand-written SQL fallback would mask.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConformanceSuite } from '@rbac-node/core/testing';

import { PrismaDriver, type PrismaRbacClient } from './driver.js';

// ─── Paths ──────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const fragmentPath = path.join(pkgRoot, 'prisma', 'rbac.prisma');
const fixtureDir = path.join(pkgRoot, 'test-fixture');
const fixtureSchemaPath = path.join(fixtureDir, 'schema.prisma');
const generatedDir = path.join(fixtureDir, 'generated');
const prismaBin = path.join(pkgRoot, 'node_modules', '.bin', 'prisma');

// ─── One-time setup: generate client ────────────────────────────────────────

ensureFixtureSchema();
ensureGeneratedClient();

/**
 * Write the combined schema (sqlite + generator + rbac fragment) to the
 * fixture path if it doesn't already exist or is stale. Stable file path
 * keeps the generated client cached across runs.
 */
function ensureFixtureSchema(): void {
  const fragment = readFileSync(fragmentPath, 'utf8');
  const schema = [
    'generator client {',
    '  provider = "prisma-client-js"',
    '  output   = "./generated"',
    '}',
    '',
    'datasource db {',
    '  provider = "sqlite"',
    '  url      = env("RBAC_PRISMA_TEST_DATABASE_URL")',
    '}',
    '',
    fragment,
  ].join('\n');

  if (!existsSync(fixtureDir)) mkdirSync(fixtureDir, { recursive: true });

  let needsWrite = true;
  if (existsSync(fixtureSchemaPath)) {
    const existing = readFileSync(fixtureSchemaPath, 'utf8');
    needsWrite = existing !== schema;
  }
  if (needsWrite) writeFileSync(fixtureSchemaPath, schema);
}

function ensureGeneratedClient(): void {
  // If the generated client exists and the schema hasn't changed (matching
  // file content already written above) we can skip the slow `generate`.
  const generatedMarker = path.join(generatedDir, 'index.js');
  if (existsSync(generatedMarker)) return;

  execFileSync(prismaBin, ['generate', `--schema=${fixtureSchemaPath}`], {
    stdio: 'inherit',
    cwd: pkgRoot,
  });
}

// ─── Per-test factory ───────────────────────────────────────────────────────

type GeneratedModule = {
  PrismaClient: new (options?: {
    datasourceUrl?: string;
    log?: ReadonlyArray<string>;
  }) => PrismaRbacClient & { $disconnect(): Promise<void> };
};

async function loadPrismaClient(): Promise<GeneratedModule['PrismaClient']> {
  // The generated client is plain CommonJS — `import()` returns an interop
  // wrapper. Pull the named export.
  const mod = (await import(path.join(generatedDir, 'index.js'))) as GeneratedModule;
  return mod.PrismaClient;
}

const PrismaClientPromise = loadPrismaClient();

async function createDriver(): Promise<{
  driver: PrismaDriver;
  teardown: () => Promise<void>;
}> {
  const PrismaClient = await PrismaClientPromise;

  const dbFile = path.join(os.tmpdir(), `rbac-prisma-test-${randomBytes(8).toString('hex')}.db`);

  // Push the schema against this fresh DB. Use --skip-generate (we already
  // have a generated client) and --accept-data-loss (the DB is empty
  // anyway). Suppress stdout/stderr unless the call fails — keeps test
  // output readable.
  try {
    execFileSync(
      prismaBin,
      ['db', 'push', `--schema=${fixtureSchemaPath}`, '--skip-generate', '--accept-data-loss'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: pkgRoot,
        env: {
          ...process.env,
          RBAC_PRISMA_TEST_DATABASE_URL: `file:${dbFile}`,
        },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`prisma db push failed for ${dbFile}: ${msg}`);
  }

  const client = new PrismaClient({ datasourceUrl: `file:${dbFile}` });

  const driver = new PrismaDriver(client);

  return {
    driver,
    teardown: async () => {
      await client.$disconnect();
      try {
        unlinkSync(dbFile);
      } catch {
        // best-effort
      }
    },
  };
}

runConformanceSuite({
  name: 'PrismaDriver',
  createDriver,
});
