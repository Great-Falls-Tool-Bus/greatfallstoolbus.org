/**
 * Dependency-free contribution offer contract (TIN-3818; ADR 0014 §5.1).
 *
 * The application surface may render this shape as a read-only preview. It
 * carries no application or contribution state and has no import path to a
 * database, writer, or payment processor. A durable choice, its recording,
 * and every processor handoff remain available only after approval and Active
 * membership.
 */

export const MONTHLY_PRESETS_CENTS = Object.freeze([500, 1000, 2000, 5000]);

export const CUSTOM_MONTHLY_CENTS = Object.freeze({ min: 500, max: 50_000 });

export const CUSTOM_ANNUAL_CENTS = Object.freeze({ min: 6_000, max: 600_000 });

export type ContributionChoice =
	| { kind: 'zero' }
	| { kind: 'cash' }
	| { kind: 'check' }
	| { kind: 'stripe'; cadence: 'monthly' | 'annual'; amountCents: number };

export interface ContributionOfferShape {
	presetsCents: readonly number[];
	customMonthlyCents: { readonly min: number; readonly max: number };
	customAnnualCents: { readonly min: number; readonly max: number };
	rails: readonly ['cash', 'check'];
}

const PRESETS_WITH_ZERO_CENTS = Object.freeze([0, ...MONTHLY_PRESETS_CENTS]);
const OFFLINE_RAILS = Object.freeze(['cash', 'check'] as const);
const OFFER_SHAPE: ContributionOfferShape = Object.freeze({
	presetsCents: PRESETS_WITH_ZERO_CENTS,
	customMonthlyCents: CUSTOM_MONTHLY_CENTS,
	customAnnualCents: CUSTOM_ANNUAL_CENTS,
	rails: OFFLINE_RAILS,
});

export function contributionOfferShape(): ContributionOfferShape {
	return OFFER_SHAPE;
}
