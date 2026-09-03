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
import type { ClaimedJob } from '../outbox/schema';

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
 * A verified-email change is a fresh request to converge the SAME list
 * entitlement, not a new entitlement generation. The inserted person_email
 * row id makes each address revision independently durable while the payload
 * remains ids-only and the activation generation-1 keys remain unchanged.
 */
export function emailListReconciliationIdempotencyKey(
	tenantId: string,
	membershipId: string,
	personEmailId: string,
): string {
	return `${tenantId}:membership:${membershipId}:add_lists:email:${personEmailId}`;
}

export async function enqueueEmailListReconciliation(
	tx: DbTransaction,
	row: Membership,
	personEmailId: string,
): Promise<OutboxJob> {
	const result = await enqueue(tx, {
		kind: 'provision.add_lists',
		aggregateType: 'membership',
		aggregateId: row.id,
		payload: {
			schemaVersion: 1,
			tenantId: row.tenantId,
			membershipId: row.id,
			personId: row.personId,
			generation: PROVISION_GENERATION,
		},
		idempotencyKey: emailListReconciliationIdempotencyKey(row.tenantId, row.id, personEmailId),
	});
	return result.job;
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
	const record = payload && typeof payload === 'object' && !Array.isArray(payload)
		? (payload as Record<string, unknown>)
		: {};
	const expectedKeys = ['membershipId', 'personId'];
	const keys = Object.keys(record).sort();
	if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
		throw new ListJobPayloadError(
			`list-projection job ${jobId} carries a malformed payload: fields must be exactly membershipId, personId`,
		);
	}
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
 * Parse either standing list-job carrier, then bind its ids to the outbox
 * aggregate before any database read. The relational membership→person bind
 * is completed by listProjectionState below.
 */
export function parseListProjectionJob(job: ClaimedJob): ListJobPayload {
	let payload: ListJobPayload;
	if (job.kind === 'provision.add_lists') {
		payload = parseProvisionJobPayload(job.payload, job.id, job.tenantId);
	} else if (job.kind === 'offboard.remove_lists') {
		payload = parseListJobPayload(job.payload, job.id);
	} else {
		throw new ListJobPayloadError(`list-projection job ${job.id} has an unsupported kind`);
	}
	if (job.aggregateType !== 'membership' || job.aggregateId !== payload.membershipId) {
		throw new ListJobPayloadError(
			`list-projection job ${job.id} is not bound to its membership aggregate`,
		);
	}
	return { membershipId: payload.membershipId, personId: payload.personId };
}

/**
 * The current state a list-projection handler re-reads inside its own unit
 * of work (§5 staleness guard): the carrier person's membership/address
 * history plus every tenant-local Active/paused owner of an affected address.
 * Payloads are ids-only, so this read — not the payload — is the truth the
 * external effect acts on.
 */
export interface ListProjectionState {
	/** `null`: the carrier membership is not bound to the payload person. */
	membershipStatus: string | null;
	/** Changes on every carrier or tenant-wide address-owner revision. */
	revision: string;
	/** `null`: the person has no current address row. */
	currentAddress: string | null;
	/** Every address ever projected for the carrier person, deduplicated oldest first. */
	addresses: string[];
	/** Carrier-history addresses currently owed by at least one Active/paused person in this tenant. */
	desiredSubscribedAddresses: string[];
}

export async function listProjectionState(tx: DbTransaction, payload: ListJobPayload): Promise<ListProjectionState> {
	const carrierRows = await tx
		.select({ id: membershipTable.id })
		.from(membershipTable)
		.where(and(eq(membershipTable.id, payload.membershipId), eq(membershipTable.personId, payload.personId)))
		.limit(1);
	if (!carrierRows[0]) {
		return {
			membershipStatus: null,
			revision: 'missing',
			currentAddress: null,
			addresses: [],
			desiredSubscribedAddresses: [],
		};
	}

	// The carrier person's membership history decides whether that person still
	// has an entitlement. The address-level union below then protects a shared
	// or reassigned address that another person is currently entitled to use.
	// The unique live-membership constraint permits at most one Active/paused
	// row for this person.
	const memberships = await tx
		.select({ id: membershipTable.id, status: membershipTable.status, version: membershipTable.version })
		.from(membershipTable)
		.where(eq(membershipTable.personId, payload.personId))
		.orderBy(membershipTable.createdAt, membershipTable.id);
	const entitled = memberships.find((row) => row.status === 'active' || row.status === 'paused');
	const carrier = memberships.find((row) => row.id === payload.membershipId);
	// The person's current (unsuperseded) address row — `currentEmail` in
	// ./activate.ts, inlined here rather than imported so provision.ts and
	// activate.ts never form an import cycle (activate.ts imports the fan-out).
	const emails = await tx
		.select({ id: personEmail.id, email: personEmail.email, supersededAt: personEmail.supersededAt })
		.from(personEmail)
		.where(eq(personEmail.personId, payload.personId))
		.orderBy(personEmail.effectiveFrom, personEmail.id);
	const current = emails.find((row) => row.supersededAt === null);
	const addresses = [...new Set(emails.map((row) => row.email))];

	// Mailman membership is address-keyed, while this database deliberately
	// does not make email an identity key. A carrier person's old address may
	// therefore be another Active person's current, verified address. Resolve
	// desired state for every affected address across the whole tenant: an old
	// removal must never revoke a different member's standing entitlement.
	const entitledOwners =
		addresses.length === 0
			? []
			: await tx
					.select({
						address: personEmail.email,
						emailId: personEmail.id,
						personId: personEmail.personId,
						membershipId: membershipTable.id,
						membershipStatus: membershipTable.status,
						membershipVersion: membershipTable.version,
					})
					.from(personEmail)
					.innerJoin(
						membershipTable,
						and(
							eq(membershipTable.tenantId, personEmail.tenantId),
							eq(membershipTable.personId, personEmail.personId),
						),
					)
					.where(
						and(
							isNull(personEmail.supersededAt),
							inArray(personEmail.email, addresses),
							inArray(membershipTable.status, ['active', 'paused']),
						),
					)
					.orderBy(personEmail.email, personEmail.personId, membershipTable.id);
	const desiredSubscribed = new Set(entitledOwners.map((row) => row.address));
	return {
		membershipStatus: entitled?.status ?? carrier?.status ?? null,
		revision: [
			memberships.map((row) => `${row.id}:${row.status}:${row.version}`).join(','),
			current?.id ?? 'none',
			emails.map((row) => row.id).join(','),
			entitledOwners
				.map(
					(row) =>
						`${row.emailId}:${row.personId}:${row.membershipId}:${row.membershipStatus}:${row.membershipVersion}`,
				)
				.join(','),
		].join(':'),
		currentAddress: current?.email ?? null,
		addresses,
		desiredSubscribedAddresses: addresses.filter((address) => desiredSubscribed.has(address)),
	};
}
