/**
 * drizzle-kit configuration (TIN-3817 slice S1).
 *
 * GENERATE ONLY. `drizzle-kit push` is forbidden by TIN-3817 and is absent
 * from every Justfile recipe and every package.json script — `just db-check`
 * greps for it and `migrations.test.ts` asserts it inside `just check`, so the
 * ban is enforced rather than documented.
 *
 * `drizzle-kit migrate` is also unused: it takes no advisory lock and does not
 * fail closed on a changed historical hash, both of which spec §6 requires.
 * The applier is `src/lib/server/db/migrate.ts`.
 *
 * No credential is baked here. `dbCredentials` reads the runtime name
 * `DATABASE_URL`, and every recipe this repository ships (`generate`, `check`)
 * is offline and never dereferences it.
 *
 * The schema list is explicit rather than a broad glob. That keeps each
 * bounded context independently reviewable while making every table part of
 * the one generated migration graph. Adding another schema module is a
 * deliberate config diff, not an accidental filesystem discovery.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: ['./src/lib/server/db/schema.ts', './src/lib/server/inventory/schema.ts'],
	out: './drizzle',
	casing: 'snake_case',
	strict: true,
	verbose: true,
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
	},
});
