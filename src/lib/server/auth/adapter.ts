/**
 * The storage-adapter DI seam (TIN-3817 slice S2) — module-internal.
 *
 * THIS FILE IS THE WHOLE OF FIX A (spec §1.3, finding B3). `withTenant`
 * opens a transaction and issues `set_config('app.tenant_id', $1, true)`
 * inside it; `SET LOCAL` is scoped to that transaction on that connection.
 * `createNodePgStorageAdapter()` would build and own its OWN pool, whose
 * connections never see the GUC — under FORCE ROW LEVEL SECURITY that is a
 * total, silent auth outage (`getUser` → null, `createUser` → WITH CHECK
 * violation). So the adapter is constructed PER UNIT OF WORK over the
 * transaction handle `withTenant` hands out, and there is no adapter
 * singleton anywhere in this repository.
 *
 * ON THE CAST BELOW, precisely, because spec §4 bans casts as COMPATIBILITY
 * proof: the cast is not the proof. The proof is the committed integration
 * test (`auth.integration.test.ts` "compatibility proof" rows), which creates
 * and reads a tenant-scoped user through this exact seam and fails if the GUC
 * never reaches the adapter's connection. What the cast bridges is a nominal
 * type gap, not a version gap: the adapter's `Database` union names whole
 * drizzle client classes (`NodePgDatabase<adapter schema>`), while
 * `withTenant` hands out a `PgTransaction` over the app schema.
 * `dist/adapter.js` assigns `this.db = config.db` verbatim and calls exactly
 * `select/insert/update/delete` on it (plus `execute` in `init()`, which this
 * repository never calls); a drizzle transaction carries all of those with
 * node-postgres result types, and the compile-time `Pick` proof right above
 * the cast pins that surface so a drizzle upgrade that changed it would fail
 * `just typecheck` here rather than at runtime.
 *
 * SINGLE DOOR: nothing outside `src/lib/server/auth/**` may import this
 * module or either auth package — `eslint.config.ts` makes both an error, and
 * `fence.test.ts` re-asserts it by scanning the tree.
 */

import { createPgStorageAdapter, type Database, type PgStorageAdapter } from '@tummycrypt/tinyland-auth-pg';
import type { DbTransaction } from '$lib/server/db/client';
import { FORBIDDEN_ADAPTER_METHODS, type ForbiddenAdapterMethod } from './fence';

/**
 * NAIVE TIMESTAMPS IN THE `auth.*` TABLES ARE UTC — a contract this module
 * has to state and enforce at its own boundary, because nothing lower down
 * will. The vendored tables are the only naive-`timestamp` columns we have
 * (house style is `timestamptz`); the adapter writes
 * `new Date().toISOString()` into them, so PostgreSQL stores the UTC wall
 * clock — but the string it reads back carries no zone, and JavaScript's
 * `new Date('2026-08-20 04:13:21')` interprets it as LOCAL time. On any
 * process not running in UTC, every session `createdAt`/`expires` shifts by
 * the UTC offset: sessions "created in the future", expiry mis-timed by hours
 * in either direction, reauth freshness always-stale or always-fresh. Found
 * by the S2 integration suite running in America/New_York; CNPG and the pods
 * run UTC, which would have hidden it until the first non-UTC process.
 *
 * A `pg.types.setTypeParser(1114, …)` fix does NOT work here: drizzle's
 * node-postgres session requests timestamps as raw strings (it supplies its
 * own type parsers) and maps them itself, so the adapter's reads bypass any
 * pg-global parser. Hence `parseDbInstant` + `normalizeSessionInstants`,
 * applied in session.ts/reauth.ts to every session that crosses OUR seam.
 *
 * Residual, flagged rather than fixed: the adapter's own INTERNAL expiry
 * check (`getSession` compares `session.expires` to now before we ever see
 * the row) still does the local-time parse. West of UTC that check fires
 * LATE and our own expiry enforcement in `validateSession` wins; east of UTC
 * the adapter would delete sessions EARLY — annoying, not unsafe (fails
 * closed). Production runs UTC end to end; recorded in the PR for the
 * upstream fix.
 */
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Parse a timestamp the adapter handed back, treating zoneless as UTC. */
export function parseDbInstant(value: string | Date): Date {
	if (value instanceof Date) return value;
	const trimmed = value.trim();
	if (NAIVE_TIMESTAMP.test(trimmed)) return new Date(`${trimmed.replace(' ', 'T')}Z`);
	return new Date(trimmed);
}

/** ISO-normalize a timestamp field; leaves unparseable input untouched. */
export function toUtcIso(value: string | Date): string {
	const parsed = parseDbInstant(value);
	return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

/**
 * Session TTL handed to every adapter construction, stated rather than
 * inherited so the number is visible in this repository (it matches the
 * package default). Not a ratified figure; a future sitting can move it
 * without a migration — it only affects newly created rows.
 *
 * SEMANTICS, PRECISELY (PR #175 review, LOW): this is a PER-SESSION-ROW
 * lifetime, which composes with reauth rotation into a SLIDING WINDOW, not a
 * maximum session age — every reauthentication mints a fresh row with a
 * fresh 7 days, so a user who performs a sensitive action weekly never
 * re-logs-in. Related: an ordinary login IS fresh reauth for the first
 * REAUTH_WINDOW_MS. Both are defensible and standard; both are POLICY calls
 * flagged to sitting #2 alongside the reauth window, not ratified here.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The complete method surface `PgStorageAdapter` uses on the injected `db`
 * (verified against `dist/adapter.js` at 0.2.4: `select`, `insert`, `update`,
 * `delete` in every method body; `execute` only in `init()`).
 */
type AdapterDbSurface = Pick<
	Extract<Database, { transaction: unknown }>,
	'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/**
 * Compile-time half of the compatibility proof: the transaction handle must
 * structurally satisfy every method the adapter calls. If a drizzle or
 * adapter upgrade breaks this, the error surfaces HERE, named, instead of as
 * a runtime miss inside the package.
 */
type Satisfies<T extends U, U> = T;
type _TxCarriesTheAdapterSurface = Satisfies<
	Pick<DbTransaction, 'select' | 'insert' | 'update' | 'delete' | 'execute'>,
	AdapterDbSurface
>;

/**
 * The adapter as this repository is allowed to see it: the forbidden method
 * surface removed at the TYPE level, so a call site fails `just typecheck` —
 * the adversarial review's exact bypass (`adapterFor(tx).getPendingInvitations`)
 * is now a compile error before it is anything else.
 */
export type FencedAdapter = Omit<PgStorageAdapter, ForbiddenAdapterMethod>;

/**
 * Construct the tenant-scoped storage adapter over the transaction handle
 * `withTenant` provided. One adapter per unit of work, by design — see the
 * module comment. The GUC pinned inside `tx` is the belt; the `tenantId`
 * every adapter method takes as its first argument is the suspenders.
 *
 * THE RETURNED ADAPTER IS FENCED AT RUNTIME, not only in types. The Proxy
 * throws on ANY access to a forbidden method name — including
 * `(adapter as never)['getTOTPSecret']`, a renamed alias, or a dynamic
 * string, none of which a static scan or a type can see. This is the layer
 * that makes the §0.7 fence bind the reachable surface rather than the
 * import graph (PR #175 adversarial review, HIGH finding).
 */
export function adapterFor(tx: DbTransaction): FencedAdapter {
	// _TxCarriesTheAdapterSurface (above) is the typed license for this cast.
	const adapter = createPgStorageAdapter({
		db: tx as unknown as Database,
		sessionMaxAge: SESSION_TTL_MS,
	});
	return new Proxy(adapter, {
		get(target, property, receiver) {
			if (typeof property === 'string' && (FORBIDDEN_ADAPTER_METHODS as readonly string[]).includes(property)) {
				throw new Error(
					`auth fence: PgStorageAdapter.${property} is forbidden for Member v0 ` +
						'(spec §4; executable-slices §0.7 — the fence, not the version pin, is the safety mechanism)',
				);
			}
			const value = Reflect.get(target, property, receiver);
			// Bind methods to the real adapter so its own `this.db` lookups do not
			// re-enter this trap.
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as FencedAdapter;
}
