/**
 * Inventory pilot schema foundation (TIN-3814 slice I1).
 *
 * Authority: meta `spec/inventory-pilot-executable-slices-2026-08-20.md` §1.2
 * (I1) and §2 (state machines / transition table); launch spec §8 (:336–356,
 * the six-entity data model, the two state lists, the partial-unique rule,
 * opaque legacy identifiers); ADR 0014 §7 (:181–198, the ratified inventory
 * pilot ruling); diagram `diagrams/launch-member-v0/inventory-custody-flow.mmd`.
 *
 * This is a bounded-context module, but not a second migration authority:
 * `drizzle.config.ts` names this file and `db/schema.ts` explicitly as the
 * complete schema input set. `just db-generate`, the checked-in journal, and
 * the immutable migration ledger therefore remain the single migration
 * graph. The earlier numbering deferral ended after Member v0 migrations
 * 0007–0010 landed; inventory now rides the next real numbered migration.
 *
 * NAMING (binding, spec §1's vocabulary rule). This file says *asset*, *loan*,
 * and *pilot intake* (I9), and avoids the four terms the slices spec retires
 * — the exact list, the rationale, and the enforcing grep gate all live in
 * `vocabulary.test.ts` in this directory, which is the single place that
 * spells them out so the ban is not repeated (and inadvertently
 * self-triggered) in every file it binds.
 *
 * OPACITY (spec §8 :354–356). `asset.legacyIdentifier` is free text, stored
 * verbatim, and this file infers nothing from it — no derived label, no
 * lookup table. The opacity grep gate lives in
 * `legacy-identifier-opacity.test.ts`.
 */

import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { person, tenant } from '../db/schema';
import {
	ASSET_COMPONENT_KINDS,
	ASSET_STATES,
	INSPECTION_KINDS,
	LOAN_STATES,
	REPAIR_CLOSE_DISPOSITIONS,
	REPAIR_OPEN_DISPOSITIONS,
} from './constants';

/** Render fixed, code-owned vocabularies into CHECK constraints. */
function sqlStringList(values: readonly string[]) {
	return sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));
}

/** Spec §8 (:349); §2.1's diagram. Built from `ASSET_STATES` (constants.ts) — one list, not two. */
export const assetState = pgEnum('asset_state', ASSET_STATES);

/** Spec §8 (:350); §2.1's diagram. Built from `LOAN_STATES`. */
export const loanState = pgEnum('loan_state', LOAN_STATES);

/**
 * `asset` — spec §8 data model, first bullet (:338–339).
 *
 * `shortId` is the human-readable label I9 assigns at intake and I3's scan
 * route resolves (slices §1.4 ASSUMPTION) — unique per tenant, never globally
 * (two tenants could each label a first bin `sew-01`).
 *
 * `legacyIdentifier` is the opaque pre-pilot identifier (spec §8 :354–356):
 * stored verbatim, nullable (a newly acquired, non-legacy asset has none),
 * and never parsed by this file or any file outside intake (I9) per the
 * opacity test.
 *
 * `parentAssetId` is the optional parent-kit reference (:339). Self-FK, paired
 * on `(tenant_id, id)` rather than bare `id` — see the module comment on
 * `assetTenantRowUniq` below for why every cross-row reference in this file
 * takes the composite form.
 *
 * `checklistVersion` is the asset's CURRENT checklist version (integer,
 * starts at 1); I2's finalize guard compares a loan's checkout/return
 * checklist version against this column, exactly as `expectedVersion` compares
 * against `version` (spec §6, same idiom as Member v0).
 */
export const asset = pgTable(
	'asset',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		shortId: text('short_id').notNull(),
		displayLabel: text('display_label').notNull(),
		kind: text('kind').notNull(),
		custodyBasis: text('custody_basis').notNull(),
		legacyIdentifier: text('legacy_identifier'),
		state: assetState('state').notNull().default('available'),
		checklistVersion: integer('checklist_version').notNull().default(1),
		parentAssetId: uuid('parent_asset_id'),
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// FK target for every OTHER table's composite (tenant_id, …) reference
		// into `asset` — see the module comment. Trivially true given the `id`
		// PK; exists to be pointed at, the same shape as
		// `finance_receipt_tenant_row_uniq`.
		unique('asset_tenant_row_uniq').on(t.tenantId, t.id),
		uniqueIndex('asset_short_id_unique').on(t.tenantId, t.shortId),
		foreignKey({
			name: 'asset_parent_in_tenant_fk',
			columns: [t.tenantId, t.parentAssetId],
			foreignColumns: [t.tenantId, t.id],
		}),
	],
);

/**
 * `asset_component` — spec §8 data model, second bullet (:340): "expected
 * contents and consumables." One row per expected item; I3's availability
 * view lists these, I4's checklist compares the return against them.
 */
export const assetComponent = pgTable(
	'asset_component',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		assetId: uuid('asset_id').notNull(),
		label: text('label').notNull(),
		kind: text('kind').notNull().default('content'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		foreignKey({
			name: 'asset_component_asset_in_tenant_fk',
			columns: [t.tenantId, t.assetId],
			foreignColumns: [asset.tenantId, asset.id],
		}),
		unique('asset_component_tenant_row_uniq').on(t.tenantId, t.id),
		check('asset_component_kind', sql`${t.kind} in (${sqlStringList(ASSET_COMPONENT_KINDS)})`),
	],
);

/**
 * `loan` — spec §8 data model, third bullet (:341–342): "member, asset,
 * checkout/expected-return/return timestamps, state, checkout and return
 * checklist versions."
 *
 * Custody follows spec §4's immutable `person_id`, not a membership row whose
 * lifecycle can end and be recreated. Pairing `tenant_id` into the FK makes a
 * cross-tenant borrower reference unrepresentable and lets offboarding join
 * open loans to the same person-keyed obligation surface.
 *
 * `expectedReturnAt` is set by I2/I3's finalize to `checkoutAt +
 * DEFAULT_LOAN_TERM_DAYS` (constants.ts) — computed at the call site, not a
 * generated column, because I8's extension explicitly moves it (spec §8
 * :383–384, "extension is an explicit versioned action").
 *
 * The partial unique index below is spec §8's headline data-model rule
 * (:351–352), reproduced verbatim from slices §1.2's SQL block.
 */
export const loan = pgTable(
	'loan',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		assetId: uuid('asset_id').notNull(),
		personId: uuid('person_id').notNull(),
		state: loanState('state').notNull().default('draft'),
		checkoutAt: timestamp('checkout_at', { withTimezone: true }),
		expectedReturnAt: timestamp('expected_return_at', { withTimezone: true }),
		returnedAt: timestamp('returned_at', { withTimezone: true }),
		checkoutChecklistVersion: integer('checkout_checklist_version'),
		returnChecklistVersion: integer('return_checklist_version'),
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique('loan_tenant_row_uniq').on(t.tenantId, t.id),
		foreignKey({
			name: 'loan_asset_in_tenant_fk',
			columns: [t.tenantId, t.assetId],
			foreignColumns: [asset.tenantId, asset.id],
		}),
		foreignKey({
			name: 'loan_person_in_tenant_fk',
			columns: [t.tenantId, t.personId],
			foreignColumns: [person.tenantId, person.id],
		}),
		// The headline rule (spec §8 :351–352; slices §1.2's SQL block, verbatim
		// but for the drizzle-kit-generated index name): at most one `active` or
		// `overdue` loan per asset. `draft` rows are deliberately outside the
		// predicate — two phones may each hold a draft for one asset; the
		// conflict resolves at finalize (I2), not at draft (slices §1.2).
		uniqueIndex('loan_one_live_per_asset')
			.on(t.tenantId, t.assetId)
			.where(sql`${t.state} in ('active', 'overdue')`),
	],
);

/**
 * `inspection` — spec §8 data model, fourth bullet (:343): "condition, notes,
 * actor, media references." Recorded at checkout (spec §8 step 3) and at
 * return (steps 2–3) — `kind` distinguishes the two, `check`-constrained
 * rather than `pgEnum` because this is a closed vocabulary tag, not a state
 * machine with edges to prove complete (contrast `asset_state`/`loan_state`).
 *
 * `mediaRefs` is a jsonb array of media object ids. Deliberately NOT a foreign
 * key: `media_object` is I5's own migration (I1 predecessor is I1 alone; I5's
 * only predecessor is also I1, and I2/I3 read `stored_verified` media rows
 * that may not exist yet when this table is created). I2/I3's finalize guard
 * is what checks every referenced id is `stored_verified`, at write time, not
 * this schema.
 */
export const inspection = pgTable(
	'inspection',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		loanId: uuid('loan_id').notNull(),
		kind: text('kind').notNull(),
		condition: text('condition').notNull(),
		notes: text('notes'),
		actorId: uuid('actor_id').notNull(),
		mediaRefs: jsonb('media_refs')
			.notNull()
			.default(sql`'[]'::jsonb`),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		foreignKey({
			name: 'inspection_loan_in_tenant_fk',
			columns: [t.tenantId, t.loanId],
			foreignColumns: [loan.tenantId, loan.id],
		}),
		foreignKey({
			name: 'inspection_actor_in_tenant_fk',
			columns: [t.tenantId, t.actorId],
			foreignColumns: [person.tenantId, person.id],
		}),
		check('inspection_kind', sql`${t.kind} in (${sqlStringList(INSPECTION_KINDS)})`),
	],
);

/**
 * `location_observation` — spec §8 data model, fifth bullet (:344–345):
 * "optional one-shot consented coordinates, purpose, and capture time; never
 * continuous tracking."
 *
 * The table's own existence is the "optional" half: a checkout with no
 * location capture writes no row here at all. `consentedAt` is a SEPARATE
 * timestamp from `capturedAt` on purpose — I3's handler records the consent
 * affirmation and the coordinate capture as two facts even when they land in
 * the same request, because "consented" is the claim this table has to be
 * able to answer for, independent of exactly when the fix was read.
 *
 * No unbounded write path exists to this table anywhere in this slice or any
 * predecessor slice — I3 is the only future writer, and it is a single
 * request-scoped handler (slices §1.4 acceptance: "a grep-shaped test for
 * geolocation API usage").
 */
export const locationObservation = pgTable(
	'location_observation',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		loanId: uuid('loan_id').notNull(),
		purpose: text('purpose').notNull(),
		latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
		longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
		capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
		consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
		actorId: uuid('actor_id').notNull(),
	},
	(t) => [
		foreignKey({
			name: 'location_observation_loan_in_tenant_fk',
			columns: [t.tenantId, t.loanId],
			foreignColumns: [loan.tenantId, loan.id],
		}),
		foreignKey({
			name: 'location_observation_actor_in_tenant_fk',
			columns: [t.tenantId, t.actorId],
			foreignColumns: [person.tenantId, person.id],
		}),
	],
);

/**
 * `repair_case` — spec §8 data model, sixth bullet (:346–347): "opened/closed
 * state, diagnosis, parts/consumables, responsible operator, and disposition."
 *
 * Opened by I4's return handler in the SAME transaction as the loan close and
 * asset quarantine (§2.2 row 5) — `openDisposition` is the return disposition
 * that triggered it (needs_repair / missing_content / damage; `clean` never
 * opens one). Closed by an operator action (§2.1's ASSUMPTION: `quarantined →
 * repair` on starting work, `repair → available`/`→ retired` on close) —
 * `closeDisposition` is null until then.
 *
 * "Open" vs "closed" is `closedAt is null`, not a redundant status column —
 * one fact, one column, matching the field list the spec actually names.
 */
export const repairCase = pgTable(
	'repair_case',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: uuid('tenant_id')
			.notNull()
			.references(() => tenant.tenantId),
		assetId: uuid('asset_id').notNull(),
		loanId: uuid('loan_id'),
		openDisposition: text('open_disposition').notNull(),
		diagnosis: text('diagnosis'),
		partsConsumables: jsonb('parts_consumables')
			.notNull()
			.default(sql`'[]'::jsonb`),
		responsibleOperatorId: uuid('responsible_operator_id'),
		openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		closeDisposition: text('close_disposition'),
		version: integer('version').notNull().default(1),
	},
	(t) => [
		foreignKey({
			name: 'repair_case_asset_in_tenant_fk',
			columns: [t.tenantId, t.assetId],
			foreignColumns: [asset.tenantId, asset.id],
		}),
		foreignKey({
			name: 'repair_case_loan_in_tenant_fk',
			columns: [t.tenantId, t.loanId],
			foreignColumns: [loan.tenantId, loan.id],
		}),
		foreignKey({
			name: 'repair_case_operator_in_tenant_fk',
			columns: [t.tenantId, t.responsibleOperatorId],
			foreignColumns: [person.tenantId, person.id],
		}),
		check('repair_case_open_disposition', sql`${t.openDisposition} in (${sqlStringList(REPAIR_OPEN_DISPOSITIONS)})`),
		check(
			'repair_case_close_disposition',
			sql`${t.closeDisposition} is null or ${t.closeDisposition} in (${sqlStringList(REPAIR_CLOSE_DISPOSITIONS)})`,
		),
	],
);

export type Asset = typeof asset.$inferSelect;
export type NewAsset = typeof asset.$inferInsert;
export type AssetComponent = typeof assetComponent.$inferSelect;
export type NewAssetComponent = typeof assetComponent.$inferInsert;
export type Loan = typeof loan.$inferSelect;
export type NewLoan = typeof loan.$inferInsert;
export type Inspection = typeof inspection.$inferSelect;
export type NewInspection = typeof inspection.$inferInsert;
export type LocationObservation = typeof locationObservation.$inferSelect;
export type NewLocationObservation = typeof locationObservation.$inferInsert;
export type RepairCase = typeof repairCase.$inferSelect;
export type NewRepairCase = typeof repairCase.$inferInsert;
