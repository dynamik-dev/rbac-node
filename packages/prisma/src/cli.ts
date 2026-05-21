#!/usr/bin/env node

/**
 * `rbac-node-prisma` — tiny CLI for bootstrapping the schema fragment.
 *
 * Usage:
 *   npx rbac-node-prisma init
 *
 * Copies this package's `prisma/rbac.prisma` to `<cwd>/prisma/rbac.prisma`
 * so the user can paste the model blocks into their `schema.prisma`.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'init') {
    printUsage();
    process.exit(1);
  }

  // Resolve this file's location and find the bundled fragment. After tsup
  // build the CLI lives at `dist/cli.js`; the fragment ships at
  // `prisma/rbac.prisma` next to `dist/`. In dev (running from `src/`) the
  // same `../prisma/rbac.prisma` relative path resolves correctly because
  // `src/` and `dist/` are siblings.
  const selfPath = fileURLToPath(import.meta.url);
  const selfDir = path.dirname(selfPath);
  const fragmentPath = path.resolve(selfDir, '..', 'prisma', 'rbac.prisma');

  // Sanity-check the file exists; if not, give the user a useful error
  // instead of a stack trace.
  try {
    await readFile(fragmentPath, 'utf8');
  } catch {
    console.error(
      `Could not locate the bundled rbac.prisma fragment at ${fragmentPath}.\n` +
        'Reinstall @rbac-node/prisma or report this as a bug.',
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const targetDir = path.join(cwd, 'prisma');
  const targetPath = path.join(targetDir, 'rbac.prisma');

  if (existsSync(targetPath)) {
    console.error(
      `Refusing to overwrite existing file: ${targetPath}.\n` +
        'Remove it first or copy the changes you want manually.',
    );
    process.exit(1);
  }

  await mkdir(targetDir, { recursive: true });
  await copyFile(fragmentPath, targetPath);

  console.log(`Created ${targetPath}.`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Copy the model blocks from `prisma/rbac.prisma` into your `schema.prisma`.');
  console.log('  2. Run `prisma migrate dev --name rbac` (or `prisma db push` for SQLite/dev).');
  console.log('  3. Run `prisma generate` so the client picks up the new models.');
  console.log('  4. Instantiate the driver:');
  console.log("       import { PrismaDriver } from '@rbac-node/prisma';");
  console.log("       import { Rbac } from '@rbac-node/core';");
  console.log('       const rbac = new Rbac({ driver: new PrismaDriver(prisma) });');
}

function printUsage(): void {
  console.error('Usage: rbac-node-prisma init');
  console.error('');
  console.error('Commands:');
  console.error('  init    Copy `prisma/rbac.prisma` into the current project.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
