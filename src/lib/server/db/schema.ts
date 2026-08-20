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
 * S2 adds `member_role_grant` and the `auth.*` Drizzle bindings; S3 adds the
 * outbox dispatcher over the table declared here. Neither needs to reshape
 * anything in this file.
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

export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
export type OutboxJob = typeof outboxJob.$inferSelect;
export type NewOutboxJob = typeof outboxJob.$inferInsert;
export type ContributionAgreement = typeof contributionAgreement.$inferSelect;
export type NewContributionAgreement = typeof contributionAgreement.$inferInsert;
export type FinanceReceipt = typeof financeReceipt.$inferSelect;
export type NewFinanceReceipt = typeof financeReceipt.$inferInsert;
export type StripeEventInboxRow = typeof stripeEventInbox.$inferSelect;
export type NewStripeEventInboxRow = typeof stripeEventInbox.$inferInsert;
