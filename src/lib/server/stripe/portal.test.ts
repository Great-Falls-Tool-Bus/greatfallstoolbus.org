/**
 * Hosted Customer Portal initiation rows (TIN-3818; spec §5 "Hosted Checkout
 * and Customer Portal only"). Previously zero coverage of any kind (S9
 * acceptance row 8's "portal-driven cancellation and refund project
 * correctly" — `git grep -n 'createContributionPortalSession'` found only its
 * own definition and the `client.ts` type import). The CONSEQUENCES of a
 * portal-driven cancellation/refund are proven elsewhere (the webhook-driven
 * `customer.subscription.deleted`/`charge.refunded` projection rows); this
 * file proves the session-creation half the portal itself is responsible for.
 */

import { describe, expect, it } from 'vitest';
import { createContributionPortalSession } from './portal';
import { createReplayGateway, FIXTURE } from './fixtures';

describe('createContributionPortalSession', () => {
	it('opens a portal session for the given customer, test-mode, through the gateway only', async () => {
		const gateway = createReplayGateway();
		const session = await createContributionPortalSession(gateway, {
			customerId: FIXTURE.customerId,
			returnUrl: 'https://example.test/account',
		});
		expect(session.livemode).toBe(false);
		expect(session.url).toContain(FIXTURE.customerId);
		expect(gateway.calls).toEqual([
			{
				method: 'createPortalSession',
				args: [{ customer: FIXTURE.customerId, return_url: 'https://example.test/account' }],
			},
		]);
	});

	it('never accepts or forwards card data — the params are customer + return_url only', async () => {
		const gateway = createReplayGateway();
		await createContributionPortalSession(gateway, {
			customerId: FIXTURE.customerId,
			returnUrl: 'https://example.test/account',
		});
		const params = gateway.calls[0].args[0] as Record<string, unknown>;
		expect(Object.keys(params).sort()).toEqual(['customer', 'return_url']);
	});

	it('propagates a gateway refusal rather than swallowing it (e.g. the live gate closed / keyless stub)', async () => {
		const refusing = createReplayGateway();
		refusing.createPortalSession = async () => {
			throw new Error('forced portal refusal');
		};
		await expect(
			createContributionPortalSession(refusing, { customerId: FIXTURE.customerId, returnUrl: 'https://example.test' }),
		).rejects.toThrow('forced portal refusal');
	});
});
