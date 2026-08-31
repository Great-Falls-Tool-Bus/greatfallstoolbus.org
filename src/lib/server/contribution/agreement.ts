/**
 * Contribution choice validation and the agreement aggregate (TIN-3818
 * scaffold; spec §5 "Contribution subsystem", slices §1.10/§3.3).
 *
 * The choice set is EXACTLY spec §5's: $0, the $5/$10/$20/$50 monthly presets,
 * server-validated integer-cent custom amounts ($5–$500 monthly or $60–$6,000
 * annually), cash, and check. The application surface may preview those
 * choices, but a durable choice, its recording, and every processor handoff
 * remain available only after approval and Active membership (ADR 0014 §5.1).
 * The visual slider is never payment authority; this module is.
 *
 * Every write here takes the transaction handle `withTenant` hands out, so a
 * call site structurally cannot touch another tenant's agreement: the RLS
 * policy on `contribution_agreement` evaluates the GUC `withTenant` pinned.
 *
 * Copy rule (ADR 0014 §0.6 / ADR 0016 §2): the word is "contribution", never
 * "donation" — "donation" carries a tax implication the project cannot
 * support, and all money copy stays recipient-neutral.
 */

import { eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { contributionAgreement, type ContributionAgreement } from '../db/schema';

import {
	CUSTOM_ANNUAL_CENTS,
	CUSTOM_MONTHLY_CENTS,
	MONTHLY_PRESETS_CENTS,
	type ContributionChoice,
} from './offer-contract';

export {
	CUSTOM_ANNUAL_CENTS,
	CUSTOM_MONTHLY_CENTS,
	MONTHLY_PRESETS_CENTS,
	type ContributionChoice,
} from './offer-contract';

export class ContributionChoiceError extends Error {}

/**
 * Validate a raw choice into the closed set, fail-closed.
 *
 * Cents are validated as SAFE INTEGERS before range checks: `1000.5`, `NaN`,
 * and `Infinity` are all rejections, not roundings — rounding money on the
 * server is inventing an amount nobody chose.
 */
export function validateChoice(raw: { kind: string; cadence?: string; amountCents?: unknown }): ContributionChoice {
	switch (raw.kind) {
		case 'zero':
			return { kind: 'zero' };
		case 'cash':
			return { kind: 'cash' };
		case 'check':
			return { kind: 'check' };
		case 'stripe':
			break;
		default:
			throw new ContributionChoiceError(`unknown contribution kind ${JSON.stringify(raw.kind)}`);
	}

	const cadence = raw.cadence;
	if (cadence !== 'monthly' && cadence !== 'annual') {
		throw new ContributionChoiceError(`stripe choice requires cadence monthly|annual, got ${JSON.stringify(cadence)}`);
	}
	const cents = raw.amountCents;
	if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) {
		throw new ContributionChoiceError('amountCents must be an integer number of cents');
	}
	const bounds = cadence === 'monthly' ? CUSTOM_MONTHLY_CENTS : CUSTOM_ANNUAL_CENTS;
	const isPreset = cadence === 'monthly' && MONTHLY_PRESETS_CENTS.includes(cents);
	if (!isPreset && (cents < bounds.min || cents > bounds.max)) {
		throw new ContributionChoiceError(
			`amountCents ${cents} outside the ${cadence} bounds [${bounds.min}, ${bounds.max}]`,
		);
	}
	return { kind: 'stripe', cadence, amountCents: cents };
}

/** The state a fresh choice lands the agreement in (spec §5 enum). */
export function stateForChoice(choice: ContributionChoice): ContributionAgreement['state'] {
	switch (choice.kind) {
		case 'zero':
			return 'zero';
		case 'cash':
		case 'check':
			return 'cash_pending';
		case 'stripe':
			return 'stripe_pending';
	}
}

export interface ChooseContributionInput {
	tenantId: string;
	personId: string;
	choice: ContributionChoice;
	helpRequested?: boolean;
}

/**
 * Record (or revise) a person's contribution choice — one agreement per
 * person, `unique (tenant_id, person_id)`. Revision bumps `version`; the
 * agreement is a mutable projection, unlike `finance_receipt`, which is the
 * append-only record of money actually received.
 *
 * $0 creates NO Stripe object anywhere downstream (spec §5) — this function
 * never talks to Stripe at all; `$lib/server/stripe/checkout.ts` owns that
 * boundary and is tested with a counting stub.
 */
export async function chooseContribution(
	tx: DbTransaction,
	input: ChooseContributionInput,
): Promise<ContributionAgreement> {
	const choice = input.choice;
	const values = {
		tenantId: input.tenantId,
		personId: input.personId,
		state: stateForChoice(choice),
		rail: choice.kind === 'stripe' ? 'stripe' : choice.kind,
		cadence: choice.kind === 'stripe' ? choice.cadence : null,
		amountCents: choice.kind === 'stripe' ? choice.amountCents : choice.kind === 'zero' ? 0 : null,
		helpRequested: input.helpRequested ?? false,
		offeredAt: new Date(),
	};
	const [row] = await tx
		.insert(contributionAgreement)
		.values(values)
		.onConflictDoUpdate({
			target: [contributionAgreement.tenantId, contributionAgreement.personId],
			set: {
				state: values.state,
				rail: values.rail,
				cadence: values.cadence,
				amountCents: values.amountCents,
				helpRequested: values.helpRequested,
				version: sql`${contributionAgreement.version} + 1`,
			},
		})
		.returning();
	return row;
}

/** The agreement for one person, or undefined. Finance-only fields included — route it through `visibility.ts`. */
export async function getAgreement(tx: DbTransaction, personId: string): Promise<ContributionAgreement | undefined> {
	const rows = await tx
		.select()
		.from(contributionAgreement)
		.where(eq(contributionAgreement.personId, personId))
		.limit(1);
	return rows[0];
}

/** Move an agreement to a new lifecycle state (projection writes use this). */
export async function setAgreementState(
	tx: DbTransaction,
	personId: string,
	state: ContributionAgreement['state'],
): Promise<ContributionAgreement | undefined> {
	const rows = await tx
		.update(contributionAgreement)
		.set({ state, version: sql`${contributionAgreement.version} + 1` })
		.where(eq(contributionAgreement.personId, personId))
		.returning();
	return rows[0];
}
