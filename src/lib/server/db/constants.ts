/**
 * Names — never values — that the database contract shares with the apply
 * plane (TIN-3817 slice S1).
 *
 * This repository is PUBLIC and owns no secrets (AGENTS.md "Repo Role", ADR
 * 0014 §0.2). Everything here is an identifier a reader could learn from the
 * generated SQL anyway: a role name, a GUC name, a schema name, a lock key
 * derivation. The DSN, the password, and the cluster endpoint stay in
 * `great-falls-tool-bus-infra`.
 */

/**
 * The PostgreSQL GUC every row-level-security policy reads.
 *
 * `current_setting('app.tenant_id', true)` returns the EMPTY STRING (not NULL)
 * for a GUC that was set and then reset inside a session, and `''::uuid`
 * raises rather than yielding NULL — so every policy wraps it in
 * `nullif(…, '')` and the predicate degrades to NULL (deny) instead of an
 * error. See the spec's §1.3 "Concrete shape".
 */
export const TENANT_GUC = 'app.tenant_id';

/**
 * The DML-only runtime role. `web` and `worker` connect as this role; it may
 * read and write rows and may not create, alter, or drop anything.
 *
 * The migration `0002_rls_and_runtime_grants.sql` creates it NOLOGIN when it
 * is absent and grants it exactly DML. Infra owns the login credential — this
 * repository never learns it.
 */
export const RUNTIME_ROLE = 'gftb_app';

/** Schema holding the migration hash ledger. Deliberately outside the tenant world. */
export const LEDGER_SCHEMA = 'migration';

/** Table holding the migration hash ledger. */
export const LEDGER_TABLE = 'applied_migration';

/** Fully-qualified ledger table. */
export const LEDGER_QUALIFIED = `${LEDGER_SCHEMA}.${LEDGER_TABLE}`;

/**
 * Schemas whose every table must carry `tenant_id`, RLS, FORCE RLS, and a
 * tenant policy. The integration suite iterates this list from `pg_class` so a
 * table added later without a policy fails the suite rather than shipping
 * unprotected.
 *
 * `migration` is absent on purpose: the ledger is per-database DDL history,
 * not tenant data, and the runtime role holds no privilege on it at all —
 * which is a stronger guarantee than a row policy.
 */
export const TENANT_SCOPED_SCHEMAS = Object.freeze(['public', 'auth']);

/**
 * Advisory-lock key for the migrator, as a decimal string.
 *
 * Derivation (reproduced by `just db-migrate --explain-lock`, and asserted by
 * a unit test so this comment cannot rot):
 *
 *   BigInt.asIntN(64, BigInt('0x' + sha256('gftb:member-v0:migrator').slice(0, 16)))
 *
 * A single fixed 64-bit key means every migrator process in the fleet
 * serialises on one `pg_advisory_lock`, which is the "exactly one applier"
 * property spec §6 requires and `drizzle-kit migrate` does not provide.
 */
export const MIGRATION_ADVISORY_LOCK_SEED = 'gftb:member-v0:migrator';

/** Exit codes for the `migrator` process boundary (see scripts/platform-entrypoint.mjs). */
export const MIGRATOR_EXIT = Object.freeze({
	/** Applied cleanly, or had nothing to do. A no-op is a success. */
	OK: 0,
	/**
	 * The ledger and the checked-in migrations disagree: a previously applied
	 * file changed, vanished, or was reordered. Forward-only by contract
	 * (spec §6), so this fails closed and changes nothing.
	 */
	DRIFT: 65,
	/** The migrator bundle or migrations directory is missing — a malformed image. */
	MALFORMED: 70,
	/**
	 * The database is unreachable or unconfigured. S0's dispatcher already
	 * publishes 78 as the migrator's "cannot proceed" code, and the Job
	 * contract in `great-falls-tool-bus-infra` keys its retry on it, so the
	 * value is inherited rather than chosen here.
	 */
	UNAVAILABLE: 78,
});
