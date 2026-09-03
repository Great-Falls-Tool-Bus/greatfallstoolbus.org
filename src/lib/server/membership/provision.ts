/**
 * Provisioning fan-out — the ADR 0024 §1.5 activation projection intent
 * (discuss-board lifecycle spec, `docs/spec/discuss-board-lifecycle-2026-09-01.md`;
 * TIN-3964).
 *
 * THE MIRROR OF `./offboard.ts`, DELIBERATELY: the same commit-first split
 * (`activateMembership` commits the membership to `active` in its own
 * transaction and this fan-out rides THAT transaction via S3's
 * `enqueue(tx, job)`), the same identity-key doctrine
 * (`<tenant>:membership:<id>:<effect>:g<generation>`, no caller segment, so a replayed
 * activation could never enqueue a second effect set — `enqueue`'s unique key
 * absorbs it), and the same ids-only payload doctrine (S3: the handler reads
 * current state itself inside its own unit of work; the payload never carries
 * an address, secret, or token).
 *
 * FOUR ENTITLEMENTS, ONE ACTIVATION. Becoming Active emits the identity,
 * mailbox, discuss-list, and archive projections together. A readiness gate
 * controls when a projection may be claimed; it never deletes the member's
 * entitlement and never converts an undelivered effect into success.
 *
 * WHO ENQUEUES, EXACTLY (spec ruling 2026-09-01): the FRESH-activation path
 * of `activateMembership` only — "membership account creation is the ONLY
 * path that adds users to the discuss board". The converge-replay path
 * enqueues nothing (the original activation already did, and re-enqueueing
 * against a dead-lettered key would throw `DeadIdempotencyKeyError` out of a
 * legitimate replay); pause/resume enqueue nothing (pause preserves
 * discussion access by ratified design — see `./transition.ts`).
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import type { Membership, OutboxJob } from '../db/schema';
import { membership as membershipTable, personEmail } from '../db/schema';
import { enqueue } from '../outbox/enqueue';

/** The ratified activation projections (ADR 0024 §1.5), in fan-out order. */
export const PROVISION_JOB_KINDS = [
	'provision.ensure_identity',
	'provision.enable_mailbox',
	'provision.add_lists',
	'provision.ensure_archive',
] as const;

export const PROVISION_GENERATION = 1 as const;

export type ProvisionJobKind = (typeof PROVISION_JOB_KINDS)[number];

/** `<tenant>:membership:<id>:<effect>:g1` — one receipt per projection generation. */
export function provisionIdempotencyKey(tenantId: string, membershipId: string, kind: ProvisionJobKind): string {
	const effect = kind.slice('provision.'.length);
	return `${tenantId}:membership:${membershipId}:${effect}:g${PROVISION_GENERATION}`;
}

/**
 * The activation fan-out: one job per provisioning projection, enqueued in
 * the caller's (the activation's) transaction. Convergent on replay by the
 * `(tenant, kind, idempotency_key)` unique — though the fresh-activation-only
 * call site keeps replays off this path entirely.
 *
 * Payloads carry ids only (S3 payload doctrine): the handlers read current
 * state themselves inside their own units of work.
 */
export async function enqueueProvisioning(tx: DbTransaction, row: Membership): Promise<OutboxJob[]> {
	const jobs: OutboxJob[] = [];
	for (const kind of PROVISION_JOB_KINDS) {
		const result = await enqueue(tx, {
			kind,
			aggregateType: 'membership',
			aggregateId: row.id,
			payload: {
				schemaVersion: 1,
				tenantId: row.tenantId,
				membershipId: row.id,
				personId: row.personId,
				generation: PROVISION_GENERATION,
			},
			idempotencyKey: provisionIdempotencyKey(row.tenantId, row.id, kind),
		});
		jobs.push(result.job);
	}
	return jobs;
}

/**
 * Repair pre-carrier Active/paused rows automatically. This is deliberately
 * the same enqueue path activation uses: missing intent is created, standing
 * pending/done intent converges on its receipt, and dead intent fails loudly
 * for the audited replay lane instead of being silently replaced.
 */
export async function reconcileActiveProvisioning(tx: DbTransaction): Promise<number> {
	const rows = await tx
		.select()
		.from(membershipTable)
		.where(inArray(membershipTable.status, ['active', 'paused']))
		.orderBy(membershipTable.createdAt, membershipTable.id);

	for (const row of rows) await enqueueProvisioning(tx, row);
	return rows.length;
}

/** Closed, versioned payload for activation provisioning effects. */
export interface ProvisionJobPayload {
	schemaVersion: 1;
	tenantId: string;
	membershipId: string;
	personId: string;
	generation: 1;
}

/** A provisioning job whose payload is not the exact v1 ids-only shape. */
export class ProvisionJobPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProvisionJobPayloadError';
	}
}

/** The ids-only payload both list projections carry (S3 payload doctrine). */
export interface ListJobPayload {
	membershipId: string;
	personId: string;
}

/** A list-projection job whose payload is not the `{ membershipId, personId }` shape the fan-outs write. */
export class ListJobPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ListJobPayloadError';
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the exact v1 carrier and bind it to the claimed job's tenant. */
export function parseProvisionJobPayload(
	payload: unknown,
	jobId: string,
	expectedTenantId: string,
): ProvisionJobPayload {
	const record = payload && typeof payload === 'object' && !Array.isArray(payload)
		? (payload as Record<string, unknown>)
		: {};
	const expectedKeys = ['generation', 'membershipId', 'personId', 'schemaVersion', 'tenantId'];
	const keys = Object.keys(record).sort();
	const malformed = (detail: string): never => {
		throw new ProvisionJobPayloadError(`provisioning job ${jobId} carries a malformed v1 payload: ${detail}`);
	};

	if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
		malformed('fields must be exactly schemaVersion, tenantId, membershipId, personId, generation');
	}
	if (record.schemaVersion !== 1) malformed('schemaVersion must be 1');
	if (record.generation !== PROVISION_GENERATION) malformed(`generation must be ${PROVISION_GENERATION}`);
	if (typeof record.tenantId !== 'string' || !UUID_RE.test(record.tenantId)) malformed('tenantId must be a UUID');
	if (record.tenantId !== expectedTenantId) malformed('tenantId must match the claimed job tenant');
	if (typeof record.membershipId !== 'string' || !UUID_RE.test(record.membershipId)) {
		malformed('membershipId must be a UUID');
	}
	if (typeof record.personId !== 'string' || !UUID_RE.test(record.personId)) malformed('personId must be a UUID');

	return {
		schemaVersion: 1,
		tenantId: record.tenantId,
		membershipId: record.membershipId,
		personId: record.personId,
		generation: PROVISION_GENERATION,
	};
}

/**
 * Validate a claimed list-projection job's payload BEFORE any database or
 * network work (the `stripe-project.ts` `parseEventId` idiom). A malformed
 * payload throws deterministically: retries into dead-letter VISIBLY rather
 * than being silently completed. The message quotes ids only — never an
 * address (the S3 doctrine applies to `last_error` the same way).
 */
export function parseListJobPayload(payload: unknown, jobId: string): ListJobPayload {
	const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
	const membershipId = record.membershipId;
	const personId = record.personId;
	if (typeof membershipId !== 'string' || !UUID_RE.test(membershipId)) {
		throw new ListJobPayloadError(
			`list-projection job ${jobId} carries a malformed payload: membershipId must be a UUID`,
		);
	}
	if (typeof personId !== 'string' || !UUID_RE.test(personId)) {
		throw new ListJobPayloadError(`list-projection job ${jobId} carries a malformed payload: personId must be a UUID`);
	}
	return { membershipId, personId };
}

/**
 * The current state a list-projection handler re-reads inside its own unit
 * of work (§5 staleness guard): the membership's CURRENT status and the
 * person's CURRENT (unsuperseded) address. Payloads are ids-only, so this
 * read — not the payload — is the truth the external effect acts on.
 */
export interface ListProjectionState {
	/** `null`: no such membership visible to this tenant transaction. */
	membershipStatus: string | null;
	/** `null`: the person has no current address row. */
	address: string | null;
}

export async function listProjectionState(tx: DbTransaction, payload: ListJobPayload): Promise<ListProjectionState> {
	const rows = await tx
		.select({ status: membershipTable.status })
		.from(membershipTable)
		.where(eq(membershipTable.id, payload.membershipId))
		.limit(1);
	// The person's current (unsuperseded) address row — `currentEmail` in
	// ./activate.ts, inlined here rather than imported so provision.ts and
	// activate.ts never form an import cycle (activate.ts imports the fan-out).
	const emails = await tx
		.select({ email: personEmail.email })
		.from(personEmail)
		.where(and(eq(personEmail.personId, payload.personId), isNull(personEmail.supersededAt)))
		.limit(1);
	return {
		membershipStatus: rows[0]?.status ?? null,
		address: emails[0]?.email ?? null,
	};
}

/**
 * EVERY address in the person's history — superseded rows included — deduped,
 * oldest first. This is the set the `offboard.remove_lists` delivery must
 * unsubscribe: `changeEmail` (./activate.ts) supersedes the current row and
 * emits NO list projection, so the address Mailman still holds after an email
 * change is a HISTORICAL one, and unsubscribing only the current address
 * would 404 (idempotent "success") while the old address stayed a discuss
 * writer forever (PR #239 adversarial verify, MAJOR 1). Each unsubscribe is
 * 404-tolerant, so removing the whole history stays idempotent with no
 * receipt table. Inlined query (same no-import-cycle reason as above; the
 * `emailHistory` twin in ./activate.ts is record-keeping, this is state).
 */
export async function personAddressHistory(tx: DbTransaction, personId: string): Promise<string[]> {
	const rows = await tx
		.select({ email: personEmail.email })
		.from(personEmail)
		.where(eq(personEmail.personId, personId))
		.orderBy(personEmail.effectiveFrom, personEmail.id);
	return [...new Set(rows.map((row) => row.email))];
}
