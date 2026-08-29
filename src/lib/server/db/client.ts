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
		pool = new pg.Pool({
			connectionString: resolveConnectionString(),
			// Pin the wire format for timestamps (TIN-3817 S2, PR #175 review;
			// corrected TIN-4217 — the previous version of this comment had the
			// safety claim BACKWARDS and is exactly the kind of line that invites
			// removing a pin that is still load-bearing).
			//
			// This option only sets what a NEW connection's `datestyle` starts as.
			// It is real defence against a ROLE- or DATABASE-level default (e.g.
			// `ALTER ROLE gftb_app SET datestyle = 'SQL, DMY'`), which Postgres
			// applies before a client's own startup options, so this pin wins over
			// it. It is NOT a defence against a `SET`/`SET LOCAL datestyle` issued
			// LATER in an already-open session or transaction — that is a strictly
			// later configuration layer and overrides this one on the same
			// connection. TIN-4217 measured exactly that vector against real
			// PostgreSQL: `SET LOCAL datestyle TO 'SQL, DMY'` inside a transaction
			// made a naive session timestamp render as `DD/MM/YYYY`, which both
			// this module's own parser AND the vendored adapter's internal expiry
			// check misread as a valid-but-wrong PAST date on ~12 days of every
			// month — NOT the "fails closed on unparseable" outcome the old
			// comment here promised, and NOT something this pool-level option
			// prevents.
			//
			// The actual safety mechanisms now are (1) `validateSession`'s
			// liveness verdict, which is SQL-native and does not depend on
			// `datestyle` at all (src/lib/server/auth/session.ts,
			// `sessionExpiryVerdict`), and (2) `PIN_ISO_DATESTYLE_SQL`
			// (src/lib/server/auth/adapter.ts), a transaction-local re-pin issued
			// immediately before the one remaining call that still requires a
			// client-side parse of a naive timestamp (the vendored adapter's own
			// `getSession`). This pool option is defence in depth for the common
			// case and for availability — a role/database DateStyle slip no
			// longer needs to be diagnosed as "why do all timestamps look wrong" —
			// it is not, and was never sufficient to be, the safety mechanism.
			options: '-c datestyle=ISO',
		});
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
