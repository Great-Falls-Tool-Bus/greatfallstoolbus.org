/**
 * Hosted Checkout initiation rows (TIN-3818; spec §5 Stripe path).
 */

import { describe, expect, it } from 'vitest';
import { CheckoutRailError, createContributionCheckout } from './checkout';
import { ContributionChoiceError } from '../contribution/agreement';
import { createReplayGateway, FIXTURE } from './fixtures';

const urls = { successUrl: 'https://example.test/ok', cancelUrl: 'https://example.test/back' };
const personId = FIXTURE.personId;

describe('$0 issues zero Stripe calls', () => {
	it('short-circuits before the gateway — asserted by the counting stub', async () => {
		const gateway = createReplayGateway();
		const outcome = await createContributionCheckout(gateway, { personId, choice: { kind: 'zero' }, ...urls });
		expect(outcome.kind).toBe('zero');
		expect(gateway.calls).toEqual([]);
	});
});

describe('rails do not collapse', () => {
	it('refuses to route cash or check through Checkout, with zero gateway calls', async () => {
		const gateway = createReplayGateway();
		for (const kind of ['cash', 'check'] as const) {
			await expect(createContributionCheckout(gateway, { personId, choice: { kind }, ...urls })).rejects.toThrow(
				CheckoutRailError,
			);
		}
		expect(gateway.calls).toEqual([]);
	});
});

describe('server-side integer-cent validation at the boundary', () => {
	const gateway = () => createReplayGateway();

	it('accepts every preset and the exact custom bounds', async () => {
		for (const amountCents of [500, 1000, 2000, 5000, 50_000]) {
			const outcome = await createContributionCheckout(gateway(), {
				personId,
				choice: { kind: 'stripe', cadence: 'monthly', amountCents },
				...urls,
			});
			expect(outcome.kind).toBe('session');
		}
		for (const amountCents of [6000, 600_000]) {
			const outcome = await createContributionCheckout(gateway(), {
				personId,
				choice: { kind: 'stripe', cadence: 'annual', amountCents },
				...urls,
			});
			expect(outcome.kind).toBe('session');
		}
	});

	it('rejects one cent outside every bound, non-integers, and NaN — with zero gateway calls', async () => {
		const g = gateway();
		const bad: Array<{ cadence: 'monthly' | 'annual'; amountCents: number }> = [
			{ cadence: 'monthly', amountCents: 499 },
			{ cadence: 'monthly', amountCents: 50_001 },
			{ cadence: 'annual', amountCents: 5_999 },
			{ cadence: 'annual', amountCents: 600_001 },
			{ cadence: 'monthly', amountCents: 1000.5 },
			{ cadence: 'monthly', amountCents: Number.NaN },
		];
		for (const choice of bad) {
			await expect(
				createContributionCheckout(g, { personId, choice: { kind: 'stripe', ...choice }, ...urls }),
			).rejects.toThrow(ContributionChoiceError);
		}
		expect(g.calls).toEqual([]);
	});
});

describe('the created session', () => {
	it('is subscription-mode, test-mode, and carries the person reference for the webhook to project', async () => {
		const gateway = createReplayGateway();
		const outcome = await createContributionCheckout(gateway, {
			personId,
			choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
			...urls,
		});
		expect(outcome.kind).toBe('session');
		if (outcome.kind === 'session') {
			expect(outcome.session.livemode).toBe(false);
			expect(outcome.session.url).toContain('checkout.stripe.com');
		}
		expect(gateway.calls).toHaveLength(1);
		const params = gateway.calls[0].args[0] as {
			mode: string;
			client_reference_id: string;
			metadata: Record<string, string>;
			line_items: Array<{
				price_data: { unit_amount: number; recurring: { interval: string }; product_data: { name: string } };
			}>;
		};
		expect(params.mode).toBe('subscription');
		expect(params.client_reference_id).toBe(personId);
		expect(params.metadata.gftb_person_id).toBe(personId);
		expect(params.line_items[0].price_data.unit_amount).toBe(1000);
		expect(params.line_items[0].price_data.recurring.interval).toBe('month');
		// Copy rule: recipient-neutral, "contribution" never "donation".
		expect(params.line_items[0].price_data.product_data.name.toLowerCase()).toContain('contribution');
		expect(params.line_items[0].price_data.product_data.name.toLowerCase()).not.toContain('donation');
	});
});
