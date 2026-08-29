/**
 * Member v0 tenant-scoped schema (TIN-3817 slice S1).
 *
 * SHAPE, IN ONE PARAGRAPH. Shared schema, `tenant_id uuid NOT NULL` on every
 * row-bearing table, every unique constraint led by `tenant_id`, and row-level
 * security enforced in PostgreSQL — not schema-per-tenant. The five reasons
 * are in the executable-slices spec §1.3; the load-bearing one is that
 * `@tummycrypt/tinyland-auth-pg@0.2.4` is a Pattern B tenant-scoped adapter
 * whose every method takes `tenantId` first, so schema-per-tenant would mean
 * forking the adapter.
 *
 * WHY THERE ARE NO POLICIES IN THIS FILE. `drizzle-kit@0.30` can emit
 * `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY`, but it cannot emit
 * `FORCE ROW LEVEL SECURITY` — and FORCE is the half that matters, because
 * without it the table owner (the migration role) silently bypasses every
 * policy. Declaring half the isolation here and half in a hand-written
 * migration would split the source of truth and make `drizzle-kit generate`
 * diff against a shape the database does not have. So ALL of the RLS DDL lives
 * in the checked-in custom migration `0002_rls_force_and_runtime_grants.sql`, and the
 * guard against a table shipping unprotected is a catalog assertion in
 * `rls.integration.test.ts` that iterates `pg_class` rather than a promise in a
 * comment.
 *
 * S2 added `member_role_grant` (below). The `auth.*` tables deliberately have
 * NO Drizzle bindings in this file, revising S1's earlier note that S2 would
 * add them: this file is `drizzle-kit generate`'s diff surface, and binding
 * tables whose DDL lives in the vendored migration `0001_*` would make the
 * next `generate` re-emit their CREATEs into a new migration that then
 * collides with 0001 at apply time. The adapter package
 * (`@tummycrypt/tinyland-auth-pg`) ships its own Drizzle objects for `auth.*`
 * and is their only query surface; app code reaches them through
 * `src/lib/server/auth/` and never re-declares them. S3 adds the outbox
 * dispatcher over the table declared here.
 */

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

/**
 * Outbox lifecycle (spec §3.1). `dead` is terminal for the dispatcher and
 * inspectable/replayable by an operator; it is never dropped.
 */
export const outboxStatus = pgEnum('outbox_status', ['pending', 'leased', 'done', 'dead']);

/**
 * The tenant registry.
 *
 * This is the one table whose `tenant_id` IS its primary key, because a tenant
 * row is the tenant. That also makes it the one documented exception to
 * "every unique constraint is `(tenant_id, …)`": `slug` is unique GLOBALLY,
 * since a per-tenant-unique slug on the table that defines tenants would let
 * two tenants claim the same name.
 *
 * TIN-3817 scopes Member v0 to one configured GFTB tenant and there is no
 * tenant UI. The table exists anyway so `tenant_id` is a foreign key into
 * something real rather than a free-floating uuid, and so "exactly one tenant
 * exists" is a queryable fact instead of an assumption.
 */
export const tenant = pgTable(
	'tenant',
	{
		tenantId: uuid('tenant_id').primaryKey().defaultRandom(),
		slug: text('slug').notNull(),
		displayName: text('display_name').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex('tenant_slug_unique').on(t.slug)],
);

/**
 * The transactional outbox (spec §6 "Outbox contract", field list fixed by
 * spec §3.1).
 *
 * S1 creates the table, the uniqueness constraint, and the claim index. S3
 * implements `enqueue(tx, job)` and the dispatcher. The table is created early
 * on purpose: S3 depends only on S1, so shipping the shape now is what lets S3
 * proceed in parallel with S2 if the operator ever lifts WIP=1.
 *
 * `max_attempts` default 8, lease 60s, and batch 32 are the spec's recorded
 * ASSUMPTIONs awaiting sitting #2. 8 is a column default and per-job
 * overridable, which is why it is cheap to change.
 */
export const outboxJob = pgTable(
	'outbox_job',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		kind: text('kind').notNull(),
		aggregateType: text('aggregate_type').notNull(),
		aggregateId: uuid('aggregate_id').notNull(),
		payload: jsonb('payload').notNull(),
		idempotencyKey: text('idempotency_key').notNull(),
		status: outboxStatus('status').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(8),
		availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
		lastError: text('last_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique('outbox_job_idem_uniq').on(t.tenantId, t.kind, t.idempotencyKey),
		// The dispatcher's claim predicate, in the order it scans: tenant first
		// (RLS already restricts to it), then availability. Partial on the two
		// claimable states so done/dead rows do not bloat the index.
		index('outbox_job_claimable')
			.on(t.tenantId, t.availableAt)
			.where(sql`${t.status} in ('pending', 'leased')`),
	],
);

/**
 * Role grants, orthogonal to membership state (TIN-3817 slice S2).
 *
 * Ratified 2026-08-21 — decisions/0018 (meta PR #32, pending operator
 * signature), sitting #2 Item 2. The executable-slices spec §1.4 role MODEL
 * (`member` implied by Active membership; `keyholder` and `finance` as
 * grants; `steward` omitted) is ratified option 1, verbatim. This table
 * remains the MECHANICAL half assigned to S2: rows, uniqueness, RLS, and
 * grant/revoke access in `src/lib/server/auth/roles.ts`. It deliberately
 * still encodes NO vocabulary in the schema itself:
 *
 *   - `role` stays `text`, not an enum and not CHECK-constrained. Now that
 *     the vocabulary is ratified it CAN land as an app-level constant plus
 *     an optional follow-up CHECK migration; this table simply hasn't taken
 *     that follow-up yet, not because anything is still undecided.
 *   - No capability mapping lives here or in roles.ts — what a `keyholder`
 *     may do is S5's to enforce (now on the ratified basis); what `finance`
 *     may see is S8's (slices §6.4).
 *
 * Column tuple is exactly the drafted shape: `(tenant_id, person_id, role,
 * granted_by, granted_at, revoked_at)`, plus a surrogate `id` because a
 * person can be re-granted a role after revocation and history is append-only
 * — so the natural triple is only unique among LIVE grants (partial unique
 * index below). Grants are revoked by setting `revoked_at`, never deleted.
 *
 * `person_id` and `granted_by` are deliberately NOT foreign keys yet: the
 * `person` table is S6's (slices §1.8), and inventing a placeholder here
 * would put its shape in the wrong slice. S6 adds the FKs in its own
 * migration when `person` exists.
 */
export const memberRoleGrant = pgTable(
	'member_role_grant',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		personId: uuid('person_id').notNull(),
		role: text('role').notNull(),
		grantedBy: uuid('granted_by').notNull(),
		grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
	},
	(t) => [
		// One LIVE grant per (tenant, person, role); revoked rows stay as history.
		uniqueIndex('member_role_grant_live_uniq')
			.on(t.tenantId, t.personId, t.role)
			.where(sql`${t.revokedAt} is null`),
		// The authorization check's scan: "what live roles does this person hold".
		index('member_role_grant_person').on(t.tenantId, t.personId),
	],
);

/* ────────────────────────────────────────────────────────────────────────────
 * Payment rails (TIN-3818 scaffold: slices S8/S9 shapes, test-mode only).
 *
 * Cash and check are RAILS, not a Stripe fallback (slices §3.3): they have
 * their own append-only receipt table and never fabricate a Stripe object.
 * Stripe is TEST-MODE ONLY by construction — the seven-row live gate (spec §5;
 * its FORM is PROPOSED for ratification in ADR 0016 §5.1, unsigned — the
 * 2026-08-18 Card C ruling in §3 decided only the §11 fallback question)
 * stays CLOSED; `ENABLE-LIVE-STRIPE` is Jess-only and out of scope for this
 * slice.
 *
 * `person_id` is a plain uuid, not a foreign key: S4 owns the person/
 * application tables and has not landed. Adding the FK when S4 merges is a
 * one-line generated migration; shipping a fake person table from this slice
 * would cross S4's file fence.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Contribution lifecycle (spec §5 "State and privacy", verbatim enum). */
export const contributionState = pgEnum('contribution_state', [
	'none',
	'zero',
	'cash_pending',
	'cash_recorded',
	'stripe_pending',
	'stripe_active',
	'stripe_past_due',
	'cancelled',
	'refunded',
]);

/**
 * One contribution agreement per person (slices §3.3). The sensitive columns —
 * rail, cadence, amount — are finance-only; the keyholder serializer in
 * `$lib/server/contribution/visibility.ts` returns the closed
 * `{offered, helpRequested}` shape and a structural test pins it.
 */
export const contributionAgreement = pgTable(
	'contribution_agreement',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		personId: uuid('person_id').notNull(),
		state: contributionState('state').notNull().default('none'),
		rail: text('rail'),
		cadence: text('cadence'),
		amountCents: integer('amount_cents'),
		helpRequested: boolean('help_requested').notNull().default(false),
		offeredAt: timestamp('offered_at', { withTimezone: true }),
		version: integer('version').notNull().default(1),
	},
	(t) => [
		unique('contribution_one_per_person').on(t.tenantId, t.personId),
		check('contribution_agreement_amount_nonneg', sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
		check('contribution_agreement_rail', sql`${t.rail} is null or ${t.rail} in ('zero', 'cash', 'check', 'stripe')`),
	],
);

/**
 * The operator-entered cash/check receipt (spec §5 cash/check path, slices
 * §3.3).
 *
 * APPEND-ONLY BY GRANT, not by convention: migration 0005 revokes UPDATE and
 * DELETE on this table from the runtime role, so a correction can only be a
 * new row whose `reverses_id` points at the original (and a fresh receipt
 * following it when the corrected figure differs).
 *
 * `idempotency_key` is an ADDITION to the slices §3.3 DDL: spec §6 requires
 * every mutation to accept an `Idempotency-Key` and S8's acceptance row
 * requires "recording a receipt twice with one Idempotency-Key yields one
 * receipt"; a unique key on the table is the structural way to satisfy both.
 * Flagged in the PR body for the S8 reviewer. A second flagged gap for that
 * reviewer: slices §3.3 prose also describes "a `replaces` row following it
 * if the corrected figure differs", and no `replaces_id` column exists here —
 * the replacement is an ordinary receipt, linked only by narrative order.
 * Whether the S8 reviewer wants an explicit `replaces_id` is their call.
 *
 * `reverses_id` is a COMPOSITE self-reference on `(tenant_id, id)`, not a bare
 * FK on `id`: PostgreSQL evaluates FK checks with the referenced table owner's
 * rights and BYPASSES row-level security, so a single-column FK would accept a
 * reversal pointing at another tenant's receipt. Pairing the tenant column
 * into the FK makes a cross-tenant pointer unrepresentable at the constraint
 * level; the write path re-checks in-tenant anyway (receipt.ts).
 *
 * Reporting note: a naive `SUM(amount_cents)` DOUBLE-COUNTS corrected
 * receipts, because amounts are always positive (`> 0` check) and a reversal
 * is a marker row, not a negative amount. Every sum over this table must be
 * reversal-aware — use `netAmountCents` in `$lib/server/contribution/receipt`.
 *
 * `check_ref_last4` stores at most the last four digits of a check reference,
 * never routing or account numbers (slices §1.10 ASSUMPTION, resolver Jess).
 */
export const financeReceipt = pgTable(
	'finance_receipt',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		personId: uuid('person_id').notNull(),
		rail: text('rail').notNull(),
		amountCents: integer('amount_cents').notNull(),
		receivedOn: date('received_on').notNull(),
		cadence: text('cadence').notNull(),
		recordedBy: uuid('recorded_by').notNull(),
		note: text('note'),
		checkRefLast4: text('check_ref_last4'),
		reversesId: uuid('reverses_id'),
		idempotencyKey: text('idempotency_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique('finance_receipt_idem_uniq').on(t.tenantId, t.idempotencyKey),
		// (tenant_id, id) is trivially unique given the id PK; it exists so the
		// composite FK below can pair the tenant into the reference.
		unique('finance_receipt_tenant_row_uniq').on(t.tenantId, t.id),
		foreignKey({
			name: 'finance_receipt_reverses_in_tenant_fk',
			columns: [t.tenantId, t.reversesId],
			foreignColumns: [t.tenantId, t.id],
		}),
		check('finance_receipt_rail', sql`${t.rail} in ('cash', 'check')`),
		check('finance_receipt_amount_positive', sql`${t.amountCents} > 0`),
		check('finance_receipt_cadence', sql`${t.cadence} in ('monthly', 'annual', 'one_time')`),
	],
);

/**
 * The durable Stripe webhook inbox (slices §3.2 DDL).
 *
 * The composite primary key IS the idempotency mechanism: the webhook handler
 * inserts `on conflict do nothing`, so duplicate and concurrent redeliveries
 * of one `event_id` collapse to one row without an application-level lock.
 * A raw event is persisted BEFORE the 2xx; projection is a separate consumer
 * (spec §5, §10 Stripe row). `livemode` is stored so the catalogue itself
 * shows that only `false` ever landed while the gate is closed.
 */
export const stripeEventInbox = pgTable(
	'stripe_event_inbox',
	{
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		eventId: text('event_id').notNull(),
		eventType: text('event_type').notNull(),
		apiVersion: text('api_version').notNull(),
		livemode: boolean('livemode').notNull(),
		payload: jsonb('payload').notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp('processed_at', { withTimezone: true }),
		processAttempts: integer('process_attempts').notNull().default(0),
		lastError: text('last_error'),
	},
	(t) => [primaryKey({ name: 'stripe_event_inbox_pkey', columns: [t.tenantId, t.eventId] })],
);

/**
 * The application aggregate (TIN-3440 slice S4; spec §4 application state
 * machine, executable-slices §1.6).
 *
 * STATES. `status` is `text`, constrained by a hand-written CHECK in the
 * migration (drizzle-kit cannot see hand-finished SQL; 0002/0003 precedent) to
 * the eight PERSISTED states of the ratified FSM:
 * `submitted → email_verified → claimed → tour_scheduled → approved |
 * declined | withdrawn | expired`. `draft` is deliberately absent: slices
 * §2.2 row 1 makes `begin` client-side only — no draft row ever exists
 * server-side, so no minimal-fields-violating partial ever needs storing.
 * `claimed`/`tour_scheduled`/decision states are S5's transitions; the column
 * admits them now so S5 adds no schema change to this table.
 *
 * FIELDS are exactly TIN-3440's intake list ("display name, verified external
 * email, interests/help offer, tour availability, and required disclosures")
 * plus the 18+ attestation mechanics (slices §1.6 AMENDMENT: `age_attested_at`
 * + `age_attestation_version`, NO date of birth, no age, no identity
 * document). There is structurally NO contribution column — "It captures no
 * contribution choice or payment intent before approval" (TIN-3440), asserted
 * by an information_schema scan in the integration suite.
 *
 * EMAIL is a normalized, mutable identifier and NEVER a key (spec §4
 * identifiers): note there is no unique constraint on it — an address may
 * hold several applications, which is also what makes the non-enumerating
 * "same response as a fresh address" behaviour honest rather than faked
 * (spec §4 rules; S4 acceptance).
 *
 * IDEMPOTENT SUBMISSION: `submission_idempotency_key` is unique per tenant —
 * a duplicate `Idempotency-Key` returns the original receipt and creates no
 * second application (spec §6 request contract; S4 acceptance).
 *
 * `version` is the `expectedVersion` optimistic-concurrency counter every
 * state transition carries (spec §4: "stale writes require `expectedVersion`
 * and return a conflict").
 */
export const application = pgTable(
	'application',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		status: text('status').notNull().default('submitted'),
		displayName: text('display_name').notNull(),
		email: text('email').notNull(),
		interestsHelpOffer: text('interests_help_offer').notNull(),
		tourAvailability: text('tour_availability').notNull(),
		disclosures: text('disclosures').notNull(),
		ageAttestedAt: timestamp('age_attested_at', { withTimezone: true }).notNull(),
		ageAttestationVersion: text('age_attestation_version').notNull(),
		submissionIdempotencyKey: text('submission_idempotency_key').notNull(),
		version: integer('version').notNull().default(1),
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// The idempotent-submission dedupe line (spec §6; S4 acceptance row 5).
		unique('application_submission_idem_uniq').on(t.tenantId, t.submissionIdempotencyKey),
		// Review-queue scan (S5 consumes) and the duplicate-address lookup.
		index('application_status').on(t.tenantId, t.status),
		index('application_email').on(t.tenantId, t.email),
	],
);

/**
 * Email-delivered single-use tokens for the application aggregate (TIN-3440
 * slice S4; spec §4: "verification tokens are random, opaque, hashed at rest,
 * single-use, and expiring").
 *
 * ONLY THE HASH IS STORED. `token_hash` is the SHA-256 hex of the plaintext
 * token; the plaintext exists only in the minting call's return value and in
 * the email the future `application.receipt_email` handler sends. It never
 * enters a log line, an audit row, or the outbox `payload` (S3's payload
 * doctrine in `src/lib/server/outbox/schema.ts` forbids tokens there) —
 * asserted by a log-capture unit test.
 *
 * PURPOSES (`purpose`, CHECK-constrained in the migration):
 *   - `verify_email` — the A3 `submitted → email_verified` transition's
 *     bearer credential. `expires_at` is NOT NULL for this purpose, by CHECK:
 *     "expiring" is part of the spec's token rule, structurally.
 *   - `withdraw` — the single-use withdrawal credential the A2 receipt email
 *     carries so A8 is reachable before verification (slices §2.2 row 8).
 *     No time expiry (ASSUMPTION, resolver Jess: it dies with the
 *     application's terminality instead — a time-boxed withdrawal right would
 *     be an invented policy).
 *
 * SINGLE-USE is one-way and database-enforced: a trigger in the migration
 * makes `consumed_at` the only writable column, NULL → NOT NULL, exactly
 * once, and forbids DELETE — the `member_role_grant`/`finance_receipt`
 * append-only doctrine applied to a credential row.
 */
export const applicationEmailToken = pgTable(
	'application_email_token',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		applicationId: uuid('application_id')
			.notNull()
			.references(() => application.id),
		purpose: text('purpose').notNull(),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// Bearer lookup is by hash; tenant leads every unique (S1 shape rule).
		unique('application_email_token_hash_uniq').on(t.tenantId, t.tokenHash),
		index('application_email_token_app').on(t.tenantId, t.applicationId),
	],
);

/**
 * A keyholder's live claim on one application review (TIN-3440 slice S5;
 * spec §4 A4 `claim`; spec §6 "exactly one keyholder claims a review at a
 * time, enforced by partial unique index").
 *
 * THE PARTIAL UNIQUE INDEX IS THE CONTRACT'S NAMED MECHANISM: at most one row
 * per `(tenant_id, application_id)` may have `released_at IS NULL`. The claim
 * write path also `SELECT … FOR UPDATE`s the application row, so racing
 * claims serialise and the loser gets an explicit conflict rather than a
 * unique-violation 500 — but the index is what makes "one live claim" a
 * database fact rather than an application promise.
 *
 * `released_at` exists ONLY for the explicit operator un-claim path (slices
 * §1.7 rollback note: "a claimed, undecided application returns to
 * `email_verified` only by explicit operator action" — never auto-released on
 * deploy). No such surface ships in S5; the column and its one-way trigger
 * ship so the operator path needs no schema change. A claim on an application
 * that later reaches a terminal state is left LIVE on purpose: it is the
 * history of who reviewed, and rewriting it would edit the record.
 *
 * `keyholder_person_id` is deliberately NOT a foreign key: the `person` table
 * is S6's (slices §1.8), the exact 0003 `member_role_grant` precedent. S6
 * adds the FK in its own migration when `person` exists.
 */
export const applicationClaim = pgTable(
	'application_claim',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		applicationId: uuid('application_id')
			.notNull()
			.references(() => application.id),
		keyholderPersonId: uuid('keyholder_person_id').notNull(),
		claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
		releasedAt: timestamp('released_at', { withTimezone: true }),
	},
	(t) => [
		// The spec §6 mechanism: one LIVE claim per application, ever.
		uniqueIndex('application_claim_live_uniq')
			.on(t.tenantId, t.applicationId)
			.where(sql`${t.releasedAt} is null`),
		// "What is this keyholder reviewing" — the queue's claimant join.
		index('application_claim_keyholder').on(t.tenantId, t.keyholderPersonId),
	],
);

/**
 * The one recorded decision on an application (TIN-3440 slice S5; spec §4
 * A6 `approve` / A7 `decline`; TIN-3440 "must record a reason").
 *
 * ONE DECISION PER APPLICATION, by unique constraint: the FSM admits exactly
 * one terminal keyholder decision, and the table shape says so. Withdrawal
 * (A8) is the APPLICANT's act and records no row here — its record is the
 * application's `withdrawn` status and the S6 audit spine's future
 * `application.withdrawn` event.
 *
 * `reason_class` is required for `declined` by CHECK (the recorded-reason
 * rule, structurally) and is free text, not an enum: no decline-reason
 * vocabulary is ratified anywhere, so constraining it by migration would
 * invent one — the 0003 role-vocabulary posture applied again. `note` is the
 * spec §4 "operational notes" slot; NEITHER column may carry contribution
 * data (spec §4: decision records carry "no contribution data" — there is
 * structurally nothing to copy it from pre-approval, and the integration
 * suite scans this table's columns like it scans `application`'s).
 *
 * Rows are immutable — grant + trigger in migration 0008, the
 * finance_receipt/member_role_grant append-only doctrine: a decision is the
 * audit record of the decisive act and cannot be rewritten from the runtime.
 *
 * `decided_by` is not yet an FK for the S6 `person` reason above.
 */
export const applicationDecision = pgTable(
	'application_decision',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		applicationId: uuid('application_id')
			.notNull()
			.references(() => application.id),
		decision: text('decision').notNull(),
		decidedBy: uuid('decided_by').notNull(),
		reasonClass: text('reason_class'),
		note: text('note'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique('application_decision_one_per_application').on(t.tenantId, t.applicationId)],
);

/* ────────────────────────────────────────────────────────────────────────────
 * Member identity, membership, assent, and the audit spine (TIN-3440 slices
 * S6/S7; spec §4 identifiers + membership state machine; executable slices
 * §1.8/§1.9).
 *
 * Composite-FK doctrine, inherited from `finance_receipt`: PostgreSQL
 * evaluates FK checks with the referenced table owner's rights and BYPASSES
 * row-level security, so every reference to a tenant-scoped row pairs the
 * tenant column into the FK — a cross-tenant pointer is unrepresentable at
 * the constraint level.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A person (spec §4 identifiers): `person_id` is an immutable UUID generated
 * by the application at A6 approval (slices §2.2 row 6: "provision `person`").
 *
 * `auth_user_id` is NULLABLE and foreign-by-name only: membership must
 * survive auth-adapter replacement (spec §4), so no FK reaches into `auth.*`.
 * It is set at M1 activation when the auth user is created, and a partial
 * unique index keeps one person per auth user.
 *
 * EMAIL IS DELIBERATELY NOT A COLUMN HERE. The address is a normalized,
 * verified, MUTABLE identifier with history and never a key (spec §4;
 * TIN-3440 bullet 1) — it lives in `person_email` rows, of which exactly one
 * per person is current. `person_id` survives every address change (S6
 * acceptance row 3).
 *
 * `application_id` records provenance: which approved application provisioned
 * this person. One person per application, by unique constraint.
 */
export const person = pgTable(
	'person',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		applicationId: uuid('application_id')
			.notNull()
			.references(() => application.id),
		displayName: text('display_name').notNull(),
		authUserId: uuid('auth_user_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique('person_one_per_application').on(t.tenantId, t.applicationId),
		// Trivially unique given the id PK; exists so composite FKs below can
		// pair the tenant into the reference (finance_receipt precedent).
		unique('person_tenant_row_uniq').on(t.tenantId, t.id),
		uniqueIndex('person_auth_user_uniq')
			.on(t.tenantId, t.authUserId)
			.where(sql`${t.authUserId} is not null`),
	],
);

/**
 * Email history (spec §4: "email address: normalized, verified, mutable
 * identifier with history; never a primary key"). Exactly one row per person
 * has `superseded_at IS NULL` — the current address; a change supersedes the
 * old row (one-way, trigger-enforced in migration 0009) and appends a new
 * one. Rows are never deleted (retention: spec §14 item 4 — Member v0
 * deletes nothing).
 */
export const personEmail = pgTable(
	'person_email',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		personId: uuid('person_id').notNull(),
		email: text('email').notNull(),
		effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
		supersededAt: timestamp('superseded_at', { withTimezone: true }),
	},
	(t) => [
		foreignKey({
			name: 'person_email_person_in_tenant_fk',
			columns: [t.tenantId, t.personId],
			foreignColumns: [person.tenantId, person.id],
		}),
		// The one current address per person (S6 acceptance row 3's "history"
		// half depends on supersession being one-way, never overwrite).
		uniqueIndex('person_email_current_uniq')
			.on(t.tenantId, t.personId)
			.where(sql`${t.supersededAt} is null`),
		index('person_email_lookup').on(t.tenantId, t.email),
	],
);

/**
 * Versioned membership agreement (slices §1.8 ASSUMPTION, drafted scheme —
 * sitting-2 item 3 mechanics, values land as data ~2026-08-22):
 * monotonically increasing integer `id` per tenant, immutable `body_sha256`,
 * `effective_from`; assent stores the integer, never the text. "Current" is
 * the greatest `effective_from` at or before now (tie: highest id) — a pure
 * function of append-only rows, so exactly one version is current without any
 * mutable `is_current` flag to desynchronise. Rows are append-only and
 * immutable by grant + trigger (migration 0009).
 *
 * `body` is stored so the assent page can display the exact text whose digest
 * the person assents to; version 1's BODY is the initial membership agreement
 * — operator-approved with the gate-row-4 copy work, SEPARABLE from
 * contribution copy (ADR 0016 §2.3), and never agent-authored as published.
 */
export const agreementVersion = pgTable(
	'agreement_version',
	{
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		id: integer('id').notNull(),
		bodySha256: text('body_sha256').notNull(),
		body: text('body').notNull(),
		effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ name: 'agreement_version_pkey', columns: [t.tenantId, t.id] }),
		check('agreement_version_id_positive', sql`${t.id} > 0`),
	],
);

/**
 * The membership aggregate (spec §4 membership state machine; slices §2.2
 * rows 10–14). `status` is `text` CHECK-constrained in migration 0009 to the
 * five ratified states: `pending_assent → active ↔ paused → left | removed`,
 * with BOTH `active → removed` and `paused → removed` (the ratified
 * `member-lifecycle.mmd` and TIN-3440 "forcibly remove" over the ASCII's
 * literal shape — slices §1.9 note). `left`/`removed` are terminal;
 * reinstatement after `removed` is a NEW application, never a transition
 * (slices §1.9 ASSUMPTION, resolver Jess).
 *
 * `version` is the `expectedVersion` optimistic-concurrency counter (spec §4;
 * REQUIRED on rows 13/14 — leave/remove).
 *
 * NO CONTRIBUTION COLUMN, STRUCTURALLY: membership transitions never query
 * contribution state (spec §5; member-projection-flow.mmd "never changes
 * membership"), and this table gives them nothing to query.
 */
export const membership = pgTable(
	'membership',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		personId: uuid('person_id').notNull(),
		applicationId: uuid('application_id')
			.notNull()
			.references(() => application.id),
		status: text('status').notNull().default('pending_assent'),
		version: integer('version').notNull().default(1),
		agreementVersionId: integer('agreement_version_id'),
		activatedAt: timestamp('activated_at', { withTimezone: true }),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		foreignKey({
			name: 'membership_person_in_tenant_fk',
			columns: [t.tenantId, t.personId],
			foreignColumns: [person.tenantId, person.id],
		}),
		foreignKey({
			name: 'membership_agreement_in_tenant_fk',
			columns: [t.tenantId, t.agreementVersionId],
			foreignColumns: [agreementVersion.tenantId, agreementVersion.id],
		}),
		unique('membership_one_per_application').on(t.tenantId, t.applicationId),
		// Composite-FK anchor, the person/finance_receipt precedent.
		unique('membership_tenant_row_uniq').on(t.tenantId, t.id),
		// One NON-terminal membership per person: a removed/left history row
		// never blocks the new application the reinstatement path requires.
		uniqueIndex('membership_live_uniq')
			.on(t.tenantId, t.personId)
			.where(sql`${t.status} not in ('left', 'removed')`),
		index('membership_status').on(t.tenantId, t.status),
	],
);

/**
 * The assent record (slices §2.2 row 10): who assented, to WHICH agreement
 * version (the integer — never the text), for which membership, when. One
 * assent per membership, immutable and append-only (migration 0009) — the
 * durable half of "assent is to the current agreement version" that M1's
 * audit row cites.
 */
export const assent = pgTable(
	'assent',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		membershipId: uuid('membership_id').notNull(),
		personId: uuid('person_id').notNull(),
		agreementVersionId: integer('agreement_version_id').notNull(),
		assentedAt: timestamp('assented_at', { withTimezone: true }).notNull(),
	},
	(t) => [
		foreignKey({
			name: 'assent_membership_in_tenant_fk',
			columns: [t.tenantId, t.membershipId],
			foreignColumns: [membership.tenantId, membership.id],
		}),
		foreignKey({
			name: 'assent_person_in_tenant_fk',
			columns: [t.tenantId, t.personId],
			foreignColumns: [person.tenantId, person.id],
		}),
		foreignKey({
			name: 'assent_agreement_in_tenant_fk',
			columns: [t.tenantId, t.agreementVersionId],
			foreignColumns: [agreementVersion.tenantId, agreementVersion.id],
		}),
		unique('assent_one_per_membership').on(t.tenantId, t.membershipId),
	],
);

/**
 * The audit spine (TIN-3440 slice S6; spec §6 audit contract): every row
 * carries actor, aggregate, transition, result, policy/agreement version, and
 * timestamp — and structurally CANNOT carry tokens, secrets, object URLs, or
 * free-text personal content, because the shape is CLOSED: there is no
 * free-text column. `reason_class` is a short classification (validated at
 * the write seam in `src/lib/server/audit/write.ts`), `token_hash` is the
 * hash-only slot spec row 3 names ("token hash only, never plaintext"), and
 * `reauth_at` is row 14's required reauthentication timestamp.
 *
 * Rows are append-only and immutable — grant + trigger in migration 0009,
 * the application_decision doctrine: an audit record that the runtime can
 * rewrite is not an audit record.
 */
export const auditEvent = pgTable(
	'audit_event',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		actorType: text('actor_type').notNull(),
		actorId: uuid('actor_id'),
		aggregateType: text('aggregate_type').notNull(),
		aggregateId: uuid('aggregate_id').notNull(),
		event: text('event').notNull(),
		fromStatus: text('from_status'),
		toStatus: text('to_status'),
		result: text('result').notNull().default('committed'),
		agreementVersionId: integer('agreement_version_id'),
		reasonClass: text('reason_class'),
		reauthAt: timestamp('reauth_at', { withTimezone: true }),
		tokenHash: text('token_hash'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index('audit_event_aggregate').on(t.tenantId, t.aggregateType, t.aggregateId),
		check('audit_event_actor', sql`${t.actorType} in ('person', 'system', 'public')`),
		check('audit_event_actor_id_required', sql`${t.actorType} <> 'person' or ${t.actorId} is not null`),
	],
);

/**
 * The mail-delivery journal (TIN-4062; operator interview 2026-08-23: mail
 * leg funded, delivery-off default). Records what the three application-mail
 * outbox handlers (`application.receipt_email`, `application.decision_email`,
 * `application.withdrawn_ack`) actually did — and doubles as their
 * consumer-side idempotency receipt, the exact shape `outbox/schema.ts`'s
 * `ClaimedJob` docstring calls for: "a receipt keyed on (kind,
 * idempotency_key) before the effect."
 *
 * NOT AN AUDIT EVENT, DELIBERATELY. `audit_event`'s vocabulary
 * (`src/lib/server/audit/schema.ts`) is a closed, ratified 14-name list
 * (spec §6; slices §2.2 rows 2-14); `assertAuditInput` hard-rejects any
 * other name, and "delivery gate is disabled" is operational machinery, not
 * a member-lifecycle transition, so it gets its own append-only table
 * instead — the same reasoning 0003 gave for refusing to ratify a role
 * vocabulary by migration.
 *
 * TWO-PHASE, NOT ONE ROW UPDATED (PR #208 review E2). `phase` is `'intent'`
 * (written and COMMITTED before `MailDelivery.send()` is ever called) or
 * `'outcome'` (written and committed AFTER `send()` returns) — two INSERTs,
 * never an UPDATE, so the append-only grant below (`REVOKE UPDATE`) still
 * holds exactly. This is what lets the network call happen OUTSIDE any open
 * PostgreSQL transaction: the intent row's commit is the durable "we are
 * about to attempt this" fact, and the caller closes that transaction and
 * releases the outbox lease's backing connection before touching a socket —
 * a hung SMTP peer therefore blocks nothing but its own dispatch attempt,
 * never a database transaction. See `mail/journal.ts` and
 * `outbox/handlers/mail-shared.ts` for the read side of this contract: an
 * `outcome` row present means fully done (idempotent no-op on replay,
 * unchanged from the original design); an `intent` row present with NO
 * matching `outcome` row is AMBIGUOUS — the prior attempt may have sent for
 * real before crashing short of recording it — and the handler refuses to
 * guess, throwing rather than sending again. `mode` is therefore nullable:
 * it names the outcome (`'disabled'` — `DisabledDelivery` recorded a no-op;
 * `'sent'` — `SmtpDelivery` actually transmitted, unreachable in this
 * deployment absent an operator-attended env change, see
 * `src/lib/server/mail/config.ts`) and is set if-and-only-if `phase =
 * 'outcome'`, enforced by `mail_delivery_journal_mode_outcome_only` below.
 * `template_approved` mirrors the approval-gate state at the moment of the
 * write, so an operator reading the journal never has to cross-reference the
 * in-code template registry to know whether a given row COULD have sent for
 * real.
 */
export const mailDeliveryJournal = pgTable(
	'mail_delivery_journal',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		outboxJobId: uuid('outbox_job_id')
			.notNull()
			.references(() => outboxJob.id),
		kind: text('kind').notNull(),
		idempotencyKey: text('idempotency_key').notNull(),
		phase: text('phase').notNull(),
		templateId: text('template_id').notNull(),
		templateApproved: boolean('template_approved').notNull(),
		mode: text('mode'),
		detail: text('detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// One INTENT row and one OUTCOME row per (tenant, kind, idempotency_key)
		// — the phase discriminator is part of the key, the outbox_job_idem_uniq
		// shape extended for the two-phase write.
		unique('mail_delivery_journal_idem_uniq').on(t.tenantId, t.kind, t.idempotencyKey, t.phase),
		index('mail_delivery_journal_job').on(t.tenantId, t.outboxJobId),
		check('mail_delivery_journal_phase', sql`${t.phase} in ('intent', 'outcome')`),
		check('mail_delivery_journal_mode', sql`${t.mode} is null or ${t.mode} in ('disabled', 'sent')`),
		check('mail_delivery_journal_mode_outcome_only', sql`(${t.phase} = 'outcome') = (${t.mode} is not null)`),
	],
);

export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
export type OutboxJob = typeof outboxJob.$inferSelect;
export type NewOutboxJob = typeof outboxJob.$inferInsert;
export type MemberRoleGrant = typeof memberRoleGrant.$inferSelect;
export type NewMemberRoleGrant = typeof memberRoleGrant.$inferInsert;
export type ContributionAgreement = typeof contributionAgreement.$inferSelect;
export type NewContributionAgreement = typeof contributionAgreement.$inferInsert;
export type FinanceReceipt = typeof financeReceipt.$inferSelect;
export type NewFinanceReceipt = typeof financeReceipt.$inferInsert;
export type StripeEventInboxRow = typeof stripeEventInbox.$inferSelect;
export type NewStripeEventInboxRow = typeof stripeEventInbox.$inferInsert;
export type Application = typeof application.$inferSelect;
export type NewApplication = typeof application.$inferInsert;
export type ApplicationEmailToken = typeof applicationEmailToken.$inferSelect;
export type NewApplicationEmailToken = typeof applicationEmailToken.$inferInsert;
export type ApplicationClaim = typeof applicationClaim.$inferSelect;
export type NewApplicationClaim = typeof applicationClaim.$inferInsert;
export type ApplicationDecision = typeof applicationDecision.$inferSelect;
export type NewApplicationDecision = typeof applicationDecision.$inferInsert;
export type Person = typeof person.$inferSelect;
export type NewPerson = typeof person.$inferInsert;
export type PersonEmail = typeof personEmail.$inferSelect;
export type NewPersonEmail = typeof personEmail.$inferInsert;
export type AgreementVersion = typeof agreementVersion.$inferSelect;
export type NewAgreementVersion = typeof agreementVersion.$inferInsert;
export type Membership = typeof membership.$inferSelect;
export type NewMembership = typeof membership.$inferInsert;
export type Assent = typeof assent.$inferSelect;
export type NewAssent = typeof assent.$inferInsert;
export type AuditEvent = typeof auditEvent.$inferSelect;
export type NewAuditEvent = typeof auditEvent.$inferInsert;
export type MailDeliveryJournalRow = typeof mailDeliveryJournal.$inferSelect;
export type NewMailDeliveryJournalRow = typeof mailDeliveryJournal.$inferInsert;
