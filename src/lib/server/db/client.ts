/**
 * The Drizzle client and the pool behind it (TIN-3817 slice S1).
 *
 * Nothing outside `src/lib/server/db/**` may import `getPool` or `getDb`
 * directly — `eslint.config.ts` turns that into an error. Application code
 * goes through `withTenant(tenantId, fn)` in `./tenant.ts`, which is the only
 * place that sets the `app.tenant_id` GUC. That restriction is the whole
 * reason the exports below are named rather than defaulted: a lint rule can
 * name an import, it cannot name a default.
 *
 * NO CREDENTIALS LIVE HERE. The DSN arrives at runtime under the name
 * `DATABASE_URL`, supplied by `great-falls-tool-bus-infra`. This repository is
 * public; it learns the name and never the value (ADR 0014 §0.2).
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * A transaction handle. This is the type S2 hands to
 * `createPgStorageAdapter({ db })` — see the DI note in `./tenant.ts`.
 */
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

let pool: pg.Pool | undefined;
let db: Db | undefined;

/**
 * Resolve the connection string by NAME. Absent or empty is a hard error
 * rather than a silent localhost default — a migrator or worker that quietly
 * pointed at the wrong database would be worse than one that refuses to start.
 */
export function resolveConnectionString(env: NodeJS.ProcessEnv = process.env): string {
	const dsn = env.DATABASE_URL?.trim();
	if (!dsn) {
		throw new Error('DATABASE_URL is not set. The apply plane (great-falls-tool-bus-infra) supplies it at runtime.');
	}
	return dsn;
}

/**
 * The process-wide pool. Lazily constructed so importing this module in a
 * unit test or a build step never opens a socket.
 */
export function getPool(): pg.Pool {
	if (!pool) {
		pool = new pg.Pool({ connectionString: resolveConnectionString() });
	}
	return pool;
}

/** The process-wide Drizzle client. Prefer `withTenant`. */
export function getDb(): Db {
	if (!db) {
		db = drizzle(getPool(), { schema });
	}
	return db;
}

/**
 * Build a Drizzle client over a caller-supplied pool or client. This is the
 * seam the integration suite uses to talk to a testcontainer, and the seam a
 * future second connection (a read replica, a narrower role) would use.
 */
export function createDb(connection: pg.Pool | pg.Client): Db {
	return drizzle(connection as pg.Pool, { schema });
}

/** Close the pool. Called by the worker/migrator on shutdown and by tests. */
export async function closeDb(): Promise<void> {
	const current = pool;
	pool = undefined;
	db = undefined;
	if (current) await current.end();
}

export { schema };
