/**
 * The member-facing contribution OFFER (TIN-3818 presentation contract;
 * spec §5:230–232; ADR 0014 §5).
 *
 * This module is the one place the offer's shape and the form-to-choice
 * parsing live, so the page and the validator cannot drift apart: the page
 * renders exactly what `contributionOfferShape()` serves, and every submitted
 * form runs through `parseOfferForm` → `validateChoice` — the server is
 * payment authority, "the visual slider is never payment authority"
 * (ADR 0014 §5).
 *
 * The choice set is EXACTLY TIN-3818's: $0/$5/$10/$20/$50 monthly presets,
 * custom monthly $5–$500, custom annual $60–$6,000 (integer cents,
 * server-validated), cash, and check — cash and check first-class rails,
 * equal to card in every membership consequence (ADR 0016 §3.1).
 *
 * PRESENTATION / RECORDING SPLIT (TIN-4227 ruling, replacing ADR 0014 §5's
 * stale "offer appears only after approval" wording): the pure
 * `contributionOfferShape()` may render before approval as a read-only
 * preview. No preview value is submitted or retained. Parsing, recording a
 * durable choice, and every payment rail remain behind the ACTIVE-membership
 * route (member-projection-flow.mmd hangs that mutation off Active). Skipping
 * the durable offer is valid; $0 is a real recorded choice once chosen there,
 * not an absence.
 *
 * Copy rule (ADR 0014 §0.6 / ADR 0016 §2): "contribution", never "donation".
 *
 * IMPORT BOUNDARY: this module reads only contribution code and the schema —
 * never `$lib/server/membership/**` (the structural converse of "membership
 * transitions never query contribution state", spec §5:225).
 */

import type { ContributionAgreement } from '../db/schema';
import {
	CUSTOM_ANNUAL_CENTS,
	CUSTOM_MONTHLY_CENTS,
	MONTHLY_PRESETS_CENTS,
	ContributionChoiceError,
	validateChoice,
	type ContributionChoice,
} from './agreement';

/**
 * The closed shape the offer page renders, served by the server so the UI
 * has no numeric authority of its own. `presetsCents` includes 0: TIN-3818
 * names the presets "$0, $5, $10, $20, $50 monthly" — $0 is a preset in the
 * presentation and the `zero` kind in the aggregate.
 */
export interface ContributionOfferShape {
	presetsCents: readonly number[];
	customMonthlyCents: { readonly min: number; readonly max: number };
	customAnnualCents: { readonly min: number; readonly max: number };
	rails: readonly ['cash', 'check'];
}

export function contributionOfferShape(): ContributionOfferShape {
	return {
		presetsCents: Object.freeze([0, ...MONTHLY_PRESETS_CENTS]),
		customMonthlyCents: CUSTOM_MONTHLY_CENTS,
		customAnnualCents: CUSTOM_ANNUAL_CENTS,
		rails: ['cash', 'check'],
	};
}

/**
 * A member's read of their OWN contribution — their data, their session.
 * The keyholder read is NOT this: keyholders get exactly
 * `keyholderContributionView` = `{ offered, helpRequested }` (visibility.ts;
 * spec §5:222–225) and nothing on any keyholder surface may serve this shape.
 */
export interface MemberContributionView {
	/** spec §5:216–220 member-facing vocabulary; 'none' = no choice yet. */
	state: ContributionAgreement['state'] | 'none';
	rail: string | null;
	cadence: string | null;
	amountCents: number | null;
	helpRequested: boolean;
	/** Agreement row version — carried so a revising form can detect staleness. */
	version: number | null;
}

export function memberContributionView(agreement: ContributionAgreement | undefined): MemberContributionView {
	if (!agreement) {
		return { state: 'none', rail: null, cadence: null, amountCents: null, helpRequested: false, version: null };
	}
	return {
		state: agreement.state,
		rail: agreement.rail,
		cadence: agreement.cadence,
		amountCents: agreement.amountCents,
		helpRequested: agreement.helpRequested,
		version: agreement.version,
	};
}

/**
 * Whole-string dollar amount: optional `$`, digits, at most two decimals.
 * Sub-cent fractions are REJECTIONS, not roundings — rounding money on the
 * server is inventing an amount nobody chose (agreement.ts rule, carried to
 * the form boundary).
 */
const DOLLARS_RE = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/;

export function parseDollarsToCents(raw: string): number {
	const match = DOLLARS_RE.exec(raw.trim());
	if (!match) {
		throw new ContributionChoiceError(`amount must be a dollar figure like 12 or 12.50, got ${JSON.stringify(raw)}`);
	}
	const dollars = Number.parseInt(match[1], 10);
	const cents = match[2] ? Number.parseInt(match[2].padEnd(2, '0'), 10) : 0;
	return dollars * 100 + cents;
}

export interface OfferSubmission {
	choice: ContributionChoice;
	helpRequested: boolean;
}

function formString(form: FormData, name: string): string {
	const value = form.get(name);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new ContributionChoiceError(`missing form field ${JSON.stringify(name)}`);
	}
	return value.trim();
}

/**
 * Parse the offer form into a validated choice. One radio group, `pick`,
 * carries the whole selection (no client script required):
 *
 *   zero | preset:<cents> | custom_monthly | custom_annual | cash | check
 *
 * with `amount` (a dollar figure) read only for the custom kinds and
 * `helpRequested=true` an independent checkbox. Every path terminates in
 * `validateChoice` — one authority for the closed set and the integer-cent
 * bounds (500–50000 monthly, 6000–600000 annual), so a form bug cannot
 * loosen what spec §5:230–232 pins.
 */
export function parseOfferForm(form: FormData): OfferSubmission {
	const pick = formString(form, 'pick');
	const helpRequested = form.get('helpRequested') === 'true';

	if (pick === 'zero') return { choice: validateChoice({ kind: 'zero' }), helpRequested };
	if (pick === 'cash') return { choice: validateChoice({ kind: 'cash' }), helpRequested };
	if (pick === 'check') return { choice: validateChoice({ kind: 'check' }), helpRequested };

	if (pick.startsWith('preset:')) {
		const cents = Number.parseInt(pick.slice('preset:'.length), 10);
		if (cents === 0) {
			// The $0 preset IS the zero kind: recorded as a real choice, and no
			// processor object exists or ever will (spec §5:233).
			return { choice: validateChoice({ kind: 'zero' }), helpRequested };
		}
		if (!MONTHLY_PRESETS_CENTS.includes(cents)) {
			throw new ContributionChoiceError(`${JSON.stringify(pick)} is not one of the monthly presets`);
		}
		return { choice: validateChoice({ kind: 'stripe', cadence: 'monthly', amountCents: cents }), helpRequested };
	}

	if (pick === 'custom_monthly' || pick === 'custom_annual') {
		return {
			choice: validateChoice({
				kind: 'stripe',
				cadence: pick === 'custom_monthly' ? 'monthly' : 'annual',
				amountCents: parseDollarsToCents(formString(form, 'amount')),
			}),
			helpRequested,
		};
	}

	throw new ContributionChoiceError(`unknown offer pick ${JSON.stringify(pick)}`);
}
