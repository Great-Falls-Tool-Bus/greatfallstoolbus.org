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
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
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
 * ⚠ PENDING RATIFICATION — sitting #2, Item 2 (`meta`
 * `spec/sitting-2-packet-2026-08-22.md`, staged in meta PR #24). The
 * executable-slices spec §1.4 drafts the role MODEL (`member` implied by
 * Active membership; `keyholder` and `finance` as grants; `steward` omitted)
 * as an AMENDMENT — drafted, not ratified. This table is the MECHANICAL half
 * the packet assigns to S2: rows, uniqueness, RLS, and grant/revoke access in
 * `src/lib/server/auth/roles.ts`. It deliberately encodes NO vocabulary:
 *
 *   - `role` is `text`, not an enum and not CHECK-constrained. An enum or
 *     CHECK would ratify a role list by migration, which is exactly the
 *     decision the sitting owns. Once ratified, the vocabulary lands as an
 *     app-level constant plus (optionally) a follow-up CHECK migration.
 *   - No capability mapping lives here or in roles.ts — what a `keyholder`
 *     may do is S5's to enforce and the sitting's to ratify; what `finance`
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

export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
export type OutboxJob = typeof outboxJob.$inferSelect;
export type NewOutboxJob = typeof outboxJob.$inferInsert;
export type MemberRoleGrant = typeof memberRoleGrant.$inferSelect;
export type NewMemberRoleGrant = typeof memberRoleGrant.$inferInsert;
