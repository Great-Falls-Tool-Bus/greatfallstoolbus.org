/**
 * Provisioning and activation — the A6 composition and M1 activation
 * (TIN-3440 slice S6; decision 0024; slices §2.2 rows 6 and 10).
 *
 * EVERY function takes the transaction handle `withTenant(tenantId, fn)`
 * produced, first, and none opens a transaction of its own — the
 * S2/S4/S5 discipline, inherited. That is what makes M1 ONE ATOMIC UNIT OF
 * WORK (spec §4: "assent to the current agreement version, password/session
 * creation, and an audit commit"): an injected failure after password
 * creation rolls back the auth user, the assent, the membership transition,
 * AND the audit row together — the S6 acceptance row asserts exactly that.
 *
 * THE A6 HAND-OFF, EXECUTED. decide.ts (S5) recorded: "S6 wires the
 * provisioning INTO THIS SAME UNIT OF WORK by composing with
 * `approveApplication` inside one `withTenant` callback." `provisionOnApproval`
 * is that composition: the S5 decision core keeps its guards (claimant-ship,
 * tour-first, the approve×withdraw race) and this module adds the `person`
 * (immutable UUID, spec §4), the current-address `person_email` row, the
 * `membership` in `pending_assent`, and the audit rows the ratified table
 * names for row 6: `application.approved` + `membership.created`.
 *
 * HOW THE APPLICANT REACHES ACTIVATION (spec §4 authentication baseline:
 * "Initial access follows application approval and the application-owned
 * verification/reset flow"): a single-use, expiring `activate` token on S4's
 * token substrate, minted at decision-email render time by the future mail
 * handler (`mintActivationToken` is its seam) — the S4 payload doctrine keeps
 * the plaintext out of the outbox row, the audit spine, and every log line.
 *
 * WHAT ACTIVATION MUST NOT TOUCH, STRUCTURALLY (slices §2.2 row 10: "no
 * contribution or mail predicate"): nothing in this module reads or writes
 * `contribution_agreement` or `finance_receipt`. The S6 acceptance proves it
 * by revoking the runtime role's access to those tables and activating
 * anyway; the S8 static fence (no `membership/** → contribution/**` import)
 * makes it compile-visible.
 *
 * `outbox_job` USED to be on that list; ADR 0024 §1.5 (2026-08-30) supersedes
 * that half of the invariant: "Activation emits idempotent mailbox and
 * discussion-list projection intent." Fresh activation therefore enqueues
 * `provision.add_lists` through `./provision.ts` in the SAME transaction as
 * the membership commit (the outbox contract's enqueue-rides-the-domain-write
 * rule), exactly as `leave`/`remove` already do for offboarding — so an
 * outbox-write failure now correctly rolls back activation. The row-10 guard
 * that survives is "no contribution or mail PREDICATE": enqueueing projection
 * intent is not a predicate, and the S6 row-4 acceptance is narrowed to the
 * contribution tables accordingly.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import {
	application,
	applicationEmailToken,
	assent,
	membership,
	person,
	personEmail,
	type Application,
	type Membership,
	type Person,
	type PersonEmail,
} from '../db/schema';
import {
	authenticate,
	createUserWithPassword,
	type AuthSession,
	type PasswordHashOptions,
	type SessionMetadata,
} from '../auth';
import { normalizeEmail } from '../application/intake';
import { approveApplication, type ApprovalInput, type DecisionResult } from '../application/decide';
import {
	TokenRejectedError,
	assessTokenRow,
	consumeToken,
	hashToken,
	mintToken,
	type MintedToken,
} from '../application/tokens';
import { requireCurrentAgreement } from './agreement';
import { enqueueProvisioning } from './provision';
import { writeAudit } from '../audit/write';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 409-shaped: the event is not legal from the membership's current state. */
export class IllegalMembershipTransitionError extends Error {
	readonly from: string;
	readonly event: string;
	constructor(from: string, event: string) {
		super(`"${event}" is not a legal transition from "${from}".`);
		this.name = 'IllegalMembershipTransitionError';
		this.from = from;
		this.event = event;
	}
}

/** 409-shaped: stale `expectedVersion` on a membership row (spec §4). */
export class MembershipVersionConflictError extends Error {
	readonly expected: number;
	readonly actual: number;
	constructor(expected: number, actual: number) {
		super('The membership changed since you last read it.');
		this.name = 'MembershipVersionConflictError';
		this.expected = expected;
		this.actual = actual;
	}
}

/**
 * 409-shaped: activation cannot proceed because the address already maps to
 * an auth user. Reinstatement after `removed` is a NEW APPLICATION (slices
 * §1.9 ASSUMPTION) — but no ratified row defines how a returning person's
 * standing auth identity merges with a freshly provisioned `person`, so this
 * module refuses loudly instead of inventing identity-merge semantics.
 * Recorded hand-off: operator-mediated resolution, resolver Jess.
 */
export class ActivationConflictError extends Error {
	constructor() {
		super('This address already has an account; activation needs operator help.');
		this.name = 'ActivationConflictError';
	}
}

/** 404-shaped: no membership/person where one was required. */
export class MembershipNotFoundError extends Error {
	constructor() {
		super('No such membership.');
		this.name = 'MembershipNotFoundError';
	}
}

/** Shared `expectedVersion` gate (spec §4: stale → 409, mutating nothing). */
export function checkMembershipVersion(row: Membership, expectedVersion: number | undefined): void {
	if (expectedVersion !== undefined && expectedVersion !== row.version) {
		throw new MembershipVersionConflictError(expectedVersion, row.version);
	}
}

/**
 * Lock the membership row and return it — the S5 `lockApplication` precedent:
 * `FOR UPDATE` is the serialisation point for every membership transition.
 */
export async function lockMembership(tx: DbTransaction, membershipId: string): Promise<Membership> {
	if (!UUID_RE.test(membershipId)) throw new MembershipNotFoundError();
	const rows = await tx.select().from(membership).where(eq(membership.id, membershipId)).for('update').limit(1);
	if (rows.length !== 1) throw new MembershipNotFoundError();
	return rows[0];
}

/** The person provisioned for an application, or null. */
export async function personByApplication(tx: DbTransaction, applicationId: string): Promise<Person | null> {
	const rows = await tx.select().from(person).where(eq(person.applicationId, applicationId)).limit(1);
	return rows[0] ?? null;
}

/** The membership provisioned for an application, or null. */
export async function membershipByApplication(tx: DbTransaction, applicationId: string): Promise<Membership | null> {
	const rows = await tx.select().from(membership).where(eq(membership.applicationId, applicationId)).limit(1);
	return rows[0] ?? null;
}

/** A person by id, or null (RLS-filtered reads identically, on purpose). */
export async function personById(tx: DbTransaction, personId: string): Promise<Person | null> {
	if (!UUID_RE.test(personId)) return null;
	const rows = await tx.select().from(person).where(eq(person.id, personId)).limit(1);
	return rows[0] ?? null;
}

/** The person behind an auth user id, or null — the session→person seam. */
export async function personByAuthUser(tx: DbTransaction, authUserId: string): Promise<Person | null> {
	if (!UUID_RE.test(authUserId)) return null;
	const rows = await tx.select().from(person).where(eq(person.authUserId, authUserId)).limit(1);
	return rows[0] ?? null;
}

/** The person's current (unsuperseded) address row, or null. */
export async function currentEmail(tx: DbTransaction, personId: string): Promise<PersonEmail | null> {
	const rows = await tx
		.select()
		.from(personEmail)
		.where(and(eq(personEmail.personId, personId), isNull(personEmail.supersededAt)))
		.limit(1);
	return rows[0] ?? null;
}

export interface ProvisionResult extends DecisionResult {
	person: Person;
	membership: Membership;
	/** false: the approval already stood; the standing provisioning returned. */
	provisioned: boolean;
}

/**
 * A6, composed (slices §2.2 row 6): the S5 decision core decides — claimant
 * guard, tour-first edge, the approve×withdraw race — and, when a FRESH
 * approval commits, this same unit of work provisions the `person` (immutable
 * UUID), the current `person_email` row, and the `membership` in
 * `pending_assent`, then writes BOTH ratified audit rows. A replayed approval
 * (S5's convergence path) returns the standing provisioning and writes
 * nothing.
 */
export async function provisionOnApproval(tx: DbTransaction, input: ApprovalInput): Promise<ProvisionResult> {
	const now = input.now ?? new Date();
	const decision = await approveApplication(tx, input);

	if (!decision.decided) {
		const standingPerson = await personByApplication(tx, decision.application.id);
		const standingMembership = await membershipByApplication(tx, decision.application.id);
		if (!standingPerson || !standingMembership) {
			// An approved application without provisioning predates this slice.
			// Surface it rather than half-provision outside the decision commit.
			throw new MembershipNotFoundError();
		}
		return { ...decision, person: standingPerson, membership: standingMembership, provisioned: false };
	}

	const app = decision.application;
	const personRows = await tx
		.insert(person)
		.values({
			tenantId: app.tenantId,
			applicationId: app.id,
			displayName: app.displayName,
			createdAt: now,
		})
		.returning();
	const provisionedPerson = personRows[0];

	await tx.insert(personEmail).values({
		tenantId: app.tenantId,
		personId: provisionedPerson.id,
		email: normalizeEmail(app.email),
		effectiveFrom: now,
	});

	const membershipRows = await tx
		.insert(membership)
		.values({
			tenantId: app.tenantId,
			personId: provisionedPerson.id,
			applicationId: app.id,
			status: 'pending_assent',
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	const provisionedMembership = membershipRows[0];

	// Row 6's audit column, both rows, same unit of work: decision and
	// operational notes only, no contribution data (spec §4).
	await writeAudit(tx, {
		actorType: 'person',
		actorId: input.keyholderPersonId,
		aggregateType: 'application',
		aggregateId: app.id,
		event: 'application.approved',
		fromStatus: 'tour_scheduled',
		toStatus: 'approved',
		now,
	});
	await writeAudit(tx, {
		actorType: 'person',
		actorId: input.keyholderPersonId,
		aggregateType: 'membership',
		aggregateId: provisionedMembership.id,
		event: 'membership.created',
		toStatus: 'pending_assent',
		now,
	});

	return { ...decision, person: provisionedPerson, membership: provisionedMembership, provisioned: true };
}

/**
 * Mint the single-use activation token the decision email carries — the seam
 * the future `application.decision_email` mail handler calls at render time
 * (S4's token doctrine: plaintext exists in the mint return value and the
 * email body, nowhere else).
 */
export async function mintActivationToken(
	tx: DbTransaction,
	applicationId: string,
	opts: { ttlMs?: number; now?: Date } = {},
): Promise<MintedToken> {
	return mintToken(tx, { applicationId, purpose: 'activate', ttlMs: opts.ttlMs, now: opts.now });
}

export interface ActivationPeek {
	verdict: 'valid' | 'invalid';
	application: Application | null;
	membership: Membership | null;
}

/**
 * Token peek for the assent page's GET load: verdict without consumption
 * (GETs mutate nothing) and, when valid, the application + membership the
 * token belongs to. Invalid is ONE undifferentiated verdict — the bearer
 * learns nothing about why (the S4 non-enumeration rule).
 */
export async function peekActivation(
	tx: DbTransaction,
	presented: string,
	now: Date = new Date(),
): Promise<ActivationPeek> {
	const rows = await tx
		.select()
		.from(applicationEmailToken)
		.where(eq(applicationEmailToken.tokenHash, hashToken(presented)))
		.limit(1);
	const verdict = assessTokenRow(rows[0], 'activate', now);
	if (verdict !== 'valid') return { verdict: 'invalid', application: null, membership: null };
	const appRows = await tx.select().from(application).where(eq(application.id, rows[0].applicationId)).limit(1);
	const app = appRows[0] ?? null;
	return {
		verdict: 'valid',
		application: app,
		membership: app ? await membershipByApplication(tx, app.id) : null,
	};
}

export interface ActivateInput {
	/** The plaintext activation token from the decision email. */
	token: string;
	/** The password the member is setting. */
	password: string;
	/** The agreement version shown during activation — MUST be the current one. */
	agreementVersionId: number;
	expectedVersion?: number;
	now?: Date;
	/** Test tuning (bcrypt rounds); production uses the package default. */
	hashOptions?: PasswordHashOptions;
	metadata?: SessionMetadata;
	/**
	 * TEST SEAM for the S6 atomicity acceptance row: injected between password
	 * creation and the membership commit. Production never passes it.
	 */
	afterPasswordCreate?: () => void | Promise<void>;
}

export interface ActivationResult {
	membership: Membership;
	person: Person;
	session: AuthSession;
	/** false: converged replay of an already-committed activation. */
	activated: boolean;
}

/**
 * M1 — legacy persisted `pending_assent → active` (pending activation to
 * active), one atomic unit of work: consume the activation token, verify the
 * version shown is CURRENT, create the auth user with the password, record the
 * agreement receipt, move the membership, link `person.auth_user_id`, write
 * the audit row (agreement version required), and open the session. Any failure rolls
 * the WHOLE act back — token consumption included, so a transient failure
 * does not burn the credential.
 *
 * GUARDS, exactly row 10's: application `approved` (structurally true — the
 * token is minted at approval and the membership exists only via
 * provisioning); assent to the CURRENT version (superseded → 409); password
 * set; and NO contribution or mail predicate — this function touches neither.
 *
 * DUPLICATE CONVERGENCE (spec §6: a duplicate request returns the original
 * result): a re-presented, already-consumed token whose membership is already
 * `active` converges — IF the presented password verifies against the account
 * the activation created. Without that proof the replay is refused exactly
 * like any dead token: a consumed credential alone must never mint a session.
 */
export async function activateMembership(tx: DbTransaction, input: ActivateInput): Promise<ActivationResult> {
	const now = input.now ?? new Date();

	// Peek first so the consumed-token replay can converge instead of dying
	// inside consumeToken. Every other verdict falls through to consumeToken,
	// which throws the single undifferentiated refusal.
	const peeked = await tx
		.select()
		.from(applicationEmailToken)
		.where(eq(applicationEmailToken.tokenHash, hashToken(input.token)))
		.limit(1);
	if (peeked[0] && peeked[0].purpose === 'activate' && peeked[0].consumedAt !== null) {
		return convergeReplay(tx, peeked[0].applicationId, input);
	}

	const consumed = await consumeToken(tx, input.token, 'activate', now);

	const appRows = await tx.select().from(application).where(eq(application.id, consumed.applicationId)).limit(1);
	if (appRows.length !== 1 || appRows[0].status !== 'approved') {
		// A withdrawn/declined application's activation link is dead. Same
		// public shape as every token refusal — no state oracle.
		throw new TokenRejectedError('wrong_purpose');
	}
	const app = appRows[0];

	const standing = await membershipByApplication(tx, app.id);
	if (!standing) throw new MembershipNotFoundError();
	const row = await lockMembership(tx, standing.id);
	checkMembershipVersion(row, input.expectedVersion);
	if (row.status !== 'pending_assent') {
		throw new IllegalMembershipTransitionError(row.status, 'activate');
	}

	const member = await personById(tx, row.personId);
	if (!member) throw new MembershipNotFoundError();

	// Row 10 guard: activation records the CURRENT agreement version.
	const agreement = await requireCurrentAgreement(tx, input.agreementVersionId, now);

	const address = (await currentEmail(tx, member.id))?.email ?? normalizeEmail(app.email);

	// Password + account, via S2's adapter seam. A standing auth user under
	// this handle means an identity-merge case no ratified row defines: refuse
	// loudly (see ActivationConflictError).
	let authUser;
	try {
		authUser = await createUserWithPassword(
			tx,
			row.tenantId,
			{ handle: address, email: address, displayName: member.displayName, password: input.password },
			input.hashOptions ?? {},
		);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505') {
			throw new ActivationConflictError();
		}
		throw error;
	}

	// The S6 atomicity acceptance row's injection point: a failure HERE must
	// leave no auth user, no assent, no Active membership, no audit row.
	await input.afterPasswordCreate?.();

	await tx.insert(assent).values({
		tenantId: row.tenantId,
		membershipId: row.id,
		personId: member.id,
		agreementVersionId: agreement.id,
		assentedAt: now,
	});

	const updated = await tx
		.update(membership)
		.set({
			status: 'active',
			version: row.version + 1,
			agreementVersionId: agreement.id,
			activatedAt: now,
			updatedAt: now,
		})
		.where(eq(membership.id, row.id))
		.returning();

	await tx.update(person).set({ authUserId: authUser.id }).where(eq(person.id, member.id));

	// Row 10's audit record: agreement version REQUIRED — write.ts enforces it.
	await writeAudit(tx, {
		actorType: 'person',
		actorId: member.id,
		aggregateType: 'membership',
		aggregateId: row.id,
		event: 'membership.activated',
		fromStatus: 'pending_assent',
		toStatus: 'active',
		agreementVersionId: agreement.id,
		now,
	});

	// ADR 0024 §1.5: fresh activation emits the idempotent discussion-list
	// projection intent (`provision.add_lists`), SAME transaction as the
	// membership commit — the outbox contract's enqueue rule, and the reason
	// the converge-replay path above never reaches this line (the original
	// activation already enqueued; identity keys make even a double-commit
	// convergent). See ./provision.ts and the discuss-board lifecycle spec.
	await enqueueProvisioning(tx, updated[0]);

	// Session issuance, same unit of work. authenticate re-verifies the
	// password against the hash just written and mints the session through
	// the same adapter seam — no separate session door.
	const { session } = await authenticate(tx, row.tenantId, {
		handle: address,
		password: input.password,
		metadata: input.metadata,
	});

	return {
		membership: updated[0],
		person: { ...member, authUserId: authUser.id },
		session,
		activated: true,
	};
}

/**
 * The consumed-token replay path: converge on the original result iff the
 * membership really is active AND the presented password verifies. See
 * activateMembership's doc block.
 */
async function convergeReplay(
	tx: DbTransaction,
	applicationId: string,
	input: ActivateInput,
): Promise<ActivationResult> {
	const standing = await membershipByApplication(tx, applicationId);
	if (!standing || standing.status !== 'active') {
		throw new TokenRejectedError('consumed');
	}
	const member = await personById(tx, standing.personId);
	const address = member ? (await currentEmail(tx, member.id))?.email : undefined;
	if (!member || !address) throw new TokenRejectedError('consumed');
	// Wrong password throws AuthError 401 — the replayer must still prove the
	// credential the original activation set.
	const { session } = await authenticate(tx, standing.tenantId, {
		handle: address,
		password: input.password,
		metadata: input.metadata,
	});
	return { membership: standing, person: member, session, activated: false };
}

export interface ChangeEmailInput {
	personId: string;
	newEmail: string;
	now?: Date;
}

/**
 * Change a person's address, HISTORY-PRESERVING (spec §4: email is a
 * normalized, verified, MUTABLE identifier with history — never a key; S6
 * acceptance row 3: `person_id` survives the change and the prior address
 * remains in `person_email`). Supersede the current row (one-way, DB-trigger
 * enforced) and append the new one; `person_id` is untouched by construction
 * — there is nothing on the person row to update.
 *
 * NOTE the auth handle is NOT rewritten here: the auth user's handle/email
 * follow through the S2 adapter on the member's next credentialed flow, and
 * `auth_user_id` is a nullable foreign identifier precisely so identity never
 * depends on it (spec §4). Recorded as part of this slice's PR notes.
 */
export async function changeEmail(tx: DbTransaction, input: ChangeEmailInput): Promise<PersonEmail> {
	const now = input.now ?? new Date();
	const member = await personById(tx, input.personId);
	if (!member) throw new MembershipNotFoundError();
	const address = normalizeEmail(input.newEmail);
	if (address.length === 0 || !address.includes('@')) {
		throw new Error('changeEmail: a normalized, non-empty address is required.');
	}
	await tx
		.update(personEmail)
		.set({ supersededAt: now })
		.where(and(eq(personEmail.personId, member.id), isNull(personEmail.supersededAt)));
	const rows = await tx
		.insert(personEmail)
		.values({
			tenantId: member.tenantId,
			personId: member.id,
			email: address,
			effectiveFrom: now,
		})
		.returning();
	return rows[0];
}

/** Full address history for a person, oldest first — the record, not state. */
export async function emailHistory(tx: DbTransaction, personId: string): Promise<PersonEmail[]> {
	return tx
		.select()
		.from(personEmail)
		.where(eq(personEmail.personId, personId))
		.orderBy(personEmail.effectiveFrom, personEmail.id);
}
