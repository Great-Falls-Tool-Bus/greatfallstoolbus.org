/**
 * Inventory pilot constants (TIN-3814 slice I1).
 *
 * Authority: meta `spec/inventory-pilot-executable-slices-2026-08-20.md`
 * §1.2 (I1 inputs); ADR 0014 §7 (:190, loans default seven days); launch spec
 * §8 (:349–351, the asset and loan state lists).
 *
 * These arrays are the single source of truth for the two state enums in
 * `./schema.ts` — `pgEnum` is built FROM them, not restated beside them, so
 * the database vocabulary and the constant used by iteration-complete tests
 * (I2's "every unlisted transition fails until covered" idiom) can never
 * drift apart.
 */

/** Launch spec §8 (:349): asset lifecycle states, in the order the ratified
 *  diagram (`inventory-custody-flow.mmd`) draws them. */
export const ASSET_STATES = ['available', 'checked_out', 'repair', 'quarantined', 'retired'] as const;

/** Launch spec §8 (:350): loan lifecycle states. */
export const LOAN_STATES = ['draft', 'active', 'overdue', 'returned', 'cancelled'] as const;

export type AssetState = (typeof ASSET_STATES)[number];
export type LoanState = (typeof LOAN_STATES)[number];

/** Expected asset rows distinguish reusable contents from consumables. */
export const ASSET_COMPONENT_KINDS = ['content', 'consumable'] as const;
export type AssetComponentKind = (typeof ASSET_COMPONENT_KINDS)[number];

/**
 * ADR 0014 §7 (:190): "Loans default to seven days." Spec §8 checkout step 2
 * (:361–362): "seven-day due date." Consumed at finalize (I2/I3) to compute
 * `expected_return_at = now() + DEFAULT_LOAN_TERM_DAYS`, and by I8's
 * self-service extension (`due_at += 7 d`, slices §1.9).
 */
export const DEFAULT_LOAN_TERM_DAYS = 7;

/**
 * Inspection is recorded at exactly these two points in the custody cycle
 * (spec §8 checkout step 3 / return steps 2–3). Not an enum in the schema —
 * `check`-constrained text, the same idiom `finance_receipt.rail` uses for a
 * closed-but-non-FSM vocabulary (schema.ts already documents why loan/asset
 * state get `pgEnum` and this kind of field does not: this list is not itself
 * a state machine with transitions to prove complete).
 */
export const INSPECTION_KINDS = ['checkout', 'return'] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

/**
 * Return-time dispositions (spec §8 :377–378) — the four outcomes I4's return
 * handler records. `clean` returns the asset to `available`; the other three
 * open a `repair_case` and quarantine the asset (§2.2 rows 4–5).
 */
export const RETURN_DISPOSITIONS = ['clean', 'needs_repair', 'missing_content', 'damage'] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

/** The subset of `RETURN_DISPOSITIONS` that opens a `repair_case` (all but `clean`). */
export const REPAIR_OPEN_DISPOSITIONS = RETURN_DISPOSITIONS.filter(
	(d): d is Exclude<ReturnDisposition, 'clean'> => d !== 'clean',
);

/**
 * `repair_case` close outcomes (§2.1: `repair → available` on a serviceable
 * close, `→ retired` otherwise). Operator-recorded, not inferred.
 */
export const REPAIR_CLOSE_DISPOSITIONS = ['serviceable', 'retired'] as const;
export type RepairCloseDisposition = (typeof REPAIR_CLOSE_DISPOSITIONS)[number];
