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
 * Residual, flagged rather than fixed, and CORRECTED HERE (TIN-4217 review):
 * the adapter's own INTERNAL expiry check (`getSession` compares
 * `session.expires` to now before we ever see the row) still does the
 * local-time parse (no 'Z' appended — see `parseDbInstant` below), keyed off
 * the PROCESS's own `TZ`, not `datestyle`. The previous version of this note
 * called the east-of-UTC direction "annoying, not unsafe" — MEASURED FALSE
 * (TIN-4217 review). Reproduced directly against `dist/adapter.js`, with
 * `datestyle` correctly pinned to `'ISO'` (this PR's own fix working exactly
 * as designed) and the process at `TZ=Asia/Tokyo` (+9): a session with THREE
 * HOURS OF LIFE LEFT (`expires_at` naive UTC digits read three hours ahead of
 * real `now`) was DELETED — `new Date('...naive UTC digits...')` under
 * `TZ=Asia/Tokyo` interprets those digits as Tokyo-local, i.e. nine hours
 * EARLIER in UTC terms than they actually mean, which is enough to read a
 * still-live session as already expired. West of UTC the same misread runs
 * the other way (late, not early) and is genuinely harmless, backstopped by
 * `sessionExpiryVerdict`'s SQL-native check in `session.ts`, which this
 * vendor call cannot see and cannot be delayed by. Reproduced identically
 * against unfixed `main` — this is NOT a regression this PR introduces, and
 * `PIN_ISO_DATESTYLE_SQL` below does not close it: that pin addresses
 * `datestyle` only, and this vector is `TZ`, a completely different GUC/env
 * axis reaching the exact same vendor line. Production runs UTC end to end,
 * which is why this has not been observed operationally; it remains an open
 * gap in the vendored dependency, recorded here for the upstream fix, not
 * something this repository can close short of forking the package.
 *
 * THAT PROVISO IS NOT FREE (TIN-4217, measured against real PostgreSQL). The
 * adapter's internal check is `new Date(session.expires) < new Date()` on
 * whatever TEXT the driver returns for the naive `expires` column — and that
 * text is rendered per the CONNECTION's `datestyle`. Under `'SQL, DMY'` a
 * naive timestamp renders `DD/MM/YYYY HH:MI:SS`; V8 heuristically reparses
 * that as `MM/DD/YYYY`, which is Invalid Date when day-of-month > 12 (safe:
 * the adapter's `NaN < now` is false, so it treats the row as live and does
 * NOT delete) but a VALID, WRONG, generally-past date when day-of-month <= 12
 * — and the adapter DOES delete on that, from inside `getSession`, before
 * `validateSession` below ever runs its own logic. Reproduced directly
 * against `dist/adapter.js` (bypassing this module's own parsing entirely):
 * a live session's row count went from 1 to 0 after nothing but
 * `adapterFor(tx).getSession(...)` under a transaction-local
 * `SET LOCAL datestyle TO 'SQL, DMY'`. This is NOT a bug this module's own
 * `parseDbInstant` could ever have caught by being stricter — the deletion
 * happens one call inside a pinned dependency we cannot patch, before this
 * module or session.ts sees the row at all.
 *
 * THE FIX IS TO REMOVE THE AMBIGUOUS INPUT, NOT TO OUT-PARSE IT.
 * `PIN_ISO_DATESTYLE_SQL` below re-pins `datestyle` to `'ISO'`,
 * TRANSACTION-LOCALLY, immediately before any call that hands a naive
 * timestamp to either this module's parser or the vendored adapter's own —
 * proven (same harness) to make the identical scenario report the session
 * live and leave the row in place. `db/client.ts`'s pool-level
 * `-c datestyle=ISO` startup option does NOT substitute for this: it only
 * pins what a NEW connection starts with, and a `SET`/`SET LOCAL` issued
 * later in an established session or transaction — the exact vector here —
 * overrides it. See `db/client.ts` for the corrected account of what that
 * pool option does and does not guarantee.
 *
 * `validateSession`'s OWN liveness verdict, separately, no longer trusts
 * ANY client-side parse at all (its own or the adapter's): it is re-derived
 * from a SQL-NATIVE comparison computed entirely inside PostgreSQL, which no
 * `datestyle` or process/session `timezone` setting can perturb, because no
 * instant crosses the wire as text for that decision. The parser below still
 * matters for two things that are not that decision: normalizing
 * `createdAt`/`expires`/`expiresAt` for display (`normalizeSessionInstants`),
 * and `reauth.ts`'s fresh-reauthentication window, which has no SQL-native
 * equivalent available at that call site.
 */
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * A full ISO-8601 instant carrying an explicit timezone designator (`Z` or
 * `±HH:MM`) — unambiguous under ANY `datestyle`, because `datestyle` governs
 * how PostgreSQL renders a value, and this shape is instead what THIS
 * module's own `toUtcIso` produces (`Date.prototype.toISOString()`), or what
 * a `timestamptz` column would send. Accepted so re-parsing an
 * already-normalized value (exactly what `parseDbInstant` does when called a
 * second time on its own output, e.g. via `isFreshlyAuthenticated`) keeps
 * working under the strict parser below.
 */
const ISO_INSTANT_WITH_DESIGNATOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Re-pin `datestyle` to the one format this module's parser (and, per the
 * measurement above, the vendored adapter's OWN internal parser) reads
 * correctly — transaction-local (`SET LOCAL`), so it borrows nothing from
 * connection-time configuration and overrides whatever the ambient value was
 * a moment ago. Execute this as the LAST statement before any read that will
 * feed a naive-timestamp session column to a parser; nothing may run between
 * the two, or a `SET LOCAL datestyle` racing in between would win. See the
 * module comment above for the measured reason this exists.
 *
 * WHAT THIS DOES NOT CLOSE (TIN-4217 review, ED-1/ED-3/ED-5 — read before
 * relying on this beyond `session.ts`'s one call site):
 *
 *   - It is `datestyle`-only. The process/session `TIMEZONE` vector that
 *     reaches the identical vendored line is a SEPARATE GUC/env axis this
 *     statement does nothing about — see the module comment's east-of-UTC
 *     paragraph above. There is no `SET LOCAL timezone` equivalent shipped
 *     here; that gap is open and recorded, not silently assumed closed.
 *   - It BLEEDS FORWARD, on purpose but worth stating: `SET LOCAL` persists
 *     for the rest of the enclosing transaction, not just the one statement
 *     after it. Measured: a transaction that had `datestyle = 'SQL, DMY'`
 *     before calling `validateSession` observes `datestyle = 'ISO, DMY'`
 *     afterward, for the remainder of that unit of work — `'ISO'` rewrites
 *     only the OUTPUT-format field, leaving the INPUT-order field (`DMY`)
 *     exactly as it was. Benign for every current caller (ISO output is
 *     unambiguous for `new Date()` regardless of input order, and nothing
 *     in this codebase re-parses ambiguous DMY-ORDERED INPUT text through
 *     this seam), but it means a read-shaped function silently mutates
 *     transaction-scoped configuration state for whatever runs after it in
 *     the same `withTenant` unit of work. A future caller that also needs a
 *     non-ISO input order for some other reason, in the same transaction,
 *     after `validateSession` has run, would be surprised by this.
 *   - `SET LOCAL` is a no-op — with a `WARNING`, not an error — outside a
 *     transaction block. `withTenant` always opens a real transaction and
 *     `DbTransaction` is the only type this is ever called with, so that
 *     mode is unreachable today; worth naming so it stays that way rather
 *     than becoming a silent, undetected failure if that assumption ever
 *     changes.
 */
export const PIN_ISO_DATESTYLE_SQL = "set local datestyle to 'ISO'";

/**
 * The discriminated result `parseDbInstant` should have returned from the
 * start (TIN-4217 acceptance (a)/(c)): a JS `Date` collapses "parsed to a
 * trustworthy instant" and "parsing failed" into the SAME type, distinguished
 * only by `Number.isNaN(d.getTime())` — a check every caller must remember to
 * make, and NaN's own arithmetic (`NaN <= x` and `NaN > x` are both `false`)
 * silently does the wrong thing for whichever caller forgets. `ok`/`err` make
 * "expired" and "I could not trust this value" different TYPES; a caller
 * that only handles the `ok` branch cannot accidentally fall through into
 * treating an untrusted value as a comparable instant.
 */
export type ParsedInstant =
	{ readonly ok: true; readonly instant: Date } | { readonly ok: false; readonly raw: string };

/**
 * Parse a timestamp the adapter (or a raw query) handed back, treating
 * zoneless naive text as UTC — the vendored `auth.*` tables' documented
 * convention (module comment above). STRICT (TIN-4217 acceptance (a)):
 * exactly two shapes are accepted — the naive `auth.*` column shape, and a
 * fully zone-qualified ISO instant (this module's own normalized output).
 * Anything else is `{ ok: false }`, NEVER a heuristic re-parse through bare
 * `new Date(text)` — that heuristic is precisely what let a DateStyle-
 * rendered `DD/MM/YYYY` string silently become a valid-but-wrong `MM/DD/YYYY`
 * instant instead of the detectable rejection this now is.
 */
export function tryParseDbInstant(value: string | Date): ParsedInstant {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? { ok: false, raw: String(value) } : { ok: true, instant: value };
	}
	const trimmed = value.trim();
	if (NAIVE_TIMESTAMP.test(trimmed)) return { ok: true, instant: new Date(`${trimmed.replace(' ', 'T')}Z`) };
	if (ISO_INSTANT_WITH_DESIGNATOR.test(trimmed)) return { ok: true, instant: new Date(trimmed) };
	return { ok: false, raw: trimmed };
}

/**
 * Date-or-Invalid-Date view over `tryParseDbInstant`, kept for callers that
 * predate the discriminated result (`toUtcIso` below). Prefer
 * `tryParseDbInstant` for anything a safety decision turns on — an `Invalid
 * Date` is exactly the silent NaN-arithmetic footgun (a) above exists to
 * retire.
 */
export function parseDbInstant(value: string | Date): Date {
	const parsed = tryParseDbInstant(value);
	return parsed.ok ? parsed.instant : new Date(NaN);
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
