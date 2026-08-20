/**
 * `withTenant` — the only door into tenant-scoped data (TIN-3817 slice S1).
 *
 * THE MISTAKE THIS FILE EXISTS TO PREVENT (spec §1.3, finding B3).
 * `set_config('app.tenant_id', …, true)` is `SET LOCAL`: it is scoped to one
 * transaction on one connection. `@tummycrypt/tinyland-auth-pg`'s
 * `createNodePgStorageAdapter()` builds and owns its OWN pool, and every
 * adapter method queries `this.db` with no transaction handle. Point that
 * adapter at a FORCE-RLS database and the policy evaluates with an unset GUC,
 * the predicate is NULL, `getUser` returns `null`, `createUser` fails its
 * `WITH CHECK` — a total, silent auth outage that no unit test against a
 * policy-free database would catch.
 *
 * S1 therefore takes FIX A, the DI path, and states it here so S2 inherits it:
 * `withTenant` hands its TRANSACTION HANDLE to the callback, and S2 constructs
 * the adapter per unit of work as `createPgStorageAdapter({ db: tx })`.
 * `dist/adapter.js` assigns `this.db = config.db` verbatim, so a tx handle is
 * accepted. Fix B (a role- or DSN-level GUC) was rejected: it is only correct
 * while exactly one tenant exists, and TIN-3817's "one configured GFTB tenant"
 * is a current fact, not a guarantee.
 *
 * Direct pool access outside this module is an ESLint error, not a convention.
 */

import { sql } from 'drizzle-orm';
import { getDb, type Db, type DbTransaction } from './client';
import { TENANT_GUC } from './constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reject anything that is not a canonical UUID before it reaches
 * `set_config`. The call is parameterised so this is not an injection guard —
 * it is a fail-fast guard, because a malformed tenant id would otherwise be
 * accepted by `set_config` and then silently match no rows, which reads
 * exactly like an empty tenant.
 */
export function assertTenantId(tenantId: string): string {
	if (!UUID_RE.test(tenantId)) {
		throw new Error(`withTenant: tenant id must be a UUID, got ${JSON.stringify(tenantId)}`);
	}
	return tenantId.toLowerCase();
}

/**
 * Run `fn` inside a transaction whose `app.tenant_id` is pinned to `tenantId`.
 *
 * `set_config(…, true)` is transaction-local, so the GUC is released on commit
 * or rollback without a reset step — and a connection returned to the pool can
 * never carry another request's tenant.
 *
 * @param tenantId canonical UUID of the tenant
 * @param fn receives the transaction handle; pass it to every query AND to
 *   `createPgStorageAdapter({ db: tx })`
 */
export async function withTenant<T>(
	tenantId: string,
	fn: (tx: DbTransaction) => Promise<T>,
	db: Db = getDb(),
): Promise<T> {
	const id = assertTenantId(tenantId);
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config(${TENANT_GUC}, ${id}, true)`);
		return fn(tx);
	});
}

/**
 * The GUC as the database currently sees it, or `null` when unset or empty.
 * Used by the integration suite to prove the "missing GUC denies rather than
 * raises" property, and useful in a debugger.
 */
export async function currentTenantId(tx: DbTransaction): Promise<string | null> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting(${TENANT_GUC}, true), '') as tenant_id`,
	);
	return result.rows[0]?.tenant_id ?? null;
}
